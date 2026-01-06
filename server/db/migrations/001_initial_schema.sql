-- Initial Database Schema for Tookan Integration
-- Run this migration in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  permissions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks table (orders from Tookan)
CREATE TABLE IF NOT EXISTS public.tasks (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT UNIQUE NOT NULL,
  status INTEGER DEFAULT 0,
  customer_name VARCHAR(255),
  customer_phone VARCHAR(50),
  customer_email VARCHAR(255),
  vendor_id BIGINT,
  fleet_id BIGINT,
  fleet_name VARCHAR(255),
  cod_amount DECIMAL(10, 2) DEFAULT 0,
  cod_collected BOOLEAN DEFAULT FALSE,
  order_fees DECIMAL(10, 2) DEFAULT 0,
  template_fields JSONB DEFAULT '{}'::jsonb,
  pickup_address TEXT,
  delivery_address TEXT,
  notes TEXT,
  creation_datetime TIMESTAMP WITH TIME ZONE,
  webhook_received_at TIMESTAMP WITH TIME ZONE,
  event_type VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Task history table (audit log for tasks)
CREATE TABLE IF NOT EXISTS public.task_history (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT REFERENCES public.tasks(id) ON DELETE CASCADE,
  job_id BIGINT NOT NULL,
  field VARCHAR(100),
  old_value JSONB,
  new_value JSONB,
  changed_by UUID REFERENCES public.users(id),
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  source VARCHAR(50) DEFAULT 'api'
);

-- COD queue table
CREATE TABLE IF NOT EXISTS public.cod_queue (
  id BIGSERIAL PRIMARY KEY,
  driver_id BIGINT NOT NULL,
  task_id BIGINT REFERENCES public.tasks(id) ON DELETE SET NULL,
  job_id BIGINT,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  settled_at TIMESTAMP WITH TIME ZONE,
  settled_by UUID REFERENCES public.users(id),
  payment_method VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Merchant plans table
CREATE TABLE IF NOT EXISTS public.merchant_plans (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  fee_structure JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Merchant plan assignments table
CREATE TABLE IF NOT EXISTS public.merchant_plan_assignments (
  id BIGSERIAL PRIMARY KEY,
  merchant_id BIGINT NOT NULL,
  plan_id BIGINT REFERENCES public.merchant_plans(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  assigned_by UUID REFERENCES public.users(id)
);

-- Withdrawal requests table
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id BIGSERIAL PRIMARY KEY,
  request_type VARCHAR(50) NOT NULL,
  customer_id BIGINT,
  merchant_id BIGINT,
  driver_id BIGINT,
  vendor_id BIGINT,
  fleet_id BIGINT,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID REFERENCES public.users(id),
  rejected_by UUID REFERENCES public.users(id),
  rejection_reason TEXT
);

-- Webhook events table (for webhook reliability)
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(100),
  job_id BIGINT,
  payload JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(50) DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMP WITH TIME ZONE,
  processed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100),
  entity_id BIGINT,
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tag config table
CREATE TABLE IF NOT EXISTS public.tag_config (
  id BIGSERIAL PRIMARY KEY,
  config JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Task metadata table
CREATE TABLE IF NOT EXISTS public.task_metadata (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT UNIQUE NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON public.tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_fleet_id ON public.tasks(fleet_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creation_datetime ON public.tasks(creation_datetime);
CREATE INDEX IF NOT EXISTS idx_tasks_vendor_id ON public.tasks(vendor_id);

CREATE INDEX IF NOT EXISTS idx_task_history_job_id ON public.task_history(job_id);
CREATE INDEX IF NOT EXISTS idx_task_history_changed_at ON public.task_history(changed_at);

CREATE INDEX IF NOT EXISTS idx_cod_queue_driver_id ON public.cod_queue(driver_id);
CREATE INDEX IF NOT EXISTS idx_cod_queue_status ON public.cod_queue(status);
CREATE INDEX IF NOT EXISTS idx_cod_queue_created_at ON public.cod_queue(created_at);

CREATE INDEX IF NOT EXISTS idx_merchant_plan_assignments_merchant_id ON public.merchant_plan_assignments(merchant_id);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON public.withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_requested_at ON public.withdrawal_requests(requested_at);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON public.webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON public.webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_job_id ON public.webhook_events(job_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON public.audit_logs(entity_type);

CREATE INDEX IF NOT EXISTS idx_task_metadata_job_id ON public.task_metadata(job_id);

-- Enable Row Level Security (initially permissive, will tighten later)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cod_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_plan_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_metadata ENABLE ROW LEVEL SECURITY;

-- Create permissive policies (will be tightened after auth implementation)
-- For now, allow all operations for service role
CREATE POLICY "Service role full access" ON public.users FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.tasks FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.task_history FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.cod_queue FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.merchant_plans FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.merchant_plan_assignments FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.withdrawal_requests FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.webhook_events FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.audit_logs FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.tag_config FOR ALL USING (true);
CREATE POLICY "Service role full access" ON public.task_metadata FOR ALL USING (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cod_queue_updated_at BEFORE UPDATE ON public.cod_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_merchant_plans_updated_at BEFORE UPDATE ON public.merchant_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhook_events_updated_at BEFORE UPDATE ON public.webhook_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tag_config_updated_at BEFORE UPDATE ON public.tag_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_task_metadata_updated_at BEFORE UPDATE ON public.task_metadata
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();











