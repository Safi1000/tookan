#!/usr/bin/env node

/**
 * Sync COD Amounts Script
 * 
 * Fetches COD amounts from Tookan's get_job_details API and updates the Supabase tasks table.
 * Uses the CASH_NEEDS_TO_BE_COLLECTED field from job_additional_info.
 * 
 * Usage:
 *   node sync-cod-amounts.js              # Sync all tasks with null/0 cod_amount
 *   node sync-cod-amounts.js --all        # Force sync all tasks (even with existing COD)
 *   node sync-cod-amounts.js --limit=1000 # Limit number of tasks to process
 *   node sync-cod-amounts.js --status     # Show current COD status
 * 
 * Environment Variables Required:
 *   TOOKAN_API_KEY - Your Tookan API key
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Your Supabase service role key
 */

require('dotenv').config();

const { fetchJobDetailsForJobIds } = require('./server/services/orderSyncService');
const { supabase, isConfigured } = require('./server/db/supabase');

// Parse command line arguments
const args = process.argv.slice(2);
const syncAll = args.includes('--all') || args.includes('-a');
const showStatus = args.includes('--status') || args.includes('-s');
const showHelp = args.includes('--help') || args.includes('-h');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;
const dateFromArg = args.find(a => a.startsWith('--from=')); // e.g. --from=2023-01-01
const dateFrom = dateFromArg ? dateFromArg.split('=')[1] : null;
const dateToArg = args.find(a => a.startsWith('--to='));     // e.g. --to=2023-01-31
const dateTo = dateToArg ? dateToArg.split('=')[1] : null;

const BATCH_SIZE = 50; // Tookan limits job_ids to 50 per request

function printHelp() {
    console.log(`
Sync COD Amounts Script
=======================

Fetches COD amounts from Tookan's get_job_details API and updates the Supabase tasks table.
Uses the CASH_NEEDS_TO_BE_COLLECTED field from job_additional_info.

Usage:
  node sync-cod-amounts.js [options]

Options:
  (no options)    Sync tasks with null or 0 cod_amount
  --all           Force sync all tasks (even with existing COD values)
  --from=DATE     Start date (YYYY-MM-DD) inclusive
  --to=DATE       End date (YYYY-MM-DD) inclusive
  --limit=N       Limit number of tasks to process
  --status        Show current COD sync status and exit
  --help          Show this help message

Environment Variables:
  TOOKAN_API_KEY              Your Tookan API key (required)
  SUPABASE_URL                Your Supabase project URL (required)
  SUPABASE_SERVICE_ROLE_KEY   Your Supabase service role key (required)

Examples:
  node sync-cod-amounts.js              # Sync tasks missing COD
  node sync-cod-amounts.js --all        # Re-sync all tasks
  node sync-cod-amounts.js --from=2023-01-01 --to=2023-01-31 # Sync Jan 2023
  node sync-cod-amounts.js --limit=500  # Sync up to 500 tasks
`);
}

