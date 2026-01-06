/**
 * Task History Model
 * 
 * Database operations for task_history table.
 * Tracks changes to tasks for audit purposes.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Add history entry
 */
async function addHistoryEntry(jobId, entryData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Get task_id from job_id
  const { data: task } = await supabase
    .from('tasks')
    .select('id')
    .eq('job_id', jobId)
    .single();

  const historyRecord = {
    task_id: task?.id || null,
    job_id: jobId,
    field: entryData.field,
    old_value: entryData.old_value || null,
    new_value: entryData.new_value || null,
    changed_by: entryData.changed_by || null,
    changed_at: entryData.changed_at || new Date().toISOString(),
    source: entryData.source || 'api'
  };

  const { data, error } = await supabase
    .from('task_history')
    .insert(historyRecord)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get task history by job_id
 */
async function getTaskHistory(jobId, limit = null) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase
    .from('task_history')
    .select('*')
    .eq('job_id', jobId)
    .order('changed_at', { ascending: false });

  if (limit) {
    query = query.limit(parseInt(limit));
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get all history entries with filters
 */
async function getAllHistory(filters = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase.from('task_history').select('*');

  if (filters.jobId) {
    query = query.eq('job_id', filters.jobId);
  }

  if (filters.field) {
    query = query.eq('field', filters.field);
  }

  if (filters.dateFrom) {
    query = query.gte('changed_at', filters.dateFrom);
  }

  if (filters.dateTo) {
    query = query.lte('changed_at', filters.dateTo);
  }

  if (filters.limit) {
    query = query.limit(parseInt(filters.limit));
  }

  query = query.order('changed_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

module.exports = {
  addHistoryEntry,
  getTaskHistory,
  getAllHistory
};











