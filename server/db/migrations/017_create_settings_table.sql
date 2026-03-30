-- Migration: Create settings table for storing app-level key-value settings
-- Used initially for bank_amount tracking

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed the bank_amount with 0 as default
INSERT INTO settings (key, value) VALUES ('bank_amount', '0')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE settings IS 'Key-value store for application-level settings like bank_amount';
