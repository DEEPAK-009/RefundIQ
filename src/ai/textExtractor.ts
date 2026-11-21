import { z } from 'zod';
import { genAI, isGeminiConfigured, ACTIVE_GEMINI_MODEL } from './geminiClient.js';

export const ExtractedComplaintSchema = z.object({
  issue_category: z.enum([
    'missing_item',
    'wrong_item',
    'damaged_spilled',
    'food_quality',
    'not_delivered',
    'other',
  ]),
  affected_items: z.array(z.string()),
  claimed_issue: z.string(),
  requested_resolution: z.enum(['full_refund', 'partial_refund', 'other']),
  reported_timing: z.string(),
  missing_information: z.array(z.string()).default([]),
});

export type ExtractedComplaint = z.infer<typeof ExtractedComplaintSchema>;

export interface ComplaintInput {
  description: string;
  issueCategory: string;
  affectedItems: string[];
  requestedResolution: string;
  orderTimestamp: string;
  deliveryTimestamp?: string;
}

/**
 * Step 3.2.A: Complaint Understanding (Text LLM)
 * Extracts structured JSON from customer's natural language complaint
 */
export async function extractComplaintDetails(input: ComplaintInput): Promise<ExtractedComplaint> {
  const prompt = `You are a food delivery dispute analysis assistant.
Analyze this customer dispute description and extract structured facts.

Customer Description: "${input.description}"
Category Claimed: "${input.issueCategory}"
Items Specified: ${JSON.stringify(input.affectedItems)}
Requested Resolution: "${input.requestedResolution}"
Delivery Time: "${input.deliveryTimestamp || 'Recently'}"

Extract strictly valid JSON with this exact schema:
{
  "issue_category": "missing_item" | "wrong_item" | "damaged_spilled" | "food_quality" | "not_delivered" | "other",
  "affected_items": ["item1", ...],
  "claimed_issue": "summary of what customer claims happened",
  "requested_resolution": "full_refund" | "partial_refund" | "other",
  "reported_timing": "when issue was reported relative to delivery",
  "missing_information": []
}`;

  if (isGeminiConfigured() && genAI) {
    try {
      const response = await genAI.models.generateContent({
        model: ACTIVE_GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const responseText = response.text?.trim() || '{}';
      const parsed = JSON.parse(responseText);
      const validated = ExtractedComplaintSchema.parse(parsed);
      return validated;
    } catch (err) {
      console.warn('[WARN] Gemini text extraction failed, falling back to deterministic extractor:', err);
    }
  }

  // Deterministic local extraction fallback
  const normalizedCategory = (['missing_item', 'wrong_item', 'damaged_spilled', 'food_quality', 'not_delivered'].includes(input.issueCategory)
    ? input.issueCategory
    : 'other') as ExtractedComplaint['issue_category'];

  const normalizedResolution = (['full_refund', 'partial_refund'].includes(input.requestedResolution)
    ? input.requestedResolution
    : 'partial_refund') as ExtractedComplaint['requested_resolution'];

  return {
    issue_category: normalizedCategory,
    affected_items: input.affectedItems.length > 0 ? input.affectedItems : ['Unknown item'],
    claimed_issue: input.description.trim(),
    requested_resolution: normalizedResolution,
    reported_timing: input.deliveryTimestamp ? 'Within 1 hour of delivery' : 'Recently delivered',
    missing_information: [],
  };
}
