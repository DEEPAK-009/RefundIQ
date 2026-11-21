import { Redis } from 'ioredis';
import { env } from '../config/index.js';

// Dedicated Redis client for publishing real-time stream events
export const redisPublisher = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  lazyConnect: true,
});

/**
 * Creates a dedicated subscriber client for SSE connections
 */
export function createRedisSubscriber(): Redis {
  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    lazyConnect: true,
  });
}

export interface DisputeStreamEvent {
  requestId: string;
  type:
    | 'CONNECTED'
    | 'DISPUTE_SUBMITTED'
    | 'STAGE_CHANGE'
    | 'AI_STARTED'
    | 'CROSS_CHECK_COMPLETED'
    | 'POLICIES_RETRIEVED'
    | 'REASONING_COMPLETED'
    | 'GUARDRAILS_EVALUATED'
    | 'STATUS_UPDATED'
    | 'ADDITIONAL_EVIDENCE_RECEIVED'
    | 'REVIEW_ACTION'
    | 'COMPLETE';
  stage?: 'INTAKE' | 'AI_EXTRACTION' | 'POLICY_RAG' | 'GUARDRAILS' | 'COMPLETED';
  status?: string;
  data?: any;
  timestamp?: string;
}

/**
 * Broadcasts an event to any connected SSE clients via Redis Pub/Sub
 */
export async function broadcastDisputeEvent(event: DisputeStreamEvent): Promise<void> {
  try {
    if (redisPublisher.status !== 'ready' && redisPublisher.status !== 'connecting') {
      await redisPublisher.connect();
    }
    const channel = `dispute:${event.requestId}`;
    const payload = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    };
    await redisPublisher.publish(channel, JSON.stringify(payload));
  } catch (err) {
    console.warn(`[EventBus] Failed to broadcast event for ${event.requestId}:`, err);
  }
}
