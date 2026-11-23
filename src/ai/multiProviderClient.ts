import fs from 'fs';
import { env } from '../config/index.js';
import { genAI, isGeminiConfigured, ACTIVE_GEMINI_MODEL } from './geminiClient.js';

export type ProviderName = 'gemini' | 'nvidia' | 'cohere' | 'requesty' | 'xkiro';

export interface LlmExecutionResult {
  text: string;
  provider: ProviderName;
  latencyMs: number;
}

export interface TextPromptOptions {
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
}

export interface VisionPromptOptions {
  prompt: string;
  filePath: string;
  mimeType?: string;
  timeoutMs?: number;
}

export interface ProviderCapability {
  name: ProviderName;
  displayName: string;
  hasKey: boolean;
  supportsText: boolean;
  supportsVision: boolean;
  textModel: string;
  visionModel: string;
  status: 'ACTIVE' | 'RATE_LIMITED' | 'INSUFFICIENT_BALANCE' | 'DISABLED';
  statusDetails: string;
}

/**
 * Registry of supported providers and their tested models
 */
export const PROVIDER_REGISTRY: Record<ProviderName, ProviderCapability> = {
  gemini: {
    name: 'gemini',
    displayName: 'Google Gemini',
    hasKey: isGeminiConfigured(),
    supportsText: true,
    supportsVision: true,
    textModel: ACTIVE_GEMINI_MODEL,
    visionModel: ACTIVE_GEMINI_MODEL,
    status: isGeminiConfigured() ? 'ACTIVE' : 'DISABLED',
    statusDetails: isGeminiConfigured() ? 'Ready' : 'GEMINI_API_KEY not configured',
  },
  nvidia: {
    name: 'nvidia',
    displayName: 'NVIDIA NIM',
    hasKey: !!(env.NVIDIA_API_KEY && env.NVIDIA_API_KEY.trim() !== ''),
    supportsText: true,
    supportsVision: true,
    textModel: 'nvidia/nemotron-3.5-bolt-e4b',
    visionModel: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    status: (env.NVIDIA_API_KEY && env.NVIDIA_API_KEY.trim() !== '') ? 'ACTIVE' : 'DISABLED',
    statusDetails: (env.NVIDIA_API_KEY && env.NVIDIA_API_KEY.trim() !== '')
      ? 'Verified: Fast text (~300ms) & vision multimodal (~1200ms)'
      : 'NVIDIA_API_KEY not configured',
  },
  cohere: {
    name: 'cohere',
    displayName: 'Cohere',
    hasKey: !!(env.COHERE_API_KEY && env.COHERE_API_KEY.trim() !== ''),
    supportsText: true,
    supportsVision: true,
    textModel: 'command-r7b-12-2024',
    visionModel: 'command-a-vision-07-2025',
    status: (env.COHERE_API_KEY && env.COHERE_API_KEY.trim() !== '') ? 'ACTIVE' : 'DISABLED',
    statusDetails: (env.COHERE_API_KEY && env.COHERE_API_KEY.trim() !== '')
      ? 'Verified: Fast text (~400ms) & native vision (~1150ms)'
      : 'COHERE_API_KEY not configured',
  },
  requesty: {
    name: 'requesty',
    displayName: 'Requesty AI Router',
    hasKey: !!(env.REQUESTY_API_KEY && env.REQUESTY_API_KEY.trim() !== ''),
    supportsText: true,
    supportsVision: true,
    textModel: 'openai/gpt-4o-mini',
    visionModel: 'openai/gpt-4o-mini',
    status: 'INSUFFICIENT_BALANCE',
    statusDetails: 'Account balance is empty (HTTP 402/Router balance too low)',
  },
  xkiro: {
    name: 'xkiro',
    displayName: 'xKiro Gateway',
    hasKey: !!(env.XKIRO_API_KEY && env.XKIRO_API_KEY.trim() !== ''),
    supportsText: true,
    supportsVision: true,
    textModel: 'cohere/command-r7b-12-2024',
    visionModel: 'cohere/command-a-vision',
    status: 'RATE_LIMITED',
    statusDetails: 'Free-model daily quota reached; requires paid wallet balance',
  },
};

/**
 * Clean markdown JSON code fences if returned by the LLM
 */
export function cleanJsonFences(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1).trim();
  }
  return cleaned.trim();
}

/**
 * Call NVIDIA NIM Chat Completions (OpenAI compatible)
 */
