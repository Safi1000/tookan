#!/usr/bin/env node

/**
 * Tag Backfill Script
 * 
 * Synchronizes the 'tags' column for the last 180 days of orders.
 * Only updates the tags field to preserve existing data.
 * 
 * Usage:
 *   node sync-tags-backfill.js
 * 
 * Environment Variables Required:
 *   TOOKAN_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

require('dotenv').config();
const { syncTaskTags, formatDate } = require('./server/services/orderSyncService');
const { isConfigured } = require('./server/db/supabase');

async function main() {
    console.log('\n🏷️  TOOKAN TAG BACKFILL (180 DAYS)');
    console.log('='.repeat(50));

    if (!process.env.TOOKAN_API_KEY) {
        console.error('❌ TOOKAN_API_KEY not found in .env');
        process.exit(1);
    }

    if (!isConfigured()) {
        console.error('❌ Supabase not configured');
        process.exit(1);
    }

    const today = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setDate(today.getDate() - 180);

    const options = {
        dateFrom: formatDate(sixMonthsAgo),
        dateTo: formatDate(today)
    };

    console.log(`📅 Range: ${options.dateFrom} to ${options.dateTo}`);
    console.log('🔄 Fetching orders and updating tags only...\n');

    try {
        const result = await syncTaskTags(options);

        if (result.success) {
            console.log('\n✅ TAG BACKFILL COMPLETED');
            console.log('='.repeat(50));
            console.log(`   Updated: ${result.stats.totalUpdated}`);
            console.log(`   Errors:  ${result.stats.totalErrors}`);
            process.exit(0);
        } else {
            console.error('\n❌ BACKFILL FAILED');
            console.error(`   ${result.message}`);
            process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ FATAL ERROR');
        console.error(error.stack);
        process.exit(1);
    }
}

main();
