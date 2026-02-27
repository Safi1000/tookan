-- Migration 014: Extend settlement_logs for merchant wallet settlements
-- Adds merchant_name and vendor_id columns, and expands settlement_type values

-- Add new columns (nullable to not break existing rows)
ALTER TABLE settlement_logs ADD COLUMN IF NOT EXISTS merchant_name TEXT;
ALTER TABLE settlement_logs ADD COLUMN IF NOT EXISTS vendor_id BIGINT;

-- Make driver_name nullable (merchant settlements won't have a driver)
ALTER TABLE settlement_logs ALTER COLUMN driver_name DROP NOT NULL;

-- Drop and recreate the settlement_type check to allow merchant types
ALTER TABLE settlement_logs DROP CONSTRAINT IF EXISTS settlement_logs_settlement_type_check;
ALTER TABLE settlement_logs ADD CONSTRAINT settlement_logs_settlement_type_check
  CHECK (settlement_type IN ('calendar', 'view_tasks', 'merchant_calendar', 'merchant_view_tasks'));

-- Index for vendor_id lookups
CREATE INDEX IF NOT EXISTS idx_settlement_logs_vendor_id ON settlement_logs(vendor_id) WHERE vendor_id IS NOT NULL;
