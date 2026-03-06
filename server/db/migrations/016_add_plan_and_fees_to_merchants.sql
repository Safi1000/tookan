-- Add plan_id and withdraw_fees columns to merchants table
-- These were previously on customers table, now moving to merchants

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS withdraw_fees NUMERIC;

-- Index for plan lookups
CREATE INDEX IF NOT EXISTS idx_merchants_plan_id ON merchants(plan_id);
