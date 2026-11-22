import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { dbPool, query } from '../db/index.js';
import { authenticateCustomer } from '../middleware/auth.js';
import { uploadEvidence, computeFileHash, verifyUploadedFilesIntegrity } from '../middleware/upload.js';
import { optimizeUploadedFiles } from '../utils/imageOptimizer.js';
import { enqueueRefundAnalysis } from '../queue/refundQueue.js';
import { disputeSubmissionLimiter } from '../middleware/rateLimiter.js';
import { sendCustomerNotification } from '../execution/notifications.js';
import { broadcastDisputeEvent, createRedisSubscriber } from '../events/eventBus.js';

export const refundsRouter = Router();

refundsRouter.use(authenticateCustomer);

const refundFormSchema = z.object({
  order_id: z.string().min(1, 'Order ID is required'),
  issue_category: z.enum([
    'missing_item',
    'wrong_item',
    'damaged_spilled',
    'food_quality',
    'not_delivered',
    'other',
  ]),
  affected_items: z.preprocess((val) => {
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return val;
  }, z.array(z.string()).min(1, 'At least one affected food item must be specified')),
  description: z.string().min(5, 'Please provide a clear description of the issue (min 5 characters)'),
  requested_resolution: z.enum(['full_refund', 'partial_refund', 'other']).default('partial_refund'),
});

/**
 * Step 2: Backend Ingestion, Verification & Queuing
 * Endpoint: POST /api/refunds
 * Multipart form data containing:
 * - order_id
 * - issue_category
 * - affected_items (multiple items allowed for partial refunds)
 * - description
 * - requested_resolution
 * - evidence (image files)
 */
refundsRouter.post(
  '/',
  disputeSubmissionLimiter,
  uploadEvidence.array('evidence', 5),
  verifyUploadedFilesIntegrity,
  optimizeUploadedFiles,
  async (req: Request, res: Response): Promise<void> => {
  const customerId = req.customer!.id;
  const files = (req.files as Express.Multer.File[]) || [];

  // 1. Input Validation with Zod
  const validationResult = refundFormSchema.safeParse(req.body);
  if (!validationResult.success) {
    res.status(400).json({
      success: false,
      error: 'Invalid refund submission data',
      details: validationResult.error.format(),
    });
    return;
  }

  const { order_id, issue_category, affected_items, description, requested_resolution } = validationResult.data;

  // 2. Authoritative Order & Payment Verification from PostgreSQL (Trust Separation)
  const orderResult = await query(
    `SELECT 
       o.id, 
       o.customer_id, 
       o.restaurant_id, 
       r.name AS restaurant_name,
       o.total_amount, 
       o.order_status, 
       o.payment_status, 
       o.refund_status, 
       o.previous_refund_amount, 
       o.delivery_timestamp
     FROM orders o
     JOIN restaurants r ON o.restaurant_id = r.id
     WHERE o.id = $1`,
    [order_id]
  );

  if (orderResult.rows.length === 0) {
    res.status(404).json({
      success: false,
      error: `Order ${order_id} does not exist in authoritative records.`,
    });
    return;
  }

  const order = orderResult.rows[0];

  // Verify ownership: customer can only dispute their own orders
  if (order.customer_id !== customerId) {
    res.status(403).json({
      success: false,
      error: `Security violation: Order ${order_id} does not belong to authenticated customer ${customerId}.`,
    });
    return;
  }

  // Check if order already received a full refund
  if (order.refund_status === 'FULL') {
    res.status(400).json({
      success: false,
      error: `Order ${order_id} has already been fully refunded (₹${order.previous_refund_amount}). Duplicate disputes are prohibited.`,
    });
    return;
  }

  // Check for any ongoing dispute for this order
  const existingDisputeResult = await query(
    `SELECT id, status FROM refund_requests WHERE order_id = $1 AND status IN ('SUBMITTED', 'PROCESSING')`,
    [order_id]
  );

  if (existingDisputeResult.rows.length > 0) {
    res.status(409).json({
      success: false,
      error: `An active refund dispute (${existingDisputeResult.rows[0].id}) is already being processed for order ${order_id}.`,
      existing_request_id: existingDisputeResult.rows[0].id,
    });
    return;
  }

  // 3. Database Persistence in an ACID Transaction
  const client = await dbPool.connect();
  const requestId = `REF${Date.now().toString().slice(-6)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  try {
    await client.query('BEGIN');

    // Insert refund request with initial status = 'SUBMITTED'
    await client.query(
      `INSERT INTO refund_requests 
        (id, order_id, customer_id, status, issue_category, affected_items, customer_description, requested_resolution)
       VALUES ($1, $2, $3, 'SUBMITTED', $4, $5, $6, $7)`,
      [requestId, order_id, customerId, issue_category, affected_items, description, requested_resolution]
    );

    // Compute hashes and store evidence metadata
    const evidenceRecords = [];
    for (const file of files) {
      const fileHash = await computeFileHash(file.path);
      const evidenceId = `EVD-${crypto.randomBytes(6).toString('hex')}`;

      await client.query(
        `INSERT INTO refund_evidence 
          (id, refund_request_id, original_filename, stored_filename, file_path, mime_type, file_size_bytes, sha256_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [evidenceId, requestId, file.originalname, file.filename, file.path, file.mimetype, file.size, fileHash]
      );

      evidenceRecords.push({
        id: evidenceId,
        filename: file.originalname,
        size: file.size,
        hash: fileHash,
      });
    }

    // Insert append-only audit log entry
    await client.query(
      `INSERT INTO refund_audit_logs 
        (refund_request_id, event_type, actor, payload)
       VALUES ($1, 'DISPUTE_SUBMITTED', 'CUSTOMER', $2)`,
      [
        requestId,
        JSON.stringify({
          order_id,
          customer_id: customerId,
          issue_category,
          affected_items,
          evidence_count: files.length,
          timestamp: new Date().toISOString(),
        }),
      ]
    );

    await client.query('COMMIT');

    // 4. Async Job Enqueue via BullMQ + Redis
    await enqueueRefundAnalysis(requestId, order_id, customerId);

    // Broadcast submission event via SSE EventBus
    await broadcastDisputeEvent({
      requestId,
      type: 'DISPUTE_SUBMITTED',
      stage: 'INTAKE',
      status: 'SUBMITTED',
      data: { order_id, issue_category, affected_items },
    });

    // 5. Respond with HTTP 202 Accepted immediately
    res.status(202).json({
      success: true,
      request_id: requestId,
      status: 'SUBMITTED',
      message: 'Refund dispute accepted and queued for autonomous AI analysis and verification.',
      tracking_url: `/api/refunds/${requestId}`,
      submission_time: new Date().toISOString(),
      order: {
        id: order.id,
        restaurant: order.restaurant_name,
        total_amount: Number(order.total_amount),
        order_status: order.order_status,
      },
      evidence_uploaded: evidenceRecords.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to persist refund request:', error);
    res.status(500).json({
      success: false,
      error: 'Internal error: Failed to record refund request.',
    });
  } finally {
    client.release();
  }
});

