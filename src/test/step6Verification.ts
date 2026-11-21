import { evaluateGuardrails } from '../guardrails/guardrailEngine.js';
import { AgentRecommendation } from '../ai/reasoningAgent.js';
import { CitationValidationResult } from '../ai/citationValidator.js';
import { CrossCheckResult, AuthoritativeOrder } from '../ai/crossCheck.js';
import { CustomerRiskProfile } from '../guardrails/guardrailEngine.js';

function runStep6Tests() {
  console.log('[TEST] Starting Step 6 Verification Tests (Deterministic Guardrails)...\n');

  const baseOrder: AuthoritativeOrder = {
    id: 'ORD1024',
    customer_id: 'CUST101',
    restaurant_id: 'REST001',
    restaurant_name: 'Burger House',
    total_amount: 500,
    order_status: 'Delivered',
    payment_status: 'Successful',
    refund_status: 'NONE',
    previous_refund_amount: 0,
    delivery_timestamp: new Date().toISOString(),
    items: [
      { item_id: '1', name: 'Burger', quantity: 2, price_per_unit: 150, total_price: 300 },
      { item_id: '2', name: 'Fries', quantity: 1, price_per_unit: 100, total_price: 100 },
      { item_id: '3', name: 'Coke', quantity: 1, price_per_unit: 100, total_price: 100 },
    ],
  };

  const goodCustomer: CustomerRiskProfile = {
    id: 'CUST101',
    name: 'Deepak Reddy',
    total_orders: 12,
    refund_count: 1,
    refund_rate: 0.08,
  };

  const validCitationResult: CitationValidationResult = {
    is_valid: true,
    all_clauses_exist_in_db: true,
    all_clauses_were_retrieved: true,
    schema_valid: true,
    cited_clauses: ['POL-01', 'POL-05'],
    valid_clauses: ['POL-01', 'POL-05'],
    hallucinated_clauses: [],
    unretrieved_clauses: [],
    validation_errors: [],
    requires_escalation: false,
  };

  // Test 1: Inconclusive Evidence overrides Agent APPROVE to HUMAN_REVIEW (Page 6 of PDF)
  console.log('--- Test 1: Inconclusive Evidence Guardrail (Page 6 PDF Case) ---');
  const agentApprove: AgentRecommendation = {
    decision: 'APPROVE',
    refund_type: 'PARTIAL',
    suggested_refund_amount: 100,
    reasoning: 'Missing item reported that exists in order.',
    clauses_used: ['POL-01', 'POL-05'],
    evidence_status: 'INCONCLUSIVE',
    confidence: 'medium',
  };

  const crossCheckInconclusive: CrossCheckResult = {
    all_items_exist: true,
    item_checks: [{ item_name: 'Fries', exists_in_order: true, ordered_quantity: 1, price_per_unit: 100, max_eligible_item_amount: 100 }],
    order_delivered: true,
    order_ownership_valid: true,
    eligible_refund_subtotal: 100,
    within_claim_window: true,
    evidence_status: 'INCONCLUSIVE',
    discrepancies: [],
    findings: ['Item verified on bill.'],
  };

  const result1 = evaluateGuardrails(agentApprove, validCitationResult, crossCheckInconclusive, baseOrder, goodCustomer);
  console.log(`Result 1 Routing: ${result1.final_routing}, Amount: ₹${result1.final_refund_amount}`);
  console.log(`Escalation reason: "${result1.escalation_reason}"`);
  if (result1.final_routing !== 'HUMAN_REVIEW' || result1.final_refund_amount !== 100) {
    throw new Error('Test 1 failed: Inconclusive evidence did not trigger HUMAN_REVIEW!');
  }
  console.log('[PASS] Test 1 Passed: Inconclusive evidence routed to HUMAN_REVIEW.\n');

  // Test 2: Financial Amount Clamping (User/Agent asks for ₹500, but only Fries @ ₹100 missing)
  console.log('--- Test 2: Financial Clamping to Item Price ---');
  const greedyAgentRecommendation: AgentRecommendation = {
    ...agentApprove,
    suggested_refund_amount: 500, // Attempting full order refund for single item
  };

  const result2 = evaluateGuardrails(greedyAgentRecommendation, validCitationResult, crossCheckInconclusive, baseOrder, goodCustomer);
  console.log(`Requested: ₹500, Clamped Result Amount: ₹${result2.final_refund_amount}`);
  if (result2.final_refund_amount !== 100) {
    throw new Error('Test 2 failed: Amount was not clamped to eligible item price of ₹100!');
  }
  console.log('[PASS] Test 2 Passed: Amount clamped strictly to ₹100.\n');

  // Test 3: Suspicious Customer History Guard
  console.log('--- Test 3: Suspicious Customer Fraud Guard (CUST103 with 67% refund rate) ---');
  const fraudCustomer: CustomerRiskProfile = {
    id: 'CUST103',
    name: 'Suspicious User',
    total_orders: 3,
    refund_count: 2,
    refund_rate: 0.67,
  };

  const fraudOrder: AuthoritativeOrder = {
    ...baseOrder,
    customer_id: 'CUST103',
  };

  const crossCheckConsistent: CrossCheckResult = {
    ...crossCheckInconclusive,
    evidence_status: 'CONSISTENT',
  };

  const consistentAgent: AgentRecommendation = {
    ...agentApprove,
    evidence_status: 'CONSISTENT',
  };

  const result3 = evaluateGuardrails(consistentAgent, validCitationResult, crossCheckConsistent, fraudOrder, fraudCustomer);
  console.log(`Fraud user routing: ${result3.final_routing}, Escalation: "${result3.escalation_reason}"`);
  if (result3.final_routing !== 'HUMAN_REVIEW' || !result3.escalation_reason?.includes('exceeds safety threshold')) {
    throw new Error('Test 3 failed: Suspicious customer was not flagged!');
  }
  console.log('[PASS] Test 3 Passed: Suspicious customer history triggered HUMAN_REVIEW.\n');

  // Test 4: Auto-Approve Low-Risk Path (Consistent evidence, clean user, verified item, amount <= 500)
  console.log('--- Test 4: Pure AUTO_APPROVE Low-Risk Path ---');
  const result4 = evaluateGuardrails(consistentAgent, validCitationResult, crossCheckConsistent, baseOrder, goodCustomer);
  console.log(`Clean case routing: ${result4.final_routing}, Final Amount: ₹${result4.final_refund_amount}`);
  if (result4.final_routing !== 'AUTO_APPROVE' || result4.final_refund_amount !== 100) {
    throw new Error('Test 4 failed: Clean low-risk case was not AUTO_APPROVED!');
  }
  console.log('[PASS] Test 4 Passed: Clean dispute successfully reached AUTO_APPROVE!\n');

  // Test 5: Auto-Decline Path (Item not in bill)
  console.log('--- Test 5: AUTO_DECLINE (Item not on bill) ---');
  const crossCheckMissingItem: CrossCheckResult = {
    ...crossCheckInconclusive,
    all_items_exist: false,
    discrepancies: ['Item Biryani not in Burger House order'],
  };
  const agentDecline: AgentRecommendation = {
    ...agentApprove,
    decision: 'DECLINE',
    suggested_refund_amount: 0,
    reasoning: 'Item not in order.',
  };
  const result5 = evaluateGuardrails(agentDecline, validCitationResult, crossCheckMissingItem, baseOrder, goodCustomer);
  console.log(`Invalid claim routing: ${result5.final_routing}, Decline reason: "${result5.decline_reason}"`);
  if (result5.final_routing !== 'AUTO_DECLINE' || result5.final_refund_amount !== 0) {
    throw new Error('Test 5 failed: Ineligible dispute was not AUTO_DECLINED!');
  }
  console.log('[PASS] Test 5 Passed: Ineligible dispute successfully reached AUTO_DECLINE!\n');

  console.log('ALL STEP 6 DETERMINISTIC GUARDRAIL TESTS PASSED!');
}

runStep6Tests();
