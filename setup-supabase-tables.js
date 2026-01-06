/**
 * Setup Supabase Tables
 * 
 * Run this once to create the required tables for the app.
 * Uses your existing .env credentials.
 * 
 * Usage: node setup-supabase-tables.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupTables() {
  console.log('🚀 Setting up Supabase tables...\n');
  console.log('URL:', supabaseUrl);

  // SQL to create all required tables
  const createTablesSql = `
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
  `;

  try {
    // Use the Supabase SQL function via RPC or direct query
    // Since we can't run raw SQL directly, we'll try to create tables one by one
    // by attempting to insert/select from them

    console.log('📦 Creating tookan_users table...');
    const { error: error1 } = await supabase.rpc('exec_sql', { sql: createTablesSql });
    
    if (error1) {
      // RPC might not exist, try alternative approach
      console.log('⚠️  RPC not available, trying direct table operations...\n');
      
      // Test if tables exist by trying to select from them
      const tables = ['tookan_users', 'users', 'withdrawal_requests', 'webhook_events', 'audit_logs', 'merchant_plans'];
      
      for (const table of tables) {
        const { error } = await supabase.from(table).select('*').limit(1);
        if (error && error.code === '42P01') {
          console.log(`❌ Table '${table}' does not exist`);
          console.log(`   You need to create it manually in Supabase SQL Editor`);
        } else if (error) {
          console.log(`⚠️  Table '${table}': ${error.message}`);
        } else {
          console.log(`✅ Table '${table}' exists`);
        }
      }
      
      console.log('\n📋 If tables are missing, run this SQL in Supabase Dashboard > SQL Editor:');
      console.log('─'.repeat(60));
      console.log(createTablesSql);
      console.log('─'.repeat(60));
      
      // Alternative: Output SQL to a file
      const fs = require('fs');
      fs.writeFileSync('supabase-schema.sql', createTablesSql.trim());
      console.log('\n✅ SQL also saved to: supabase-schema.sql');
      console.log('   You can run this file in Supabase SQL Editor');
      
    } else {
      console.log('✅ All tables created successfully!');
    }

  } catch (err) {
    console.error('Error:', err.message);
    
    // Output SQL for manual creation
    const fs = require('fs');
    fs.writeFileSync('supabase-schema.sql', createTablesSql.trim());
    console.log('\n📋 SQL saved to: supabase-schema.sql');
    console.log('   Run this in Supabase Dashboard > SQL Editor');
  }

  console.log('\n📌 Next steps:');
  console.log('1. Add these env vars to Vercel:');
  console.log('   - SUPABASE_URL');
  console.log('   - SUPABASE_SERVICE_ROLE_KEY');
  console.log('   - SUPABASE_ANON_KEY');
  console.log('2. Redeploy on Vercel');
  console.log('3. Password auth and withdrawal requests will work!\n');
}

setupTables();

