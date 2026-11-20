import { Request, Response, NextFunction } from 'express';
import { query } from '../db/index.js';

export interface AuthenticatedCustomer {
  id: string;
  name: string;
  email: string;
  refund_rate: number;
}

declare global {
  namespace Express {
    interface Request {
      customer?: AuthenticatedCustomer;
    }
  }
}

/**
 * Customer Session Authentication Middleware (Step 1 of PDF)
 * Extracts customer_id from the authenticated session / header.
 * For development & API testing: Reads from 'x-customer-id' or 'Authorization', defaulting to 'CUST101'.
 * Authoritatively verifies customer existence in PostgreSQL.
 */
export async function authenticateCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const customerIdHeader = (req.headers['x-customer-id'] as string) || 'CUST101';

    const result = await query(
      'SELECT id, name, email, refund_rate FROM customers WHERE id = $1',
      [customerIdHeader]
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid customer session.',
      });
      return;
    }

    req.customer = result.rows[0];
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication verification failed.',
    });
  }
}
