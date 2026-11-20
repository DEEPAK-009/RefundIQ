import { dbPool } from './index.js';

export async function seedOrders() {
  console.log('🌱 Seeding customers, restaurants, and authoritative orders...');
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');

    // 1. Seed Customers
    await client.query(`
      INSERT INTO customers (id, name, email, phone, total_orders, refund_count, refund_rate)
      VALUES 
        ('CUST101', 'Deepak Reddy', 'deepak@example.com', '+919876543210', 12, 1, 0.08),
        ('CUST102', 'Rahul Sharma', 'rahul@example.com', '+919876543211', 25, 2, 0.08),
        ('CUST103', 'Suspicious User', 'fraud_test@example.com', '+919876543212', 3, 2, 0.67)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        refund_rate = EXCLUDED.refund_rate;
    `);

    // 2. Seed Restaurants
    await client.query(`
      INSERT INTO restaurants (id, name, phone, address, rating)
      VALUES 
        ('REST001', 'Burger House', '+918012345678', '12 MG Road, Indiranagar, Bangalore', 4.6),
        ('REST002', 'Biryani Bowl', '+918012345679', '45 100ft Road, Koramangala, Bangalore', 4.8),
        ('REST003', 'Pizza Italia', '+918012345680', '88 Church Street, Bangalore', 4.3)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name;
    `);

    // 3. Seed Orders (including exact ORD1024 from page 1 & 5 of the PDF)
    await client.query(`
      INSERT INTO orders (id, customer_id, restaurant_id, total_amount, order_status, payment_status, refund_status, previous_refund_amount, delivery_timestamp, created_at)
      VALUES 
        -- Exact order from PDF specification (Page 1 & 5)
        ('ORD1024', 'CUST101', 'REST001', 500.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '35 minutes', NOW() - INTERVAL '1 hour'),
        
        -- Additional delivered order for CUST101
        ('ORD1025', 'CUST101', 'REST002', 540.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '3 hours'),
        
        -- Already refunded order (for duplicate guardrail verification)
        ('ORD1026', 'CUST101', 'REST003', 450.00, 'Delivered', 'Successful', 'FULL', 450.00, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day 1 hour'),
        
        -- Order belonging to customer CUST102 (for order ownership tamper test)
        ('ORD2001', 'CUST102', 'REST001', 350.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '4 hours', NOW() - INTERVAL '5 hours'),
        
        -- Order for high refund-rate user CUST103
        ('ORD3001', 'CUST103', 'REST001', 750.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '1 hour')
      ON CONFLICT (id) DO UPDATE SET
        total_amount = EXCLUDED.total_amount,
        refund_status = EXCLUDED.refund_status;
    `);

    // 4. Seed Order Items
    // Clean up existing items to avoid duplicates on re-seed
    await client.query(`DELETE FROM order_items WHERE order_id IN ('ORD1024', 'ORD1025', 'ORD1026', 'ORD2001', 'ORD3001');`);

    await client.query(`
      INSERT INTO order_items (id, order_id, item_name, quantity, price_per_unit, total_price)
      VALUES 
        -- ORD1024 items: 2 Burgers (₹150 ea), 1 Fries (₹100), 1 Coke (₹100) = ₹500
        ('ITEM1024_1', 'ORD1024', 'Burger', 2, 150.00, 300.00),
        ('ITEM1024_2', 'ORD1024', 'Fries', 1, 100.00, 100.00),
        ('ITEM1024_3', 'ORD1024', 'Coke', 1, 100.00, 100.00),

        -- ORD1025 items: 2 Biryani (₹250 ea), 1 Thums Up (₹40) = ₹540
        ('ITEM1025_1', 'ORD1025', 'Hyderabadi Chicken Biryani', 2, 250.00, 500.00),
        ('ITEM1025_2', 'ORD1025', 'Thums Up', 1, 40.00, 40.00),

        -- ORD1026 items
        ('ITEM1026_1', 'ORD1026', 'Margherita Pizza', 1, 350.00, 350.00),
        ('ITEM1026_2', 'ORD1026', 'Garlic Bread', 1, 100.00, 100.00),

        -- ORD2001 items
        ('ITEM2001_1', 'ORD2001', 'Veg Whopper', 1, 250.00, 250.00),
        ('ITEM2001_2', 'ORD2001', 'Cold Coffee', 1, 100.00, 100.00),

        -- ORD3001 items
        ('ITEM3001_1', 'ORD3001', 'Crispy Chicken Bucket', 1, 600.00, 600.00),
        ('ITEM3001_2', 'ORD3001', 'Peri Peri Fries', 1, 150.00, 150.00);
    `);

    await client.query('COMMIT');
    console.log('✅ Successfully seeded customers, restaurants, and authoritative orders!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to seed orders:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1].endsWith('seedOrders.ts') || process.argv[1].endsWith('seedOrders.js')) {
  seedOrders()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