/**
 * Endpoint: GET /api/refunds/:requestId
 * Real-time tracking of dispute status, AI reasoning, guardrails, and audit log
 */
refundsRouter.get('/:requestId', async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.customer!.id;
    const requestId = String(req.params.requestId);

    const requestResult = await query(
      `SELECT r.*, o.total_amount AS order_total, rest.name AS restaurant_name
       FROM refund_requests r
       JOIN orders o ON r.order_id = o.id
       JOIN restaurants rest ON o.restaurant_id = rest.id
       WHERE r.id = $1`,
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      res.status(404).json({ success: false, error: `Refund request ${requestId} not found.` });
      return;
    }

    const refund = requestResult.rows[0];

    // Ownership check (unless reviewer)
    if (refund.customer_id !== customerId && req.headers['x-role'] !== 'admin') {
      res.status(403).json({ success: false, error: 'Unauthorized to view this refund request.' });
      return;
    }

    // Retrieve uploaded evidence files
    const evidenceResult = await query(
      `SELECT id, original_filename, stored_filename, mime_type, file_size_bytes, sha256_hash, uploaded_at
       FROM refund_evidence
       WHERE refund_request_id = $1`,
      [requestId]
    );

    // Retrieve audit logs
    const auditLogsResult = await query(
      `SELECT event_type, actor, refund_amount, payload, created_at
       FROM refund_audit_logs
       WHERE refund_request_id = $1
       ORDER BY created_at ASC`,
      [requestId]
    );

    res.json({
      success: true,
      refund: {
        ...refund,
        evidence: evidenceResult.rows,
        audit_trail: auditLogsResult.rows,
      },
    });
  } catch (error) {
    console.error('Error fetching refund tracking:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve refund dispute details.' });
  }
});

/**
 * Option 5: Real-time Server-Sent Events (SSE) Stream
 * Endpoint: GET /api/refunds/:requestId/stream
 * Streams instant push updates to the browser as the AI worker processes each pipeline stage.
 */