async function callNvidiaText(options: TextPromptOptions): Promise<string> {
  const apiKey = env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('NVIDIA_API_KEY not provided');

  const messages: any[] = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: options.prompt });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PROVIDER_REGISTRY.nvidia.textModel,
        messages,
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`NVIDIA API HTTP ${res.status}: ${errBody}`);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('NVIDIA API returned empty message content');
    }
    return cleanJsonFences(content);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call NVIDIA NIM Multimodal Vision (Nemotron-3.5-super-vl)
 */
async function callNvidiaVision(options: VisionPromptOptions): Promise<string> {
  const apiKey = env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('NVIDIA_API_KEY not provided');

  const fileBuffer = fs.readFileSync(options.filePath);
  const base64Data = fileBuffer.toString('base64');
  const mime = options.mimeType || 'image/jpeg';
  const dataUrl = `data:${mime};base64,${base64Data}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PROVIDER_REGISTRY.nvidia.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: options.prompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`NVIDIA Vision HTTP ${res.status}: ${errBody}`);
    }

    const data: any = await res.json();
    const message = data.choices?.[0]?.message;
    const content = message?.content || message?.reasoning_content;
    if (!content) {
      throw new Error('NVIDIA Vision returned empty content');
    }

    // If output contains an embedded JSON block, extract it
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    return cleanJsonFences(content);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call Cohere Chat API v2
 */
async function callCohereText(options: TextPromptOptions): Promise<string> {
  const apiKey = env.COHERE_API_KEY;
  if (!apiKey) throw new Error('COHERE_API_KEY not provided');

  const messages: any[] = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: options.prompt });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);

  try {
    const res = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PROVIDER_REGISTRY.cohere.textModel,
        messages,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Cohere API HTTP ${res.status}: ${errBody}`);
    }

    const data: any = await res.json();
    const content = data.message?.content?.[0]?.text;
    if (!content) {
      throw new Error('Cohere API returned empty text');
    }
    return cleanJsonFences(content);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call Cohere Multimodal Vision (command-a-vision-07-2025)
 */
async function callCohereVision(options: VisionPromptOptions): Promise<string> {
  const apiKey = env.COHERE_API_KEY;
  if (!apiKey) throw new Error('COHERE_API_KEY not provided');

  const fileBuffer = fs.readFileSync(options.filePath);
  const base64Data = fileBuffer.toString('base64');
  const mime = options.mimeType || 'image/jpeg';
  const dataUrl = `data:${mime};base64,${base64Data}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  try {
    const res = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PROVIDER_REGISTRY.cohere.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: options.prompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Cohere Vision HTTP ${res.status}: ${errBody}`);
    }

    const data: any = await res.json();
    const content = data.message?.content?.[0]?.text;
    if (!content) {
      throw new Error('Cohere Vision returned empty text');
    }
    return cleanJsonFences(content);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call Google Gemini Text
 */
