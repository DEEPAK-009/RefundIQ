import { dbPool } from './index.js';

export async function seedOrders() {
  console.log('[INFO] Seeding customers, restaurants, and authoritative orders...');
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');

    // 1. Seed 6 Diverse Customer Behavioral Profiles
    await client.query(`
      INSERT INTO customers (id, name, email, phone, total_orders, refund_count, refund_rate)
      VALUES 
        -- Clean, loyal customer (Normal profile - 8% refund rate)
        ('CUST101', 'Deepak Reddy', 'deepak@example.com', '+919876543210', 12, 1, 0.08),

        -- VIP frequent customer (High volume - 8% refund rate)
        ('CUST102', 'Rahul Sharma', 'rahul@example.com', '+919876543211', 25, 2, 0.08),

        -- High-risk suspicious customer (Exceeds 30% fraud threshold - 67% refund rate)
        ('CUST103', 'Suspicious User', 'fraud_test@example.com', '+919876543212', 3, 2, 0.67),

        -- Brand new customer (First-time user - 0% refund rate)
        ('CUST104', 'Priya Nair', 'priya@example.com', '+919876543213', 1, 0, 0.00),

        -- Corporate / high-value bulk orderer (Large ticket baskets - 6% refund rate)
        ('CUST105', 'Vikram Malhotra', 'vikram.m@example.com', '+919876543214', 15, 1, 0.06),

        -- Moderate regular customer (Medium volume - 12% refund rate)
        ('CUST106', 'Ananya Sen', 'ananya@example.com', '+919876543215', 8, 1, 0.12)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        total_orders = EXCLUDED.total_orders,
        refund_count = EXCLUDED.refund_count,
        refund_rate = EXCLUDED.refund_rate;
    `);

    // 2. Seed 6 Diverse Restaurants Across Regional & Global Cuisines
    await client.query(`
      INSERT INTO restaurants (id, name, phone, address, rating)
      VALUES 
        ('REST001', 'Burger House', '+918012345678', '12 MG Road, Indiranagar, Bangalore', 4.6),
        ('REST002', 'Biryani Bowl', '+918012345679', '45 100ft Road, Koramangala, Bangalore', 4.8),
        ('REST003', 'Pizza Italia', '+918012345680', '88 Church Street, Bangalore', 4.3),
        ('REST004', 'Dragon Wok Asian Kitchen', '+918012345681', '21 CMH Road, Indiranagar, Bangalore', 4.7),
        ('REST005', 'Sweet Tooth Bakery & Cafe', '+918012345682', '14 Lavelle Road, Bangalore', 4.5),
        ('REST006', 'Madurai Tiffin House', '+918012345683', '33 Gandhi Bazaar, Basavanagudi, Bangalore', 4.9)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        rating = EXCLUDED.rating;
    `);

    // 3. Seed 27 Authoritative Orders Across Customers & Restaurants
    await client.query(`
      INSERT INTO orders (id, customer_id, restaurant_id, total_amount, order_status, payment_status, refund_status, previous_refund_amount, delivery_timestamp, created_at)
      VALUES 
        -- ==================== CUST101: Deepak Reddy ====================
        -- ORD1024: Exact order from design specification (Delivered 35m ago)
        ('ORD1024', 'CUST101', 'REST001', 500.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '35 minutes', NOW() - INTERVAL '1 hour'),
        -- ORD1025: Biryani order (Delivered 2h ago)
        ('ORD1025', 'CUST101', 'REST002', 540.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '3 hours'),
        -- ORD1026: Pizza Italia order (Delivered 28h ago - EXPIRED CLAIM WINDOW, FULLY REFUNDED)
        ('ORD1026', 'CUST101', 'REST003', 450.00, 'Delivered', 'Successful', 'FULL', 450.00, NOW() - INTERVAL '28 hours', NOW() - INTERVAL '29 hours'),
        -- ORD1027: Asian Kitchen order (Delivered 45m ago)
        ('ORD1027', 'CUST101', 'REST004', 480.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '1 hour 15 minutes'),
        -- ORD1028: Bakery order (Delivered 4h ago)
        ('ORD1028', 'CUST101', 'REST005', 420.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '4 hours', NOW() - INTERVAL '4 hours 45 minutes'),
        -- ORD1029: South Indian breakfast (Delivered 1h ago)
        ('ORD1029', 'CUST101', 'REST006', 220.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour 30 minutes'),

        -- ==================== CUST102: Rahul Sharma (VIP) ====================
        -- ORD2001: Burger House order (Delivered 4h ago)
        ('ORD2001', 'CUST102', 'REST001', 350.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '4 hours', NOW() - INTERVAL '5 hours'),
        -- ORD2002: Royal Biryani & Kebab feast (Delivered 1h ago)
        ('ORD2002', 'CUST102', 'REST002', 800.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour 45 minutes'),
        -- ORD2003: Gourmet Pizza & Tiramisu (Delivered 3h ago)
        ('ORD2003', 'CUST102', 'REST003', 950.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '4 hours'),
        -- ORD2004: Dim Sums & Fried Rice (Delivered 50m ago)
        ('ORD2004', 'CUST102', 'REST004', 680.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '50 minutes', NOW() - INTERVAL '1 hour 20 minutes'),
        -- ORD2005: Tiffin Combo (Delivered 2h ago - PARTIALLY REFUNDED)
        ('ORD2005', 'CUST102', 'REST006', 540.00, 'Delivered', 'Successful', 'PARTIAL', 120.00, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours 40 minutes'),

        -- ==================== CUST103: Suspicious User (High Risk) ====================
        -- ORD3001: Chicken Bucket (Delivered 30m ago)
        ('ORD3001', 'CUST103', 'REST001', 750.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '1 hour'),
        -- ORD3002: Biryani & Starters (Delivered 3h ago)
        ('ORD3002', 'CUST103', 'REST002', 920.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours 40 minutes'),
        -- ORD3003: Pizza (Delivered 48h ago - EXPIRED & FULLY REFUNDED)
        ('ORD3003', 'CUST103', 'REST003', 840.00, 'Delivered', 'Successful', 'FULL', 840.00, NOW() - INTERVAL '48 hours', NOW() - INTERVAL '49 hours'),
        -- ORD3004: Asian Cuisine (Delivered 20m ago)
        ('ORD3004', 'CUST103', 'REST004', 600.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '50 minutes'),

        -- ==================== CUST104: Priya Nair (Brand New User) ====================
        -- ORD4001: First order - Budget burger combo (Delivered 25m ago)
        ('ORD4001', 'CUST104', 'REST001', 300.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '55 minutes'),
        -- ORD4002: Bakery dessert & coffee (Delivered 2h ago)
        ('ORD4002', 'CUST104', 'REST005', 360.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours 30 minutes'),

        -- ==================== CUST105: Vikram Malhotra (Corporate / High Value) ====================
        -- ORD5001: Large Biryani Feast (₹2,500 - Delivered 1h ago)
        ('ORD5001', 'CUST105', 'REST002', 2500.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '2 hours'),
        -- ORD5002: Large Team Pizza Party (₹2,200 - Delivered 3h ago)
        ('ORD5002', 'CUST105', 'REST003', 2200.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '4 hours'),
        -- ORD5003: Asian Multi-Dish Banquet (₹2,300 - Delivered 40m ago)
        ('ORD5003', 'CUST105', 'REST004', 2300.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '40 minutes', NOW() - INTERVAL '1 hour 30 minutes'),
        -- ORD5004: Corporate Breakfast & Pastry Box (₹2,290 - Delivered 4h ago)
        ('ORD5004', 'CUST105', 'REST005', 2290.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '4 hours', NOW() - INTERVAL '4 hours 50 minutes'),

        -- ==================== CUST106: Ananya Sen (Moderate Frequent) ====================
        -- ORD6001: South Indian breakfast (Delivered 30m ago)
        ('ORD6001', 'CUST106', 'REST006', 310.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '1 hour'),
        -- ORD6002: Burger & Shake meal (Delivered 2h ago)
        ('ORD6002', 'CUST106', 'REST001', 560.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours 45 minutes'),
        -- ORD6003: Paneer Biryani meal (Delivered 5h ago)
        ('ORD6003', 'CUST106', 'REST002', 400.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '5 hours', NOW() - INTERVAL '5 hours 45 minutes'),
        -- ORD6004: Italian pizza & dessert (Delivered 36h ago - EXPIRED CLAIM WINDOW)
        ('ORD6004', 'CUST106', 'REST003', 600.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '36 hours', NOW() - INTERVAL '37 hours'),
        -- ORD6005: Noodles & wontons (Delivered 1h ago)
        ('ORD6005', 'CUST106', 'REST004', 480.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour 40 minutes'),
        -- ORD6006: Coffee & cupcake (Delivered 45m ago)
        ('ORD6006', 'CUST106', 'REST005', 240.00, 'Delivered', 'Successful', 'NONE', 0.00, NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '1 hour 15 minutes')
      ON CONFLICT (id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        restaurant_id = EXCLUDED.restaurant_id,
        total_amount = EXCLUDED.total_amount,
        order_status = EXCLUDED.order_status,
        payment_status = EXCLUDED.payment_status,
        refund_status = EXCLUDED.refund_status,
        previous_refund_amount = EXCLUDED.previous_refund_amount,
        delivery_timestamp = EXCLUDED.delivery_timestamp,
        created_at = EXCLUDED.created_at;
    `);

    // 4. Seed Order Items (Clear old items and re-insert authoritative items)
    await client.query(`DELETE FROM order_items WHERE order_id LIKE 'ORD%';`);

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

        -- ORD1027 items
        ('ITEM1027_1', 'ORD1027', 'Veg Hakka Noodles', 1, 220.00, 220.00),
        ('ITEM1027_2', 'ORD1027', 'Chilli Paneer Dry', 1, 260.00, 260.00),

        -- ORD1028 items
        ('ITEM1028_1', 'ORD1028', 'Chocolate Truffle Pastry', 2, 120.00, 240.00),
        ('ITEM1028_2', 'ORD1028', 'Hazelnut Cold Coffee', 1, 180.00, 180.00),

        -- ORD1029 items
        ('ITEM1029_1', 'ORD1029', 'Ghee Roast Masala Dosa', 1, 160.00, 160.00),
        ('ITEM1029_2', 'ORD1029', 'Madras Filter Coffee', 1, 60.00, 60.00),

        -- ORD2001 items
        ('ITEM2001_1', 'ORD2001', 'Veg Whopper', 1, 250.00, 250.00),
        ('ITEM2001_2', 'ORD2001', 'Cold Coffee', 1, 100.00, 100.00),

        -- ORD2002 items
        ('ITEM2002_1', 'ORD2002', 'Mutton Dum Biryani', 1, 380.00, 380.00),
        ('ITEM2002_2', 'ORD2002', 'Chicken Tikka Kebab', 1, 320.00, 320.00),
        ('ITEM2002_3', 'ORD2002', 'Butter Naan', 2, 50.00, 100.00),

        -- ORD2003 items
        ('ITEM2003_1', 'ORD2003', 'Farmhouse Gourmet Pizza', 1, 550.00, 550.00),
        ('ITEM2003_2', 'ORD2003', 'Cheesy Garlic Breadsticks', 1, 180.00, 180.00),
        ('ITEM2003_3', 'ORD2003', 'Tiramisu Cup', 1, 220.00, 220.00),

        -- ORD2004 items
        ('ITEM2004_1', 'ORD2004', 'Steamed Chicken Dim Sums', 1, 280.00, 280.00),
        ('ITEM2004_2', 'ORD2004', 'Schezwan Fried Rice', 1, 240.00, 240.00),
        ('ITEM2004_3', 'ORD2004', 'Manchow Soup', 1, 160.00, 160.00),

        -- ORD2005 items
        ('ITEM2005_1', 'ORD2005', 'Idli Vada Combo', 2, 120.00, 240.00),
        ('ITEM2005_2', 'ORD2005', 'Mysore Masala Dosa', 1, 180.00, 180.00),
        ('ITEM2005_3', 'ORD2005', 'Madras Filter Coffee', 2, 60.00, 120.00),

        -- ORD3001 items
        ('ITEM3001_1', 'ORD3001', 'Crispy Chicken Bucket', 1, 600.00, 600.00),
        ('ITEM3001_2', 'ORD3001', 'Peri Peri Fries', 1, 150.00, 150.00),

        -- ORD3002 items
        ('ITEM3002_1', 'ORD3002', 'Special Chicken Biryani', 2, 320.00, 640.00),
        ('ITEM3002_2', 'ORD3002', 'Chicken 65', 1, 280.00, 280.00),

        -- ORD3003 items
        ('ITEM3003_1', 'ORD3003', 'Pepperoni Feast Pizza', 1, 650.00, 650.00),
        ('ITEM3003_2', 'ORD3003', 'Stuffed Garlic Bread', 1, 190.00, 190.00),

        -- ORD3004 items
        ('ITEM3004_1', 'ORD3004', 'Kung Pao Chicken', 1, 340.00, 340.00),
        ('ITEM3004_2', 'ORD3004', 'Burnt Garlic Fried Rice', 1, 260.00, 260.00),

        -- ORD4001 items
        ('ITEM4001_1', 'ORD4001', 'Classic Cheeseburger', 1, 150.00, 150.00),
        ('ITEM4001_2', 'ORD4001', 'Salted Fries', 1, 90.00, 90.00),
        ('ITEM4001_3', 'ORD4001', 'Coke Zero', 1, 60.00, 60.00),

        -- ORD4002 items
        ('ITEM4002_1', 'ORD4002', 'Blueberry Cheesecake', 1, 220.00, 220.00),
        ('ITEM4002_2', 'ORD4002', 'Cappuccino', 1, 140.00, 140.00),

        -- ORD5001 items (High-Value Order ₹2,500)
        ('ITEM5001_1', 'ORD5001', 'Royal Chicken Biryani Family Pack', 4, 400.00, 1600.00),
        ('ITEM5001_2', 'ORD5001', 'Mutton Seekh Kebab Platter', 2, 350.00, 700.00),
        ('ITEM5001_3', 'ORD5001', 'Gulab Jamun Box', 4, 50.00, 200.00),

        -- ORD5002 items (High-Value Order ₹2,200)
        ('ITEM5002_1', 'ORD5002', 'Large BBQ Chicken Pizza', 2, 650.00, 1300.00),
        ('ITEM5002_2', 'ORD5002', 'Penne Arrabiata Pasta', 2, 300.00, 600.00),
        ('ITEM5002_3', 'ORD5002', 'Cheesy Garlic Bread', 2, 150.00, 300.00),

        -- ORD5003 items (High-Value Order ₹2,300)
        ('ITEM5003_1', 'ORD5003', 'Wok Tossed Hakka Noodles', 3, 220.00, 660.00),
        ('ITEM5003_2', 'ORD5003', 'Chilli Chicken Gravy', 2, 320.00, 640.00),
        ('ITEM5003_3', 'ORD5003', 'Steamed Dim Sum Basket', 2, 280.00, 560.00),
        ('ITEM5003_4', 'ORD5003', 'Spring Rolls', 4, 110.00, 440.00),

        -- ORD5004 items (High-Value Order ₹2,290)
        ('ITEM5004_1', 'ORD5004', 'Party Assorted Pastry Box', 1, 850.00, 850.00),
        ('ITEM5004_2', 'ORD5004', 'Gourmet Club Sandwich', 4, 180.00, 720.00),
        ('ITEM5004_3', 'ORD5004', 'Iced Caramel Macchiato', 4, 180.00, 720.00),

        -- ORD6001 items
        ('ITEM6001_1', 'ORD6001', 'Onion Rava Dosa', 1, 170.00, 170.00),
        ('ITEM6001_2', 'ORD6001', 'Medu Vada Platter', 1, 80.00, 80.00),
        ('ITEM6001_3', 'ORD6001', 'Madras Filter Coffee', 1, 60.00, 60.00),

        -- ORD6002 items
        ('ITEM6002_1', 'ORD6002', 'Double Patty BBQ Burger', 1, 280.00, 280.00),
        ('ITEM6002_2', 'ORD6002', 'Crispy Onion Rings', 1, 120.00, 120.00),
        ('ITEM6002_3', 'ORD6002', 'Chocolate Milkshake', 1, 160.00, 160.00),

        -- ORD6003 items
        ('ITEM6003_1', 'ORD6003', 'Paneer Tikka Biryani', 1, 280.00, 280.00),
        ('ITEM6003_2', 'ORD6003', 'Mirchi Ka Salan', 1, 80.00, 80.00),
        ('ITEM6003_3', 'ORD6003', 'Thums Up', 1, 40.00, 40.00),

        -- ORD6004 items
        ('ITEM6004_1', 'ORD6004', 'Four Cheese Pizza', 1, 480.00, 480.00),
        ('ITEM6004_2', 'ORD6004', 'Choco Lava Cake', 1, 120.00, 120.00),

        -- ORD6005 items
        ('ITEM6005_1', 'ORD6005', 'Schezwan Chicken Noodles', 1, 260.00, 260.00),
        ('ITEM6005_2', 'ORD6005', 'Pan Fried Chicken Wontons', 1, 220.00, 220.00),

        -- ORD6006 items
        ('ITEM6006_1', 'ORD6006', 'Red Velvet Cupcake', 1, 110.00, 110.00),
        ('ITEM6006_2', 'ORD6006', 'Iced Americano', 1, 130.00, 130.00);
    `);

    await client.query('COMMIT');
    console.log('[SUCCESS] Successfully seeded 6 customers, 6 restaurants, and 27 authoritative orders!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[ERROR] Failed to seed orders:', error);
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
