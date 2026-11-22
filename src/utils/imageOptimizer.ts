import sharp from 'sharp';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/index.js';

export interface ImageOptimizationResult {
  filePath: string;
  resized: boolean;
  originalWidth?: number;
  originalHeight?: number;
  finalWidth?: number;
  finalHeight?: number;
  originalSizeBytes: number;
  finalSizeBytes: number;
  reductionPercentage: number;
  reason: string;
}

/**
 * Conditionally optimizes and downscales an evidence image only if its resolution
 * exceeds the configured threshold (default: 1600px).
 *
 * Preserves EXIF metadata for forensic provenance verification and auto-rotates
 * based on device orientation tags.
 */
export async function optimizeImageIfExceedsThreshold(
  filePath: string,
  maxDimension = env.MAX_IMAGE_DIMENSION_THRESHOLD
): Promise<ImageOptimizationResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const originalStats = fs.statSync(filePath);
  const originalSizeBytes = originalStats.size;

  const metadata = await sharp(filePath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  // STRICT RULE: Only resize if the image resolution exceeds the threshold
  if (width <= maxDimension && height <= maxDimension) {
    return {
      filePath,
      resized: false,
      originalWidth: width,
      originalHeight: height,
      finalWidth: width,
      finalHeight: height,
      originalSizeBytes,
      finalSizeBytes: originalSizeBytes,
      reductionPercentage: 0,
      reason: `Image resolution ${width}x${height} is within threshold (${maxDimension}px). Preserved original.`,
    };
  }

  const tmpPath = `${filePath}.opt.tmp`;

  let pipeline = sharp(filePath)
    .rotate() // auto-rotates based on EXIF orientation
    .resize({
      width: width >= height ? maxDimension : undefined,
      height: height > width ? maxDimension : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .withMetadata(); // preserves camera EXIF metadata for forensics

  if (metadata.format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  } else if (metadata.format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 8 });
  } else if (metadata.format === 'webp') {
    pipeline = pipeline.webp({ quality: 85 });
  }

  await pipeline.toFile(tmpPath);

  const newMeta = await sharp(tmpPath).metadata();
  const finalStats = fs.statSync(tmpPath);
  const finalSizeBytes = finalStats.size;

  // Atomically replace original file with optimized version
  fs.renameSync(tmpPath, filePath);

  const reductionPercentage = Math.max(
    0,
    Math.round(((originalSizeBytes - finalSizeBytes) / originalSizeBytes) * 100)
  );

  console.log(
    `[INFO] Image optimized: ${width}x${height} (${Math.round(originalSizeBytes / 1024)}KB) -> ` +
    `${newMeta.width}x${newMeta.height} (${Math.round(finalSizeBytes / 1024)}KB) [${reductionPercentage}% reduced]`
  );

  return {
    filePath,
    resized: true,
    originalWidth: width,
    originalHeight: height,
    finalWidth: newMeta.width,
    finalHeight: newMeta.height,
    originalSizeBytes,
    finalSizeBytes,
    reductionPercentage,
    reason: `Image resolution ${width}x${height} exceeded threshold (${maxDimension}px). Downscaled to ${newMeta.width}x${newMeta.height}.`,
  };
}

/**
 * Express Middleware: Inspects uploaded evidence files and conditionally resizes
 * any image whose resolution exceeds the configured threshold.
 */
export async function optimizeUploadedFiles(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);

  for (const file of files) {
    if (file.path && fs.existsSync(file.path)) {
      try {
        const result = await optimizeImageIfExceedsThreshold(file.path);
        if (result.resized) {
          file.size = result.finalSizeBytes;
        }
      } catch (err: any) {
        console.warn(`[WARN] Failed to optimize image ${file.originalname}:`, err.message);
      }
    }
  }

  next();
}
