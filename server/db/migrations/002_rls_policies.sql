-- Row Level Security Policies
-- Run this after authentication is set up
-- Tightens RLS policies based on user roles and permissions

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Service role full access" ON public.users;
DROP POLICY IF EXISTS "Service role full access" ON public.tasks;
DROP POLICY IF EXISTS "Service role full access" ON public.task_history;
DROP POLICY IF EXISTS "Service role full access" ON public.cod_queue;
DROP POLICY IF EXISTS "Service role full access" ON public.merchant_plans;
DROP POLICY IF EXISTS "Service role full access" ON public.merchant_plan_assignments;
DROP POLICY IF EXISTS "Service role full access" ON public.withdrawal_requests;
DROP POLICY IF EXISTS "Service role full access" ON public.webhook_events;
DROP POLICY IF EXISTS "Service role full access" ON public.audit_logs;
DROP POLICY IF EXISTS "Service role full access" ON public.tag_config;
DROP POLICY IF EXISTS "Service role full access" ON public.task_metadata;

-- Users table policies
-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Admins can read all users
CREATE POLICY "Admins can read all users" ON public.users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Tasks table policies
-- All authenticated users can read tasks
CREATE POLICY "Authenticated users can read tasks" ON public.tasks
  FOR SELECT USING (auth.role() = 'authenticated');

-- Admins and staff can insert/update tasks
CREATE POLICY "Staff can modify tasks" ON public.tasks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- Task history policies
-- All authenticated users can read task history
CREATE POLICY "Authenticated users can read task history" ON public.task_history
  FOR SELECT USING (auth.role() = 'authenticated');

-- Staff can insert task history
CREATE POLICY "Staff can insert task history" ON public.task_history
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- COD queue policies
-- All authenticated users can read COD queue
CREATE POLICY "Authenticated users can read COD queue" ON public.cod_queue
  FOR SELECT USING (auth.role() = 'authenticated');

-- Staff can modify COD queue
CREATE POLICY "Staff can modify COD queue" ON public.cod_queue
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- Merchant plans policies
-- All authenticated users can read plans
CREATE POLICY "Authenticated users can read merchant plans" ON public.merchant_plans
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only admins can modify plans
CREATE POLICY "Admins can modify merchant plans" ON public.merchant_plans
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Merchant plan assignments policies
-- All authenticated users can read assignments
CREATE POLICY "Authenticated users can read plan assignments" ON public.merchant_plan_assignments
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only admins can modify assignments
CREATE POLICY "Admins can modify plan assignments" ON public.merchant_plan_assignments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Withdrawal requests policies
-- All authenticated users can read withdrawal requests
CREATE POLICY "Authenticated users can read withdrawal requests" ON public.withdrawal_requests
  FOR SELECT USING (auth.role() = 'authenticated');

-- Users can create their own withdrawal requests
CREATE POLICY "Users can create withdrawal requests" ON public.withdrawal_requests
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Only admins can approve/reject withdrawal requests
CREATE POLICY "Admins can modify withdrawal requests" ON public.withdrawal_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Webhook events policies
-- Only service role can access webhook events (internal use)
-- This table is managed by the backend, not directly by users

-- Audit logs policies
-- All authenticated users can read audit logs
CREATE POLICY "Authenticated users can read audit logs" ON public.audit_logs
  FOR SELECT USING (auth.role() = 'authenticated');

-- System can insert audit logs (via service role)
-- This is handled by backend, not RLS

-- Tag config policies
-- All authenticated users can read tag config
CREATE POLICY "Authenticated users can read tag config" ON public.tag_config
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only admins can modify tag config
CREATE POLICY "Admins can modify tag config" ON public.tag_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Task metadata policies
-- All authenticated users can read task metadata
CREATE POLICY "Authenticated users can read task metadata" ON public.task_metadata
  FOR SELECT USING (auth.role() = 'authenticated');

-- Staff can modify task metadata
CREATE POLICY "Staff can modify task metadata" ON public.task_metadata
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- Note: Service role (used by backend) bypasses all RLS policies
-- This is intentional for backend operations