async function callGeminiText(options: TextPromptOptions): Promise<string> {
  if (!isGeminiConfigured() || !genAI) {
    throw new Error('Gemini API is not configured');
  }

  const timeoutMs = options.timeoutMs || 6000;
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini text timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const apiPromise = (async () => {
    const response = await genAI!.models.generateContent({
      model: ACTIVE_GEMINI_MODEL,
      contents: options.prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const responseText = response.text?.trim() || '';
    if (!responseText) {
      throw new Error('Gemini returned empty text');
    }
    return cleanJsonFences(responseText);
  })();

  try {
    return await Promise.race([apiPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Call Google Gemini Multimodal Vision
 */
async function callGeminiVision(options: VisionPromptOptions): Promise<string> {
  if (!isGeminiConfigured() || !genAI) {
    throw new Error('Gemini API is not configured');
  }

  const fileBuffer = fs.readFileSync(options.filePath);
  const base64Data = fileBuffer.toString('base64');
  const timeoutMs = options.timeoutMs || 8000;

  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini vision timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const apiPromise = (async () => {
    const response = await genAI!.models.generateContent({
      model: ACTIVE_GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: options.prompt },
            {
              inlineData: {
                data: base64Data,
                mimeType: options.mimeType || 'image/jpeg',
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const responseText = response.text?.trim() || '';
    if (!responseText) {
      throw new Error('Gemini vision returned empty text');
    }
    return cleanJsonFences(responseText);
  })();

  try {
    return await Promise.race([apiPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Universal Multi-Provider Text Executor
 * Automatically supports FALLBACK chain or PARALLEL_RACE
 */
export async function executeTextPrompt(options: TextPromptOptions): Promise<LlmExecutionResult> {
  const executionMode = (process.env.LLM_EXECUTION_MODE as any) || env.LLM_EXECUTION_MODE || 'FALLBACK';

  const providerCallers: Array<{ name: ProviderName; fn: () => Promise<string> }> = [];

  // Register available providers
  if (PROVIDER_REGISTRY.gemini.status === 'ACTIVE') {
    providerCallers.push({ name: 'gemini', fn: () => callGeminiText(options) });
  }
  if (PROVIDER_REGISTRY.nvidia.status === 'ACTIVE') {
    providerCallers.push({ name: 'nvidia', fn: () => callNvidiaText(options) });
  }
  if (PROVIDER_REGISTRY.cohere.status === 'ACTIVE') {
    providerCallers.push({ name: 'cohere', fn: () => callCohereText(options) });
  }

  if (providerCallers.length === 0) {
    throw new Error('No active LLM providers configured.');
  }

  // 1. Parallel Race Mode: All active providers execute concurrently; fastest wins
  if (executionMode === 'PARALLEL_RACE') {
    const t0 = Date.now();
    try {
      const racePromises = providerCallers.map(async ({ name, fn }) => {
        const text = await fn();
        return { text, provider: name, latencyMs: Date.now() - t0 };
      });
      const winner = await Promise.any(racePromises);
      console.log(`[INFO] Parallel race won by [${winner.provider.toUpperCase()}] in ${winner.latencyMs}ms`);
      return winner;
    } catch (aggregateErr) {
      console.warn('[WARN] All parallel racers failed, falling back to sequential chain');
    }
  }

  // 2. Sequential Fallback Mode: Tries providers in deterministic order
  for (const { name, fn } of providerCallers) {
    const t0 = Date.now();
    try {
      const text = await fn();
      const latencyMs = Date.now() - t0;
      console.log(`[INFO] Text LLM prompt fulfilled by [${name.toUpperCase()}] in ${latencyMs}ms`);
      return { text, provider: name, latencyMs };
    } catch (err: any) {
      console.warn(`[WARN] Provider [${name.toUpperCase()}] text call failed (${err.message}). Trying fallback...`);
    }
  }

  throw new Error('All configured LLM providers failed to generate text.');
}

/**
 * Universal Multi-Provider Vision Executor
 * Automatically supports FALLBACK chain or PARALLEL_RACE
 */
export async function executeVisionPrompt(options: VisionPromptOptions): Promise<LlmExecutionResult> {
  const executionMode = (process.env.LLM_EXECUTION_MODE as any) || env.LLM_EXECUTION_MODE || 'FALLBACK';

  const providerCallers: Array<{ name: ProviderName; fn: () => Promise<string> }> = [];

  if (PROVIDER_REGISTRY.gemini.status === 'ACTIVE') {
    providerCallers.push({ name: 'gemini', fn: () => callGeminiVision(options) });
  }
  if (PROVIDER_REGISTRY.nvidia.status === 'ACTIVE') {
    providerCallers.push({ name: 'nvidia', fn: () => callNvidiaVision(options) });
  }
  if (PROVIDER_REGISTRY.cohere.status === 'ACTIVE') {
    providerCallers.push({ name: 'cohere', fn: () => callCohereVision(options) });
  }

  if (providerCallers.length === 0) {
    throw new Error('No active Vision LLM providers configured.');
  }

  // 1. Parallel Race Mode
  if (executionMode === 'PARALLEL_RACE') {
    const t0 = Date.now();
    try {
      const racePromises = providerCallers.map(async ({ name, fn }) => {
        const text = await fn();
        return { text, provider: name, latencyMs: Date.now() - t0 };
      });
      const winner = await Promise.any(racePromises);
      console.log(`[INFO] Parallel vision race won by [${winner.provider.toUpperCase()}] in ${winner.latencyMs}ms`);
      return winner;
    } catch (aggregateErr) {
      console.warn('[WARN] All parallel vision racers failed, falling back to sequential chain');
    }
  }

  // 2. Sequential Fallback Mode
  for (const { name, fn } of providerCallers) {
    const t0 = Date.now();
    try {
      const text = await fn();
      const latencyMs = Date.now() - t0;
      console.log(`[INFO] Vision LLM prompt fulfilled by [${name.toUpperCase()}] in ${latencyMs}ms`);
      return { text, provider: name, latencyMs };
    } catch (err: any) {
      console.warn(`[WARN] Provider [${name.toUpperCase()}] vision call failed (${err.message}). Trying fallback...`);
    }
  }

  throw new Error('All configured Vision LLM providers failed.');
}
