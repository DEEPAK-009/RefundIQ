import { Queue } from 'bullmq';
import { env } from '../config/index.js';

export const REDIS_CONNECTION = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
};

export const REFUND_QUEUE_NAME = 'refund-analysis';

export interface RefundJobPayload {
  requestId: string;
  orderId: string;
  customerId: string;
  taskType: 'analyse_food_refund';
  timestamp: string;
}

export const refundQueue = new Queue<RefundJobPayload>(REFUND_QUEUE_NAME, {
  connection: REDIS_CONNECTION,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
    removeOnComplete: {
      count: 100, // Keep last 100 successful jobs for debugging
    },
    removeOnFail: {
      count: 500, // Keep failed jobs for inspection
    },
  },
});

export async function enqueueRefundAnalysis(
  requestId: string,
  orderId: string,
  customerId: string
) {
  const payload: RefundJobPayload = {
    requestId,
    orderId,
    customerId,
    taskType: 'analyse_food_refund',
    timestamp: new Date().toISOString(),
  };

  const job = await refundQueue.add('analyse_food_refund', payload, {
    jobId: requestId, // Idempotent job key
  });

  return job;
}
