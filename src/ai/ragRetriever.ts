import { query } from '../db/index.js';
import { generateEmbedding, formatVectorForPg } from './embeddings.js';
import { ExtractedComplaint } from './textExtractor.js';
import { ExtractedEvidence } from './visionExtractor.js';
import { AuthoritativeOrder, CrossCheckResult } from './crossCheck.js';

export interface RetrievedPolicyClause {
  clause_id: string;
  title: string;
  policy_text: string;
  issue_category: string;
  refund_type: string;
  policy_version: string;
  similarity_score: number;
}

export interface AssembledReasoningContext {
  complaint_analysis: ExtractedComplaint;
  evidence_analysis_report: {
    evidence_status: 'CONSISTENT' | 'INCONSISTENT' | 'INCONCLUSIVE';
    extractions: ExtractedEvidence[];
    findings: string[];
    discrepancies: string[];
    max_eligible_subtotal: number;
  };
  verified_order_details: {
    order_id: string;
    customer_id: string;
    restaurant_name: string;
    total_amount: number;
    order_status: string;
    payment_status: string;
    previous_refund_amount: number;
    delivery_timestamp: string | null;
    items: {
      name: string;
      quantity: number;
      price_per_unit: number;
      total_price: number;
    }[];
  };
  retrieved_policy_clauses: RetrievedPolicyClause[];
}

/**
 * Step 4.2: Runtime Semantic Retrieval (RAG)
 * Synthesizes a semantic search query from complaint facts, item names,
 * and evidence status, and retrieves relevant policy clauses using pgvector cosine distance (<=>).
 */
export async function retrieveRelevantPolicies(
  complaint: ExtractedComplaint,
  evidenceStatus: 'CONSISTENT' | 'INCONSISTENT' | 'INCONCLUSIVE',
  order: AuthoritativeOrder,
  limit: number = 4
): Promise<RetrievedPolicyClause[]> {
  // Construct rich contextual semantic query
  const queryText = `
    Complaint Category: ${complaint.issue_category}.
    Affected Food Items: ${complaint.affected_items.join(', ')}.
    Customer Description & Claim: ${complaint.claimed_issue}.
    Requested Resolution: ${complaint.requested_resolution}.
    Evidence Classification Status: ${evidenceStatus}.
  `.trim();

  // Generate 768-dimensional query vector
  const queryEmbedding = await generateEmbedding(queryText);
  const vectorLiteral = formatVectorForPg(queryEmbedding);

  // Hybrid vector search + metadata relevance weighting in PostgreSQL
  const sql = `
    SELECT 
      clause_id,
      title,
      policy_text,
      issue_category,
      refund_type,
      policy_version,
      ROUND((1 - (embedding <=> $1::vector))::numeric, 4) AS similarity_score
    FROM policies
    WHERE (effective_to IS NULL OR effective_to >= CURRENT_DATE)
    ORDER BY (
      -- Category-specific boost
      (CASE WHEN issue_category = $2 THEN 0.35 ELSE 0.0 END) +
      -- Evidence rule boost if evidence is inconclusive
      (CASE WHEN $3 = 'INCONCLUSIVE' AND issue_category = 'evidence_rule' THEN 0.30 ELSE 0.0 END) +
      -- Essential financial and reporting guardrail boost
      (CASE WHEN issue_category IN ('pricing_cap', 'reporting_window') THEN 0.20 ELSE 0.0 END) +
      -- Cosine semantic similarity score
      (1 - (embedding <=> $1::vector))
    ) DESC
    LIMIT $4;
  `;

  const result = await query(sql, [vectorLiteral, complaint.issue_category, evidenceStatus, limit]);

  return result.rows.map((row) => ({
    clause_id: row.clause_id,
    title: row.title,
    policy_text: row.policy_text,
    issue_category: row.issue_category,
    refund_type: row.refund_type,
    policy_version: row.policy_version,
    similarity_score: Number(row.similarity_score),
  }));
}

/**
 * Step 4.3: Context Assembly
 * Bundles the 4 required inputs specified in the PDF for the Step 5 reasoning agent.
 */
export function assembleReasoningContext(
  complaint: ExtractedComplaint,
  evidenceList: ExtractedEvidence[],
  crossCheck: CrossCheckResult,
  order: AuthoritativeOrder,
  retrievedPolicies: RetrievedPolicyClause[]
): AssembledReasoningContext {
  return {
    complaint_analysis: complaint,
    evidence_analysis_report: {
      evidence_status: crossCheck.evidence_status,
      extractions: evidenceList,
      findings: crossCheck.findings,
      discrepancies: crossCheck.discrepancies,
      max_eligible_subtotal: crossCheck.eligible_refund_subtotal,
    },
    verified_order_details: {
      order_id: order.id,
      customer_id: order.customer_id,
      restaurant_name: order.restaurant_name,
      total_amount: order.total_amount,
      order_status: order.order_status,
      payment_status: order.payment_status,
      previous_refund_amount: order.previous_refund_amount,
      delivery_timestamp: order.delivery_timestamp,
      items: order.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        price_per_unit: i.price_per_unit,
        total_price: i.total_price,
      })),
    },
    retrieved_policy_clauses: retrievedPolicies,
  };
}
