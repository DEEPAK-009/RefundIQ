import { GoogleGenAI } from '@google/genai';
import { env } from '../config/index.js';

let aiClient: GoogleGenAI | null = null;

if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== '') {
  try {
    aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    console.log('✨ Gemini AI client initialized with Gemini 2.0 Flash.');
  } catch (err) {
    console.warn('⚠️ Could not initialize Gemini AI client:', err);
  }
} else {
  console.log('ℹ️ No GEMINI_API_KEY provided. System will use high-fidelity deterministic multimodal simulator for testing.');
}

export const genAI = aiClient;
export const isGeminiConfigured = () => !!aiClient;
