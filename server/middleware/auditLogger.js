/**
 * Audit Logging Middleware
 * 
 * Comprehensive audit trail for all system actions.
 * Logs all user actions with timestamp, user ID, and value changes.
 */

const auditLogsModel = require('../db/models/auditLogs');
const { isConfigured } = require('../db/supabase');

/**
 * Extract IP address from request
 */
function getIpAddress(req) {
  return req.ip || 
         req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         null;
}

/**
 * Extract user agent from request
 */
function getUserAgent(req) {
  return req.headers['user-agent'] || null;
}

/**
 * Create audit log entry
 */
async function createAuditLog(req, action, entityType, entityId, oldValue = null, newValue = null) {
  if (!isConfigured()) {
    console.warn('Audit logging skipped: Supabase not configured');
    return null;
  }

  try {
    const userId = req.userId || req.user?.id || null;
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);

    const logData = {
      user_id: userId,
      action: action,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      old_value: oldValue ? (typeof oldValue === 'object' ? oldValue : { value: oldValue }) : null,
      new_value: newValue ? (typeof newValue === 'object' ? newValue : { value: newValue }) : null,
      ip_address: ipAddress,
      user_agent: userAgent
    };

    return await auditLogsModel.createLog(logData);
  } catch (error) {
    console.error('Audit logging error:', error);
    // Don't throw - audit logging should not break the main flow
    return null;
  }
}

/**
 * Audit log middleware factory
 * Creates middleware that logs the action automatically
 */
function auditLog(action, entityType, getEntityId = (req) => req.params.id) {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json to capture response
    res.json = function(data) {
      // Log after response is sent
      if (data.status === 'success' && req.method !== 'GET') {
        const entityId = typeof getEntityId === 'function' ? getEntityId(req) : getEntityId;
        createAuditLog(req, action, entityType, entityId, null, data.data || data)
          .catch(err => console.error('Audit log error:', err));
      }
      return originalJson(data);
    };

    next();
  };
}

module.exports = {
  createAuditLog,
  auditLog,
  getIpAddress,
  getUserAgent
};







