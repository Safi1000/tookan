-- Migration: Create merchants table
-- Stores merchant/customer data synced from Tookan's viewCustomersWithPagination API
-- Note: vendor_id from Tookan is stored as merchant_id here

CREATE TABLE IF NOT EXISTS merchants (
  customer_id BIGINT PRIMARY KEY,
  customer_username TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  customer_address TEXT,
  company TEXT,
  description TEXT,
  customer_latitude TEXT,
  customer_longitude TEXT,
  creation_datetime TEXT,
  merchant_id BIGINT,
  tags TEXT,
  registration_status INTEGER DEFAULT 1,
  is_blocked INTEGER DEFAULT 0,
  vendor_image TEXT,
  source TEXT,
  is_form_user BOOLEAN DEFAULT false,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on merchant_id for lookup
CREATE INDEX IF NOT EXISTS idx_merchants_merchant_id ON merchants(merchant_id);

-- Index on customer_email for search
CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(customer_email);
