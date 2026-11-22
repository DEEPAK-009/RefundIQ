import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { optimizeImageIfExceedsThreshold } from '../utils/imageOptimizer.js';
import { analyzeImageForensics } from '../utils/imageForensics.js';

async function runOptimizerTests() {
  console.log('[TEST] Starting Image Optimization & Threshold Resizing Tests...\n');

  const tmpDir = path.join(os.tmpdir(), 'refundiq-optimizer-test');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const threshold = 1200;

  // 1. Create an image below threshold (800x600)
  const smallImagePath = path.join(tmpDir, 'below_threshold.png');
  await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 240, g: 100, b: 50 },
    },
  })
    .png()
    .toFile(smallImagePath);

  const initialSmallSize = fs.statSync(smallImagePath).size;
  const res1 = await optimizeImageIfExceedsThreshold(smallImagePath, threshold);

  console.log('Test 1 (Image Below Threshold 800x600):');
  console.log(`  Resized: ${res1.resized}`);
  console.log(`  Dimensions: ${res1.finalWidth}x${res1.finalHeight}`);
  console.log(`  Reason: ${res1.reason}`);

  if (res1.resized === false && res1.finalWidth === 800 && res1.finalHeight === 600) {
    console.log('[PASS] Test 1 Passed: Small image was NOT resized.\n');
  } else {
    throw new Error('Test 1 Failed: Image below threshold was unexpectedly modified.');
  }

  // 2. Create an image above threshold (2400x1800)
  const largeImagePath = path.join(tmpDir, 'above_threshold.jpg');
  await sharp({
    create: {
      width: 2400,
      height: 1800,
      channels: 3,
      background: { r: 50, g: 150, b: 240 },
    },
  })
    .jpeg({ quality: 90 })
    .toFile(largeImagePath);

  const initialLargeSize = fs.statSync(largeImagePath).size;
  const res2 = await optimizeImageIfExceedsThreshold(largeImagePath, threshold);

  console.log('Test 2 (Image Above Threshold 2400x1800):');
  console.log(`  Resized: ${res2.resized}`);
  console.log(`  Original: ${res2.originalWidth}x${res2.originalHeight} (${Math.round(initialLargeSize / 1024)}KB)`);
  console.log(`  Final: ${res2.finalWidth}x${res2.finalHeight} (${Math.round(res2.finalSizeBytes / 1024)}KB)`);
  console.log(`  Reduction: ${res2.reductionPercentage}%`);
  console.log(`  Reason: ${res2.reason}`);

  if (res2.resized === true && res2.finalWidth === 1200 && res2.finalHeight === 900) {
    console.log('[PASS] Test 2 Passed: Large image was downscaled correctly to threshold limits.\n');
  } else {
    throw new Error('Test 2 Failed: Image above threshold was not resized correctly.');
  }

  // 3. Create a portrait image above threshold (1500x3000)
  const portraitPath = path.join(tmpDir, 'portrait_large.jpg');
  await sharp({
    create: {
      width: 1500,
      height: 3000,
      channels: 3,
      background: { r: 100, g: 200, b: 100 },
    },
  })
    .jpeg()
    .toFile(portraitPath);

  const res3 = await optimizeImageIfExceedsThreshold(portraitPath, threshold);

  console.log('Test 3 (Portrait Image Above Threshold 1500x3000):');
  console.log(`  Final: ${res3.finalWidth}x${res3.finalHeight}`);
  if (res3.resized === true && res3.finalHeight === 1200 && res3.finalWidth === 600) {
    console.log('[PASS] Test 3 Passed: Aspect ratio strictly preserved on portrait image.\n');
  } else {
    throw new Error(`Test 3 Failed: Portrait aspect ratio incorrect: ${res3.finalWidth}x${res3.finalHeight}`);
  }

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('[SUCCESS] ALL IMAGE OPTIMIZATION & THRESHOLD RESIZING TESTS PASSED!');
}

runOptimizerTests().catch((err) => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
