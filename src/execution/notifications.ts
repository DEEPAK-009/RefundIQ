import { query } from '../db/index.js';

export type NotificationType =
  | 'REFUND_APPROVED'
  | 'REFUND_DECLINED'
  | 'SENT_TO_HUMAN_REVIEW'
  | 'ADDITIONAL_EVIDENCE_REQUIRED'
  | 'REFUND_PROCESSED';

export interface CustomerNotification {
  requestId: string;
  customerId: string;
  orderId: string;
  type: NotificationType;
  title: string;
  message: string;
  refundAmount?: number;
  policyReason?: string;
  timestamp: string;
}

/**
 * Step 7: Customer Notification Dispatcher
 * Dispatches live updates to the customer regarding dispute outcomes.
 */
export async function sendCustomerNotification(
  notification: CustomerNotification
): Promise<void> {
  console.log(`\n[Notification] Dispatching to Customer ${notification.customerId}:`);
  console.log(`   Type: ${notification.type}`);
  console.log(`   Title: "${notification.title}"`);
  console.log(`   Message: "${notification.message}"`);
  if (notification.refundAmount) {
    console.log(`   Amount: ₹${notification.refundAmount}`);
  }

  // Record notification dispatch into the append-only audit trail
  await query(
    `INSERT INTO refund_audit_logs (refund_request_id, event_type, actor, refund_amount, payload)
     VALUES ($1, 'CUSTOMER_NOTIFIED', 'NOTIFICATION_SERVICE', $2, $3)`,
    [
      notification.requestId,
      notification.refundAmount || null,
      JSON.stringify(notification),
    ]
  );
}
