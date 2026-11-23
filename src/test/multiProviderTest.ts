import path from 'path';
import fs from 'fs';
import {
  PROVIDER_REGISTRY,
  executeTextPrompt,
  executeVisionPrompt,
} from '../ai/multiProviderClient.js';
import { extractComplaintDetails } from '../ai/textExtractor.js';
import { analyzeEvidenceImage } from '../ai/visionExtractor.js';
import { evaluateDisputeWithReasoningAgent } from '../ai/reasoningAgent.js';
import { AssembledReasoningContext } from '../ai/ragRetriever.js';

async function runMultiProviderTests() {
  console.log('[TEST] Starting Multi-Provider LLM & Multimodal Verification');

  // 1. Audit Provider Registry Status
  console.log('[TEST] Checking registered provider states:');
  for (const [providerKey, capability] of Object.entries(PROVIDER_REGISTRY)) {
    console.log(
      `[INFO] Provider ${providerKey.toUpperCase()}: Status=${capability.status}, TextModel=${capability.textModel}, VisionModel=${capability.visionModel}`
    );
    console.log(`       Details: ${capability.statusDetails}`);
  }

  // 2. Direct Text Execution via executeTextPrompt
  console.log('\n[TEST] 1. Executing text prompt via executeTextPrompt()...');
  const textPrompt = 'Return a JSON object with keys "status" (string: "ok") and "provider_test" (boolean: true)';
  const textResult = await executeTextPrompt({ prompt: textPrompt });
  console.log(`[PASS] Text prompt executed successfully via [${textResult.provider.toUpperCase()}] in ${textResult.latencyMs}ms`);
  console.log(`[INFO] Output: ${textResult.text}`);

  // 3. Direct Vision Execution via executeVisionPrompt using a sample image
  console.log('\n[TEST] 2. Executing multimodal vision prompt via executeVisionPrompt()...');
  const uploadsDir = path.resolve(process.cwd(), 'storage/uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Find an existing image or create a minimal 1x1 test JPEG
  let testImagePath = path.join(uploadsDir, 'provider_test.jpg');
  const existingFiles = fs.readdirSync(uploadsDir).filter((f) => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg'));
  if (existingFiles.length > 0) {
    testImagePath = path.join(uploadsDir, existingFiles[0]);
    console.log(`[INFO] Using existing image file: ${testImagePath}`);
  } else {
    // 1x1 base64 JPEG
    const minimalJpgBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    fs.writeFileSync(testImagePath, Buffer.from(minimalJpgBase64, 'base64'));
    console.log(`[INFO] Created test JPEG: ${testImagePath}`);
  }

  const visionPrompt = 'Analyze this image and return JSON with "image_detected": true, "summary": "brief description"';
  const visionResult = await executeVisionPrompt({
    prompt: visionPrompt,
    filePath: testImagePath,
    mimeType: 'image/jpeg',
  });
  console.log(`[PASS] Vision prompt executed successfully via [${visionResult.provider.toUpperCase()}] in ${visionResult.latencyMs}ms`);
  console.log(`[INFO] Output: ${visionResult.text}`);

  // 4. Test Text Extractor Integration
  console.log('\n[TEST] 3. Testing extractComplaintDetails integration...');
  const complaint = await extractComplaintDetails({
    description: 'My paneer tikka was completely cold and the container lid was cracked and spilled.',
    issueCategory: 'damaged_spilled',
    affectedItems: ['Paneer Tikka'],
    requestedResolution: 'full_refund',
    orderTimestamp: new Date().toISOString(),
    deliveryTimestamp: new Date().toISOString(),
  });
  console.log('[PASS] Complaint extraction result:');
  console.log(JSON.stringify(complaint, null, 2));

  // 5. Test Vision Extractor Integration
  console.log('\n[TEST] 4. Testing analyzeEvidenceImage integration...');
  const evidence = await analyzeEvidenceImage({
    filePath: testImagePath,
    mimeType: 'image/jpeg',
    originalFilename: 'test.jpg',
    claimedCategory: 'damaged_spilled',
    claimedItems: ['Paneer Tikka'],
  });
  console.log('[PASS] Evidence analysis result:');
  console.log(JSON.stringify(evidence, null, 2));

  // 6. Test Reasoning Agent Integration
  console.log('\n[TEST] 5. Testing evaluateDisputeWithReasoningAgent integration...');
  const mockContext: AssembledReasoningContext = {
    complaint_analysis: complaint,
    evidence_analysis_report: {
      evidence_status: 'CONSISTENT',
      extractions: [evidence],
      max_eligible_subtotal: 280,
      findings: ['Packaging damage and food spillage visible'],
      discrepancies: [],
    },
    verified_order_details: {
      order_id: 'ORD-TEST-999',
      customer_id: 'CUST-001',
      restaurant_name: 'Punjab Grill',
      order_status: 'DELIVERED',
      payment_status: 'PAID',
      previous_refund_amount: 0,
      delivery_timestamp: new Date().toISOString(),
      total_amount: 350,
      items: [{ name: 'Paneer Tikka', quantity: 1, price_per_unit: 280, total_price: 280 }],
    },
    retrieved_policy_clauses: [
      {
        clause_id: 'POL-03',
        title: 'Damaged or Spilled Food',
        policy_text: 'Full or partial refund for items spilled, compromised, or inedible due to transit damage upon photographic proof.',
        refund_type: 'PARTIAL',
        issue_category: 'damaged_spilled',
        policy_version: 'v1.0',
        similarity_score: 0.95,
      },
      {
        clause_id: 'POL-05',
        title: 'Refund Calculation Cap',
        policy_text: 'Refund amount shall not exceed the purchase price of affected items.',
        refund_type: 'PARTIAL',
        issue_category: 'all',
        policy_version: 'v1.0',
        similarity_score: 0.90,
      },
    ],
  };

  const agentRecommendation = await evaluateDisputeWithReasoningAgent(mockContext);
  console.log('[PASS] Reasoning Agent recommendation:');
  console.log(JSON.stringify(agentRecommendation, null, 2));

  // 6. Test Parallel Race Mode
  console.log('\n[TEST] 6. Testing PARALLEL_RACE execution mode...');
  process.env.LLM_EXECUTION_MODE = 'PARALLEL_RACE';
  const raceResult = await executeTextPrompt({ prompt: 'Return JSON: {"race_completed": true}' });
  console.log(`[PASS] Parallel race completed successfully! Winner: [${raceResult.provider.toUpperCase()}] in ${raceResult.latencyMs}ms`);

  console.log('\n[SUCCESS] All Multi-Provider LLM & Multimodal tests passed cleanly!');
}

runMultiProviderTests().catch((err) => {
  console.error('[FAIL] Multi-Provider test error:', err);
  process.exit(1);
});
