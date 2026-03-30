#!/usr/bin/env node

/**
 * Tag Backfill Script
 * 
 * Synchronizes the 'tags' column for orders.
 * Only updates the tags field to preserve existing data.
 * 
 * Usage:
 *   node sync-tags-backfill.js             # Sync last 180 days
 *   node sync-tags-backfill.js --today     # Sync only today's tasks (Bahrain time)
 *   node sync-tags-backfill.js --from=2024-01-01 --to=2024-01-31  # Custom date range
 *   node sync-tags-backfill.js --help      # Show help
 * 
 * Environment Variables Required:
 *   TOOKAN_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

require('dotenv').config();
const { syncTaskTags, formatDate } = require('./server/services/orderSyncService');
const { isConfigured } = require('./server/db/supabase');

// Parse command line arguments
const args = process.argv.slice(2);
const isToday = args.includes('--today') || args.includes('-t');
const showHelp = args.includes('--help') || args.includes('-h');

// Calculate current date in Bahrain time (UTC+3) — same pattern as sync-cod-amounts.js
const getBahrainDateString = () => {
    const now = new Date();
    // Add 3 hours to UTC time to get Bahrain time
    const bahrainTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    return bahrainTime.toISOString().split('T')[0];
};

const todayStr = getBahrainDateString();
const dateFromArg = args.find(a => a.startsWith('--from='));
const dateToArg = args.find(a => a.startsWith('--to='));

// Resolve dateFrom / dateTo: --today takes priority, then --from/--to, then default 180 days
const dateFrom = isToday ? todayStr : (dateFromArg ? dateFromArg.split('=')[1] : null);
const dateTo = isToday ? todayStr : (dateToArg ? dateToArg.split('=')[1] : null);

function printHelp() {
    console.log(`
Tag Backfill Script
===================

Synchronizes the 'tags' column for orders from Tookan.
Only updates the tags field to preserve existing data.

Usage:
  node sync-tags-backfill.js [options]

Options:
  (no options)    Sync last 180 days of tags
  --today, -t     Sync only today's tasks (Bahrain time UTC+3)
  --from=DATE     Start date (YYYY-MM-DD) inclusive
  --to=DATE       End date (YYYY-MM-DD) inclusive
  --help, -h      Show this help message

Environment Variables:
  TOOKAN_API_KEY              Your Tookan API key (required)
  SUPABASE_URL                Your Supabase project URL (required)
  SUPABASE_SERVICE_ROLE_KEY   Your Supabase service role key (required)

Examples:
  node sync-tags-backfill.js                                  # Sync 180 days
  node sync-tags-backfill.js --today                          # Sync today only
  node sync-tags-backfill.js --from=2024-01-01 --to=2024-01-31  # Sync Jan 2024
`);
}

async function main() {
    if (showHelp) {
        printHelp();
        process.exit(0);
    }

    const modeLabel = isToday ? 'TODAY ONLY' : (dateFrom && dateTo ? 'CUSTOM RANGE' : '180 DAYS');
    console.log(`\n🏷️  TOOKAN TAG BACKFILL (${modeLabel})`);
    console.log('='.repeat(50));

    if (!process.env.TOOKAN_API_KEY) {
        console.error('❌ TOOKAN_API_KEY not found in .env');
        process.exit(1);
    }

    if (!isConfigured()) {
        console.error('❌ Supabase not configured');
        process.exit(1);
    }

    // Determine date range
    let effectiveDateFrom, effectiveDateTo;

    if (dateFrom && dateTo) {
        // --today or --from/--to provided
        effectiveDateFrom = dateFrom;
        effectiveDateTo = dateTo;
    } else {
        // Default: last 180 days
        const today = new Date();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setDate(today.getDate() - 180);
        effectiveDateFrom = formatDate(sixMonthsAgo);
        effectiveDateTo = formatDate(today);
    }

    const options = {
        dateFrom: effectiveDateFrom,
        dateTo: effectiveDateTo
    };

    if (isToday) {
        console.log(`📅 Bahrain date (UTC+3): ${todayStr}`);
    }
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
