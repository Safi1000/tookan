/**
 * Order Sync Service
 * 
 * Fetches orders from Tookan API for the last 6 months and stores them in Supabase.
 * Handles batching (31-day chunks), retry logic for SSL errors, and progress tracking.
 */

require('dotenv').config();
const fetch = require('node-fetch');
const { supabase, isConfigured } = require('../db/supabase');

const TOOKAN_API_BASE = 'https://api.tookanapp.com/v2';
const BATCH_SIZE = 200; // Records per API request
const MAX_DAYS_PER_BATCH = 1; // 1 day per batch - Tookan ignores pagination, so we need tiny windows
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const JOB_TYPES = [0, 1, 2, 3]; // Pickup, Delivery, Appointment, FOS

/**
 * Normalize a date/time string to ISO or return null when invalid
 * Filters out Tookan's "0000-00-00 00:00:00" placeholders.
 */
function normalizeTimestamp(value) {
  if (!value) return null;
  if (typeof value === 'string' && value.startsWith('0000-00-00')) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Get API key from environment
 */
function getApiKey() {
  const apiKey = process.env.TOOKAN_API_KEY;
  if (!apiKey) {
    throw new Error('TOOKAN_API_KEY not configured in environment variables');
  }
  return apiKey;
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculate date 6 months ago from today
 */
function getSixMonthsAgo() {
  const date = new Date();
  date.setMonth(date.getMonth() - 6);
  return date;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry logic for SSL/network errors
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      lastError = error;
      const isSSLError = error.message.includes('SSL') ||
        error.message.includes('ssl') ||
        error.message.includes('decryption') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT');

      if (isSSLError && attempt < retries) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`⚠️  Retry ${attempt}/${retries} after ${delay}ms due to: ${error.message}`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Generate date batches (31-day chunks) for the last 6 months
 */
function generateDateBatches(customStartDate, customEndDate) {
  const batches = [];
  const endDate = customEndDate ? new Date(customEndDate) : new Date();
  const startDate = customStartDate ? new Date(customStartDate) : getSixMonthsAgo();

  let currentEnd = new Date(endDate);

  while (currentEnd >= startDate) {
    const batchStart = new Date(currentEnd);
    batchStart.setDate(batchStart.getDate() - MAX_DAYS_PER_BATCH + 1);

    // Ensure we don't go before the 6-month start date
    if (batchStart < startDate) {
      batchStart.setTime(startDate.getTime());
    }

    batches.push({
      startDate: formatDate(batchStart),
      endDate: formatDate(currentEnd)
    });

    // Move to the previous batch
    currentEnd = new Date(batchStart);
    currentEnd.setDate(currentEnd.getDate() - 1);
  }

  return batches.reverse(); // Start from oldest to newest
}

/**
 * Fetch tasks for a specific date range and job type
 */
async function fetchTasksBatch(startDate, endDate, jobType, offset = 0) {
  const apiKey = getApiKey();

  const payload = {
    api_key: apiKey,
    job_type: jobType,
    job_status: '0,1,2,3,4,5,6,7,8,9', // include all statuses
    start_date: startDate,
    end_date: endDate,
    is_pagination: 1,
    off_set: offset,
    limit: BATCH_SIZE,
    custom_fields: 1
  };

  const response = await fetchWithRetry(`${TOOKAN_API_BASE}/get_all_tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 45000
  });

  const text = await response.text();

  try {
    const data = JSON.parse(text);

    if (data.status === 200 || data.status === 1) {
      return Array.isArray(data.data) ? data.data : [];
    }

    // Some error statuses are expected (no data)
    if (data.message && data.message.includes('No task')) {
      return [];
    }

    console.log(`⚠️  API response: ${data.message || 'Unknown status'}`);
    return [];
  } catch (parseError) {
    console.error(`❌ Failed to parse response: ${text.substring(0, 200)}`);
    throw parseError;
  }
}

/**
 * Fetch job details (tags and COD) for a batch of job IDs
 * Uses get_job_details with job_additional_info: 1
 * Extracts COD from CASH_NEEDS_TO_BE_COLLECTED field in job_additional_info
 */
async function fetchJobDetailsForJobIds(jobIds) {
  if (!jobIds || jobIds.length === 0) return {};

  const apiKey = getApiKey();
  try {
    const response = await fetchWithRetry(`${TOOKAN_API_BASE}/get_job_details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        job_ids: jobIds, // Array of job IDs
        include_task_history: 0,
        job_additional_info: 1,
        include_job_report: 0
      }),
      timeout: 30000
    });

    const data = await response.json();
    const detailsMap = {};

    const extractCodFromCustomField = (job) => {
      // COD is in custom_field array with label "CASH_NEEDS_TO_BE_COLLECTED"
      // (Not in job_additional_info as previously thought)
      const customFields = job.custom_field || [];
      if (!Array.isArray(customFields)) return null;

      const codField = customFields.find(field =>
        field.label === 'CASH_NEEDS_TO_BE_COLLECTED' ||
        field.display_name === 'CASH NEEDS TO BE COLLECTED'
      );

      if (codField && codField.data) {
        const codValue = parseFloat(codField.data);
        return isNaN(codValue) ? null : codValue;
      }
      return null;
    };

    if (data.status === 200 && Array.isArray(data.data)) {
      data.data.forEach(job => {
        if (job.job_id) {
          detailsMap[job.job_id] = {
            tags: job.tags || null,
            cod_amount: extractCodFromCustomField(job)
          };
        }
      });
    } else if (data.status === 200 && data.data && data.data.job_id) {
      // Handle single result return case
      detailsMap[data.data.job_id] = {
        tags: data.data.tags || null,
        cod_amount: extractCodFromCustomField(data.data)
      };
    }

    return detailsMap;
  } catch (error) {
    console.error(`❌ Error fetching job details for batch: ${error.message}`);
    return {};
  }
}

