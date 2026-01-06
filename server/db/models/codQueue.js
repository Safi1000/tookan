/**
 * COD Queue Model
 * 
 * Database operations for cod_queue table.
 * Replaces file-based codQueue.js operations.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Get COD queue for a driver
 */
async function getDriverQueue(driverId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('cod_queue')
    .select('*')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get all COD queue entries
 */
async function getAllQueue(filters = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase.from('cod_queue').select('*');

  if (filters.driverId) {
    query = query.eq('driver_id', filters.driverId);
  }

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  query = query.order('created_at', { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Add COD to queue
 */
async function addToQueue(queueData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Get task_id from job_id if provided
  let taskId = null;
  if (queueData.job_id) {
    const { data: task } = await supabase
      .from('tasks')
      .select('id')
      .eq('job_id', queueData.job_id)
      .single();
    taskId = task?.id || null;
  }

  const queueRecord = {
    driver_id: queueData.driverId || queueData.driver_id,
    task_id: taskId,
    job_id: queueData.job_id || queueData.jobId,
    amount: queueData.amount,
    status: queueData.status || 'pending',
    payment_method: queueData.payment_method || null
  };

  const { data, error } = await supabase
    .from('cod_queue')
    .insert(queueRecord)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Update COD queue entry
 */
async function updateQueueEntry(id, updateData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('cod_queue')
    .update({
      ...updateData,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Settle COD entry
 */
async function settleCODEntry(id, settledBy, paymentMethod) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('cod_queue')
    .update({
      status: 'settled',
      settled_at: new Date().toISOString(),
      settled_by: settledBy,
      payment_method: paymentMethod,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get oldest pending COD for a driver
 */
async function getOldestPending(driverId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('cod_queue')
    .select('*')
    .eq('driver_id', driverId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || null;
}

module.exports = {
  getDriverQueue,
  getAllQueue,
  addToQueue,
  updateQueueEntry,
  settleCODEntry,
  getOldestPending
};











