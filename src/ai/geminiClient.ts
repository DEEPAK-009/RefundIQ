import { GoogleGenAI } from '@google/genai';
import { env } from '../config/index.js';

let aiClient: GoogleGenAI | null = null;
export const ACTIVE_GEMINI_MODEL = 'gemini-3.1-flash-lite';

if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== '') {
  try {
    aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY.trim() });
    console.log(`[INFO] Live Google Gemini AI client initialized using model: ${ACTIVE_GEMINI_MODEL}`);
  } catch (err) {
    console.warn('[WARN] Could not initialize Gemini AI client:', err);
  }
} else {
  console.log('[INFO] No GEMINI_API_KEY provided. System will use high-fidelity deterministic multimodal simulator for testing.');
}

export const genAI = aiClient;
export const isGeminiConfigured = () => !!aiClient;
