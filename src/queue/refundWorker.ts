import fs from 'fs';
import { Worker, Job } from 'bullmq';
import { REDIS_CONNECTION, REFUND_QUEUE_NAME, RefundJobPayload } from './refundQueue.js';
import { query, dbPool } from '../db/index.js';
import { extractComplaintDetails, ExtractedComplaint } from '../ai/textExtractor.js';
import { analyzeEvidenceImage, ExtractedEvidence } from '../ai/visionExtractor.js';
import { performDeterministicCrossCheck, CrossCheckResult, AuthoritativeOrder } from '../ai/crossCheck.js';
import { retrieveRelevantPolicies, assembleReasoningContext, RetrievedPolicyClause, AssembledReasoningContext } from '../ai/ragRetriever.js';
import { evaluateDisputeWithReasoningAgent, AgentRecommendation } from '../ai/reasoningAgent.js';
import { validateAgentCitations, CitationValidationResult } from '../ai/citationValidator.js';
import { evaluateGuardrails, GuardrailEvaluation, CustomerRiskProfile } from '../guardrails/guardrailEngine.js';
import { executePaymentGatewayRefund } from '../execution/paymentGateway.js';
import { sendCustomerNotification } from '../execution/notifications.js';
import { broadcastDisputeEvent } from '../events/eventBus.js';
import { analyzeImageForensics, ImageForensicResult } from '../utils/imageForensics.js';

/**
 * BullMQ Worker Processor (Steps 3, 4, 5, 6 & 7)
 * 1. Text LLM extraction (Complaint understanding)
 * 2. Vision LLM extraction (Photo analysis)
 * 3. Deterministic DB cross-check (item validation & price calculation)
 * 4. Grounded Policy Retrieval via pgvector (RAG) & Context Assembly
 * 5. Reasoning Agent Evaluation & Programmatic Citation Validation
 * 6. Deterministic Guardrail Layer (Financial caps, duplicate prevention, routing)
 * 7. Automated Execution (for AUTO_APPROVE) or Human Review Queue Dispatch
 */
