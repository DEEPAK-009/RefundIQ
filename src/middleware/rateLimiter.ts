import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * 1. General API Rate Limiter
 * Applied across all /api routes to prevent brute force, scraping, and DoS.
 * Window: 1 minute, Max: 150 requests
 */
export const generalApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 150,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many API requests from this source. Please slow down and try again shortly.',
  },
});

/**
 * 2. Dispute Submission Limiter
 * Applied specifically to POST /api/refunds.
 * 
 * Crucial in an Autonomous AI Agent architecture:
 * Ingestion triggers file uploads, disk hashing, PostgreSQL transactions,
 * BullMQ job scheduling, and downstream Google Gemini Multimodal LLM invocations.
 * Limiting this prevents denial-of-wallet (DoW) and background queue starvation.
 * 
 * Window: 15 minutes, Max: 10 dispute submissions per customer/IP
 */
export const disputeSubmissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Key by authoritative customer ID if authenticated, or header, fallback to IP
    const custId = (req as any).customer?.id || req.headers['x-customer-id']?.toString();
    return custId ? `cust_${custId}` : (req.ip || 'unknown_ip');
  },
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'DISPUTE_SUBMISSION_RATE_LIMITED',
      message: 'Too many dispute requests submitted. To protect platform safety, queue integrity, and prevent automated dispute flooding, please wait 15 minutes before submitting another dispute.',
      window: '15 minutes',
    });
  },
});

/**
 * 3. Reviewer Action Limiter
 * Applied to POST /api/review/:requestId/action.
 * Prevents rapid double-clicking or scripted execution against payment refund gateways.
 * Window: 1 minute, Max: 40 actions
 */
export const reviewActionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'REVIEW_ACTION_RATE_LIMITED',
    message: 'Too many reviewer actions processed. Please wait a moment before executing more dispute decisions.',
  },
});
