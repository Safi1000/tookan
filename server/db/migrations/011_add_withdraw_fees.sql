-- Add withdraw_fees column to customers table
-- This column stores the fixed withdrawal fee for customers linked to a withdrawal fee

ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS withdraw_fees DECIMAL(10, 2) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN customers.withdraw_fees IS 'Fixed withdrawal fee applied to this customer, null if not linked to any fee';
