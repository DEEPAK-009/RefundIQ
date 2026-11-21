import { query } from '../db/index.js';
import { AgentRecommendation, AgentRecommendationSchema } from './reasoningAgent.js';
import { RetrievedPolicyClause } from './ragRetriever.js';

export interface CitationValidationResult {
  is_valid: boolean;
  all_clauses_exist_in_db: boolean;
  all_clauses_were_retrieved: boolean;
  schema_valid: boolean;
  cited_clauses: string[];
  valid_clauses: string[];
  hallucinated_clauses: string[];
  unretrieved_clauses: string[];
  validation_errors: string[];
  requires_escalation: boolean;
  escalation_reason?: string;
}

/**
 * Step 5.2: Backend Citation Validation (Anti-Hallucination Guard)
 * Programmatically verifies that:
 * 1. Every cited clause ID exists in PostgreSQL.
 * 2. Every cited clause was ACTUALLY RETRIEVED in the RAG step for this dispute.
 * 3. Schema adherence and non-negative amounts.
 * 
 * SPEC RULE: Invalid or hallucinated citations trigger escalation rather than being silently accepted.
 */
export async function validateAgentCitations(
  recommendation: AgentRecommendation,
  retrievedPolicies: RetrievedPolicyClause[]
): Promise<CitationValidationResult> {
  const validationErrors: string[] = [];
  const citedClauses = recommendation.clauses_used || [];
  const retrievedClauseIds = new Set(retrievedPolicies.map((p) => p.clause_id));

  // 1. Validate Zod Schema
  const schemaCheck = AgentRecommendationSchema.safeParse(recommendation);
  const schemaValid = schemaCheck.success;
  if (!schemaValid) {
    validationErrors.push(`Agent output failed schema validation: ${JSON.stringify(schemaCheck.error.format())}`);
  }

  // 2. Validate Amount
  if (recommendation.suggested_refund_amount < 0 || isNaN(recommendation.suggested_refund_amount)) {
    validationErrors.push(`Invalid suggested refund amount: ${recommendation.suggested_refund_amount}. Must be non-negative.`);
  }

  // 3. Query PostgreSQL for existence of all cited clauses
  const dbCheckResult = await query(
    `SELECT clause_id FROM policies WHERE clause_id = ANY($1::text[])`,
    [citedClauses]
  );
  const existingDbClauseIds = new Set(dbCheckResult.rows.map((r) => r.clause_id));

  const validClauses: string[] = [];
  const hallucinatedClauses: string[] = [];
  const unretrievedClauses: string[] = [];

  for (const clauseId of citedClauses) {
    const existsInDb = existingDbClauseIds.has(clauseId);
    const wasRetrievedInRag = retrievedClauseIds.has(clauseId);

    if (!existsInDb) {
      hallucinatedClauses.push(clauseId);
      validationErrors.push(`Hallucination detected: Cited clause '${clauseId}' does not exist in platform policy database.`);
    } else if (!wasRetrievedInRag) {
      unretrievedClauses.push(clauseId);
      validationErrors.push(`Unretrieved citation: Clause '${clauseId}' exists in DB but was NOT in the retrieved RAG context for this dispute.`);
    } else {
      validClauses.push(clauseId);
    }
  }

  const allClausesExistInDb = hallucinatedClauses.length === 0;
  const allClausesWereRetrieved = unretrievedClauses.length === 0 && allClausesExistInDb;
  const isValid = schemaValid && allClausesExistInDb && allClausesWereRetrieved && validationErrors.length === 0;

  let requiresEscalation = false;
  let escalationReason: string | undefined;

  if (!isValid) {
    requiresEscalation = true;
    escalationReason = `Citation validation failed: ${validationErrors.join(' | ')}`;
  }

  return {
    is_valid: isValid,
    all_clauses_exist_in_db: allClausesExistInDb,
    all_clauses_were_retrieved: allClausesWereRetrieved,
    schema_valid: schemaValid,
    cited_clauses: citedClauses,
    valid_clauses: validClauses,
    hallucinated_clauses: hallucinatedClauses,
    unretrieved_clauses: unretrievedClauses,
    validation_errors: validationErrors,
    requires_escalation: requiresEscalation,
    escalation_reason: escalationReason,
  };
}
