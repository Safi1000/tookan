-- Create customers table for Tookan customer sync
-- This table stores customer data synchronized from Tookan API

CREATE TABLE IF NOT EXISTS customers (
    vendor_id BIGINT PRIMARY KEY,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(100),
    customer_email VARCHAR(255),
    customer_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on phone for faster lookups
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(customer_phone);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(customer_email);

-- Add comment
COMMENT ON TABLE customers IS 'Tookan customers synced via API and webhooks';
