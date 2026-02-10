/**
 * Generic script to run SQL migrations
 * Usage: node server/run-sql.js server/sql/01_api_tokens.sql
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runSql(filePath) {
    if (!filePath) {
        console.error('❌ Usage: node server/run-sql.js <path-to-sql-file>');
        process.exit(1);
    }

    const absolutePath = path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
        console.error('❌ SQL file not found:', absolutePath);
        process.exit(1);
    }

    const sql = fs.readFileSync(absolutePath, 'utf8');

    console.log(`🚀 Applying migration: ${path.basename(filePath)}...`);

    // Try RPC method first (if enabled)
    const { error: rpcError } = await supabase.rpc('exec_sql', { sql });

    if (!rpcError) {
        console.log('✅ Migration applied successfully via RPC!');
        process.exit(0);
    }

    // If RPC fails, try manual fallback (instruction only)
    console.log('⚠️  RPC execution failed (likely disabled or function missing).');
    console.log('   Running raw SQL queries via Supabase client isn\'t possible for DDL (CREATE TABLE, etc).');
    console.log('📋 Please run the SQL manually in Supabase Dashboard > SQL Editor:');
    console.log('─'.repeat(60));
    console.log(sql);
    console.log('─'.repeat(60));
}

const fileArg = process.argv[2];
runSql(fileArg);