/**
 * Legacy function for backward compatibility - calls fetchJobDetailsForJobIds
 */
async function fetchTagsForJobIds(jobIds) {
  const detailsMap = await fetchJobDetailsForJobIds(jobIds);
  // Convert to old format (just tags)
  const tagsMap = {};
  Object.keys(detailsMap).forEach(jobId => {
    tagsMap[jobId] = detailsMap[jobId]?.tags || null;
  });
  return tagsMap;
}

/**
 * Fetch all tasks for a date range (handles pagination and all job types)
 */
async function fetchAllTasksForDateRange(startDate, endDate) {
  const allTasks = [];

  for (const jobType of JOB_TYPES) {
    const jobTypeName = ['Pickup', 'Delivery', 'Appointment', 'FOS'][jobType];
    let offset = 0;
    let hasMore = true;
    let pageCount = 0;
    let jobTypeTasks = 0;

    while (hasMore) {
      try {
        const tasks = await fetchTasksBatch(startDate, endDate, jobType, offset);
        pageCount++;

        if (tasks.length === 0) {
          hasMore = false;
        } else {
          allTasks.push(...tasks);
          jobTypeTasks += tasks.length;

          // Log pagination progress for debugging
          if (tasks.length === BATCH_SIZE) {
            console.log(`      [${jobTypeName}] Page ${pageCount}: ${tasks.length} tasks (offset ${offset}), continuing...`);
          }

          offset += BATCH_SIZE; // Always increment by BATCH_SIZE, not tasks.length

          // If we got less than BATCH_SIZE, we've reached the end
          if (tasks.length < BATCH_SIZE) {
            hasMore = false;
          }

          // Safety limit: don't fetch more than 50 pages per job type per date range
          if (pageCount >= 50) {
            console.log(`      [${jobTypeName}] Hit 50 page limit, moving on...`);
            hasMore = false;
          }
        }

        // Small delay between requests to avoid rate limiting
        await sleep(150);
      } catch (error) {
        console.error(`❌ Error fetching ${jobTypeName} tasks (offset ${offset}): ${error.message}`);
        hasMore = false;
      }
    }

    // Log total for this job type if we fetched multiple pages
    if (pageCount > 1) {
      console.log(`      [${jobTypeName}] Total: ${jobTypeTasks} tasks in ${pageCount} pages`);
    }
  }

  return allTasks;
}

/**
 * Truncate string to max length (for varchar columns)
 */
function truncateString(str, maxLength) {
  if (!str) return null;
  const s = String(str);
  return s.length > maxLength ? s.substring(0, maxLength) : s;
}

/**
 * Transform Tookan task to database record format
 * Omits null timestamp fields to prevent overwriting existing values
 */
