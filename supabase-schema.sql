-- Tookan users table (for password storage)
    CREATE TABLE IF NOT EXISTS tookan_users (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      tookan_id TEXT NOT NULL,
      user_type TEXT NOT NULL,
      email TEXT,
      name TEXT,
      password_hash TEXT,
      role TEXT DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tookan_id, user_type)
    );

    -- Users table (for admin users)
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      name TEXT,
      role TEXT DEFAULT 'user',
      permissions JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Withdrawal requests table
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      request_type TEXT NOT NULL,
      customer_id TEXT,
      merchant_id TEXT,
      driver_id TEXT,
      vendor_id TEXT,
      fleet_id TEXT,
      amount DECIMAL(10,2) NOT NULL,
      status TEXT DEFAULT 'pending',
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      approved_by TEXT,
      rejected_at TIMESTAMPTZ,
      rejected_by TEXT,
      rejection_reason TEXT
    );

    -- Webhook events table
    CREATE TABLE IF NOT EXISTS webhook_events (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      event_type TEXT NOT NULL,
      job_id TEXT,
      payload JSONB,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      error_message TEXT
    );

    -- Audit logs table
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id TEXT,
      user_email TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      old_value JSONB,
      new_value JSONB,
      notes TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Merchant plans table
    CREATE TABLE IF NOT EXISTS merchant_plans (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price_per_order DECIMAL(10,2) DEFAULT 0,
      monthly_fee DECIMAL(10,2) DEFAULT 0,
      features JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Merchant plan assignments
    CREATE TABLE IF NOT EXISTS merchant_plan_assignments (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      plan_id UUID REFERENCES merchant_plans(id),
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      assigned_by TEXT,
      UNIQUE(merchant_id)
    );