/**
 * Tasks Model
 * 
 * Database operations for tasks (orders) table.
 * Replaces file-based taskStorage.js operations.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Get task by job_id
 */
async function getTask(jobId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = not found
    throw error;
  }

  return data || null;
}

/**
 * Get all tasks with optional filters
 */
async function getAllTasks(filters = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase.from('tasks').select('*');

  if (filters.dateFrom || filters.dateTo) {
    if (filters.dateFrom) {
      query = query.gte('creation_datetime', filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte('creation_datetime', filters.dateTo);
    }
  }

  if (filters.driverId) {
    query = query.eq('fleet_id', filters.driverId);
  }

  if (filters.customerId) {
    query = query.eq('vendor_id', filters.customerId);
  }

  if (filters.status !== undefined) {
    query = query.eq('status', filters.status);
  }

  if (filters.search) {
    const searchTerm = `%${filters.search}%`;
    query = query.or(`job_id::text.ilike.${searchTerm},customer_name.ilike.${searchTerm},fleet_name.ilike.${searchTerm}`);
  }

  if (filters.limit) {
    query = query.limit(parseInt(filters.limit));
  }

  if (filters.page && filters.limit) {
    const offset = (parseInt(filters.page) - 1) * parseInt(filters.limit);
    query = query.range(offset, offset + parseInt(filters.limit) - 1);
  }

  query = query.order('creation_datetime', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get tasks with pagination and exact total count
 */
async function getAllTasksPaginated(filters = {}, page = 1, limit = 50) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 50);
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;

  let query = supabase
    .from('tasks')
    .select('job_id,cod_amount,order_fees,fleet_id,fleet_name,notes,creation_datetime,customer_name,customer_phone,customer_email,pickup_address,delivery_address', { count: 'exact' });

  if (filters.dateFrom) {
    query = query.gte('creation_datetime', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('creation_datetime', filters.dateTo);
  }
  if (filters.driverId) {
    query = query.eq('fleet_id', filters.driverId);
  }
  if (filters.customerId) {
    query = query.eq('vendor_id', filters.customerId);
  }
  if (filters.status !== undefined) {
    query = query.eq('status', filters.status);
  }
  if (filters.search) {
    const term = String(filters.search).trim().replace(/,/g, '');
    // Search by job_id (numeric, primary)
    const numTerm = parseInt(term, 10);
    if (!isNaN(numTerm)) {
      query = query.eq('job_id', numTerm);
    }
  }

  query = query.order('creation_datetime', { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) {
    throw error;
  }

  return {
    tasks: data || [],
    total: count || 0,
    page: pageNum,
    limit: limitNum
  };
}

/**
 * Create or update task
 */
async function upsertTask(jobId, taskData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const taskRecord = {
    job_id: jobId,
    ...taskData,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('tasks')
    .upsert(taskRecord, {
      onConflict: 'job_id',
      ignoreDuplicates: false
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Update task
 */
async function updateTask(jobId, taskData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('tasks')
    .update({
      ...taskData,
      updated_at: new Date().toISOString()
    })
    .eq('job_id', jobId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Delete task
 */
async function deleteTask(jobId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('job_id', jobId);

  if (error) {
    throw error;
  }

  return true;
}

/**
 * Get task count
 */
async function getTaskCount(filters = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase.from('tasks').select('*', { count: 'exact', head: true });

  if (filters.dateFrom) {
    query = query.gte('creation_datetime', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('creation_datetime', filters.dateTo);
  }

  const { count, error } = await query;

  if (error) {
    throw error;
  }

  return count || 0;
}

/**
 * Bulk upsert multiple tasks efficiently
 * @param {Array} tasks - Array of task records to upsert
 * @param {number} chunkSize - Number of records per chunk (default 100)
 * @returns {Object} - { inserted, updated, errors }
 */
async function bulkUpsertTasks(tasks, chunkSize = 100) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  if (!tasks || tasks.length === 0) {
    return { inserted: 0, updated: 0, errors: 0 };
  }

  let inserted = 0;
  let errors = 0;

  // Process in chunks to avoid payload size limits
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize);

    try {
      const { data, error } = await supabase
        .from('tasks')
        .upsert(chunk, {
          onConflict: 'job_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`Bulk upsert error: ${error.message}`);
        errors += chunk.length;
      } else {
        inserted += chunk.length;
      }
    } catch (err) {
      console.error(`Bulk upsert exception: ${err.message}`);
      errors += chunk.length;
    }
  }

  return { inserted, updated: 0, errors };
}

/**
 * Get sync status for orders
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

    return data || null;
  } catch (error) {
    console.error('Failed to get sync status:', error.message);
    return null;
  }
}

/**
 * Update sync status
 */
async function updateSyncStatus(updates) {
  if (!isConfigured()) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('sync_status')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('sync_type', 'orders')
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to update sync status:', error.message);
    return null;
  }
}

/**
 * Get last successful sync timestamp
 */
async function getLastSyncTimestamp() {
  const status = await getSyncStatus();
  return status?.last_successful_sync || null;
}

/**
 * Check if cache is fresh (synced within specified hours)
 * @param {number} maxAgeHours - Maximum age in hours (default 24)
 */
async function isCacheFresh(maxAgeHours = 24) {
  const lastSync = await getLastSyncTimestamp();
  
  if (!lastSync) {
    return false;
  }

  const lastSyncDate = new Date(lastSync);
  const now = new Date();
  const hoursDiff = (now - lastSyncDate) / (1000 * 60 * 60);

  return hoursDiff < maxAgeHours;
}

/**
 * Get cached task count for date range
 */
async function getCachedTaskCount(dateFrom, dateTo) {
  if (!isConfigured()) {
    return 0;
  }

  try {
    let query = supabase.from('tasks').select('*', { count: 'exact', head: true });

    if (dateFrom) {
      query = query.gte('creation_datetime', dateFrom);
    }
    if (dateTo) {
      query = query.lte('creation_datetime', dateTo);
    }

    const { count, error } = await query;

    if (error) {
      throw error;
    }

    return count || 0;
  } catch (error) {
    console.error('Failed to get cached task count:', error.message);
    return 0;
  }
}

/**
 * Get tasks from cache with transformed order format
 */
async function getCachedOrders(filters = {}) {
  if (!isConfigured()) {
    return [];
  }

  try {
    let query = supabase.from('tasks').select('*');

    if (filters.dateFrom) {
      query = query.gte('creation_datetime', filters.dateFrom);
    }
    if (filters.dateTo) {
      // Add end of day to include full day
      const endDate = new Date(filters.dateTo);
      endDate.setHours(23, 59, 59, 999);
      query = query.lte('creation_datetime', endDate.toISOString());
    }
    if (filters.driverId) {
      query = query.eq('fleet_id', filters.driverId);
    }
    if (filters.customerId) {
      query = query.eq('vendor_id', filters.customerId);
    }
    if (filters.status !== undefined && filters.status !== null) {
      query = query.eq('status', parseInt(filters.status));
    }
    if (filters.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.or(`job_id::text.ilike.${searchTerm},order_id.ilike.${searchTerm},customer_name.ilike.${searchTerm},fleet_name.ilike.${searchTerm}`);
    }

    query = query.order('creation_datetime', { ascending: false });

    if (filters.limit) {
      query = query.limit(parseInt(filters.limit));
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    // Transform to order format expected by frontend
    return (data || []).map(task => ({
      id: task.job_id?.toString(),
      job_id: task.job_id,
      orderId: task.order_id || task.job_id?.toString(),
      order_id: task.order_id,
      date: task.creation_datetime,
      merchant: task.pickup_name || task.customer_name,
      merchantId: task.vendor_id?.toString(),
      driver: task.fleet_name,
      driverId: task.fleet_id?.toString(),
      customer: task.customer_name || task.delivery_name,
      customerId: task.vendor_id?.toString(),
      cod: task.total_amount || task.cod_amount || 0,
      codAmount: task.cod_amount || task.total_amount || 0,
      fee: task.order_fees || 0,
      orderFees: task.order_fees || 0,
      status: task.status,
      statusText: getStatusText(task.status),
      job_type: task.job_type,
      addresses: `${task.pickup_address || ''} → ${task.delivery_address || ''}`,
      pickup_address: task.pickup_address,
      delivery_address: task.delivery_address,
      notes: task.notes,
      source: task.source,
      raw_data: task.raw_data
    }));
  } catch (error) {
    console.error('Failed to get cached orders:', error.message);
    return [];
  }
}

/**
 * Convert status code to text
 */
function getStatusText(status) {
  const statusMap = {
    0: 'Assigned',
    1: 'Started',
    2: 'Successful',
    3: 'Failed',
    4: 'In Progress',
    5: 'Unassigned',
    6: 'Accepted',
    7: 'Decline',
    8: 'Cancel',
    9: 'Deleted'
  };
  return statusMap[status] || 'Unknown';
}

module.exports = {
  getTask,
  getAllTasks,
  getAllTasksPaginated,
  upsertTask,
  updateTask,
  deleteTask,
  getTaskCount,
  bulkUpsertTasks,
  getSyncStatus,
  updateSyncStatus,
  getLastSyncTimestamp,
  isCacheFresh,
  getCachedTaskCount,
  getCachedOrders,
  getStatusText
};











