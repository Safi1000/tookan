-- Migration: Order Cache Enhancement
-- Adds additional fields to tasks table and creates sync_status table
-- for 6-month order caching from Tookan API

-- ============================================
-- Expand tasks table with additional Tookan fields
-- ============================================

-- Add new columns if they don't exist
DO $$ 
BEGIN
    -- Total amount/COD for the order
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'total_amount') THEN
        ALTER TABLE public.tasks ADD COLUMN total_amount DECIMAL(10, 2) DEFAULT 0;
    END IF;

    -- Order ID from Tookan (different from job_id)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'order_id') THEN
        ALTER TABLE public.tasks ADD COLUMN order_id TEXT;
    END IF;

    -- Job type: 0=Pickup, 1=Delivery, 2=Appointment, 3=FOS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'job_type') THEN
        ALTER TABLE public.tasks ADD COLUMN job_type INTEGER DEFAULT 1;
    END IF;

    -- Raw data from Tookan API (full payload for reference)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'raw_data') THEN
        ALTER TABLE public.tasks ADD COLUMN raw_data JSONB DEFAULT '{}'::jsonb;
    END IF;

    -- Pickup details
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'pickup_name') THEN
        ALTER TABLE public.tasks ADD COLUMN pickup_name VARCHAR(255);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'pickup_phone') THEN
        ALTER TABLE public.tasks ADD COLUMN pickup_phone VARCHAR(50);
    END IF;

    -- Delivery/Customer details
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'delivery_name') THEN
        ALTER TABLE public.tasks ADD COLUMN delivery_name VARCHAR(255);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'delivery_phone') THEN
        ALTER TABLE public.tasks ADD COLUMN delivery_phone VARCHAR(50);
    END IF;

    -- Completed datetime
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'completed_datetime') THEN
        ALTER TABLE public.tasks ADD COLUMN completed_datetime TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Started datetime
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'started_datetime') THEN
        ALTER TABLE public.tasks ADD COLUMN started_datetime TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Acknowledged datetime
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'acknowledged_datetime') THEN
        ALTER TABLE public.tasks ADD COLUMN acknowledged_datetime TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Source of the record (api_sync, webhook, manual)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'source') THEN
        ALTER TABLE public.tasks ADD COLUMN source VARCHAR(50) DEFAULT 'api_sync';
    END IF;

    -- Last synced from API timestamp
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'last_synced_at') THEN
        ALTER TABLE public.tasks ADD COLUMN last_synced_at TIMESTAMP WITH TIME ZONE;
    END IF;

END $$;

-- ============================================
-- Create sync_status table
-- ============================================
CREATE TABLE IF NOT EXISTS public.sync_status (
    id BIGSERIAL PRIMARY KEY,
    sync_type VARCHAR(50) NOT NULL DEFAULT 'orders',
    status VARCHAR(50) NOT NULL DEFAULT 'idle',  -- idle, in_progress, completed, failed
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    last_successful_sync TIMESTAMP WITH TIME ZONE,
    
    -- Progress tracking
    total_batches INTEGER DEFAULT 0,
    completed_batches INTEGER DEFAULT 0,
    total_records INTEGER DEFAULT 0,
    synced_records INTEGER DEFAULT 0,
    failed_records INTEGER DEFAULT 0,
    
    -- Date range being synced
    sync_from_date DATE,
    sync_to_date DATE,
    current_batch_start DATE,
    current_batch_end DATE,
    
    -- Error tracking
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(sync_type)
);

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_tasks_order_id ON public.tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_tasks_job_type ON public.tasks(job_type);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON public.tasks(source);
CREATE INDEX IF NOT EXISTS idx_tasks_last_synced_at ON public.tasks(last_synced_at);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_datetime ON public.tasks(completed_datetime);
CREATE INDEX IF NOT EXISTS idx_tasks_total_amount ON public.tasks(total_amount);

-- Index for sync_status
CREATE INDEX IF NOT EXISTS idx_sync_status_type ON public.sync_status(sync_type);
CREATE INDEX IF NOT EXISTS idx_sync_status_status ON public.sync_status(status);

-- Enable RLS on sync_status
ALTER TABLE public.sync_status ENABLE ROW LEVEL SECURITY;

-- Create permissive policy for service role
CREATE POLICY "Service role full access" ON public.sync_status FOR ALL USING (true);

-- Create trigger for updated_at on sync_status
DROP TRIGGER IF EXISTS update_sync_status_updated_at ON public.sync_status;
CREATE TRIGGER update_sync_status_updated_at 
    BEFORE UPDATE ON public.sync_status
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial sync status record for orders
INSERT INTO public.sync_status (sync_type, status)
VALUES ('orders', 'idle')
ON CONFLICT (sync_type) DO NOTHING;

-- ============================================
-- Comments for documentation
-- ============================================
COMMENT ON TABLE public.sync_status IS 'Tracks the status of data synchronization from Tookan API';
COMMENT ON COLUMN public.sync_status.sync_type IS 'Type of sync: orders, fleets, customers';
COMMENT ON COLUMN public.sync_status.status IS 'Current status: idle, in_progress, completed, failed';
COMMENT ON COLUMN public.sync_status.total_batches IS 'Total number of 31-day batches to sync';
COMMENT ON COLUMN public.sync_status.completed_batches IS 'Number of batches successfully synced';
COMMENT ON COLUMN public.tasks.raw_data IS 'Full JSON payload from Tookan API for reference';
COMMENT ON COLUMN public.tasks.source IS 'Source of record: api_sync, webhook, manual';

