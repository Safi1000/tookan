#!/usr/bin/env node

/**
 * Tookan Customer Sync Script
 * 
 * Syncs all customers from Tookan API to Supabase.
 * 
 * Usage:
 *   node sync-tookan-customers.js
 */

require('dotenv').config();

const { syncAllCustomers } = require('./server/services/customerSyncService');
const { isConfigured } = require('./server/db/supabase');

async function main() {
    console.log('\n🚀 TOOKAN CUSTOMER SYNC');
    console.log('='.repeat(50));

    // Check environment
    if (!process.env.TOOKAN_API_KEY) {
        console.error('❌ TOOKAN_API_KEY not found in environment');
        console.error('   Please set it in your .env file');
        process.exit(1);
    }

    if (!isConfigured()) {
        console.error('❌ Supabase is not configured');
        console.error('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    console.log('✅ Environment configured');
    console.log(`   Tookan API Key: ${process.env.TOOKAN_API_KEY.substring(0, 10)}...`);
    console.log(`   Supabase URL: ${process.env.SUPABASE_URL}`);
    console.log('='.repeat(50));

    try {
        const result = await syncAllCustomers();

        if (result.success) {
            console.log('\n✅ SYNC COMPLETED SUCCESSFULLY');
            console.log(`   Total synced: ${result.synced || 0}`);
            console.log(`   Errors: ${result.errors || 0}`);
            process.exit(0);
        } else {
            console.error('\n❌ SYNC FAILED');
            console.error(`   ${result.message || 'Unknown error'}`);
            process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ FATAL ERROR');
        console.error(`   ${error.message}`);
        process.exit(1);
    }
}

main();
