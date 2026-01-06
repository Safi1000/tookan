/**
 * Webhook Events Model
 * 
 * Database operations for webhook_events table.
 * Implements webhook reliability with retry mechanism.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Create webhook event
 */
async function createEvent(eventData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const eventRecord = {
    event_type: eventData.event_type || eventData.type,
    job_id: eventData.job_id || eventData.jobId,
    payload: eventData.payload || eventData,
    status: 'pending'
  };

  const { data, error } = await supabase
    .from('webhook_events')
    .insert(eventRecord)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Mark event as processed
 */
async function markProcessed(id) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('webhook_events')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
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
 * Mark event as failed
 */
async function markFailed(id, errorMessage) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data: event } = await supabase
    .from('webhook_events')
    .select('retry_count')
    .eq('id', id)
    .single();

  const { data, error } = await supabase
    .from('webhook_events')
    .update({
      status: 'failed',
      retry_count: (event?.retry_count || 0) + 1,
      last_retry_at: new Date().toISOString(),
      error_message: errorMessage,
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
 * Get pending events for retry
 */
async function getPendingEvents(maxRetries = 3) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('status', 'pending')
    .lt('retry_count', maxRetries)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get failed events
 */
async function getFailedEvents() {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Reset event for retry
 */
async function resetForRetry(id) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('webhook_events')
    .update({
      status: 'pending',
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

module.exports = {
  createEvent,
  markProcessed,
  markFailed,
  getPendingEvents,
  getFailedEvents,
  resetForRetry
};







