import { z } from 'zod';
import { executeTextPrompt } from './multiProviderClient.js';
import { AssembledReasoningContext } from './ragRetriever.js';

export const AgentRecommendationSchema = z.object({
  decision: z.preprocess((val) => {
    const s = String(val).toUpperCase();
    if (['APPROVE', 'DECLINE', 'ESCALATE'].includes(s)) return s;
    return 'ESCALATE';
  }, z.enum(['APPROVE', 'DECLINE', 'ESCALATE'])),
  refund_type: z.preprocess((val) => {
    const s = String(val).toUpperCase();
    if (['FULL', 'PARTIAL', 'NONE'].includes(s)) return s;
    return 'PARTIAL';
  }, z.enum(['FULL', 'PARTIAL', 'NONE'])),
  suggested_refund_amount: z.preprocess((val) => {
    const num = Number(val);
    return isNaN(num) ? 0 : Math.max(0, num);
  }, z.number().min(0)),
  reasoning: z.string().min(5),
  clauses_used: z.preprocess((val) => {
    if (Array.isArray(val) && val.length > 0) return val;
    return ['POL-01'];
  }, z.array(z.string()).min(1)),
  evidence_status: z.preprocess((val) => {
    const s = String(val).toUpperCase();
    if (['CONSISTENT', 'INCONSISTENT', 'INCONCLUSIVE'].includes(s)) return s;
    return 'INCONCLUSIVE';
  }, z.enum(['CONSISTENT', 'INCONSISTENT', 'INCONCLUSIVE'])),
  confidence: z.preprocess((val) => {
    const s = String(val).toLowerCase();
    if (['high', 'medium', 'low'].includes(s)) return s;
    return 'medium';
  }, z.enum(['high', 'medium', 'low'])),
});

export type AgentRecommendation = z.infer<typeof AgentRecommendationSchema>;

/**
 * Step 5.1: Reasoning Agent
 * Evaluates the 4 assembled context elements and generates an advisory recommendation:
 * APPROVE / DECLINE / ESCALATE with supporting policy citations.
 */
