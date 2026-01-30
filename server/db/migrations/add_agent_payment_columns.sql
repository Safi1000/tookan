-- Migration: Add paid and balance columns to agents table
-- Run this in Supabase SQL Editor

-- Add total_paid column to track cumulative payments to drivers
ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_paid DECIMAL(12,2) DEFAULT 0;

-- Add balance column to track remaining balance (COD received minus paid)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS balance DECIMAL(12,2) DEFAULT 0;

-- Add comments for clarity
COMMENT ON COLUMN agents.total_paid IS 'Total amount paid to this driver (cumulative)';
COMMENT ON COLUMN agents.balance IS 'Current balance owed to the driver (COD received minus total paid)';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_agents_balance ON agents(balance);
CREATE INDEX IF NOT EXISTS idx_agents_total_paid ON agents(total_paid);
