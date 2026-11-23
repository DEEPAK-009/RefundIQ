import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';

async function runMaxImagesTest() {
  console.log('[TEST] Starting Max 2 Images Initial Intake Enforcement Test...\n');

  const tmpDir = path.join(os.tmpdir(), 'refundiq-max-images-test');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // Generate 3 sample test PNG files
  const sampleBuf = await sharp({
    create: {
      width: 400,
      height: 400,
      channels: 3,
      background: { r: 120, g: 180, b: 240 },
    },
  })
    .png()
    .toBuffer();

  const file1 = new Blob([sampleBuf], { type: 'image/png' });
  const file2 = new Blob([sampleBuf], { type: 'image/png' });
  const file3 = new Blob([sampleBuf], { type: 'image/png' });

  // Test 1: Submitting 3 images (should be strictly rejected with HTTP 400)
  console.log('--- Test 1: Submitting 3 images on initial intake (exceeds max 2) ---');
  const formWith3 = new FormData();
  formWith3.append('order_id', 'ORD1024');
  formWith3.append('issue_category', 'damaged_spilled');
  formWith3.append('affected_items', JSON.stringify(['Burger']));
  formWith3.append('description', 'Burger packaging crushed.');
  formWith3.append('requested_resolution', 'partial_refund');
  formWith3.append('evidence', file1, 'photo1.png');
  formWith3.append('evidence', file2, 'photo2.png');
  formWith3.append('evidence', file3, 'photo3.png');

  const res1 = await fetch('http://localhost:4000/api/refunds', {
    method: 'POST',
    headers: { 'x-customer-id': 'CUST101' },
    body: formWith3,
  });

  const data1 = (await res1.json()) as any;
  console.log('Response Status:', res1.status);
  console.log('Response Body:', data1);

  if (res1.status === 400 && data1.error === 'MAX_FILES_EXCEEDED') {
    console.log('[PASS] Test 1 Passed: 3 images successfully rejected with HTTP 400 MAX_FILES_EXCEEDED.\n');
  } else {
    throw new Error(`Test 1 Failed: Expected HTTP 400 MAX_FILES_EXCEEDED but got ${res1.status}`);
  }

  // Test 2: Submitting 2 images (should be accepted with HTTP 200/202)
  console.log('--- Test 2: Submitting 2 images on initial intake (allowed max) ---');

  // Query an order without an active pending dispute
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/refund_iq' });
  const availRes = await pool.query(`
    SELECT o.id, o.customer_id, oi.item_name
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN refund_requests r ON r.order_id = o.id AND r.status IN ('SUBMITTED', 'PROCESSING')
    WHERE r.id IS NULL AND o.order_status = 'Delivered'
    LIMIT 1
  `);

  if (availRes.rows.length === 0) {
    throw new Error('No available delivered orders for testing.');
  }

  const testOrder = availRes.rows[0];

  const formWith2 = new FormData();
  formWith2.append('order_id', testOrder.id);
  formWith2.append('issue_category', 'damaged_spilled');
  formWith2.append('affected_items', JSON.stringify([testOrder.item_name]));
  formWith2.append('description', 'Food packaging spilled.');
  formWith2.append('requested_resolution', 'partial_refund');
  formWith2.append('evidence', file1, 'photo1.png');
  formWith2.append('evidence', file2, 'photo2.png');

  const res2 = await fetch('http://localhost:4000/api/refunds', {
    method: 'POST',
    headers: { 'x-customer-id': testOrder.customer_id },
    body: formWith2,
  });

  const data2 = (await res2.json()) as any;
  console.log('Response Status:', res2.status);
  console.log('Response Request ID:', data2.request_id);

  if ((res2.status === 200 || res2.status === 202) && data2.success && data2.evidence_uploaded === 2) {
    console.log('[PASS] Test 2 Passed: 2 images successfully accepted with HTTP ' + res2.status + '.\n');
  } else {
    throw new Error(`Test 2 Failed: Expected HTTP 200/202 with 2 files but got status ${res2.status}`);
  }

  await pool.end();

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('[SUCCESS] ALL INITIAL INTAKE MAX 2 IMAGES TESTS PASSED!');
}

runMaxImagesTest().catch((err) => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
