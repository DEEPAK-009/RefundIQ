import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { executePaymentGatewayRefund } from '../execution/paymentGateway.js';
import { sendCustomerNotification } from '../execution/notifications.js';
import { reviewActionLimiter } from '../middleware/rateLimiter.js';
import { broadcastDisputeEvent } from '../events/eventBus.js';

export const reviewRouter = Router();

const reviewerActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'REQUEST_INFO']),
  reviewer_id: z.string().default('REV_AGENT_01'),
  reviewer_name: z.string().default('Senior Claims Specialist'),
  notes: z.string().min(5, 'Reviewer notes are mandatory for audit compliance (minimum 5 characters)'),
  override_amount: z.number().positive().optional(),
});

/**
 * Step 7.3: Global Audit Trail Explorer
 * Endpoint: GET /api/review/audit-all
 * Returns recent append-only audit trail entries across all disputes
 */
reviewRouter.get('/audit-all', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT a.id, a.refund_request_id, a.event_type, a.actor, a.refund_amount, a.payload, a.created_at
       FROM refund_audit_logs a
       ORDER BY a.created_at DESC
       LIMIT 50`
    );

    res.json({
      success: true,
      audit_logs: result.rows,
    });
  } catch (error) {
    console.error('Error fetching global audit trail:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve audit logs.' });
  }
});

/**
 * Step 7.1: Reviewer Queue
 * Endpoint: GET /api/review/queue
 * Returns all disputes waiting in the Human Review Queue (status = 'ESCALATED')
 */
reviewRouter.get('/queue', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT 
         r.id AS request_id,
         r.status,
         r.order_id,
         r.customer_id,
         c.name AS customer_name,
         c.refund_rate AS customer_refund_rate,
         rest.name AS restaurant_name,
         r.issue_category,
         r.affected_items,
         r.customer_description,
         r.evidence_status,
         r.escalation_reason,
         r.reviewer_notes,
         r.suggested_refund_amount,
         r.final_refund_amount,
         r.created_at
       FROM refund_requests r
       JOIN customers c ON r.customer_id = c.id
       JOIN orders o ON r.order_id = o.id
       JOIN restaurants rest ON o.restaurant_id = rest.id
       WHERE r.status IN ('ESCALATED', 'ACTION_REQUIRED')
       ORDER BY r.created_at ASC`
    );

    res.json({
      success: true,
      pending_review_count: result.rows.length,
      disputes: result.rows,
    });
  } catch (error) {
    console.error('Error fetching review queue:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve review queue.' });
  }
});

/**
 * Step 7.1: Full Reviewer Cockpit View for a Single Dispute
 * Endpoint: GET /api/review/:requestId
 * Displays side-by-side evidence, itemized bill, AI report, retrieved policies, and escalation causes
 */
