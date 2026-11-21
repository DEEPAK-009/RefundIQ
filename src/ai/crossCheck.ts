import { ExtractedComplaint } from './textExtractor.js';
import { ExtractedEvidence } from './visionExtractor.js';

export interface AuthoritativeOrderItem {
  item_id: string;
  name: string;
  quantity: number;
  price_per_unit: number;
  total_price: number;
}

export interface AuthoritativeOrder {
  id: string;
  customer_id: string;
  restaurant_id: string;
  restaurant_name: string;
  total_amount: number;
  order_status: string;
  payment_status: string;
  refund_status: string;
  previous_refund_amount: number;
  delivery_timestamp: string | null;
  items: AuthoritativeOrderItem[];
}

export interface CrossCheckResult {
  all_items_exist: boolean;
  item_checks: {
    item_name: string;
    exists_in_order: boolean;
    ordered_quantity: number;
    price_per_unit: number;
    max_eligible_item_amount: number;
  }[];
  order_delivered: boolean;
  order_ownership_valid: boolean;
  eligible_refund_subtotal: number;
  within_claim_window: boolean;
  evidence_status: 'CONSISTENT' | 'INCONSISTENT' | 'INCONCLUSIVE';
  discrepancies: string[];
  findings: string[];
}

/**
 * Step 3.3 & 3.4: Deterministic Cross-Check & Evidence Classification
 * Compares AI extractions against authoritative database records.
 * Classifies evidence as CONSISTENT, INCONSISTENT, or INCONCLUSIVE.
 */
export function performDeterministicCrossCheck(
  complaint: ExtractedComplaint,
  evidenceList: ExtractedEvidence[],
  order: AuthoritativeOrder,
  customerId: string
): CrossCheckResult {
  const discrepancies: string[] = [];
  const findings: string[] = [];

  // 1. Verify Ownership & Delivery Status
  const orderOwnershipValid = order.customer_id === customerId;
  if (!orderOwnershipValid) {
    discrepancies.push(`Security violation: Order ${order.id} does not belong to customer ${customerId}.`);
  }

  const orderDelivered = order.order_status.toLowerCase() === 'delivered';
  if (!orderDelivered) {
    discrepancies.push(`Order status is '${order.order_status}'. Non-delivered orders require delivery investigation.`);
  }

  // 2. Check Claim Window (e.g. 24 hours from delivery)
  let withinClaimWindow = true;
  if (order.delivery_timestamp) {
    const deliveryTime = new Date(order.delivery_timestamp).getTime();
    const now = Date.now();
    const hoursElapsed = (now - deliveryTime) / (1000 * 60 * 60);
    if (hoursElapsed > 24) {
      withinClaimWindow = false;
      discrepancies.push(`Complaint filed ${hoursElapsed.toFixed(1)} hours after delivery (window is 24 hours).`);
    } else {
      findings.push(`Complaint filed within acceptable reporting window (${hoursElapsed.toFixed(1)} hours after delivery).`);
    }
  }

  // 3. Item-by-item verification against authoritative bill
  let eligibleRefundSubtotal = 0;
  let allItemsExist = true;

  const itemChecks = complaint.affected_items.map((claimedItem) => {
    const normalizedClaim = claimedItem.trim().toLowerCase();
    
    // Match against bill items
    const matchedItem = order.items.find(
      (item) =>
        item.name.toLowerCase() === normalizedClaim ||
        item.name.toLowerCase().includes(normalizedClaim) ||
        normalizedClaim.includes(item.name.toLowerCase())
    );

    if (matchedItem) {
      const eligibleAmount = Number(matchedItem.price_per_unit);
      eligibleRefundSubtotal += eligibleAmount;
      findings.push(`Claimed item '${claimedItem}' verified on bill (ordered qty: ${matchedItem.quantity}, price: ₹${matchedItem.price_per_unit}).`);
      return {
        item_name: claimedItem,
        exists_in_order: true,
        ordered_quantity: matchedItem.quantity,
        price_per_unit: Number(matchedItem.price_per_unit),
        max_eligible_item_amount: eligibleAmount,
      };
    } else {
      allItemsExist = false;
      discrepancies.push(`Claimed item '${claimedItem}' does NOT exist in the original order items.`);
      return {
        item_name: claimedItem,
        exists_in_order: false,
        ordered_quantity: 0,
        price_per_unit: 0,
        max_eligible_item_amount: 0,
      };
    }
  });

  // 4. Evidence Classification (Consistent / Inconsistent / Inconclusive)
  let evidenceStatus: 'CONSISTENT' | 'INCONSISTENT' | 'INCONCLUSIVE' = 'INCONCLUSIVE';

  const primaryEvidence = evidenceList[0];

  if (!allItemsExist) {
    // If user claims an item not in their order -> Inconsistent
    evidenceStatus = 'INCONSISTENT';
    findings.push('Evidence status: INCONSISTENT because claimed items do not match authoritative bill.');
  } else if (complaint.issue_category === 'missing_item') {
    // Crucial rule from PDF: A photo of an exterior bag cannot prove an item inside was missing.
    // It is INCONCLUSIVE rather than rejected!
    evidenceStatus = 'INCONCLUSIVE';
    findings.push('Evidence status: INCONCLUSIVE. Exterior photo of food delivery packaging cannot conclusively establish that an item was omitted inside.');
  } else if (complaint.issue_category === 'damaged_spilled') {
    if (primaryEvidence && primaryEvidence.visible_spillage_or_damage) {
      evidenceStatus = 'CONSISTENT';
      findings.push('Evidence status: CONSISTENT. Visual inspection confirms visible liquid leakage, spillage, or container damage.');
    } else {
      evidenceStatus = 'INCONCLUSIVE';
      findings.push('Evidence status: INCONCLUSIVE. Uploaded photo does not clearly show physical spillage or crushed packaging.');
    }
  } else if (complaint.issue_category === 'wrong_item') {
    if (primaryEvidence && primaryEvidence.visible_mismatch) {
      evidenceStatus = 'CONSISTENT';
      findings.push('Evidence status: CONSISTENT. Visual mismatch confirmed between ordered item and photo evidence.');
    } else {
      evidenceStatus = 'INCONCLUSIVE';
      findings.push('Evidence status: INCONCLUSIVE. Cannot conclusively determine food mismatch without clear visual item identification.');
    }
  } else if (complaint.issue_category === 'food_quality') {
    if (primaryEvidence && (primaryEvidence.visible_spillage_or_damage || (primaryEvidence.summary_observations && primaryEvidence.summary_observations.length > 10))) {
      evidenceStatus = 'CONSISTENT';
      findings.push('Evidence status: CONSISTENT. Photographic evidence verifying meal condition received.');
    } else {
      evidenceStatus = 'INCONCLUSIVE';
      findings.push('Evidence status: INCONCLUSIVE. Cannot conclusively determine food quality defect from photograph alone.');
    }
  } else {
    evidenceStatus = 'INCONCLUSIVE';
  }

  return {
    all_items_exist: allItemsExist,
    item_checks: itemChecks,
    order_delivered: orderDelivered,
    order_ownership_valid: orderOwnershipValid,
    eligible_refund_subtotal: Math.min(eligibleRefundSubtotal, Number(order.total_amount)),
    within_claim_window: withinClaimWindow,
    evidence_status: evidenceStatus,
    discrepancies,
    findings,
  };
}
