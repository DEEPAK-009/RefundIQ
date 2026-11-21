import crypto from 'crypto';
import { dbPool, query } from '../db/index.js';

export interface RefundExecutionParams {
  requestId: string;
  orderId: string;
  amount: number;
  customerId: string;
  actor: 'SYSTEM_AUTO' | 'HUMAN_REVIEWER';
  actorId?: string;
  reviewerNotes?: string;
}

export interface PaymentGatewayRefundResult {
  success: boolean;
  transaction_id: string;
  idempotency_key: string;
  amount_refunded: number;
  currency: string;
  gateway_status: 'succeeded' | 'pending' | 'failed';
  processed_at: string;
  cumulative_refund: number;
  order_refund_status: 'PARTIAL' | 'FULL';
}

/**
 * Step 7: Refund Execution Engine
 * Executes refunds against a test payment gateway with strict idempotency.
 * RULE: Cumulative refunds must never exceed the total order purchase price.
 */
export async function executePaymentGatewayRefund(
  params: RefundExecutionParams
): Promise<PaymentGatewayRefundResult> {
  const { requestId, orderId, amount, actor, actorId, reviewerNotes } = params;

  if (amount <= 0) {
    throw new Error(`Refund execution rejected: Amount ₹${amount} must be strictly positive.`);
  }

  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');

    // 1. Authoritative check on dispute & order inside transaction
    const disputeRes = await client.query(
      `SELECT id, status, idempotency_key, payment_refund_id FROM refund_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );

    if (disputeRes.rows.length === 0) {
      throw new Error(`Refund dispute ${requestId} not found.`);
    }

    const dispute = disputeRes.rows[0];

    // Idempotency check: If already executed, return existing transaction safely
    if (dispute.payment_refund_id) {
      console.log(`ℹ️ [PaymentGateway] Idempotent hit: Refund for ${requestId} was already executed (${dispute.payment_refund_id}).`);
      await client.query('ROLLBACK');
      return {
        success: true,
        transaction_id: dispute.payment_refund_id,
        idempotency_key: dispute.idempotency_key,
        amount_refunded: amount,
        currency: 'INR',
        gateway_status: 'succeeded',
        processed_at: new Date().toISOString(),
        cumulative_refund: amount,
        order_refund_status: 'PARTIAL',
      };
    }

    const orderRes = await client.query(
      `SELECT id, total_amount, previous_refund_amount, refund_status FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      throw new Error(`Order ${orderId} not found.`);
    }

    const order = orderRes.rows[0];
    const prevRefunded = Number(order.previous_refund_amount);
    const totalOrderAmount = Number(order.total_amount);

    // Rule: Cumulative refunds must never exceed total order amount
    if (prevRefunded + amount > totalOrderAmount) {
      throw new Error(
        `Financial rule violation: Cumulative refund (₹${prevRefunded} + ₹${amount} = ₹${prevRefunded + amount}) exceeds total order amount of ₹${totalOrderAmount}.`
      );
    }

    // 2. Generate Idempotency Key & Test Gateway Transaction ID
    const idempotencyKey = dispute.idempotency_key || `idemp_${requestId}_${crypto.randomBytes(4).toString('hex')}`;
    const transactionId = `rfnd_test_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

    const newCumulativeRefund = Number((prevRefunded + amount).toFixed(2));
    const newOrderRefundStatus = newCumulativeRefund >= totalOrderAmount ? 'FULL' : 'PARTIAL';

    // 3. Update orders table with cumulative refund amount and refund status
    await client.query(
      `UPDATE orders 
       SET 
         previous_refund_amount = $1,
         refund_status = $2
       WHERE id = $3`,
      [newCumulativeRefund, newOrderRefundStatus, orderId]
    );

    // 4. Update refund_requests table
    const finalDisputeStatus = actor === 'SYSTEM_AUTO' ? 'AUTO_APPROVED' : 'MANUALLY_APPROVED';
    await client.query(
      `UPDATE refund_requests
       SET 
         status = $1,
         final_refund_amount = $2,
         idempotency_key = $3,
         payment_refund_id = $4,
         reviewer_notes = COALESCE($5, reviewer_notes),
         reviewed_by = COALESCE($6, reviewed_by),
         reviewed_at = CASE WHEN $6 IS NOT NULL THEN NOW() ELSE reviewed_at END,
         updated_at = NOW()
       WHERE id = $7`,
      [finalDisputeStatus, amount, idempotencyKey, transactionId, reviewerNotes || null, actorId || null, requestId]
    );

    // 5. Append-only audit log entry
    await client.query(
      `INSERT INTO refund_audit_logs (refund_request_id, event_type, actor, refund_amount, payload)
       VALUES ($1, 'PAYMENT_REFUND_EXECUTED', $2, $3, $4)`,
      [
        requestId,
        actor,
        amount,
        JSON.stringify({
          gateway: 'PaymentGateway_TestMode',
          transaction_id: transactionId,
          idempotency_key: idempotencyKey,
          amount_refunded: amount,
          currency: 'INR',
          new_cumulative_refund: newCumulativeRefund,
          order_refund_status: newOrderRefundStatus,
          reviewer_notes: reviewerNotes || null,
          processed_at: new Date().toISOString(),
        }),
      ]
    );

    await client.query('COMMIT');

    console.log(`💳 [PaymentGateway] Refund of ₹${amount} successfully executed! Transaction ID: ${transactionId}`);

    return {
      success: true,
      transaction_id: transactionId,
      idempotency_key: idempotencyKey,
      amount_refunded: amount,
      currency: 'INR',
      gateway_status: 'succeeded',
      processed_at: new Date().toISOString(),
      cumulative_refund: newCumulativeRefund,
      order_refund_status: newOrderRefundStatus,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ [PaymentGateway] Refund execution failed for dispute ${requestId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}
