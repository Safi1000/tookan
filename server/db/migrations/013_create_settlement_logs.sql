-- Migration 013: Create settlement_logs table
-- Tracks COD settlement activity for audit purposes

CREATE TABLE IF NOT EXISTS settlement_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  settled_by_email TEXT NOT NULL,
  settled_by_name TEXT,
  driver_name TEXT NOT NULL,
  fleet_id INTEGER NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('calendar', 'view_tasks')),
  settlement_date_from TEXT,
  settlement_date_to TEXT,
  task_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_settlement_logs_created_at ON settlement_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_logs_fleet_id ON settlement_logs(fleet_id);

-- Disable RLS for service role access
ALTER TABLE settlement_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON settlement_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);
