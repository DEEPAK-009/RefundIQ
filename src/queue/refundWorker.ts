import { Worker, Job } from 'bullmq';
import { REDIS_CONNECTION, REFUND_QUEUE_NAME, RefundJobPayload } from './refundQueue.js';
import { query, dbPool } from '../db/index.js';
import { extractComplaintDetails, ExtractedComplaint } from '../ai/textExtractor.js';
import { analyzeEvidenceImage, ExtractedEvidence } from '../ai/visionExtractor.js';
import { performDeterministicCrossCheck, CrossCheckResult, AuthoritativeOrder } from '../ai/crossCheck.js';
import { retrieveRelevantPolicies, assembleReasoningContext, RetrievedPolicyClause, AssembledReasoningContext } from '../ai/ragRetriever.js';
import { evaluateDisputeWithReasoningAgent, AgentRecommendation } from '../ai/reasoningAgent.js';
import { validateAgentCitations, CitationValidationResult } from '../ai/citationValidator.js';

/**
 * BullMQ Worker Processor (Steps 3, 4 & 5)
 * 1. Text LLM extraction (Complaint understanding)
 * 2. Vision LLM extraction (Photo analysis)
 * 3. Deterministic DB cross-check (item validation & price calculation)
 * 4. Grounded Policy Retrieval via pgvector (RAG) & Context Assembly
 * 5. Reasoning Agent Evaluation & Programmatic Citation Validation
 */
