import fs from 'fs';
import path from 'path';
import os from 'os';
import { analyzeImageForensics } from '../utils/imageForensics.js';

async function runForensicsTests() {
  console.log('🧪 Starting 0-Token Image Forensics & Download Detection Test...\n');

  const tmpDir = path.join(os.tmpdir(), 'refundiq-forensics-test');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // 1. Create a simulated downloaded internet image (plain PNG without EXIF)
  const downloadedPath = path.join(tmpDir, 'download_pizza_stock.png');
  fs.writeFileSync(downloadedPath, Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x5C, 0x72, 0xA8, 0x66, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]));

  const t0 = Date.now();
  const res1 = await analyzeImageForensics(downloadedPath);
  const durationMs = Date.now() - t0;

  console.log(`Test 1 (Simulated Downloaded Web Photo):`);
  console.log(`  Classification: ${res1.classification}`);
  console.log(`  Is Camera Captured: ${res1.isCameraCaptured}`);
  console.log(`  Indicators:`, res1.indicators);
  console.log(`  Summary: ${res1.summary}`);
  console.log(`  Execution Time: ${durationMs}ms (Tokens used: 0)\n`);

  if (!res1.isCameraCaptured && res1.classification === 'SUSPECTED_WEB_DOWNLOAD_OR_SCREENSHOT') {
    console.log('✅ Test 1 Passed: Correctly classified stripped web download.\n');
  } else {
    throw new Error('Test 1 Failed: Simulated web download was not flagged.');
  }

  // 2. Test simulated screenshot filename
  const screenshotPath = path.join(tmpDir, 'Screenshot_2026-11-20_at_2.30.12_PM.png');
  fs.copyFileSync(downloadedPath, screenshotPath);

  const res2 = await analyzeImageForensics(screenshotPath);
  console.log(`Test 2 (Screenshot Filename Detection):`);
  console.log(`  Classification: ${res2.classification}`);
  console.log(`  Indicators:`, res2.indicators);

  if (res2.indicators.some((i) => i.includes('screenshot'))) {
    console.log('✅ Test 2 Passed: Screenshot pattern detected in file provenance.\n');
  } else {
    throw new Error('Test 2 Failed: Screenshot indicator missing.');
  }

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('🎉 ALL 0-TOKEN IMAGE FORENSICS TESTS PASSED WITH ZERO API CALLS!');
}

runForensicsTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
