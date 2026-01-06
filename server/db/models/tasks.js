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

module.exports = {
  getTask,
  getAllTasks,
  upsertTask,
  updateTask,
  deleteTask,
  getTaskCount
};











