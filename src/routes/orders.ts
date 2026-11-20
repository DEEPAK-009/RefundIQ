import { Router, Request, Response } from 'express';
import { query } from '../db/index.js';
import { authenticateCustomer } from '../middleware/auth.js';

export const ordersRouter = Router();

// Apply session authentication to all order routes
ordersRouter.use(authenticateCustomer);

/**
 * Step 1.1: Authentication and order lookup
 * Endpoint: GET /api/orders
 * - Verifies the customer's session.
 * - Extracts customer_id from authenticated session.
 * - Fetches orders belonging strictly to that customer from PostgreSQL.
 * - Returns authoritative order history with restaurant details, items, quantities, prices, and status.
 */
ordersRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.customer!.id;

    const sql = `
      SELECT 
        o.id AS order_id,
        r.id AS restaurant_id,
        r.name AS restaurant_name,
        o.total_amount,
        o.order_status,
        o.payment_status,
        o.refund_status,
        o.previous_refund_amount,
        o.delivery_timestamp,
        o.created_at AS order_timestamp,
        COALESCE(
          json_agg(
            json_build_object(
              'item_id', oi.id,
              'name', oi.item_name,
              'quantity', oi.quantity,
              'price_per_unit', oi.price_per_unit,
              'total_price', oi.total_price
            ) ORDER BY oi.id
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.customer_id = $1
      GROUP BY o.id, r.id, r.name
      ORDER BY o.created_at DESC;
    `;

    const result = await query(sql, [customerId]);

    res.json({
      success: true,
      customer: {
        id: req.customer!.id,
        name: req.customer!.name,
      },
      orders: result.rows,
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve order history.',
    });
  }
});

/**
 * Step 1.2: Order selection and read-only binding lookup
 * Endpoint: GET /api/orders/:orderId
 * - Backend independently fetches order by authenticated customer_id and selected order_id.
 * - Guarantees the customer owns this order before they can initiate a dispute.
 */
ordersRouter.get('/:orderId', async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.customer!.id;
    const { orderId } = req.params;

    const sql = `
      SELECT 
        o.id AS order_id,
        r.id AS restaurant_id,
        r.name AS restaurant_name,
        o.total_amount,
        o.order_status,
        o.payment_status,
        o.refund_status,
        o.previous_refund_amount,
        o.delivery_timestamp,
        o.created_at AS order_timestamp,
        COALESCE(
          json_agg(
            json_build_object(
              'item_id', oi.id,
              'name', oi.item_name,
              'quantity', oi.quantity,
              'price_per_unit', oi.price_per_unit,
              'total_price', oi.total_price
            ) ORDER BY oi.id
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id = $1 AND o.customer_id = $2
      GROUP BY o.id, r.id, r.name;
    `;

    const result = await query(sql, [orderId, customerId]);

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: `Order ${orderId} not found or does not belong to customer ${customerId}. (Trust separation enforced)`,
      });
      return;
    }

    res.json({
      success: true,
      order: result.rows[0],
    });
  } catch (error) {
    console.error('Error fetching order detail:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve order details.',
    });
  }
});