export async function processRefundJob(job: Job<RefundJobPayload>) {
  const { requestId, orderId, customerId } = job.data;
  console.log(`\n========================================================`);
  console.log(`[Worker] Processing Dispute: ${requestId} for Order: ${orderId}`);
  console.log(`========================================================`);

  // 1. Transition dispute status to 'PROCESSING'
  await query(`UPDATE refund_requests SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1`, [requestId]);
  await broadcastDisputeEvent({
    requestId,
    type: 'STAGE_CHANGE',
    stage: 'AI_EXTRACTION',
    status: 'PROCESSING',
    data: { message: 'AI Worker started: Analyzing complaint and photo evidence' },
  });

  // 2. Load dispute and authoritative database records
  const disputeRes = await query(`SELECT * FROM refund_requests WHERE id = $1`, [requestId]);
  if (disputeRes.rows.length === 0) {
    throw new Error(`Refund dispute ${requestId} not found in database.`);
  }
  const dispute = disputeRes.rows[0];

  const customerRes = await query(`SELECT id, name, total_orders, refund_count, refund_rate FROM customers WHERE id = $1`, [customerId]);
  const customerProfile: CustomerRiskProfile = customerRes.rows[0] || {
    id: customerId,
    name: 'Customer',
    total_orders: 1,
    refund_count: 0,
    refund_rate: 0,
  };

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

  // Zero-Token Local Image Forensics Analysis (Detects internet downloads / screenshots)
  console.log(`[Forensics] Running local 0-token EXIF & provenance analysis on ${evidenceFilesRes.rows.length} image(s)...`);
  const imageForensicsReports: ImageForensicResult[] = [];
  for (const file of evidenceFilesRes.rows) {
    if (file.file_path && fs.existsSync(file.file_path)) {
      const report = await analyzeImageForensics(file.file_path);
      imageForensicsReports.push(report);
      console.log(`   [Forensics] ${file.original_filename}: ${report.classification} — ${report.summary}`);
    }
  }
  const primaryForensics = imageForensicsReports[0];

  // 3. Parallel AI Extractions (Step 3)
  console.log(`[AI] Running Complaint Understanding (Text LLM)...`);
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

  console.log(`[AI] Running Evidence Analysis (Vision LLM) on ${evidenceFilesRes.rows.length} image(s)...`);
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
  console.log(`[CrossCheck] Running deterministic checks against authoritative database records...`);
  const crossCheckResult: CrossCheckResult = performDeterministicCrossCheck(
    complaintExtraction,
    evidenceExtractions,
    authoritativeOrder,
    customerId
  );

  console.log(`   Evidence Classification: [${crossCheckResult.evidence_status}]`);
  console.log(`   Calculated Max Eligible Amount: ₹${crossCheckResult.eligible_refund_subtotal}`);

  // 5. Runtime Semantic Policy Retrieval (RAG via pgvector) (Step 4)
  console.log(`[RAG] Performing semantic policy retrieval with pgvector cosine similarity...`);
  await broadcastDisputeEvent({
    requestId,
    type: 'STAGE_CHANGE',
    stage: 'POLICY_RAG',
    status: 'PROCESSING',
    data: {
      evidence_status: crossCheckResult.evidence_status,
      eligible_amount: crossCheckResult.eligible_refund_subtotal,
    },
  });

  const retrievedPolicies: RetrievedPolicyClause[] = await retrieveRelevantPolicies(
    complaintExtraction,
    crossCheckResult.evidence_status,
    authoritativeOrder,
    4
  );

  console.log(`   Retrieved ${retrievedPolicies.length} policy clauses: [${retrievedPolicies.map((p) => p.clause_id).join(', ')}]`);

  const assembledContext: AssembledReasoningContext = assembleReasoningContext(
    complaintExtraction,
    evidenceExtractions,
    crossCheckResult,
    authoritativeOrder,
    retrievedPolicies
  );

  // 6. Reasoning Agent Evaluation (Step 5)
  console.log(`[Reasoning] Evaluating claim against retrieved policy clauses...`);
  const recommendation: AgentRecommendation = await evaluateDisputeWithReasoningAgent(assembledContext);

  console.log(`   Recommendation: [${recommendation.decision}], Clauses: [${recommendation.clauses_used.join(', ')}]`);

  // 7. Programmatic Citation Validation (Step 5)
  console.log(`[CitationGuard] Programmatically verifying cited clauses against DB and RAG context...`);
  const citationValidation: CitationValidationResult = await validateAgentCitations(recommendation, retrievedPolicies);

  // 8. Deterministic Guardrail Layer (Step 6)
  console.log(`[Guardrails] Applying deterministic business rules & threshold limits...`);
  await broadcastDisputeEvent({
    requestId,
    type: 'STAGE_CHANGE',
    stage: 'GUARDRAILS',
    status: 'PROCESSING',
    data: {
      recommendation: recommendation.decision,
      clauses_used: recommendation.clauses_used,
    },
  });

  const guardrails: GuardrailEvaluation = evaluateGuardrails(
    recommendation,
    citationValidation,
    crossCheckResult,
    authoritativeOrder,
    customerProfile,
    primaryForensics
  );

  console.log(`   Final Routing Decision: [${guardrails.final_routing}]`);
  console.log(`   Final Calculated Refund Amount: ₹${guardrails.final_refund_amount}`);

  const newStatus =
    guardrails.final_routing === 'AUTO_APPROVE'
      ? 'AUTO_APPROVED'
      : guardrails.final_routing === 'AUTO_DECLINE'
      ? 'AUTO_DECLINED'
      : 'ESCALATED';

  // 9. Persist Results & Audit Trail in PostgreSQL
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE refund_requests
       SET 
         status = $1,
         extracted_complaint = $2,
         extracted_evidence = $3,
         evidence_status = $4,
         retrieved_clauses = $5,
         agent_recommendation = $6,
         citation_validation = $7,
         guardrail_results = $8,
         routing_decision = $9,
         escalation_reason = $10,
         suggested_refund_amount = $11,
         final_refund_amount = $12,
         updated_at = NOW()
       WHERE id = $13`,
      [
        newStatus,
        JSON.stringify(complaintExtraction),
        JSON.stringify({ extractions: evidenceExtractions, forensics: imageForensicsReports }),
        crossCheckResult.evidence_status,
        JSON.stringify(retrievedPolicies),
        JSON.stringify(recommendation),
        JSON.stringify(citationValidation),
        JSON.stringify(guardrails.guardrail_checks),
        guardrails.final_routing,
        guardrails.escalation_reason || guardrails.decline_reason || null,
        recommendation.suggested_refund_amount,
        guardrails.final_refund_amount,
        requestId,
      ]
    );

    await client.query(
      `INSERT INTO refund_audit_logs (refund_request_id, event_type, actor, refund_amount, payload)
       VALUES ($1, 'GUARDRAILS_EVALUATED', 'GUARDRAIL_ENGINE', $2, $3)`,
      [
        requestId,
        guardrails.final_refund_amount,
        JSON.stringify({
          final_routing: guardrails.final_routing,
          new_status: newStatus,
          final_refund_amount: guardrails.final_refund_amount,
          escalation_reason: guardrails.escalation_reason,
          decline_reason: guardrails.decline_reason,
          timestamp: new Date().toISOString(),
        }),
      ]
    );

    await client.query('COMMIT');
    console.log(`[Worker] Dispute ${requestId} routed to: ${guardrails.final_routing} (Status: ${newStatus}).`);

    // Broadcast terminal evaluation result via SSE EventBus
    await broadcastDisputeEvent({
      requestId,
      type: 'STATUS_UPDATED',
      stage: 'COMPLETED',
      status: newStatus,
      data: {
        final_routing: guardrails.final_routing,
        final_refund_amount: guardrails.final_refund_amount,
        escalation_reason: guardrails.escalation_reason || guardrails.decline_reason,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[ERROR] [Worker] Failed to persist worker results for ${requestId}:`, err);
    throw err;
  } finally {
    client.release();
  }

  // 10. Step 7: Automatic Refund Execution or Notification Dispatch
  if (guardrails.final_routing === 'AUTO_APPROVE' && guardrails.final_refund_amount > 0) {
    console.log(`[Execution] Triggering automated payment gateway execution for ${requestId}...`);
    const refundResult = await executePaymentGatewayRefund({
      requestId,
      orderId,
      amount: guardrails.final_refund_amount,
      customerId,
      actor: 'SYSTEM_AUTO',
    });

    await sendCustomerNotification({
      requestId,
      customerId,
      orderId,
      type: 'REFUND_PROCESSED',
      title: 'Refund Approved Automatically',
      message: `Your dispute for order ${orderId} was verified and automatically refunded ₹${guardrails.final_refund_amount}. Transaction ID: ${refundResult.transaction_id}.`,
      refundAmount: guardrails.final_refund_amount,
      timestamp: new Date().toISOString(),
    });
  } else if (guardrails.final_routing === 'AUTO_DECLINE') {
    await sendCustomerNotification({
      requestId,
      customerId,
      orderId,
      type: 'REFUND_DECLINED',
      title: 'Refund Request Ineligible',
      message: `Your refund request for order ${orderId} was declined under platform policy: ${guardrails.decline_reason}`,
      policyReason: guardrails.decline_reason,
      timestamp: new Date().toISOString(),
    });
  } else {
    // HUMAN_REVIEW / ESCALATED
    await sendCustomerNotification({
      requestId,
      customerId,
      orderId,
      type: 'SENT_TO_HUMAN_REVIEW',
      title: 'Dispute Routed to Claims Specialist',
      message: `Your dispute for order ${orderId} requires manual review by our claims team. A specialist will review your photos and order details shortly.`,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    requestId,
    evidenceStatus: crossCheckResult.evidence_status,
    finalRouting: guardrails.final_routing,
    finalRefundAmount: guardrails.final_refund_amount,
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
    console.log(`BullMQ Refund Worker connected and listening for jobs on '${REFUND_QUEUE_NAME}'...`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed with error:`, err);
  });

  return worker;
}