reviewRouter.get('/:requestId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;

    const requestRes = await query(
      `SELECT r.*, c.name AS customer_name, c.email AS customer_email, c.refund_rate, c.total_orders,
              o.total_amount AS order_total_amount, o.order_status, o.payment_status, 
              o.delivery_timestamp, o.previous_refund_amount, rest.name AS restaurant_name
       FROM refund_requests r
       JOIN customers c ON r.customer_id = c.id
       JOIN orders o ON r.order_id = o.id
       JOIN restaurants rest ON o.restaurant_id = rest.id
       WHERE r.id = $1`,
      [requestId]
    );

    if (requestRes.rows.length === 0) {
      res.status(404).json({ success: false, error: `Dispute ${requestId} not found.` });
      return;
    }

    const dispute = requestRes.rows[0];

    // Fetch order items on the bill
    const itemsRes = await query(`SELECT * FROM order_items WHERE order_id = $1`, [dispute.order_id]);

    // Fetch evidence photos
    const evidenceRes = await query(`SELECT * FROM refund_evidence WHERE refund_request_id = $1`, [requestId]);

    // Fetch complete audit trail
    const auditRes = await query(
      `SELECT event_type, actor, refund_amount, payload, created_at
       FROM refund_audit_logs
       WHERE refund_request_id = $1
       ORDER BY created_at ASC`,
      [requestId]
    );

    res.json({
      success: true,
      cockpit: {
        dispute_id: dispute.id,
        current_status: dispute.status,
        escalation_reason: dispute.escalation_reason,
        customer: {
          id: dispute.customer_id,
          name: dispute.customer_name,
          email: dispute.customer_email,
          total_orders: dispute.total_orders,
          refund_rate: Number(dispute.refund_rate),
        },
        order: {
          id: dispute.order_id,
          restaurant: dispute.restaurant_name,
          total_paid: Number(dispute.order_total_amount),
          previously_refunded: Number(dispute.previous_refund_amount),
          order_status: dispute.order_status,
          delivery_timestamp: dispute.delivery_timestamp,
          items: itemsRes.rows.map((i) => ({
            name: i.item_name,
            quantity: i.quantity,
            price_per_unit: Number(i.price_per_unit),
            total_price: Number(i.total_price),
          })),
        },
        complaint: {
          category: dispute.issue_category,
          affected_items: dispute.affected_items,
          customer_description: dispute.customer_description,
          requested_resolution: dispute.requested_resolution,
          extracted_complaint: dispute.extracted_complaint,
        },
        evidence: {
          evidence_status: dispute.evidence_status,
          extracted_evidence: dispute.extracted_evidence,
          files: evidenceRes.rows.map((f) => ({
            id: f.id,
            filename: f.original_filename,
            stored_path: f.file_path,
            mime_type: f.mime_type,
            size_bytes: f.file_size_bytes,
            sha256_hash: f.sha256_hash,
          })),
        },
        ai_recommendation: dispute.agent_recommendation,
        citation_validation: dispute.citation_validation,
        retrieved_policies: dispute.retrieved_clauses,
        guardrail_checks: dispute.guardrail_results,
        amounts: {
          suggested: Number(dispute.suggested_refund_amount),
          final_calculated: Number(dispute.final_refund_amount),
        },
        audit_trail: auditRes.rows,
      },
    });
  } catch (error) {
    console.error('Error fetching cockpit detail:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve reviewer cockpit details.' });
  }
});

/**
 * Step 7.1 & 7.2: Reviewer Adjudication Action
 * Endpoint: POST /api/review/:requestId/action
 * Reviewer Actions: APPROVE | REJECT | REQUEST_INFO
 * Mandatory reviewer notes required for audit compliance!
 */
