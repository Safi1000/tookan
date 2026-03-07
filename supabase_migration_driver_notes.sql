-- Create driver_daily_notes table for per-driver per-day notes in Balance Panel
CREATE TABLE IF NOT EXISTS driver_daily_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fleet_id INTEGER NOT NULL,
  note_date DATE NOT NULL,
  note_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(fleet_id, note_date)
);

-- Index for fast lookups by driver + date range
CREATE INDEX IF NOT EXISTS idx_driver_daily_notes_fleet_date 
  ON driver_daily_notes(fleet_id, note_date);

-- Enable RLS
ALTER TABLE driver_daily_notes ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON driver_daily_notes
  FOR ALL USING (true) WITH CHECK (true);
