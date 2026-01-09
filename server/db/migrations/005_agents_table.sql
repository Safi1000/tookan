-- Migration: 005_agents_table.sql
-- Purpose: Create agents table to store and cache Tookan fleet/driver data
-- Run this in Supabase SQL Editor

-- Create agents table
CREATE TABLE IF NOT EXISTS public.agents (
  id BIGSERIAL PRIMARY KEY,
  fleet_id INTEGER UNIQUE NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(100),
  username VARCHAR(255),
  status INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  team_id INTEGER,
  team_name VARCHAR(255),
  tags TEXT[],
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  battery_level INTEGER,
  registration_status INTEGER,
  transport_type INTEGER,
  transport_desc VARCHAR(100),
  license VARCHAR(100),
  color VARCHAR(50),
  raw_data JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agents_fleet_id ON public.agents(fleet_id);
CREATE INDEX IF NOT EXISTS idx_agents_is_active ON public.agents(is_active);
CREATE INDEX IF NOT EXISTS idx_agents_team_id ON public.agents(team_id);
CREATE INDEX IF NOT EXISTS idx_agents_name ON public.agents(name);

-- Enable Row Level Security
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- Create policies for agents table
-- Allow authenticated users to read agents
CREATE POLICY "Allow authenticated read access to agents"
  ON public.agents
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access to agents"
  ON public.agents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_agents_updated_at ON public.agents;
CREATE TRIGGER trigger_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_agents_updated_at();

-- Add comments for documentation
COMMENT ON TABLE public.agents IS 'Cached Tookan fleet/driver/agent data';
COMMENT ON COLUMN public.agents.fleet_id IS 'Tookan fleet ID (unique identifier)';
COMMENT ON COLUMN public.agents.name IS 'Agent display name';
COMMENT ON COLUMN public.agents.status IS 'Tookan status code';
COMMENT ON COLUMN public.agents.is_active IS 'Whether agent is currently active';
COMMENT ON COLUMN public.agents.team_id IS 'Tookan team ID';
COMMENT ON COLUMN public.agents.raw_data IS 'Full raw response from Tookan API';
COMMENT ON COLUMN public.agents.last_synced_at IS 'Last time this agent was synced from Tookan';

