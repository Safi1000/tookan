-- Migration: Create withdrawals table for Withdrawal Request Receiver API
-- Run this in Supabase SQL Editor

-- Create withdrawals table
CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fleet_id BIGINT NULL,
    vendor_id BIGINT NULL,
    email TEXT NOT NULL,
    requested_amount NUMERIC(12, 3) NOT NULL,
    tax_applied NUMERIC(12, 3) NOT NULL DEFAULT 0,
    final_amount NUMERIC(12, 3) NOT NULL,
    iban TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraint: Ensure only one of fleet_id or vendor_id is set (mutual exclusivity)
    CONSTRAINT chk_fleet_or_vendor CHECK (
        (fleet_id IS NOT NULL AND vendor_id IS NULL) OR
        (fleet_id IS NULL AND vendor_id IS NOT NULL)
    ),
    
    -- Constraint: Status must be valid
    CONSTRAINT chk_status CHECK (
        status IN ('pending', 'approved', 'rejected', 'completed')
    ),
    
    -- Constraint: Amounts must be non-negative
    CONSTRAINT chk_requested_amount CHECK (requested_amount > 0),
    CONSTRAINT chk_final_amount CHECK (final_amount >= 0)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_withdrawals_fleet_id ON withdrawals(fleet_id) WHERE fleet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_withdrawals_vendor_id ON withdrawals(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON withdrawals(created_at DESC);

-- Enable Row Level Security (optional, for additional security)
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

-- Comment on table
COMMENT ON TABLE withdrawals IS 'Stores withdrawal requests from Fleet (type=1) and Vendor (type=2) partners';
COMMENT ON COLUMN withdrawals.fleet_id IS 'Set when type=1 (Fleet withdrawal request)';
COMMENT ON COLUMN withdrawals.vendor_id IS 'Set when type=2 (Vendor withdrawal request)';
COMMENT ON COLUMN withdrawals.tax_applied IS 'Tax amount calculated by partner system (trusted)';
COMMENT ON COLUMN withdrawals.final_amount IS 'Final amount after tax calculated by partner system (trusted)';