function transformTaskToRecord(task) {
  const record = {
    job_id: parseInt(task.job_id) || task.job_id,
    order_id: truncateString(task.order_id, 100),
    status: parseInt(task.job_status) || 0,
    job_type: parseInt(task.job_type) || 1,

    // Customer/Delivery info (truncate to fit varchar columns)
    customer_name: truncateString(task.customer_username || task.job_delivery_name, 255),
    customer_phone: truncateString(task.customer_phone || task.job_delivery_phone, 100),
    customer_email: truncateString(task.customer_email, 255),
    delivery_name: truncateString(task.job_delivery_name || task.customer_username, 255),
    delivery_phone: truncateString(task.job_delivery_phone || task.customer_phone, 100),
    delivery_address: task.job_address || task.customer_address || null,

    // Pickup info
    pickup_name: truncateString(task.job_pickup_name, 255),
    pickup_phone: truncateString(task.job_pickup_phone, 100),
    pickup_address: task.job_pickup_address || null,

    // Financial
    total_amount: parseFloat(task.total_amount || task.order_payment || task.cod || 0),
    cod_amount: parseFloat(task.cod_amount || task.total_amount || 0),
    cod_collected: task.cod_collected || false,
    order_fees: parseFloat(task.order_fees || 0),

    // Assignment
    fleet_id: parseInt(task.fleet_id) || null,
    fleet_name: truncateString(task.fleet_name, 255),
    vendor_id: parseInt(task.customer_id || task.vendor_id) || null,

    // Template fields and notes (use Tookan job_description as system note)
    template_fields: task.template_data || task.custom_field || {},
    notes: task.job_description || null,

    // Sync metadata
    source: 'api_sync',
    last_synced_at: new Date().toISOString(),
    tags: task.tags || null,
    raw_data: task
  };

  // Only include timestamp fields if they have valid values
  // This prevents overwriting existing DB values with null
  const creationDt = normalizeTimestamp(task.creation_datetime || task.created_at || task.job_time || task.creation_date);
  if (creationDt) record.creation_datetime = creationDt;

  const completedDt = normalizeTimestamp(task.completed_datetime || task.job_completed_datetime || task.completed_on || task.completed_at || task.job_completion_time);
  if (completedDt) record.completed_datetime = completedDt;

  const startedDt = normalizeTimestamp(task.started_datetime || task.job_started_datetime || task.arrival_datetime);
  if (startedDt) record.started_datetime = startedDt;

  const acknowledgedDt = normalizeTimestamp(task.acknowledged_datetime || task.job_acknowledged_datetime);
  if (acknowledgedDt) record.acknowledged_datetime = acknowledgedDt;

  return record;
}

/**
 * Bulk upsert tasks to Supabase with retry logic
 */
async function bulkUpsertTasks(tasks) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  if (tasks.length === 0) {
    return { inserted: 0, updated: 0, errors: 0 };
  }

  const records = tasks.map(transformTaskToRecord);

  // Process in smaller chunks to avoid payload size limits
  const CHUNK_SIZE = 50; // Smaller chunks for better reliability
  const MAX_RETRIES = 3;
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    let success = false;

    for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
      try {
        const { data, error } = await supabase
          .from('tasks')
          .upsert(chunk, {
            onConflict: 'job_id',
            ignoreDuplicates: false
          });

        if (error) {
          // Check if it's a transient error worth retrying
          const isTransient = error.message.includes('fetch') ||
            error.message.includes('timeout') ||
            error.message.includes('500') ||
            error.message.includes('503');

          if (isTransient && attempt < MAX_RETRIES) {
            console.log(`   ⚠️  Retry ${attempt}/${MAX_RETRIES} for chunk due to: ${error.message.substring(0, 80)}`);
            await sleep(1000 * attempt); // Backoff
            continue;
          }

          console.error(`❌ Bulk upsert error: ${error.message.substring(0, 100)}`);
          errors += chunk.length;
        } else {
          inserted += chunk.length;
        }
        success = true;
      } catch (err) {
        const isTransient = err.message.includes('fetch') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('timeout');

        if (isTransient && attempt < MAX_RETRIES) {
          console.log(`   ⚠️  Retry ${attempt}/${MAX_RETRIES} for chunk due to: ${err.message.substring(0, 80)}`);
          await sleep(1000 * attempt);
          continue;
        }

        console.error(`❌ Bulk upsert exception: ${err.message.substring(0, 100)}`);
        errors += chunk.length;
        success = true; // Move on after max retries
      }
    }

    // Small delay between chunks to avoid overwhelming Supabase
    await sleep(100);
  }

  return { inserted, updated, errors };
}

/**
 * Update sync status in database
 */
async function updateSyncStatus(updates) {
  if (!isConfigured()) {
    return;
  }

  try {
    await supabase
      .from('sync_status')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('sync_type', 'orders');
  } catch (error) {
    console.error('Failed to update sync status:', error.message);
  }
}

/**
 * Get current sync status
 */
async function getSyncStatus() {
  if (!isConfigured()) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('sync_status')
      .select('*')
      .eq('sync_type', 'orders')
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to get sync status:', error.message);
    return null;
  }
}

