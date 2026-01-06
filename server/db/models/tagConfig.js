/**
 * Tag Config Model
 * 
 * Database operations for tag_config table.
 * Stores tag configuration for delivery charges.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Get tag configuration
 */
async function getConfig() {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('tag_config')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || { config: {} };
}

/**
 * Update tag configuration
 */
async function updateConfig(config) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Get existing config ID if exists
  const existing = await supabase
    .from('tag_config')
    .select('id')
    .limit(1)
    .single();

  let query;
  if (existing.data?.id) {
    // Update existing
    query = supabase
      .from('tag_config')
      .update({
        config: config,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.data.id)
      .select()
      .single();
  } else {
    // Insert new
    query = supabase
      .from('tag_config')
      .insert({
        config: config
      })
      .select()
      .single();
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data;
}

module.exports = {
  getConfig,
  updateConfig
};











