/**
 * Audit Logs Model
 * 
 * Database operations for audit_logs table.
 * Comprehensive audit trail for all system actions.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Create audit log entry
 */
async function createLog(logData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const logRecord = {
    user_id: logData.user_id || logData.userId || null,
    action: logData.action,
    entity_type: logData.entity_type || logData.entityType,
    entity_id: logData.entity_id || logData.entityId,
    old_value: logData.old_value || logData.oldValue || null,
    new_value: logData.new_value || logData.newValue || null,
    ip_address: logData.ip_address || logData.ipAddress || null,
    user_agent: logData.user_agent || logData.userAgent || null
  };

  const { data, error } = await supabase
    .from('audit_logs')
    .insert(logRecord)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get audit logs with filters
 */
async function getLogs(filters = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase.from('audit_logs').select('*');

  if (filters.user_id || filters.userId) {
    query = query.eq('user_id', filters.user_id || filters.userId);
  }

  if (filters.action) {
    query = query.eq('action', filters.action);
  }

  if (filters.entity_type || filters.entityType) {
    query = query.eq('entity_type', filters.entity_type || filters.entityType);
  }

  if (filters.entity_id || filters.entityId) {
    query = query.eq('entity_id', filters.entity_id || filters.entityId);
  }

  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }

  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo);
  }

  if (filters.limit) {
    query = query.limit(parseInt(filters.limit));
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get audit logs for a specific entity
 */
async function getEntityLogs(entityType, entityId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

module.exports = {
  createLog,
  getLogs,
  getEntityLogs
};











