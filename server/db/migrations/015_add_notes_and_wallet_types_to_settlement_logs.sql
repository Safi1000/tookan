-- Migration 015: Add notes column and wallet transaction types to settlement_logs
-- Extends logging to cover driver/merchant wallet credits/debits with notes

-- Add notes column
ALTER TABLE settlement_logs ADD COLUMN IF NOT EXISTS notes TEXT;

-- Expand settlement_type constraint to include wallet transaction types
ALTER TABLE settlement_logs DROP CONSTRAINT IF EXISTS settlement_logs_settlement_type_check;
ALTER TABLE settlement_logs ADD CONSTRAINT settlement_logs_settlement_type_check
  CHECK (settlement_type IN (
    'calendar', 'view_tasks',
    'merchant_calendar', 'merchant_view_tasks',
    'driver_wallet_credit', 'driver_wallet_debit',
    'merchant_wallet_credit', 'merchant_wallet_debit'
  ));
