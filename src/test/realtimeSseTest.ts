import { broadcastDisputeEvent } from '../events/eventBus.js';

async function testRealtimeSSE() {
  console.log('🧪 Starting Real-Time SSE Stream Verification Test...\n');

  const testRequestId = 'REF_SSE_VERIFY_' + Date.now();
  const res = await fetch(`http://localhost:4000/api/refunds/${testRequestId}/stream`);

  if (res.status !== 200 || !res.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error(`Failed to connect to SSE stream: status ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  // Read initial handshake chunk
  const chunk1 = await reader.read();
  const text1 = decoder.decode(chunk1.value);
  console.log('Handshake received:\n' + text1.trim());

  // Broadcast a real-time event to this dispute channel
  console.log('\nBroadcasting test AI stage event via Redis Pub/Sub...');
  await broadcastDisputeEvent({
    requestId: testRequestId,
    type: 'STAGE_CHANGE',
    stage: 'AI_EXTRACTION',
    status: 'PROCESSING',
    data: { message: 'AI Extraction started in real time' },
  });

  // Read the pushed event
  const chunk2 = await reader.read();
  const text2 = decoder.decode(chunk2.value);
  console.log('Pushed event received via SSE:\n' + text2.trim());

  if (text2.includes('AI_EXTRACTION') && text2.includes('AI Extraction started in real time')) {
    console.log('\n✅ Real-Time SSE Push Verified: Event was received instantly across Redis Pub/Sub and HTTP stream!');
  } else {
    throw new Error('Test failed: Broadcasted event was not received by SSE reader.');
  }

  reader.cancel();
  console.log('\n🎉 ALL REAL-TIME SSE TESTS PASSED!');
  process.exit(0);
}

testRealtimeSSE().catch((err) => {
  console.error('❌ SSE test failed:', err);
  process.exit(1);
});
