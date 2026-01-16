-- Migration: 009_agents_normalized_name.sql
-- Purpose: Add normalized_name column to agents table for case-insensitive search
-- Run this in Supabase SQL Editor

-- Add normalized_name column
ALTER TABLE public.agents 
ADD COLUMN IF NOT EXISTS normalized_name VARCHAR(255);

-- Create index for faster search on normalized_name
CREATE INDEX IF NOT EXISTS idx_agents_normalized_name ON public.agents(normalized_name);

-- Add comment for documentation
COMMENT ON COLUMN public.agents.normalized_name IS 'Lowercased, trimmed name for case-insensitive search';
