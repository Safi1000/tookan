/**
 * Task Metadata Model
 * 
 * Database operations for task_metadata table.
 * Stores internal metadata for tasks.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Get metadata for a task
 */
async function getMetadata(jobId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('task_metadata')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || null;
}

/**
 * Set metadata for a task
 */
async function setMetadata(jobId, metadata) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('task_metadata')
    .upsert({
      job_id: jobId,
      metadata: metadata,
      updated_at: new Date().toISOString()
    }, {
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
 * Update metadata (merge with existing)
 */
async function updateMetadata(jobId, metadataUpdate) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Get existing metadata
  const existing = await getMetadata(jobId);
  const mergedMetadata = {
    ...(existing?.metadata || {}),
    ...metadataUpdate
  };

  return setMetadata(jobId, mergedMetadata);
}

module.exports = {
  getMetadata,
  setMetadata,
  updateMetadata
};











