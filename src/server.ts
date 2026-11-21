import express from 'express';
import cors from 'cors';
import { env } from './config/index.js';
import { ordersRouter } from './routes/orders.js';
import { refundsRouter } from './routes/refunds.js';
import { reviewRouter } from './routes/review.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  console.error('Unhandled API Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

const server = app.listen(env.PORT, () => {
  console.log(`🚀 RefundIQ Express Server running at http://localhost:${env.PORT}`);
  console.log(`📦 Step 1 Endpoint: GET /api/orders (Session Order Lookup) ready.`);
});

export default app;
