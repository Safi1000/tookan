/**
 * Tookan Configuration Constants
 * 
 * Defines exact template field keys and other Tookan-specific constants
 * that must match exactly what is configured in the Tookan dashboard.
 */

/**
 * Template field keys for COD handling
 * These must match exactly the field names configured in Tookan template
 */
const TEMPLATE_FIELDS = {
  COD_AMOUNT: 'cod_amount',
  COD_COLLECTED: 'cod_collected'
};

/**
 * Webhook event types from Tookan
 */
const WEBHOOK_EVENTS = {
  TASK_CREATED: 'task_created',
  TASK_UPDATED: 'task_updated',
  TASK_COMPLETED: 'task_completed',
  TASK_ASSIGNED: 'task_assigned',
  TASK_STATUS_CHANGED: 'task_status_changed'
};

/**
 * Task status values
 */
const TASK_STATUS = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

module.exports = {
  TEMPLATE_FIELDS,
  WEBHOOK_EVENTS,
  TASK_STATUS
};