reviewRouter.post('/:requestId/action', reviewActionLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;

    const validation = reviewerActionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid reviewer action payload',
        details: validation.error.format(),
      });
      return;
    }

    const { action, reviewer_id, reviewer_name, notes, override_amount } = validation.data;

    // Fetch dispute details
    const disputeRes = await query(`SELECT * FROM refund_requests WHERE id = $1`, [requestId]);
    if (disputeRes.rows.length === 0) {
      res.status(404).json({ success: false, error: `Dispute ${requestId} not found.` });
      return;
    }

    const dispute = disputeRes.rows[0];

    if (!['ESCALATED', 'ACTION_REQUIRED', 'SUBMITTED', 'PROCESSING'].includes(dispute.status)) {
      res.status(400).json({
        success: false,
        error: `Dispute ${requestId} is already resolved with status '${dispute.status}'.`,
      });
      return;
    }

    if (action === 'APPROVE') {
      const finalAmount = override_amount !== undefined ? override_amount : Number(dispute.final_refund_amount);

      // Execute refund through test payment gateway with idempotency
      const refundResult = await executePaymentGatewayRefund({
        requestId,
        orderId: dispute.order_id,
        amount: finalAmount,
        customerId: dispute.customer_id,
        actor: 'HUMAN_REVIEWER',
        actorId: reviewer_id,
        reviewerNotes: notes,
      });

      // Dispatch customer notification
      await sendCustomerNotification({
        requestId,
        customerId: dispute.customer_id,
        orderId: dispute.order_id,
        type: 'REFUND_PROCESSED',
        title: 'Refund Approved & Processed',
        message: `Your refund claim for order ${dispute.order_id} was reviewed and approved for ₹${finalAmount}. Payment transaction ID: ${refundResult.transaction_id}.`,
        refundAmount: finalAmount,
        timestamp: new Date().toISOString(),
      });

      // Broadcast real-time approval event
      await broadcastDisputeEvent({
        requestId,
        type: 'REVIEW_ACTION',
        status: 'MANUALLY_APPROVED',
        data: { action: 'APPROVED', amount: finalAmount, transaction_id: refundResult.transaction_id, notes },
      });

      res.json({
        success: true,
        action: 'APPROVED',
        status: 'MANUALLY_APPROVED',
        dispute_id: requestId,
        amount_refunded: finalAmount,
        transaction_id: refundResult.transaction_id,
        reviewer: `${reviewer_name} (${reviewer_id})`,
        notes,
      });
      return;
    }

    if (action === 'REJECT') {
      await query(
        `UPDATE refund_requests
         SET 
           status = 'MANUALLY_REJECTED',
           reviewer_notes = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
         WHERE id = $3`,
        [notes, reviewer_id, requestId]
      );

      await query(
        `INSERT INTO refund_audit_logs (refund_request_id, event_type, actor, payload)
         VALUES ($1, 'DISPUTE_MANUALLY_REJECTED', 'HUMAN_REVIEWER', $2)`,
        [
          requestId,
          JSON.stringify({
            reviewer_id,
            reviewer_name,
            notes,
            timestamp: new Date().toISOString(),
          }),
        ]
      );

      await sendCustomerNotification({
        requestId,
        customerId: dispute.customer_id,
        orderId: dispute.order_id,
        type: 'REFUND_DECLINED',
        title: 'Refund Claim Declined',
        message: `Your refund claim for order ${dispute.order_id} was reviewed by our claims specialist and declined. Reason: ${notes}.`,
        policyReason: notes,
        timestamp: new Date().toISOString(),
      });

      // Broadcast real-time rejection event
      await broadcastDisputeEvent({
        requestId,
        type: 'REVIEW_ACTION',
        status: 'MANUALLY_REJECTED',
        data: { action: 'REJECTED', notes },
      });

      res.json({
        success: true,
        action: 'REJECTED',
        status: 'MANUALLY_REJECTED',
        dispute_id: requestId,
        reviewer: `${reviewer_name} (${reviewer_id})`,
        notes,
      });
      return;
    }

    if (action === 'REQUEST_INFO') {
      await query(
        `UPDATE refund_requests
         SET 
           status = 'ACTION_REQUIRED',
           reviewer_notes = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
         WHERE id = $3`,
        [notes, reviewer_id, requestId]
      );

      await query(
        `INSERT INTO refund_audit_logs (refund_request_id, event_type, actor, payload)
         VALUES ($1, 'ADDITIONAL_INFORMATION_REQUESTED', 'HUMAN_REVIEWER', $2)`,
        [
          requestId,
          JSON.stringify({
            reviewer_id,
            reviewer_name,
            request_notes: notes,
            timestamp: new Date().toISOString(),
          }),
        ]
      );

      await sendCustomerNotification({
        requestId,
        customerId: dispute.customer_id,
        orderId: dispute.order_id,
        type: 'ADDITIONAL_EVIDENCE_REQUIRED',
        title: 'Additional Information Required',
        message: `Our review team needs additional details regarding order ${dispute.order_id}: ${notes}. Please update your dispute.`,
        timestamp: new Date().toISOString(),
      });

      // Broadcast real-time info request event
      await broadcastDisputeEvent({
        requestId,
        type: 'REVIEW_ACTION',
        status: 'ACTION_REQUIRED',
        data: { action: 'REQUEST_INFO', notes },
      });

      res.json({
        success: true,
        action: 'REQUEST_INFO',
        status: 'ACTION_REQUIRED',
        dispute_id: requestId,
        reviewer: `${reviewer_name} (${reviewer_id})`,
        notes,
      });
      return;
    }
  } catch (error) {
    console.error('Error processing reviewer action:', error);
    res.status(500).json({ success: false, error: 'Failed to process reviewer adjudication.' });
  }
});
