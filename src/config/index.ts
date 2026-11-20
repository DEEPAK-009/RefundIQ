import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/refund_iq'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  GEMINI_API_KEY: z.string().optional(),
  STORAGE_DIR: z.string().default('./storage/uploads'),
  MAX_AUTO_REFUND_AMOUNT: z.coerce.number().default(500),
  SUSPICIOUS_REFUND_RATE_THRESHOLD: z.coerce.number().default(0.3),
  CLAIM_WINDOW_HOURS: z.coerce.number().default(24),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
export const storagePath = path.resolve(process.cwd(), env.STORAGE_DIR);
