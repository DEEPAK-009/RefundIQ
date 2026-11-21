import { validateAgentCitations } from '../ai/citationValidator.js';
import { AgentRecommendation } from '../ai/reasoningAgent.js';
import { RetrievedPolicyClause } from '../ai/ragRetriever.js';
import { dbPool } from '../db/index.js';

async function runStep5Tests() {
  console.log('[TEST] Starting Step 5 Verification Tests (Reasoning & Citation Validation)...');

  // Simulated retrieved RAG set for a missing item dispute
  const mockRetrievedPolicies: RetrievedPolicyClause[] = [
    {
      clause_id: 'POL-01',
      title: 'Missing Items Policy',
      policy_text: 'Missing items qualify for partial refund.',
      issue_category: 'missing_item',
      refund_type: 'partial',
      policy_version: 'v1.0',
      similarity_score: 0.85,
    },
    {
      clause_id: 'POL-05',
      title: 'Refund Pricing & Item Cap Policy',
      policy_text: 'Refunds must not exceed item purchase price.',
      issue_category: 'pricing_cap',
      refund_type: 'partial',
      policy_version: 'v1.0',
      similarity_score: 0.78,
    },
    {
      clause_id: 'POL-07',
      title: 'Inconclusive Evidence Review Policy',
      policy_text: 'Inconclusive evidence requires review.',
      issue_category: 'evidence_rule',
      refund_type: 'review',
      policy_version: 'v1.0',
      similarity_score: 0.72,
    },
  ];

  // Test Case 1: Legitimate Agent Recommendation (cites POL-01 and POL-05)
  console.log('\n--- Test Case 1: Valid Recommendation & Legitimate Citations ---');
  const validRecommendation: AgentRecommendation = {
    decision: 'APPROVE',
    refund_type: 'PARTIAL',
    suggested_refund_amount: 100,
    reasoning: 'The customer reported a missing item that exists in the original order bill.',
    clauses_used: ['POL-01', 'POL-05'],
    evidence_status: 'INCONCLUSIVE',
    confidence: 'medium',
  };

  const validResult = await validateAgentCitations(validRecommendation, mockRetrievedPolicies);
  console.log('Result:', {
    is_valid: validResult.is_valid,
    valid_clauses: validResult.valid_clauses,
    requires_escalation: validResult.requires_escalation,
  });

  if (!validResult.is_valid || validResult.requires_escalation) {
    throw new Error('Test Case 1 failed: Valid recommendation was rejected!');
  }
  console.log('[PASS] Test Case 1 Passed: Valid citation passed validation.');

  // Test Case 2: Hallucinated / Non-Existent Clause (cites fake POL-99)
  console.log('\n--- Test Case 2: Hallucinated Clause Detection (Anti-Hallucination Guard) ---');
  const hallucinatedRecommendation: AgentRecommendation = {
    ...validRecommendation,
    clauses_used: ['POL-01', 'POL-99_FAKE_RULE'],
  };

  const hallucinatedResult = await validateAgentCitations(hallucinatedRecommendation, mockRetrievedPolicies);
  console.log('Result:', {
    is_valid: hallucinatedResult.is_valid,
    hallucinated_clauses: hallucinatedResult.hallucinated_clauses,
    requires_escalation: hallucinatedResult.requires_escalation,
    escalation_reason: hallucinatedResult.escalation_reason,
  });

  if (hallucinatedResult.is_valid || !hallucinatedResult.requires_escalation || !hallucinatedResult.hallucinated_clauses.includes('POL-99_FAKE_RULE')) {
    throw new Error('Test Case 2 failed: Hallucinated clause was not caught!');
  }
  console.log('[PASS] Test Case 2 Passed: Fake clause POL-99_FAKE_RULE was caught and triggered escalation.');

  // Test Case 3: Real DB Clause but NOT Retrieved in RAG for this dispute
  console.log('\n--- Test Case 3: Unretrieved Clause Detection ---');
  // POL-03 is a real clause in DB (damaged food), but was not in mockRetrievedPolicies
  const unretrievedRecommendation: AgentRecommendation = {
    ...validRecommendation,
    clauses_used: ['POL-01', 'POL-03'],
  };

  const unretrievedResult = await validateAgentCitations(unretrievedRecommendation, mockRetrievedPolicies);
  console.log('Result:', {
    is_valid: unretrievedResult.is_valid,
    unretrieved_clauses: unretrievedResult.unretrieved_clauses,
    requires_escalation: unretrievedResult.requires_escalation,
    escalation_reason: unretrievedResult.escalation_reason,
  });

  if (unretrievedResult.is_valid || !unretrievedResult.requires_escalation || !unretrievedResult.unretrieved_clauses.includes('POL-03')) {
    throw new Error('Test Case 3 failed: Unretrieved clause was not caught!');
  }
  console.log('[PASS] Test Case 3 Passed: Unretrieved clause POL-03 was caught and triggered escalation.');

  console.log('\nALL STEP 5 CITATION VALIDATION TESTS PASSED!');
  await dbPool.end();
}

runStep5Tests().catch((err) => {
  console.error('[FAIL] Step 5 test failure:', err);
  process.exit(1);
});
