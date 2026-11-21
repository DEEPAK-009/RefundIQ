import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { storagePath } from '../config/index.js';

// Ensure storage directory exists
if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
}

// Multer disk storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, storagePath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `evidence-${uniqueSuffix}${ext}`);
  },
});

// Primary header check: MIME type and extension
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

  const ext = path.extname(file.originalname).toLowerCase();

  // Strict document and PDF block
  if (ext === '.pdf' || file.mimetype === 'application/pdf') {
    return cb(new Error('PDF documents are strictly not accepted. Only photo evidence (JPG, PNG, WebP) is permitted.'));
  }
  if (['.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx'].includes(ext)) {
    return cb(new Error('Documents and spreadsheets are strictly not accepted. Only photo evidence (JPG, PNG, WebP) is permitted.'));
  }

  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only JPEG, PNG, and WebP images are permitted.`));
  }
};

export const uploadEvidence = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 5, // Maximum 5 files per dispute
  },
});

export interface MagicByteValidationResult {
  isValid: boolean;
  detectedType: string;
  error?: string;
}

/**
 * Option 3: Magic-Byte Binary Inspection & Antivirus / Executable Shielding
 * Inspects the exact binary signature (magic bytes) from disk.
 * Prevents attackers from spoofing extensions (e.g. renaming a malware .exe or script to .png).
 */
export function validateFileMagicBytes(filePath: string): MagicByteValidationResult {
  if (!fs.existsSync(filePath)) {
    return { isValid: false, detectedType: 'NOT_FOUND', error: 'File does not exist on disk' };
  }

  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(16);
  const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);

  if (bytesRead < 4) {
    return { isValid: false, detectedType: 'EMPTY_OR_TRUNCATED', error: 'File is empty or truncated' };
  }

  // 1. Check for malicious executable / script headers:
  // Windows DOS/PE executable: 'MZ' (0x4D, 0x5A)
  if (buffer[0] === 0x4D && buffer[1] === 0x5A) {
    return { isValid: false, detectedType: 'EXE_WINDOWS', error: 'Malicious executable header (DOS/Windows PE binary) detected' };
  }

  // Linux ELF executable: 0x7F 'ELF' (0x7F, 0x45, 0x4C, 0x46)
  if (buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
    return { isValid: false, detectedType: 'ELF_BINARY', error: 'Executable binary header (Linux ELF binary) detected' };
  }

  // Shell script shebang: '#!' (0x23, 0x21)
  if (buffer[0] === 0x23 && buffer[1] === 0x21) {
    return { isValid: false, detectedType: 'SHELL_SCRIPT', error: 'Executable shell script header detected' };
  }

  // PDF Document header: '%PDF' (0x25, 0x50, 0x44, 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { isValid: false, detectedType: 'PDF_DOCUMENT', error: 'PDF documents are strictly not accepted. Only authentic images (JPEG, PNG, WebP) are permitted.' };
  }

  // ZIP / DOCX / OpenDocument archive: 'PK\x03\x04' (0x50, 0x4B, 0x03, 0x04)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return { isValid: false, detectedType: 'DOCX_OR_ARCHIVE', error: 'Archive and Office document files are strictly not accepted. Only authentic images are permitted.' };
  }

  // Legacy Microsoft Office document: 0xD0 0xCF 0x11 0xE0
  if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
    return { isValid: false, detectedType: 'OLE_DOCUMENT', error: 'Microsoft Office documents are strictly not accepted. Only authentic images are permitted.' };
  }

  // Script or HTML text content
  const textHeader = buffer.toString('utf8', 0, Math.min(bytesRead, 12)).toLowerCase();
  if (
    textHeader.startsWith('<?php') ||
    textHeader.startsWith('<!doctype') ||
    textHeader.startsWith('<html') ||
    textHeader.startsWith('<script')
  ) {
    return { isValid: false, detectedType: 'SCRIPT_OR_HTML', error: 'Malicious script or HTML markup detected in photo payload' };
  }

  // 2. Validate legitimate image magic bytes:
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytesRead >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return { isValid: true, detectedType: 'image/png' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { isValid: true, detectedType: 'image/jpeg' };
  }

  // WebP: RIFF....WEBP (bytes 0-3: 'RIFF', bytes 8-11: 'WEBP')
  if (
    bytesRead >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { isValid: true, detectedType: 'image/webp' };
  }

  return {
    isValid: false,
    detectedType: 'UNKNOWN_OR_CORRUPT',
    error: 'Binary file header does not match authentic JPEG, PNG, or WebP signatures',
  };
}

/**
 * Express Middleware: Inspects uploaded files on disk and deletes any rejected files immediately
 */
export function verifyUploadedFilesIntegrity(req: Request, res: Response, next: NextFunction): void {
  const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);

  for (const file of files) {
    const magicResult = validateFileMagicBytes(file.path);
    if (!magicResult.isValid) {
      // Clean up all uploaded files from disk immediately
      for (const f of files) {
        if (fs.existsSync(f.path)) {
          try {
            fs.unlinkSync(f.path);
          } catch {}
        }
      }

      res.status(400).json({
        success: false,
        error: 'FILE_INTEGRITY_VIOLATION',
        message: `Security rejection: File '${file.originalname}' failed binary magic-byte inspection. ${magicResult.error}.`,
        detected_type: magicResult.detectedType,
      });
      return;
    }
  }

  next();
}

/**
 * Computes SHA-256 hash of a saved file for tamper detection and audit trail
 */
export async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}
