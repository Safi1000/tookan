#!/usr/bin/env node

/**
 * Tookan Order Sync Script
 * 
 * Syncs all orders from the last 6 months from Tookan API to Supabase cache.
 * 
 * Usage:
 *   node sync-tookan-orders.js              # Full sync (last 6 months)
 *   node sync-tookan-orders.js --incremental # Incremental sync (since last sync)
 *   node sync-tookan-orders.js --status      # Show sync status
 *   node sync-tookan-orders.js --force       # Force sync even if already running
 * 
 * Environment Variables Required:
 *   TOOKAN_API_KEY - Your Tookan API key
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Your Supabase service role key
 */

require('dotenv').config();

const { syncOrders, incrementalSync, getSyncStatus } = require('./server/services/orderSyncService');
const { isConfigured } = require('./server/db/supabase');

// Parse command line arguments
const args = process.argv.slice(2);
const isIncremental = args.includes('--incremental') || args.includes('-i');
const showStatus = args.includes('--status') || args.includes('-s');
const forceSync = args.includes('--force') || args.includes('-f');
const showHelp = args.includes('--help') || args.includes('-h');
const dateFromArg = args.find(a => a.startsWith('--dateFrom=')) || args.find(a => a.startsWith('--from='));
const dateToArg = args.find(a => a.startsWith('--dateTo=')) || args.find(a => a.startsWith('--to='));
const dateFrom = dateFromArg ? dateFromArg.split('=')[1] : null;
const dateTo = dateToArg ? dateToArg.split('=')[1] : null;

function printHelp() {
  console.log(`
Tookan Order Sync Script
========================

Syncs orders from Tookan API to Supabase cache for faster access.
Tookan only retains data for the last 6 months.

Usage:
  node sync-tookan-orders.js [options]

Options:
  (no options)    Full sync - Fetches all orders from last 6 months
  --incremental   Only sync orders since last successful sync
  --status        Show current sync status and exit
  --force         Force sync even if one is already in progress
  --dateFrom=YYYY-MM-DD  Limit sync start date (optional)
  --dateTo=YYYY-MM-DD    Limit sync end date (optional)
  --help          Show this help message

Environment Variables:
  TOOKAN_API_KEY              Your Tookan API key (required)
  SUPABASE_URL                Your Supabase project URL (required)
  SUPABASE_SERVICE_ROLE_KEY   Your Supabase service role key (required)

Examples:
  node sync-tookan-orders.js                # Run full 6-month sync
  node sync-tookan-orders.js --incremental  # Quick sync of new orders
  node sync-tookan-orders.js --status       # Check sync progress
  node sync-tookan-orders.js --dateFrom=2025-11-17 --dateTo=2025-12-05 --force  # Targeted range
`);
}

async function showSyncStatus() {
  console.log('\n📊 SYNC STATUS');
  console.log('='.repeat(50));
  
  if (!isConfigured()) {
    console.log('❌ Supabase is not configured');
    console.log('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  
  const status = await getSyncStatus();
  
  if (!status) {
    console.log('ℹ️  No sync has been performed yet');
    return;
  }
  
  console.log(`Status: ${status.status}`);
  console.log(`Last successful sync: ${status.last_successful_sync || 'Never'}`);
  console.log(`Total synced records: ${status.synced_records || 0}`);
  console.log(`Failed records: ${status.failed_records || 0}`);
  console.log(`Completed batches: ${status.completed_batches || 0}/${status.total_batches || 0}`);
  
  if (status.status === 'in_progress') {
    console.log(`\n🔄 Sync in progress...`);
    console.log(`   Current batch: ${status.current_batch_start} to ${status.current_batch_end}`);
  }
  
  if (status.last_error) {
    console.log(`\n⚠️  Last error: ${status.last_error}`);
  }
  
  console.log('='.repeat(50));
}

async function main() {
  if (showHelp) {
    printHelp();
    process.exit(0);
  }
  
  console.log('\n🚀 TOOKAN ORDER SYNC');
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
  if (dateFrom || dateTo) {
    console.log(`   Date override: ${dateFrom || '(auto)'} to ${dateTo || '(now)'}`);
  }
  console.log('='.repeat(50));
  
  if (showStatus) {
    await showSyncStatus();
    process.exit(0);
  }
  
  try {
    let result;
    
    if (isIncremental) {
      console.log('\n📥 Starting INCREMENTAL sync...');
      console.log('   This will only sync orders since the last successful sync.\n');
      result = await incrementalSync();
    } else {
      console.log('\n📥 Starting FULL sync (last 6 months)...');
      console.log('   This may take several minutes depending on order volume.\n');
      result = await syncOrders({ forceSync, dateFrom, dateTo });
    }
    
    if (result.success) {
      console.log('\n✅ SYNC COMPLETED SUCCESSFULLY');
      console.log('='.repeat(50));
      if (result.stats) {
        console.log(`   Total synced: ${result.stats.totalSynced || result.synced || 0}`);
        console.log(`   Total errors: ${result.stats.totalErrors || 0}`);
        if (result.stats.dateRange) {
          console.log(`   Date range: ${result.stats.dateRange.from} to ${result.stats.dateRange.to}`);
        }
      }
      process.exit(0);
    } else {
      console.error('\n❌ SYNC FAILED');
      console.error(`   ${result.message || 'Unknown error'}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ FATAL ERROR');
    console.error(`   ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
main();

