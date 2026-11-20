-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(20),
    total_orders INTEGER NOT NULL DEFAULT 0,
    refund_count INTEGER NOT NULL DEFAULT 0,
    refund_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Restaurants Table
CREATE TABLE IF NOT EXISTS restaurants (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    rating NUMERIC(3,2) DEFAULT 4.5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Orders Table (Authoritative record)
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL REFERENCES customers(id),
    restaurant_id VARCHAR(50) NOT NULL REFERENCES restaurants(id),
    total_amount NUMERIC(10,2) NOT NULL,
    order_status VARCHAR(50) NOT NULL DEFAULT 'Delivered',
    payment_status VARCHAR(50) NOT NULL DEFAULT 'Successful',
    refund_status VARCHAR(50) NOT NULL DEFAULT 'NONE', -- NONE, PARTIAL, FULL
    previous_refund_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    delivery_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
    id VARCHAR(50) PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_name VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL,
    price_per_unit NUMERIC(10,2) NOT NULL,
    total_price NUMERIC(10,2) NOT NULL
);

-- 5. Refund Requests Table (Dispute state machine)
CREATE TABLE IF NOT EXISTS refund_requests (
    id VARCHAR(50) PRIMARY KEY, -- e.g. REF202601
    order_id VARCHAR(50) NOT NULL REFERENCES orders(id),
    customer_id VARCHAR(50) NOT NULL REFERENCES customers(id),
    status VARCHAR(50) NOT NULL DEFAULT 'SUBMITTED', -- SUBMITTED, PROCESSING, AUTO_APPROVED, AUTO_DECLINED, ESCALATED, MANUALLY_APPROVED, MANUALLY_REJECTED
    issue_category VARCHAR(50) NOT NULL, -- missing_item, wrong_item, damaged_spilled, food_quality, not_delivered, other
    affected_items TEXT[] NOT NULL DEFAULT '{}',
    customer_description TEXT NOT NULL,
    requested_resolution VARCHAR(50) NOT NULL DEFAULT 'partial_refund', -- full_refund, partial_refund, other
    
    -- AI Extraction & Verification outputs (populated in Step 3)
    extracted_complaint JSONB,
    extracted_evidence JSONB,
    evidence_status VARCHAR(50), -- CONSISTENT, INCONSISTENT, INCONCLUSIVE
    
    -- Policy Reasoning outputs (populated in Step 5)
    retrieved_clauses JSONB,
    agent_recommendation JSONB,
    citation_validation JSONB,
    
    -- Deterministic Guardrail outputs (populated in Step 6)
    guardrail_results JSONB,
    routing_decision VARCHAR(50), -- AUTO_APPROVE, AUTO_DECLINE, HUMAN_REVIEW
    escalation_reason TEXT,
    
    -- Execution & Financial values (populated in Step 6 & 7)
    suggested_refund_amount NUMERIC(10,2) DEFAULT 0.00,
    final_refund_amount NUMERIC(10,2) DEFAULT 0.00,
    idempotency_key VARCHAR(100) UNIQUE,
    payment_refund_id VARCHAR(100),
    reviewer_notes TEXT,
    reviewed_by VARCHAR(50),
    reviewed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Refund Evidence Table (Uploaded media metadata)
CREATE TABLE IF NOT EXISTS refund_evidence (
    id VARCHAR(50) PRIMARY KEY,
    refund_request_id VARCHAR(50) NOT NULL REFERENCES refund_requests(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Policy Vector Table (RAG with pgvector)
CREATE TABLE IF NOT EXISTS policies (
    id SERIAL PRIMARY KEY,
    clause_id VARCHAR(50) NOT NULL UNIQUE, -- e.g. POL-01
    title VARCHAR(150) NOT NULL,
    policy_text TEXT NOT NULL,
    issue_category VARCHAR(50) NOT NULL,
    refund_type VARCHAR(50) NOT NULL, -- partial, full, conditional
    policy_version VARCHAR(20) NOT NULL DEFAULT 'v1.0',
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    embedding vector(768), -- Gemini text-embedding-004 dimension
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Append-Only Audit Logs Table
CREATE TABLE IF NOT EXISTS refund_audit_logs (
    id SERIAL PRIMARY KEY,
    refund_request_id VARCHAR(50) NOT NULL REFERENCES refund_requests(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    actor VARCHAR(50) NOT NULL, -- CUSTOMER, INGESTION_API, AI_WORKER, GUARDRAIL_ENGINE, HUMAN_REVIEWER, PAYMENT_GATEWAY
    policy_version VARCHAR(20),
    cited_clauses TEXT[],
    refund_amount NUMERIC(10,2),
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_order_id ON refund_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_customer_id ON refund_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_refund_id ON refund_audit_logs(refund_request_id);
