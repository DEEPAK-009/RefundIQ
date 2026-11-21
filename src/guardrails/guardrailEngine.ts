import { AgentRecommendation } from '../ai/reasoningAgent.js';
import { CitationValidationResult } from '../ai/citationValidator.js';
import { CrossCheckResult, AuthoritativeOrder } from '../ai/crossCheck.js';
import { env } from '../config/index.js';
import { ImageForensicResult } from '../utils/imageForensics.js';

export interface CustomerRiskProfile {
  id: string;
  name: string;
  total_orders: number;
  refund_count: number;
  refund_rate: number;
}

export interface GuardrailCheckResult {
  name: string;
  passed: boolean;
  action_taken: string;
  details: string;
}

export interface GuardrailEvaluation {
  final_routing: 'AUTO_APPROVE' | 'AUTO_DECLINE' | 'HUMAN_REVIEW';
  final_refund_amount: number;
  escalation_reason?: string;
  decline_reason?: string;
  guardrail_checks: GuardrailCheckResult[];
}

/**
 * Step 6: Deterministic Guardrail Layer
 * Enforces hard business rules independently of AI reasoning.
 * The AI recommendation is only advisory.
 */
export function evaluateGuardrails(
  recommendation: AgentRecommendation,
  citationValidation: CitationValidationResult,
  crossCheck: CrossCheckResult,
  order: AuthoritativeOrder,
  customer: CustomerRiskProfile,
  forensics?: ImageForensicResult
): GuardrailEvaluation {
  const checks: GuardrailCheckResult[] = [];
  const escalationReasons: string[] = [];
  let declineReason: string | undefined;

  // 1. Order already refunded check
  const alreadyFullyRefunded = order.refund_status === 'FULL';
  const remainingOrderBalance = Math.max(0, order.total_amount - order.previous_refund_amount);

  checks.push({
    name: 'DUPLICATE_REFUND_CHECK',
    passed: !alreadyFullyRefunded,
    action_taken: alreadyFullyRefunded ? 'BLOCK_DUPLICATE' : 'PROCEED',
    details: alreadyFullyRefunded
      ? `Order ${order.id} has already been fully refunded (₹${order.previous_refund_amount}). Duplicate blocked.`
      : `Order balance available: ₹${remainingOrderBalance.toFixed(2)}.`,
  });

  if (alreadyFullyRefunded) {
    return {
      final_routing: 'AUTO_DECLINE',
      final_refund_amount: 0,
      decline_reason: `Order ${order.id} has already been refunded. Duplicate refund requests are blocked.`,
      guardrail_checks: checks,
    };
  }

  // 2. Order ownership check
  const ownsOrder = order.customer_id === customer.id;
  checks.push({
    name: 'CUSTOMER_OWNERSHIP_CHECK',
    passed: ownsOrder,
    action_taken: ownsOrder ? 'PROCEED' : 'REJECT',
    details: ownsOrder
      ? `Order verified to belong to customer ${customer.id}.`
      : `Security breach: Customer ${customer.id} does not own order ${order.id}.`,
  });

  if (!ownsOrder) {
    return {
      final_routing: 'AUTO_DECLINE',
      final_refund_amount: 0,
      decline_reason: `Order ownership verification failed.`,
      guardrail_checks: checks,
    };
  }

  // 3. Item presence and bill consistency check
  checks.push({
    name: 'BILL_ITEMS_EXISTENCE_CHECK',
    passed: crossCheck.all_items_exist,
    action_taken: crossCheck.all_items_exist ? 'PROCEED' : 'REJECT_OR_CORRECT',
    details: crossCheck.all_items_exist
      ? 'All claimed items verified on authoritative bill.'
      : `Claimed items missing from original bill: ${crossCheck.discrepancies.join('; ')}.`,
  });

  if (!crossCheck.all_items_exist) {
    return {
      final_routing: 'AUTO_DECLINE',
      final_refund_amount: 0,
      decline_reason: 'One or more claimed food items do not exist in the original order bill.',
      guardrail_checks: checks,
    };
  }

  // 4. Financial amount bounds and item-level cap calculation
  // RULE: Never trust LLM or frontend refund calculation.
  // The backend clamps the refund amount strictly to the verified affected item prices.
  const rawSuggestedAmount = recommendation.suggested_refund_amount;
  const clampedEligibleAmount = Math.min(
    Math.max(0, crossCheck.eligible_refund_subtotal),
    remainingOrderBalance
  );

  const amountWasClamped = rawSuggestedAmount > clampedEligibleAmount;
  checks.push({
    name: 'FINANCIAL_BOUNDS_CLAMP_CHECK',
    passed: !amountWasClamped,
    action_taken: amountWasClamped ? 'CLAMP_AMOUNT' : 'MAINTAIN_AMOUNT',
    details: amountWasClamped
      ? `Suggested amount ₹${rawSuggestedAmount} exceeded verified item eligible total ₹${clampedEligibleAmount}. Clamped to ₹${clampedEligibleAmount}.`
      : `Amount ₹${clampedEligibleAmount} verified within item and order boundaries.`,
  });

  const finalAmount = clampedEligibleAmount;

  // 5. Inconclusive Evidence Guard
  const evidenceIsInconclusive = crossCheck.evidence_status === 'INCONCLUSIVE';
  checks.push({
    name: 'EVIDENCE_INCONCLUSIVE_GUARD',
    passed: !evidenceIsInconclusive,
    action_taken: evidenceIsInconclusive ? 'ROUTE_HUMAN_REVIEW' : 'PROCEED',
    details: evidenceIsInconclusive
      ? 'Photographic evidence is inconclusive (e.g. exterior bag photo for missing items). Requires human review.'
      : `Evidence classified as ${crossCheck.evidence_status}.`,
  });

  if (evidenceIsInconclusive) {
    escalationReasons.push('Evidence is inconclusive (cannot establish claim fact from exterior packaging photo alone).');
  }

  // 6. Contradictory Evidence Guard
  const evidenceIsInconsistent = crossCheck.evidence_status === 'INCONSISTENT';
  checks.push({
    name: 'EVIDENCE_CONTRADICTION_GUARD',
    passed: !evidenceIsInconsistent,
    action_taken: evidenceIsInconsistent ? 'ROUTE_HUMAN_REVIEW' : 'PROCEED',
    details: evidenceIsInconsistent
      ? 'Evidence directly contradicts claims. Requires investigator review.'
      : 'No evidence contradictions detected.',
  });

  if (evidenceIsInconsistent) {
    escalationReasons.push('Uploaded evidence directly contradicts customer claims.');
  }

  // 7. Suspicious Customer Refund History Guard
  const isSuspicious = customer.refund_rate >= env.SUSPICIOUS_REFUND_RATE_THRESHOLD && customer.total_orders >= 3;
  checks.push({
    name: 'SUSPICIOUS_HISTORY_GUARD',
    passed: !isSuspicious,
    action_taken: isSuspicious ? 'ROUTE_HUMAN_REVIEW' : 'PROCEED',
    details: isSuspicious
      ? `Customer has high dispute frequency (${(customer.refund_rate * 100).toFixed(1)}% refunds across ${customer.total_orders} orders). Threshold is ${(env.SUSPICIOUS_REFUND_RATE_THRESHOLD * 100)}%.`
      : `Customer dispute frequency normal (${(customer.refund_rate * 100).toFixed(1)}%).`,
  });

  if (isSuspicious) {
    escalationReasons.push(`Customer dispute rate (${(customer.refund_rate * 100).toFixed(1)}%) exceeds safety threshold.`);
  }

  // 8. Citation & Policy Integrity Guard
  checks.push({
    name: 'CITATION_INTEGRITY_GUARD',
    passed: citationValidation.is_valid,
    action_taken: citationValidation.is_valid ? 'PROCEED' : 'ROUTE_HUMAN_REVIEW',
    details: citationValidation.is_valid
      ? 'All cited policy clauses verified in database and RAG context.'
      : `Citation validation failed: ${citationValidation.escalation_reason}`,
  });

  if (!citationValidation.is_valid) {
    escalationReasons.push(citationValidation.escalation_reason || 'Policy citation validation failed.');
  }

  // 9. Auto-Approval Maximum Threshold Guard (e.g. ₹500 in config)
  const exceedsAutoThreshold = finalAmount > env.MAX_AUTO_REFUND_AMOUNT;
  checks.push({
    name: 'AUTO_APPROVAL_THRESHOLD_GUARD',
    passed: !exceedsAutoThreshold,
    action_taken: exceedsAutoThreshold ? 'ROUTE_HUMAN_REVIEW' : 'PROCEED',
    details: exceedsAutoThreshold
      ? `Refund amount ₹${finalAmount} exceeds auto-approval ceiling of ₹${env.MAX_AUTO_REFUND_AMOUNT}.`
      : `Refund amount ₹${finalAmount} is within auto-approval ceiling of ₹${env.MAX_AUTO_REFUND_AMOUNT}.`,
  });

  if (exceedsAutoThreshold) {
    escalationReasons.push(`Refund amount ₹${finalAmount} exceeds auto-approval limit of ₹${env.MAX_AUTO_REFUND_AMOUNT}.`);
  }

  // 10. Claim window guard
  if (!crossCheck.within_claim_window) {
    escalationReasons.push('Dispute reported outside 24-hour delivery window.');
  }

  // 11. Zero-Token Image Forensics & Origin Guard (Detects internet downloads / screenshots)
  if (forensics) {
    const isAuthentic = forensics.isCameraCaptured;
    const isWebOrEdited = forensics.classification !== 'AUTHENTIC_CAMERA_CAPTURE';

    checks.push({
      name: 'IMAGE_AUTHENTICITY_FORENSICS_GUARD',
      passed: isAuthentic,
      action_taken: isWebOrEdited ? 'ROUTE_HUMAN_REVIEW' : 'PROCEED',
      details: forensics.summary,
    });

    if (isWebOrEdited) {
      escalationReasons.push(`Forensic metadata warning: ${forensics.summary}`);
    }
  }

  // Final Routing Synthesis:
  // If agent recommended DECLINE or if fundamental facts failed -> AUTO_DECLINE
  if (recommendation.decision === 'DECLINE') {
    return {
      final_routing: 'AUTO_DECLINE',
      final_refund_amount: 0,
      decline_reason: recommendation.reasoning,
      guardrail_checks: checks,
    };
  }

  // If any guardrail flagged for escalation -> HUMAN_REVIEW
  if (escalationReasons.length > 0 || recommendation.decision === 'ESCALATE') {
    return {
      final_routing: 'HUMAN_REVIEW',
      final_refund_amount: finalAmount,
      escalation_reason: escalationReasons.join(' | ') || recommendation.reasoning,
      guardrail_checks: checks,
    };
  }

  // If all conditions passed without exception -> AUTO_APPROVE
  return {
    final_routing: 'AUTO_APPROVE',
    final_refund_amount: finalAmount,
    guardrail_checks: checks,
  };
}
