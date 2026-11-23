import express from 'express';
import cors from 'cors';
import path from 'path';
import { env, storagePath } from './config/index.js';
import { ordersRouter } from './routes/orders.js';
import { refundsRouter } from './routes/refunds.js';
import { reviewRouter } from './routes/review.js';
import { generalApiLimiter } from './middleware/rateLimiter.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply general API rate limiting across all /api endpoints
app.use('/api', generalApiLimiter);

// Serve static frontend assets
app.use(express.static(path.resolve(process.cwd(), 'public')));

// Serve uploaded evidence photos securely for UI inspection
app.use('/uploads', express.static(storagePath));

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'RefundIQ API',
  });
});

// Step 1: Customer Intake & Trust Separation routes
app.use('/api/orders', ordersRouter);

// Step 2: Backend Ingestion, Verification & Queuing routes
app.use('/api/refunds', refundsRouter);

// Step 7: Human Review Cockpit & Execution routes
app.use('/api/review', reviewRouter);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({
      success: false,
      error: 'MAX_FILES_EXCEEDED',
      message: 'Too many files uploaded. A maximum of 2 photos are accepted for initial dispute submission.',
    });
    return;
  }
  console.error('Unhandled API Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

const server = app.listen(env.PORT, () => {
  console.log(`RefundIQ Express Server running at http://localhost:${env.PORT}`);
  console.log(`Step 1 Endpoint: GET /api/orders (Session Order Lookup) ready.`);
});

export default app;
