import { createRefundWorker } from './queue/refundWorker.js';

console.log('🤖 Starting RefundIQ AI Background Worker...');
const worker = createRefundWorker();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down BullMQ Refund Worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down BullMQ Refund Worker...');
  await worker.close();
  process.exit(0);
});
