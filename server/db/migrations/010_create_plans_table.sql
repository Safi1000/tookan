-- Create plans table
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('fixed', 'percentage')),
    amount NUMERIC NOT NULL CHECK (amount >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index on name
CREATE INDEX IF NOT EXISTS idx_plans_name ON plans(name);

-- Add RLS policies (optional, but good practice)
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- Allow read access to authenticated users
CREATE POLICY "Allow read access for authenticated users" ON plans
    FOR SELECT
    TO authenticated
    USING (true);

-- Allow write access to authenticated users (admin assumed)
CREATE POLICY "Allow write access for authenticated users" ON plans
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