/**
 * Main sync function - fetches all orders for last 6 months
 */
async function syncOrders(options = {}) {
  const { resumeFromBatch = 0, forceSync = false, dateFrom = null, dateTo = null } = options;

  console.log('\n' + '='.repeat(60));
  console.log('TOOKAN ORDER SYNC');
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`DEBUG: dateFrom=${dateFrom}, dateTo=${dateTo}`);

  // Check if sync is already in progress
  const currentStatus = await getSyncStatus();
  if (currentStatus?.status === 'in_progress' && !forceSync) {
    console.log('⚠️  Sync already in progress. Use forceSync option to override.');
    return { success: false, message: 'Sync already in progress' };
  }

  // Generate date batches (pass custom dates if provided)
  const batches = generateDateBatches(dateFrom, dateTo);
  console.log(`DEBUG: Generated ${batches.length} batches`);
  const startDateStr = dateFrom || formatDate(getSixMonthsAgo());
  const endDateStr = dateTo || formatDate(new Date());

  console.log(`📅 Date range: ${startDateStr} to ${endDateStr}`);
  console.log(`📦 Total batches: ${batches.length} (${MAX_DAYS_PER_BATCH}-day chunks)`);
  console.log(`🔄 Job types: Pickup, Delivery, Appointment, FOS`);
  console.log('='.repeat(60));

  // Initialize sync status
  await updateSyncStatus({
    status: 'in_progress',
    started_at: new Date().toISOString(),
    completed_at: null,
    sync_from_date: startDateStr,
    sync_to_date: endDateStr,
    total_batches: batches.length,
    completed_batches: resumeFromBatch,
    total_records: 0,
    synced_records: 0,
    failed_records: 0,
    last_error: null,
    error_count: 0
  });

  let totalSynced = 0;
  let totalErrors = 0;
  let completedBatches = resumeFromBatch;

  try {
    // Process each batch
    for (let i = resumeFromBatch; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`\n📥 Batch ${i + 1}/${batches.length}: ${batch.startDate} to ${batch.endDate}`);

      // Update current batch in status
      await updateSyncStatus({
        current_batch_start: batch.startDate,
        current_batch_end: batch.endDate,
        completed_batches: i
      });

      try {
        // Fetch all tasks for this date range
        const tasks = await fetchAllTasksForDateRange(batch.startDate, batch.endDate);
        console.log(`   📋 Fetched ${tasks.length} tasks`);

        if (tasks.length > 0) {
          // Bulk upsert to database
          const result = await bulkUpsertTasks(tasks);
          totalSynced += result.inserted;
          totalErrors += result.errors;
          console.log(`   ✅ Synced: ${result.inserted}, Errors: ${result.errors}`);
        }

        completedBatches = i + 1;

        // Update progress
        await updateSyncStatus({
          completed_batches: completedBatches,
          synced_records: totalSynced,
          failed_records: totalErrors
        });

      } catch (batchError) {
        console.error(`   ❌ Batch error: ${batchError.message}`);
        totalErrors++;

        await updateSyncStatus({
          last_error: batchError.message,
          error_count: totalErrors
        });

        // Continue with next batch instead of stopping
      }

      // Delay between batches to avoid rate limiting
      await sleep(500);
    }

    // Sync completed successfully
    await updateSyncStatus({
      status: 'completed',
      completed_at: new Date().toISOString(),
      last_successful_sync: new Date().toISOString(),
      completed_batches: batches.length,
      synced_records: totalSynced,
      failed_records: totalErrors,
      current_batch_start: null,
      current_batch_end: null
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ SYNC COMPLETED');
    console.log(`   Total synced: ${totalSynced}`);
    console.log(`   Total errors: ${totalErrors}`);
    console.log(`   Completed at: ${new Date().toISOString()}`);
    console.log('='.repeat(60) + '\n');

    return {
      success: true,
      message: 'Sync completed successfully',
      stats: {
        totalSynced,
        totalErrors,
        batches: batches.length,
        dateRange: { from: startDateStr, to: endDateStr }
      }
    };

  } catch (error) {
    console.error('\n❌ SYNC FAILED:', error.message);

    await updateSyncStatus({
      status: 'failed',
      last_error: error.message,
      error_count: totalErrors + 1
    });

    return {
      success: false,
      message: error.message,
      stats: {
        totalSynced,
        totalErrors,
        completedBatches,
        totalBatches: batches.length
      }
    };
  }
}

/**
 * Incremental sync - only syncs orders from the last sync date to now
 */
