-- API Tokens Table for EDI Integration
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  permissions JSONB DEFAULT '["all"]',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  UNIQUE(token_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_merchant_id ON api_tokens(merchant_id);

-- Optional: Audit log trigger if audit_logs table exists
-- (Assuming audit_logs schema from setup-supabase-tables.js)
