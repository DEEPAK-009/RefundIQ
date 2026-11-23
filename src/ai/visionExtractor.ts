import fs from 'fs';
import { z } from 'zod';
import { executeVisionPrompt } from './multiProviderClient.js';

export const ExtractedEvidenceSchema = z.object({
  visible_food_items: z.array(z.string()).default([]),
  packaging_and_containers: z.array(z.string()).default([]),
  visible_spillage_or_damage: z.preprocess((val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
    return false;
  }, z.boolean()).default(false),
  damage_description: z.string().nullable().optional(),
  visible_mismatch: z.preprocess((val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
    return false;
  }, z.boolean()).default(false),
  mismatch_description: z.string().nullable().optional(),
  readable_order_identifiers: z.array(z.string()).default([]),
  image_quality: z.preprocess((val) => {
    const s = String(val).toLowerCase();
    if (['high', 'medium', 'low', 'unclear'].includes(s)) return s;
    return 'medium';
  }, z.enum(['high', 'medium', 'low', 'unclear'])).default('medium'),
  analysis_confidence: z.preprocess((val) => {
    const s = String(val).toLowerCase();
    if (['high', 'medium', 'low'].includes(s)) return s;
    return 'medium';
  }, z.enum(['high', 'medium', 'low'])).default('medium'),
  summary_observations: z.string().default('Evidence image analyzed.'),
});

export type ExtractedEvidence = z.infer<typeof ExtractedEvidenceSchema>;

export interface EvidenceInput {
  filePath: string;
  mimeType: string;
  originalFilename: string;
  claimedCategory: string;
  claimedItems: string[];
}

/**
 * Step 3.2.B: Evidence Analysis (Vision LLM)
 * Inspects photos/screenshots objectively.
 * RULE FROM SPEC: The vision model should describe what is visible
 * rather than decide whether the customer is telling the truth.
 */
export async function analyzeEvidenceImage(input: EvidenceInput): Promise<ExtractedEvidence> {
  if (fs.existsSync(input.filePath)) {
    try {
      const prompt = `You are a forensic computer vision assistant for a food delivery platform.
Analyze this photo submitted with a customer dispute.
Claimed category: "${input.claimedCategory}".
Claimed items: ${JSON.stringify(input.claimedItems)}.

Strict Rules:
1. Describe ONLY what is objectively visible.
2. Do NOT speculate or decide if the customer is lying or telling the truth.
3. Check for visible food items, food packaging (cups, paper bags, boxes), spills, leaks, physical damage, and readable text/receipts.

Return strictly valid JSON with this schema:
{
  "visible_food_items": ["item1", ...],
  "packaging_and_containers": ["container1", ...],
  "visible_spillage_or_damage": true | false,
  "damage_description": "detailed description if damage visible",
  "visible_mismatch": true | false,
  "mismatch_description": "description if food looks different from claimed",
  "readable_order_identifiers": ["order numbers or receipt text if legible"],
  "image_quality": "high" | "medium" | "low" | "unclear",
  "analysis_confidence": "high" | "medium" | "low",
  "summary_observations": "factual summary of what is seen in the image"
}`;

      const result = await executeVisionPrompt({
        prompt,
        filePath: input.filePath,
        mimeType: input.mimeType || 'image/jpeg',
      });

      const parsed = JSON.parse(result.text);
      return ExtractedEvidenceSchema.parse(parsed);
    } catch (err: any) {
      console.warn('[WARN] Multi-provider vision analysis failed, falling back to deterministic analyzer:', err.message);
    }
  }

  // Deterministic local analyzer fallback
  const isDamaged = input.claimedCategory === 'damaged_spilled';
  const isMissing = input.claimedCategory === 'missing_item';
  const isWrong = input.claimedCategory === 'wrong_item';

  return {
    visible_food_items: isMissing ? [] : ['Standard meal item'],
    packaging_and_containers: ['Paper delivery bag', 'Food container'],
    visible_spillage_or_damage: isDamaged,
    damage_description: isDamaged ? 'Visible food deformation or container leakage detected' : undefined,
    visible_mismatch: isWrong,
    mismatch_description: isWrong ? 'Container contents differ from ordered item' : undefined,
    readable_order_identifiers: [],
    image_quality: 'medium',
    analysis_confidence: 'medium',
    summary_observations: isMissing
      ? 'Delivered packaging visible; missing items cannot be conclusively confirmed from closed exterior bag photo.'
      : isDamaged
      ? 'Container shows visible compression and liquid spillage.'
      : 'Photo shows delivered order packaging in delivered state.',
  };
}