async function incrementalSync() {
  console.log('\n📥 Starting incremental sync...');

  const status = await getSyncStatus();
  let startDate;

  if (status?.last_successful_sync) {
    // Start from day after last successful sync
    const lastSync = new Date(status.last_successful_sync);
    lastSync.setDate(lastSync.getDate() - 1); // Overlap by 1 day for safety
    startDate = formatDate(lastSync);
  } else {
    // No previous sync, do full 6-month sync
    console.log('⚠️  No previous sync found. Running full sync...');
    return syncOrders();
  }

  const endDate = formatDate(new Date());
  console.log(`📅 Incremental sync: ${startDate} to ${endDate}`);

  await updateSyncStatus({
    status: 'in_progress',
    started_at: new Date().toISOString()
  });

  try {
    const tasks = await fetchAllTasksForDateRange(startDate, endDate);
    console.log(`📋 Fetched ${tasks.length} tasks`);

    if (tasks.length > 0) {
      const result = await bulkUpsertTasks(tasks);
      console.log(`✅ Synced: ${result.inserted}, Errors: ${result.errors}`);
    }

    await updateSyncStatus({
      status: 'completed',
      completed_at: new Date().toISOString(),
      last_successful_sync: new Date().toISOString()
    });

    return { success: true, synced: tasks.length };
  } catch (error) {
    await updateSyncStatus({
      status: 'failed',
      last_error: error.message
    });

    return { success: false, error: error.message };
  }
}

/**
 * Sync only tags for a specific date range
 * Updates ONLY the tags column to minimize database impact
 */
async function syncTaskTags(options = {}) {
  const { dateFrom, dateTo } = options;
  const startDate = dateFrom || formatDate(getSixMonthsAgo());
  const endDate = dateTo || formatDate(new Date());

  console.log(`\n🏷️  STARTING TAG SYNC: ${startDate} to ${endDate}`);

  try {
    const batches = generateDateBatches(startDate, endDate);
    let totalUpdated = 0;
    let totalErrors = 0;

    for (const batch of batches) {
      console.log(`\n📅 Processing tags for batch: ${batch.startDate} to ${batch.endDate}`);
      const tasks = await fetchAllTasksForDateRange(batch.startDate, batch.endDate);

      if (tasks.length === 0) continue;

      console.log(`   📋 Found ${tasks.length} tasks, fetching tags in sub-batches...`);

      // Enrich tasks with tags in sub-batches of 50 (get_job_details limit)
      const SUB_BATCH_SIZE = 50;
      for (let i = 0; i < tasks.length; i += SUB_BATCH_SIZE) {
        const subBatchTasks = tasks.slice(i, i + SUB_BATCH_SIZE);
        const jobIds = subBatchTasks.map(t => parseInt(t.job_id));

        console.log(`      🔗 Fetching tags for ${jobIds.length} tasks...`);
        const tagsMap = await fetchTagsForJobIds(jobIds);

        // Use UPDATE instead of UPSERT to only modify tags column
        // This prevents overwriting other columns like completed_datetime
        let subBatchUpdated = 0;
        let subBatchErrors = 0;
        for (const task of subBatchTasks) {
          const jobId = parseInt(task.job_id);
          const tags = tagsMap[jobId] || null;

          const { error } = await supabase
            .from('tasks')
            .update({ tags, updated_at: new Date().toISOString() })
            .eq('job_id', jobId);

          if (error) {
            // If record doesn't exist, that's expected - just skip
            if (!error.message.includes('No rows')) {
              subBatchErrors++;
            }
          } else {
            subBatchUpdated++;
          }
        }

        totalUpdated += subBatchUpdated;
        totalErrors += subBatchErrors;

        if (subBatchErrors > 0) {
          console.error(`   ⚠️ Sub-batch: ${subBatchUpdated} updated, ${subBatchErrors} errors`);
        }

        // Small delay to avoid hitting Tookan rate limits on get_job_details
        await sleep(200);
      }

      console.log(`   ✅ Current total updated: ${totalUpdated}`);
    }

    return { success: true, stats: { totalUpdated, totalErrors } };
  } catch (error) {
    console.error('❌ Tag sync failed:', error);
    return { success: false, message: error.message };
  }
}

module.exports = {
  syncOrders,
  incrementalSync,
  syncTaskTags,
  getSyncStatus,
  updateSyncStatus,
  fetchWithRetry,
  generateDateBatches,
  getSixMonthsAgo,
  formatDate,
  bulkUpsertTasks,
  transformTaskToRecord,
  fetchJobDetailsForJobIds,
  fetchTagsForJobIds
};

