-- Migration: Add user status column for enable/disable/ban functionality
-- Date: 2026-01-10

-- Add status column to users table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'status'
    ) THEN
        ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active';
    END IF;
END $$;

-- Update existing users to have 'active' status if null
UPDATE users SET status = 'active' WHERE status IS NULL;

-- Add check constraint for valid status values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage 
        WHERE constraint_name = 'users_status_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_status_check 
        CHECK (status IN ('active', 'disabled', 'banned'));
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        NULL; -- Constraint already exists
END $$;

-- Set superadmin user to admin role with all permissions
INSERT INTO users (email, name, role, permissions, status, created_at, updated_at)
VALUES (
    'ahmedhassan123.ah83@gmail.com',
    'Super Admin',
    'admin',
    '{"edit_order_financials": true, "manage_wallets": true, "perform_reorder": true, "perform_return": true, "delete_ongoing_orders": true, "export_reports": true, "add_cod": true, "confirm_cod_payments": true, "manage_users": true}'::jsonb,
    'active',
    NOW(),
    NOW()
)
ON CONFLICT (email) DO UPDATE SET
    role = 'admin',
    permissions = '{"edit_order_financials": true, "manage_wallets": true, "perform_reorder": true, "perform_return": true, "delete_ongoing_orders": true, "export_reports": true, "add_cod": true, "confirm_cod_payments": true, "manage_users": true}'::jsonb,
    status = 'active',
    updated_at = NOW();

-- Comment on the column for documentation
COMMENT ON COLUMN users.status IS 'User account status: active (enabled), disabled (temporarily disabled), banned (permanently blocked)';

