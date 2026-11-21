import fs from 'fs';
import path from 'path';
import { validateFileMagicBytes } from '../middleware/upload.js';

async function testMagicBytes() {
  console.log('🧪 Starting Option 3: Magic-Byte Binary Inspection Tests...\n');

  const tmpDir = path.resolve(process.cwd(), 'storage/test_tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const fakeExePath = path.join(tmpDir, 'malware.png');
  const fakeScriptPath = path.join(tmpDir, 'exploit.jpg');
  const validPngPath = path.join(tmpDir, 'valid.png');

  // 1. Create a fake Windows executable disguised as PNG ('MZ' header)
  fs.writeFileSync(fakeExePath, Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]));

  // 2. Create a fake shell script disguised as JPG ('#!' header)
  fs.writeFileSync(fakeScriptPath, Buffer.from('#!/bin/bash\nrm -rf /'));

  // 2b. Create a fake PDF disguised as PNG ('%PDF' header)
  const fakePdfPath = path.join(tmpDir, 'disguised.png');
  fs.writeFileSync(fakePdfPath, Buffer.from('%PDF-1.5 fake document payload'));

  // 3. Create a valid PNG header (89 50 4E 47 0D 0A 1A 0A)
  fs.writeFileSync(validPngPath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]));

  // Test 1: Fake EXE detection
  const res1 = validateFileMagicBytes(fakeExePath);
  console.log('Test 1 (Fake EXE .png):', res1);
  if (!res1.isValid && res1.detectedType === 'EXE_WINDOWS') {
    console.log('✅ Test 1 Passed: Disguised Windows binary detected and blocked.\n');
  } else {
    throw new Error('Test 1 Failed: Fake EXE was not intercepted.');
  }

  // Test 2: Fake Script detection
  const res2 = validateFileMagicBytes(fakeScriptPath);
  console.log('Test 2 (Shell Script .jpg):', res2);
  if (!res2.isValid && res2.detectedType === 'SHELL_SCRIPT') {
    console.log('✅ Test 2 Passed: Disguised shell script detected and blocked.\n');
  } else {
    throw new Error('Test 2 Failed: Fake script was not intercepted.');
  }

  // Test 2b: Fake PDF detection
  const res2b = validateFileMagicBytes(fakePdfPath);
  console.log('Test 2b (Disguised PDF .png):', res2b);
  if (!res2b.isValid && res2b.detectedType === 'PDF_DOCUMENT') {
    console.log('✅ Test 2b Passed: Disguised PDF document detected and blocked.\n');
  } else {
    throw new Error('Test 2b Failed: Disguised PDF was not intercepted.');
  }

  // Test 3: Valid PNG validation
  const res3 = validateFileMagicBytes(validPngPath);
  console.log('Test 3 (Valid PNG):', res3);
  if (res3.isValid && res3.detectedType === 'image/png') {
    console.log('✅ Test 3 Passed: Authentic PNG magic-bytes verified successfully.\n');
  } else {
    throw new Error('Test 3 Failed: Valid PNG was rejected.');
  }

  // Cleanup test files
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('🎉 ALL MAGIC-BYTE BINARY INSPECTION TESTS PASSED!');
}

testMagicBytes().catch((err) => {
  console.error('❌ Magic-byte test failed:', err);
  process.exit(1);
});
