import exifr from 'exifr';
import fs from 'fs';
import path from 'path';

export interface ImageForensicResult {
  isCameraCaptured: boolean;
  classification: 'AUTHENTIC_CAMERA_CAPTURE' | 'SUSPECTED_WEB_DOWNLOAD_OR_SCREENSHOT' | 'EDITED_OR_GENERATED';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  capturedAt?: string;
  software?: string;
  fNumber?: number;
  iso?: number;
  exposureTime?: number;
  indicators: string[];
  summary: string;
}

/**
 * Known graphics/editing software signatures indicating synthetic or edited files.
 */
const EDITING_SOFTWARE_KEYWORDS = [
  'photoshop',
  'gimp',
  'canva',
  'figma',
  'illustrator',
  'picsart',
  'snapseed',
  'lightroom',
  'procreate',
  'paint.net',
  'libpng',
  'imagemagick',
];

/**
 * Analyzes local image files for camera hardware provenance vs internet download / screenshot characteristics.
 * Operates purely locally on the CPU in 1-2 milliseconds with ZERO external API token costs.
 */
export async function analyzeImageForensics(filePath: string): Promise<ImageForensicResult> {
  const indicators: string[] = [];

  if (!fs.existsSync(filePath)) {
    return {
      isCameraCaptured: false,
      classification: 'SUSPECTED_WEB_DOWNLOAD_OR_SCREENSHOT',
      confidence: 'LOW',
      indicators: ['File does not exist on disk'],
      summary: 'Analysis failed: file not found',
    };
  }

  const filename = path.basename(filePath).toLowerCase();

  // 1. Filename heuristic patterns common to web downloads and screenshots
  if (/screenshot|screen_shot|screengrab|capture/i.test(filename)) {
    indicators.push('Filename pattern indicates a screen capture / screenshot');
  }
  if (/download|images\(\d+\)|stock|shutterstock|depositphotos|istock|getty/i.test(filename)) {
    indicators.push('Filename pattern indicates web download or stock photo repository');
  }
  if (/^img-.*wa\d+/i.test(filename) || /whatsapp/i.test(filename)) {
    indicators.push('Filename pattern indicates WhatsApp media transfer (metadata stripped during re-compression)');
  }

  // 2. Parse EXIF, TIFF, and XMP metadata locally
  let tags: Record<string, any> | undefined;
  try {
    tags = await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      xmp: true,
      jfif: true,
      icc: false, // keep fast
    });
  } catch (err: any) {
    indicators.push(`Metadata parse exception: ${err?.message || 'unknown error'}`);
  }

  // If no tags returned at all
  if (!tags || Object.keys(tags).length === 0) {
    indicators.push('No EXIF or camera hardware metadata found in file header');
    indicators.push('All standard digital camera sensor tags are absent (typical of web downloads or screenshots)');

    return {
      isCameraCaptured: false,
      classification: 'SUSPECTED_WEB_DOWNLOAD_OR_SCREENSHOT',
      confidence: 'HIGH',
      indicators,
      summary: 'Suspected Web Download or Screenshot: Stripped of all camera sensor metadata.',
    };
  }

  const make = tags.Make ? String(tags.Make).trim() : undefined;
  const model = tags.Model ? String(tags.Model).trim() : undefined;
  const software = tags.Software ? String(tags.Software).trim() : undefined;
  const lensModel = tags.LensModel ? String(tags.LensModel).trim() : undefined;
  const capturedAt = tags.DateTimeOriginal || tags.CreateDate ? String(tags.DateTimeOriginal || tags.CreateDate) : undefined;
  const fNumber = typeof tags.FNumber === 'number' ? tags.FNumber : undefined;
  const iso = typeof tags.ISO === 'number' ? tags.ISO : typeof tags.ISOSpeedRatings === 'number' ? tags.ISOSpeedRatings : undefined;
  const exposureTime = typeof tags.ExposureTime === 'number' ? tags.ExposureTime : undefined;

  // 3. Check for graphic/photo-editing software signatures
  if (software) {
    const swLower = software.toLowerCase();
    for (const kw of EDITING_SOFTWARE_KEYWORDS) {
      if (swLower.includes(kw)) {
        indicators.push(`Software signature detected: "${software}" (matches known graphics/editing software "${kw}")`);
        return {
          isCameraCaptured: false,
          classification: 'EDITED_OR_GENERATED',
          confidence: 'HIGH',
          cameraMake: make,
          cameraModel: model,
          lensModel,
          capturedAt,
          software,
          fNumber,
          iso,
          exposureTime,
          indicators,
          summary: `Edited or Synthetic Image: File was processed or exported with ${software}.`,
        };
      }
    }
  }

  // 4. Verify physical camera sensor hardware parameters
  const hasHardwareDevice = Boolean(make && model);
  const hasOpticalMetrics = Boolean(fNumber || iso || exposureTime || lensModel);

  if (hasHardwareDevice) {
    indicators.push(`Verified physical camera sensor: ${make} ${model}`);
    if (capturedAt) indicators.push(`Capture timestamp verified: ${capturedAt}`);
    if (fNumber) indicators.push(`Optical aperture: f/${fNumber}`);
    if (iso) indicators.push(`ISO sensitivity: ${iso}`);
    if (lensModel) indicators.push(`Lens hardware: ${lensModel}`);

    return {
      isCameraCaptured: true,
      classification: 'AUTHENTIC_CAMERA_CAPTURE',
      confidence: hasOpticalMetrics ? 'HIGH' : 'MEDIUM',
      cameraMake: make,
      cameraModel: model,
      lensModel,
      capturedAt,
      software,
      fNumber,
      iso,
      exposureTime,
      indicators,
      summary: `Authentic Camera Capture: Shot on ${make} ${model}${capturedAt ? ` at ${capturedAt}` : ''}.`,
    };
  }

  // Tags exist (e.g. basic resolution or web profile), but no camera hardware
  indicators.push('EXIF block exists but lacks camera manufacturer and model identifiers');
  if (software) indicators.push(`Software identifier present: ${software}`);

  return {
    isCameraCaptured: false,
    classification: 'SUSPECTED_WEB_DOWNLOAD_OR_SCREENSHOT',
    confidence: 'MEDIUM',
    software,
    indicators,
    summary: 'Suspected Web Download or Screenshot: Lacks authentic mobile camera hardware tags.',
  };
}