async function showCodStatus() {
    console.log('\n📊 COD SYNC STATUS');
    console.log('='.repeat(50));

    if (!isConfigured()) {
        console.log('❌ Supabase is not configured');
        return;
    }

    // Count total tasks
    const { count: totalCount } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true });

    // Count tasks with null cod_amount
    const { count: nullCount } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .is('cod_amount', null);

    // Count tasks with 0 cod_amount
    const { count: zeroCount } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('cod_amount', 0);

    // Count tasks with non-zero cod_amount
    const { count: hasCodeCount } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .gt('cod_amount', 0);

    console.log(`Total tasks in database: ${totalCount || 0}`);
    console.log(`Tasks with COD amount (> 0): ${hasCodeCount || 0}`);
    console.log(`Tasks with COD = 0: ${zeroCount || 0}`);
    console.log(`Tasks with COD = null: ${nullCount || 0}`);
    console.log(`Tasks needing sync: ${(nullCount || 0) + (zeroCount || 0)}`);
    console.log('='.repeat(50));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncCodAmounts(options = {}) {
    const {
        syncAll = false,
        limit = null,
        dateFrom = null,
        dateTo = null,

        jobId = null,
        showStatus = false
    } = options;

    if (showStatus) {
        await showCodStatus();
        return;
    }

    console.log('\n🚀 COD AMOUNT SYNC');
    console.log('='.repeat(50));

    // Check environment
    if (!process.env.TOOKAN_API_KEY) {
        console.error('❌ TOOKAN_API_KEY not found in environment');
        throw new Error('TOOKAN_API_KEY not found');
    }

    if (!isConfigured()) {
        console.error('❌ Supabase is not configured');
        throw new Error('Supabase not configured');
    }

    console.log('✅ Environment configured');
    console.log(`   Tookan API Key: ${process.env.TOOKAN_API_KEY.substring(0, 10)}...`);
    console.log(`   Supabase URL: ${process.env.SUPABASE_URL}`);
    console.log('='.repeat(50));

    if (showStatus) {
        await showCodStatus();
        process.exit(0);
    }

    try {
        // Fetch tasks that need COD sync with pagination (Supabase default limit is 1000)
        const PAGE_SIZE = 1000;
        let allJobIds = [];
        let page = 0;
        let hasMore = true;

        console.log('\n📋 Fetching tasks from database...');

        while (hasMore) {
            let query = supabase
                .from('tasks')
                .select('job_id')
                .order('job_id', { ascending: false })
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (!syncAll) {
                // Only sync tasks with null or 0 cod_amount (unless jobId provided)
                if (!jobId) {
                    query = query.or('cod_amount.is.null,cod_amount.eq.0');
                }
            }

            if (jobId) {
                query = query.eq('job_id', jobId);
            } else {
                if (dateFrom) {
                    query = query.gte('creation_datetime', dateFrom);
                }
                if (dateTo) {
                    query = query.lte('creation_datetime', dateTo);
                }
            }

            const { data: tasks, error } = await query;

            if (error) {
                throw new Error(`Failed to fetch tasks: ${error.message}`);
            }

            if (!tasks || tasks.length === 0) {
                hasMore = false;
            } else {
                allJobIds = allJobIds.concat(tasks.map(t => t.job_id));
                console.log(`   Page ${page + 1}: Found ${tasks.length} tasks (total: ${allJobIds.length})`);

                if (tasks.length < PAGE_SIZE) {
                    hasMore = false;
                } else {
                    page++;
                }
            }

            // Check if we've hit the limit
            if (limit && allJobIds.length >= limit) {
                allJobIds = allJobIds.slice(0, limit);
                hasMore = false;
            }
        }

        if (allJobIds.length === 0) {
            console.log('\n✅ No tasks need COD sync');
            process.exit(0);
        }

        console.log(`\n📋 Found ${allJobIds.length} total tasks to sync COD for`);

        const jobIds = allJobIds;
        let totalUpdated = 0;
        let totalCodFound = 0;
        let totalErrors = 0;

        // Process in batches of 50 (Tookan limit)
        for (let i = 0; i < jobIds.length; i += BATCH_SIZE) {
            const batchJobIds = jobIds.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(jobIds.length / BATCH_SIZE);

            console.log(`\n📥 Batch ${batchNum}/${totalBatches}: Fetching ${batchJobIds.length} job details...`);

            try {
                const detailsMap = await fetchJobDetailsForJobIds(batchJobIds);

                // Update each task with its COD amount
                let batchUpdated = 0;
                let batchCodFound = 0;

                for (const jobId of batchJobIds) {
                    const details = detailsMap[jobId];
                    const codAmount = details?.cod_amount;

                    if (codAmount !== null && codAmount !== undefined) {
                        batchCodFound++;

                        const { error: updateError } = await supabase
                            .from('tasks')
                            .update({
                                cod_amount: codAmount,
                                updated_at: new Date().toISOString()
                            })
                            .eq('job_id', jobId);

                        if (updateError) {
                            console.error(`   ❌ Failed to update job ${jobId}: ${updateError.message}`);
                            totalErrors++;
                        } else {
                            batchUpdated++;
                        }
                    }
                }

                totalUpdated += batchUpdated;
                totalCodFound += batchCodFound;

                console.log(`   ✅ Found COD for ${batchCodFound} tasks, updated ${batchUpdated}`);

            } catch (batchError) {
                console.error(`   ❌ Batch error: ${batchError.message}`);
                totalErrors++;
            }

            // Small delay between batches to avoid rate limiting
            await sleep(200);
        }

        console.log('\n' + '='.repeat(50));
        console.log('✅ COD SYNC COMPLETED');
        console.log(`   Tasks processed: ${jobIds.length}`);
        console.log(`   COD values found: ${totalCodFound}`);
        console.log(`   Successfully updated: ${totalUpdated}`);
        console.log(`   Errors: ${totalErrors}`);
        console.log('='.repeat(50) + '\n');

        return { success: true, updated: totalUpdated };

    } catch (error) {
        console.error('\n❌ FATAL ERROR');
        console.error(`   ${error.message}`);
        console.error(error.stack);
        if (require.main === module) process.exit(1);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    const args = process.argv.slice(2);
    const syncAll = args.includes('--all') || args.includes('-a');
    const showStatus = args.includes('--status') || args.includes('-s');
    const showHelp = args.includes('--help') || args.includes('-h');
    const limitArg = args.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;
    const dateFromArg = args.find(a => a.startsWith('--from='));

    const dateToArg = args.find(a => a.startsWith('--to='));
    const dateTo = dateToArg ? dateToArg.split('=')[1] : null;
    const jobIdArg = args.find(a => a.startsWith('--jobId=') || a.startsWith('--job=') || a.startsWith('--id='));
    const jobId = jobIdArg ? jobIdArg.split('=')[1] : null;



    if (showHelp) {
        printHelp();
        process.exit(0);
    }

    syncCodAmounts({ syncAll, limit, dateFrom, dateTo, jobId, showStatus });
}

module.exports = { syncCodAmounts };