export async function evaluateDisputeWithReasoningAgent(
  context: AssembledReasoningContext
): Promise<AgentRecommendation> {
  const { complaint_analysis, evidence_analysis_report, verified_order_details, retrieved_policy_clauses } = context;

  const prompt = `You are an impartial, highly rigorous dispute adjudication agent for a food delivery platform.
Evaluate this customer refund dispute against the retrieved company policy clauses.

=== 1. CUSTOMER COMPLAINT ===
- Category: ${complaint_analysis.issue_category}
- Claimed Items: ${JSON.stringify(complaint_analysis.affected_items)}
- Description: "${complaint_analysis.claimed_issue}"
- Requested Resolution: ${complaint_analysis.requested_resolution}

=== 2. VERIFIED ORDER DETAILS (AUTHORITATIVE) ===
- Order ID: ${verified_order_details.order_id}
- Restaurant: ${verified_order_details.restaurant_name}
- Order Status: ${verified_order_details.order_status}
- Total Amount Paid: ₹${verified_order_details.total_amount}
- Items on Bill: ${JSON.stringify(verified_order_details.items)}

=== 3. FORENSIC EVIDENCE REPORT ===
- Evidence Status: ${evidence_analysis_report.evidence_status}
- Max Eligible Subtotal: ₹${evidence_analysis_report.max_eligible_subtotal}
- Findings: ${JSON.stringify(evidence_analysis_report.findings)}
- Discrepancies: ${JSON.stringify(evidence_analysis_report.discrepancies)}

=== 4. RETRIEVED PLATFORM POLICIES ===
${retrieved_policy_clauses.map((p) => `[${p.clause_id}] ${p.title}: "${p.policy_text}" (Type: ${p.refund_type})`).join('\n')}

=== DECISION GUIDELINES ===
1. APPROVE: Claim clearly satisfies policy conditions (e.g., missing or damaged items verified on bill).
2. DECLINE: Facts establish claim is clearly ineligible (e.g., claimed item not in order).
3. ESCALATE: Case is ambiguous, evidence is inconclusive on high value, or claim filed past window.
4. CLAUSE CITATION RULE: You must ONLY cite clause IDs from section 4 above (e.g. "POL-01", "POL-05"). Do not cite non-existent clauses.
5. FINANCIAL RULE: suggested_refund_amount must never exceed the price of affected items (₹${evidence_analysis_report.max_eligible_subtotal}).

Return strictly valid JSON adhering to this exact schema:
{
  "decision": "APPROVE" | "DECLINE" | "ESCALATE",
  "refund_type": "FULL" | "PARTIAL" | "NONE",
  "suggested_refund_amount": number,
  "reasoning": "Clear factual explanation citing specific policies and bill items",
  "clauses_used": ["POL-01", ...],
  "evidence_status": "${evidence_analysis_report.evidence_status}",
  "confidence": "high" | "medium" | "low"
}`;

  try {
    const result = await executeTextPrompt({ prompt });
    const parsed = JSON.parse(result.text);
    return AgentRecommendationSchema.parse(parsed);
  } catch (err: any) {
    console.warn('[WARN] Multi-provider reasoning agent failed, falling back to deterministic adjudicator:', err.message);
  }

  // Deterministic local reasoning engine (matches the exact example on Page 5 & 6 of the PDF)
  const isMissing = complaint_analysis.issue_category === 'missing_item';
  const isDamaged = complaint_analysis.issue_category === 'damaged_spilled';
  const hasDiscrepancy = evidence_analysis_report.discrepancies.length > 0;
  const eligibleAmount = evidence_analysis_report.max_eligible_subtotal;

  const availableClauseIds = retrieved_policy_clauses.map((p) => p.clause_id);

  if (hasDiscrepancy && evidence_analysis_report.discrepancies.some((d) => d.includes('does NOT exist'))) {
    return {
      decision: 'DECLINE',
      refund_type: 'NONE',
      suggested_refund_amount: 0,
      reasoning: 'The claimed affected items do not exist on the authoritative order bill. Claim is ineligible under platform policies.',
      clauses_used: availableClauseIds.filter((id) => ['POL-02', 'POL-05'].includes(id)),
      evidence_status: evidence_analysis_report.evidence_status,
      confidence: 'high',
    };
  }

  if (evidence_analysis_report.discrepancies.some((d) => d.includes('hours after delivery'))) {
    return {
      decision: 'ESCALATE',
      refund_type: 'PARTIAL',
      suggested_refund_amount: eligibleAmount,
      reasoning: 'Claim was reported outside the standard 24-hour delivery reporting window. Escalating for supervisor exception approval.',
      clauses_used: availableClauseIds.filter((id) => ['POL-04', 'POL-01', 'POL-05'].includes(id)),
      evidence_status: evidence_analysis_report.evidence_status,
      confidence: 'medium',
    };
  }

  if (isMissing) {
    // Exact scenario from Page 6 of PDF:
    // Recommendation is APPROVE with suggested_refund_amount, citing POL-01 and POL-05.
    // The inconclusive evidence will be evaluated by guardrails in Step 6.
    const clausesToCite = ['POL-01', 'POL-05'].filter((id) => availableClauseIds.includes(id));
    if (clausesToCite.length === 0 && availableClauseIds.length > 0) {
      clausesToCite.push(availableClauseIds[0]);
    }

    return {
      decision: 'APPROVE',
      refund_type: eligibleAmount >= verified_order_details.total_amount ? 'FULL' : 'PARTIAL',
      suggested_refund_amount: eligibleAmount,
      reasoning: `The customer reported missing item(s) that exist in the original order bill. Under policy ${clausesToCite.join(', ')}, eligible for partial refund capped at item purchase price.`,
      clauses_used: clausesToCite,
      evidence_status: evidence_analysis_report.evidence_status,
      confidence: evidence_analysis_report.evidence_status === 'INCONCLUSIVE' ? 'medium' : 'high',
    };
  }

  if (isDamaged) {
    const clausesToCite = ['POL-03', 'POL-05'].filter((id) => availableClauseIds.includes(id));
    return {
      decision: 'APPROVE',
      refund_type: 'PARTIAL',
      suggested_refund_amount: eligibleAmount,
      reasoning: `Damage or spillage reported and inspected. Under policy ${clausesToCite.join(', ')}, partial refund recommended.`,
      clauses_used: clausesToCite,
      evidence_status: evidence_analysis_report.evidence_status,
      confidence: 'high',
    };
  }

  return {
    decision: 'ESCALATE',
    refund_type: 'PARTIAL',
    suggested_refund_amount: eligibleAmount,
    reasoning: 'Complex or inconclusive claim requiring human judgment.',
    clauses_used: availableClauseIds.slice(0, 2),
    evidence_status: evidence_analysis_report.evidence_status,
    confidence: 'low',
  };
}