refundsRouter.get('/:requestId/stream', async (req: Request, res: Response): Promise<void> => {
  const { requestId } = req.params;

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial connection handshake event
  res.write(`event: connected\ndata: ${JSON.stringify({ type: 'CONNECTED', requestId, timestamp: new Date().toISOString() })}\n\n`);

  const subscriber = createRedisSubscriber();
  const channel = `dispute:${requestId}`;

  try {
    await subscriber.connect();
    await subscriber.subscribe(channel);

    subscriber.on('message', (chan, message) => {
      if (chan === channel) {
        res.write(`data: ${message}\n\n`);
      }
    });

    // 20s heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 20000);

    req.on('close', async () => {
      clearInterval(heartbeat);
      try {
        await subscriber.unsubscribe(channel);
        subscriber.disconnect();
      } catch {}
    });
  } catch (err) {
    console.warn(`[SSE] Subscription error for ${requestId}:`, err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'SSE stream connection failed' })}\n\n`);
    res.end();
  }
});

/**
 * Option 1: Customer Supplemental Evidence Submission
 * Endpoint: POST /api/refunds/:requestId/additional-evidence
 * Allows customers to submit additional photo evidence or explanations when a human reviewer requests more info.
 */
refundsRouter.post(
  '/:requestId/additional-evidence',
  uploadEvidence.array('evidence', 5),
  verifyUploadedFilesIntegrity,
  optimizeUploadedFiles,
  async (req: Request, res: Response): Promise<void> => {
    const customerId = req.customer!.id;
    const requestId = String(req.params.requestId);
    const customerNotes = req.body.customer_notes?.trim() || '';
    const files = (req.files as Express.Multer.File[]) || [];

    if (files.length === 0 && !customerNotes) {
      res.status(400).json({
        success: false,
        error: 'Please provide at least one photo or an explanatory message.',
      });
      return;
    }

    const disputeResult = await query(
      `SELECT id, customer_id, order_id, status FROM refund_requests WHERE id = $1`,
      [requestId]
    );

    if (disputeResult.rows.length === 0) {
      res.status(404).json({ success: false, error: `Dispute ${requestId} not found.` });
      return;
    }

    const dispute = disputeResult.rows[0];

    // Ownership check
    if (dispute.customer_id !== customerId) {
      res.status(403).json({ success: false, error: 'Unauthorized to update this dispute.' });
      return;
    }

    // Must be in ACTION_REQUIRED or ESCALATED status
    if (dispute.status !== 'ACTION_REQUIRED' && dispute.status !== 'ESCALATED') {
      res.status(400).json({
        success: false,
        error: `Cannot submit supplemental evidence. Current status is ${dispute.status}.`,
      });
      return;
    }

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert new evidence files
      for (const file of files) {
        const fileHash = await computeFileHash(file.path);
        const evidenceId = `EVD-${crypto.randomBytes(6).toString('hex')}`;

        await client.query(
          `INSERT INTO refund_evidence 
            (id, refund_request_id, original_filename, stored_filename, file_path, mime_type, file_size_bytes, sha256_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            evidenceId,
            requestId,
            file.originalname,
            file.filename,
            file.path,
            file.mimetype,
            file.size,
            fileHash,
          ]
        );
      }

      // 2. Insert audit log
      await client.query(
        `INSERT INTO refund_audit_logs (refund_request_id, event_type, actor, payload)
         VALUES ($1, 'ADDITIONAL_EVIDENCE_SUBMITTED', 'CUSTOMER', $2)`,
        [
          requestId,
          JSON.stringify({
            customer_id: customerId,
            files_uploaded: files.map((f) => f.originalname),
            customer_notes: customerNotes,
            timestamp: new Date().toISOString(),
          }),
        ]
      );

      // 3. Return status to ESCALATED for reviewer re-evaluation
      await client.query(
        `UPDATE refund_requests
         SET 
           status = 'ESCALATED',
           updated_at = NOW()
         WHERE id = $1`,
        [requestId]
      );

      await client.query('COMMIT');

      // 4. Send customer confirmation notification
      await sendCustomerNotification({
        requestId,
        customerId,
        orderId: dispute.order_id,
        type: 'SENT_TO_HUMAN_REVIEW',
        title: 'Supplemental Evidence Received',
        message: `Your additional evidence for order ${dispute.order_id} has been received and returned to the claims review queue.`,
        timestamp: new Date().toISOString(),
      });

      // Broadcast update via SSE
      await broadcastDisputeEvent({
        requestId,
        type: 'ADDITIONAL_EVIDENCE_RECEIVED',
        status: 'ESCALATED',
        data: { files_count: files.length, customer_notes: customerNotes },
      });

      res.json({
        success: true,
        message: 'Supplemental evidence submitted successfully. Your dispute has been returned to the specialist review queue.',
        new_status: 'ESCALATED',
        files_count: files.length,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error('Error submitting supplemental evidence:', err);
      res.status(500).json({ success: false, error: 'Failed to submit supplemental evidence.' });
    } finally {
      client.release();
    }
  }
);

/**
 * Endpoint: GET /api/refunds
 * List all refund requests submitted by the authenticated customer
 */
refundsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.customer!.id;

    const result = await query(
      `SELECT r.id, r.order_id, rest.name AS restaurant_name, r.status, r.issue_category, 
              r.affected_items, r.final_refund_amount, r.created_at, r.updated_at
       FROM refund_requests r
       JOIN orders o ON r.order_id = o.id
       JOIN restaurants rest ON o.restaurant_id = rest.id
       WHERE r.customer_id = $1
       ORDER BY r.created_at DESC`,
      [customerId]
    );

    res.json({
      success: true,
      refunds: result.rows,
    });
  } catch (error) {
    console.error('Error listing refunds:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve refunds list.' });
  }
});