export async function processRefundJob(job: Job<RefundJobPayload>) {
  const { requestId, orderId, customerId } = job.data;
  console.log(`\n========================================================`);
  console.log(`🤖 [Worker] Processing Dispute: ${requestId} for Order: ${orderId}`);
  console.log(`========================================================`);

  // 1. Transition dispute status to 'PROCESSING'
  await query(`UPDATE refund_requests SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1`, [requestId]);

  // 2. Load dispute and authoritative database records
  const disputeRes = await query(`SELECT * FROM refund_requests WHERE id = $1`, [requestId]);
  if (disputeRes.rows.length === 0) {
    throw new Error(`Refund dispute ${requestId} not found in database.`);
  }
  const dispute = disputeRes.rows[0];

  const orderRes = await query(
    `SELECT o.*, r.name AS restaurant_name
     FROM orders o
     JOIN restaurants r ON o.restaurant_id = r.id
     WHERE o.id = $1`,
    [orderId]
  );
  if (orderRes.rows.length === 0) {
    throw new Error(`Order ${orderId} not found in database.`);
  }
  const orderData = orderRes.rows[0];

  const itemsRes = await query(`SELECT * FROM order_items WHERE order_id = $1`, [orderId]);
  const orderItems = itemsRes.rows.map((row) => ({
    item_id: row.id,
    name: row.item_name,
    quantity: row.quantity,
    price_per_unit: Number(row.price_per_unit),
    total_price: Number(row.total_price),
  }));

  const authoritativeOrder: AuthoritativeOrder = {
    id: orderData.id,
    customer_id: orderData.customer_id,
    restaurant_id: orderData.restaurant_id,
    restaurant_name: orderData.restaurant_name,
    total_amount: Number(orderData.total_amount),
    order_status: orderData.order_status,
    payment_status: orderData.payment_status,
    refund_status: orderData.refund_status,
    previous_refund_amount: Number(orderData.previous_refund_amount),
    delivery_timestamp: orderData.delivery_timestamp,
    items: orderItems,
  };

  const evidenceFilesRes = await query(`SELECT * FROM refund_evidence WHERE refund_request_id = $1`, [requestId]);

  // 3. Parallel AI Extractions (Step 3)
  console.log(`🧠 [AI] Running Complaint Understanding (Text LLM)...`);
  const complaintExtraction: ExtractedComplaint = await extractComplaintDetails({
    description: dispute.customer_description,
    issueCategory: dispute.issue_category,
    affectedItems: dispute.affected_items || [],
    requestedResolution: dispute.requested_resolution,
    orderTimestamp: orderData.created_at,
    deliveryTimestamp: orderData.delivery_timestamp,
  });
  console.log(`   Claimed Issue: "${complaintExtraction.claimed_issue}"`);
  console.log(`   Affected Items: [${complaintExtraction.affected_items.join(', ')}]`);

  console.log(`👁️ [AI] Running Evidence Analysis (Vision LLM) on ${evidenceFilesRes.rows.length} image(s)...`);
  const evidenceExtractions: ExtractedEvidence[] = [];
  for (const file of evidenceFilesRes.rows) {
    const analysis = await analyzeEvidenceImage({
      filePath: file.file_path,
      mimeType: file.mime_type,
      originalFilename: file.original_filename,
      claimedCategory: dispute.issue_category,
      claimedItems: dispute.affected_items || [],
    });
    evidenceExtractions.push(analysis);
  }

  // 4. Deterministic Cross-Check & Evidence Classification (Step 3)
  console.log(`⚖️ [CrossCheck] Running deterministic checks against authoritative database records...`);
  const crossCheckResult: CrossCheckResult = performDeterministicCrossCheck(
    complaintExtraction,
    evidenceExtractions,
    authoritativeOrder,
    customerId
  );

  console.log(`   Evidence Classification: [${crossCheckResult.evidence_status}]`);
  console.log(`   Calculated Max Eligible Amount: ₹${crossCheckResult.eligible_refund_subtotal}`);
  crossCheckResult.findings.forEach((f) => console.log(`   ✓ ${f}`));
  crossCheckResult.discrepancies.forEach((d) => console.log(`   ✗ ${d}`));

  // 5. Runtime Semantic Policy Retrieval (RAG via pgvector) (Step 4)
  console.log(`🔍 [RAG] Performing semantic policy retrieval with pgvector cosine similarity...`);
  const retrievedPolicies: RetrievedPolicyClause[] = await retrieveRelevantPolicies(
    complaintExtraction,
    crossCheckResult.evidence_status,
    authoritativeOrder,
    4
  );

  console.log(`   Retrieved ${retrievedPolicies.length} policy clauses:`);
  retrievedPolicies.forEach((p) => {
    console.log(`   → [${p.clause_id}] ${p.title} (similarity: ${p.similarity_score.toFixed(4)}, type: ${p.refund_type})`);
  });

  // Assemble full context
  const assembledContext: AssembledReasoningContext = assembleReasoningContext(
    complaintExtraction,
    evidenceExtractions,
    crossCheckResult,
    authoritativeOrder,
    retrievedPolicies
  );

  // 6. Reasoning Agent Evaluation (Step 5)
  console.log(`🤔 [Reasoning] Evaluating claim against retrieved policy clauses...`);
  const recommendation: AgentRecommendation = await evaluateDisputeWithReasoningAgent(assembledContext);

  console.log(`   Recommendation: [${recommendation.decision}]`);
  console.log(`   Refund Type: [${recommendation.refund_type}], Suggested Amount: ₹${recommendation.suggested_refund_amount}`);
  console.log(`   Reasoning: "${recommendation.reasoning}"`);
  console.log(`   Clauses Used: [${recommendation.clauses_used.join(', ')}]`);

  // 7. Programmatic Citation Validation (Anti-Hallucination Guard) (Step 5)
  console.log(`🛡️ [CitationGuard] Programmatically verifying cited clauses against DB and RAG retrieval set...`);
  const citationValidation: CitationValidationResult = await validateAgentCitations(recommendation, retrievedPolicies);

  if (citationValidation.is_valid) {
    console.log(`   ✓ Citation validation PASSED. All clauses exist and were legitimately retrieved in RAG context.`);
  } else {
    console.warn(`   ⚠️ Citation validation FAILED: ${citationValidation.escalation_reason}`);
    console.warn(`   ⚠️ Overriding decision to ESCALATE due to citation violation.`);
  }

  // 8. Persist Results & Audit Trail in PostgreSQL
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE refund_requests
       SET 
         extracted_complaint = $1,
         extracted_evidence = $2,
         evidence_status = $3,
         retrieved_clauses = $4,
         agent_recommendation = $5,
         citation_validation = $6,
         suggested_refund_amount = $7,
         updated_at = NOW()
       WHERE id = $8`,
      [
        JSON.stringify(complaintExtraction),
        JSON.stringify(evidenceExtractions),
        crossCheckResult.evidence_status,
        JSON.stringify(retrievedPolicies),
        JSON.stringify(recommendation),
        JSON.stringify(citationValidation),
        recommendation.suggested_refund_amount,
        requestId,
      ]
    );

    await client.query(
      `INSERT INTO refund_audit_logs (refund_request_id, event_type, actor, payload)
       VALUES ($1, 'POLICY_REASONING_COMPLETED', 'AI_WORKER', $2)`,
      [
        requestId,
        JSON.stringify({
          recommendation: {
            decision: recommendation.decision,
            refund_type: recommendation.refund_type,
            suggested_amount: recommendation.suggested_refund_amount,
            clauses_used: recommendation.clauses_used,
            confidence: recommendation.confidence,
          },
          citation_validation: {
            is_valid: citationValidation.is_valid,
            hallucinated_clauses: citationValidation.hallucinated_clauses,
            unretrieved_clauses: citationValidation.unretrieved_clauses,
          },
          timestamp: new Date().toISOString(),
        }),
      ]
    );

    await client.query('COMMIT');
    console.log(`💾 [Worker] Successfully persisted reasoning recommendation and citation validation for ${requestId}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ [Worker] Failed to persist worker results for ${requestId}:`, err);
    throw err;
  } finally {
    client.release();
  }

  return {
    requestId,
    evidenceStatus: crossCheckResult.evidence_status,
    eligibleSubtotal: crossCheckResult.eligible_refund_subtotal,
    retrievedClauses: retrievedPolicies.map((p) => p.clause_id),
    recommendation,
    citationValidation,
  };
}

export function createRefundWorker() {
  const worker = new Worker<RefundJobPayload>(
    REFUND_QUEUE_NAME,
    async (job) => {
      return await processRefundJob(job);
    },
    {
      connection: REDIS_CONNECTION,
      concurrency: 2,
    }
  );

  worker.on('ready', () => {
    console.log(`⚡ BullMQ Refund Worker connected and listening for jobs on '${REFUND_QUEUE_NAME}'...`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed with error:`, err);
  });

  return worker;
}
