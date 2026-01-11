/**
 * Task Storage Management
 * 
 * Manages storage for task data including COD fields and template fields.
 * Uses Supabase database with file-based fallback for backward compatibility.
 */

const fs = require('fs');
const path = require('path');
const { TEMPLATE_FIELDS } = require('./config/tookanConfig');
const { isConfigured } = require('./db/supabase');
const taskModel = require('./db/models/tasks');
const taskHistoryModel = require('./db/models/taskHistory');
const taskMetadataModel = require('./db/models/taskMetadata');

const DATA_DIR = path.join(__dirname, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const TASK_HISTORY_FILE = path.join(DATA_DIR, 'taskHistory.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load tasks from file
 */
function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = fs.readFileSync(TASKS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading tasks:', error);
  }

  // Return default structure
  return {
    tasks: {},
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Save tasks to file
 */
function saveTasks(tasksData) {
  try {
    tasksData.lastUpdated = new Date().toISOString();
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasksData, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving tasks:', error);
    return false;
  }
}

/**
 * Load task history from file
 */
function loadTaskHistory() {
  try {
    if (fs.existsSync(TASK_HISTORY_FILE)) {
      const data = fs.readFileSync(TASK_HISTORY_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading task history:', error);
  }

  // Return default structure
  return {
    history: [],
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Save task history to file
 */
function saveTaskHistory(historyData) {
  try {
    historyData.lastUpdated = new Date().toISOString();
    fs.writeFileSync(TASK_HISTORY_FILE, JSON.stringify(historyData, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving task history:', error);
    return false;
  }
}

/**
 * Get task by job ID
 * @param {string} jobId - Tookan job/task ID
 * @returns {Object|null} Task data or null if not found
 */
async function getTask(jobId) {
  // Try database first
  if (isConfigured()) {
    try {
      const task = await taskModel.getTask(jobId);
      if (task) {
        // Transform database record to expected format
        return transformTaskFromDB(task);
      }
    } catch (error) {
      console.warn('Database getTask failed, falling back to file:', error.message);
    }
  }

  // Fallback to file-based storage
  const tasksData = loadTasks();
  return tasksData.tasks[jobId] || null;
}

/**
 * Transform task from database format to expected format
 */
function transformTaskFromDB(task) {
  return {
    ...task,
    job_id: task.job_id?.toString(),
    order_id: task.job_id?.toString(),
    last_updated: task.updated_at
  };
}

/**
 * Transform task to database format
 */
function transformTaskToDB(taskData) {
  return {
    job_id: parseInt(taskData.job_id || taskData.order_id, 10),
    status: taskData.status || taskData.job_status || 0,
    customer_name: taskData.customer_name,
    customer_phone: taskData.customer_phone,
    customer_email: taskData.customer_email,
    vendor_id: taskData.vendor_id,
    fleet_id: taskData.fleet_id,
    fleet_name: taskData.fleet_name,
    cod_amount: taskData.cod_amount ? parseFloat(taskData.cod_amount) : 0,
    cod_collected: taskData.cod_collected || false,
    order_fees: taskData.order_fees || taskData.order_payment ? parseFloat(taskData.order_fees || taskData.order_payment) : 0,
    template_fields: taskData.template_fields || {},
    pickup_address: taskData.pickup_address,
    delivery_address: taskData.delivery_address,
    notes: taskData.notes,
    creation_datetime: taskData.creation_datetime || taskData.job_time || taskData.created_at,
    webhook_received_at: taskData.webhook_received_at,
    event_type: taskData.event_type,
    tags: taskData.tags || null
  };
}

/**
 * Update or create task
 * @param {string} jobId - Tookan job/task ID
 * @param {Object} taskData - Task data to store
 * @returns {Object} Updated task data
 */
async function updateTask(jobId, taskData) {
  // Try database first
  if (isConfigured()) {
    try {
      const dbTaskData = transformTaskToDB({ ...taskData, job_id: jobId });
      const updated = await taskModel.upsertTask(jobId, dbTaskData);
      return transformTaskFromDB(updated);
    } catch (error) {
      console.warn('Database updateTask failed, falling back to file:', error.message);
    }
  }

  // Fallback to file-based storage
  const tasksData = loadTasks();
  const existingTask = tasksData.tasks[jobId] || {};

  const updatedTask = {
    ...existingTask,
    job_id: jobId,
    ...taskData,
    last_updated: new Date().toISOString()
  };

  tasksData.tasks[jobId] = updatedTask;
  saveTasks(tasksData);

  return updatedTask;
}

/**
 * Extract COD data from template fields
 * @param {Object} templateFields - Template fields object from Tookan
 * @returns {Object} Extracted COD data
 */
function extractCODData(templateFields) {
  if (!templateFields || typeof templateFields !== 'object') {
    return {
      cod_amount: null,
      cod_collected: false
    };
  }

  // Handle different possible structures
  const codAmount = templateFields[TEMPLATE_FIELDS.COD_AMOUNT] ||
    templateFields.cod_amount ||
    templateFields.codAmount ||
    null;

  const codCollected = templateFields[TEMPLATE_FIELDS.COD_COLLECTED] !== undefined ?
    (templateFields[TEMPLATE_FIELDS.COD_COLLECTED] === true ||
      templateFields[TEMPLATE_FIELDS.COD_COLLECTED] === 'true' ||
      templateFields[TEMPLATE_FIELDS.COD_COLLECTED] === 1) :
    (templateFields.cod_collected === true ||
      templateFields.cod_collected === 'true' ||
      templateFields.codCollected === true) || false;

  return {
    cod_amount: codAmount ? parseFloat(codAmount) : null,
    cod_collected: codCollected
  };
}

/**
 * Update task from webhook payload
 * @param {Object} webhookData - Webhook payload from Tookan
 * @returns {Object|null} Updated task data or null if job_id not found
 */
async function updateTaskFromWebhook(webhookData) {
  const jobId = webhookData.job_id || webhookData.order_id || webhookData.task_id;

  if (!jobId) {
    console.warn('Webhook missing job_id, cannot update task');
    return null;
  }

  // Extract template fields from various possible locations
  const templateFields = webhookData.template_fields ||
    webhookData.templateFields ||
    webhookData.custom_fields ||
    webhookData.customFields ||
    {};

  // Extract COD data
  const codData = extractCODData(templateFields);

  // Get existing task to compare changes
  const existingTask = await getTask(jobId);
  const oldCodAmount = existingTask?.cod_amount;
  const oldCodCollected = existingTask?.cod_collected;

  // Extract complete order information for Reports Panel
  // Store all relevant order data from webhook
  const orderData = {
    // Basic order info
    job_id: jobId,
    order_id: jobId, // Alias for compatibility
    creation_datetime: webhookData.creation_datetime || webhookData.created_at || webhookData.job_time || existingTask?.creation_datetime,
    job_time: webhookData.job_time || webhookData.creation_datetime || existingTask?.job_time,

    // Status
    status: webhookData.job_status || webhookData.status || existingTask?.status,
    job_status: webhookData.job_status || webhookData.status || existingTask?.job_status,

    // Customer/Merchant info
    customer_name: webhookData.customer_name || webhookData.customerName || existingTask?.customer_name,
    customer_phone: webhookData.customer_phone || webhookData.customerPhone || existingTask?.customer_phone,
    customer_email: webhookData.customer_email || webhookData.customerEmail || existingTask?.customer_email,
    customer_id: webhookData.customer_id || webhookData.customerId || existingTask?.customer_id,
    vendor_id: webhookData.vendor_id || webhookData.vendorId || existingTask?.vendor_id,

    // Driver/Fleet info
    fleet_id: webhookData.fleet_id || webhookData.fleetId || existingTask?.fleet_id,
    fleet_name: webhookData.fleet_name || webhookData.fleetName || existingTask?.fleet_name,

    // Addresses
    pickup_address: webhookData.pickup_address || webhookData.pickupAddress || existingTask?.pickup_address,
    delivery_address: webhookData.delivery_address || webhookData.deliveryAddress || existingTask?.delivery_address,
    pickup_latitude: webhookData.pickup_latitude || webhookData.pickupLatitude || existingTask?.pickup_latitude,
    pickup_longitude: webhookData.pickup_longitude || webhookData.pickupLongitude || existingTask?.pickup_longitude,
    delivery_latitude: webhookData.delivery_latitude || webhookData.deliveryLatitude || existingTask?.delivery_latitude,
    delivery_longitude: webhookData.delivery_longitude || webhookData.deliveryLongitude || existingTask?.delivery_longitude,

    // Financial info
    cod: webhookData.cod || webhookData.cod_amount || codData.cod_amount || existingTask?.cod,
    order_payment: webhookData.order_payment || webhookData.orderPayment || webhookData.order_fees || existingTask?.order_payment,
    order_fees: webhookData.order_fees || webhookData.orderFees || webhookData.order_payment || existingTask?.order_fees,
    tags: webhookData.tags || existingTask?.tags || null,

    // COD data from template fields
    cod_amount: codData.cod_amount,
    cod_collected: codData.cod_collected,
    template_fields: templateFields,

    // Additional metadata
    notes: webhookData.notes || webhookData.description || existingTask?.notes,
    job_type: webhookData.job_type || webhookData.jobType || existingTask?.job_type,
    distance: webhookData.distance || existingTask?.distance,

    // Webhook metadata
    webhook_received_at: new Date().toISOString(),
    event_type: webhookData.event_type || webhookData.type || 'unknown',

    // Preserve existing internal metadata
    internal_metadata: existingTask?.internal_metadata || {}
  };

  // Update task with complete order data
  const updatedTask = await updateTask(jobId, orderData);

  // Log to history if COD changed
  if (oldCodAmount !== codData.cod_amount || oldCodCollected !== codData.cod_collected) {
    await addHistoryEntry(jobId, {
      field: 'cod',
      old_value: {
        cod_amount: oldCodAmount,
        cod_collected: oldCodCollected
      },
      new_value: {
        cod_amount: codData.cod_amount,
        cod_collected: codData.cod_collected
      },
      changed_at: new Date().toISOString(),
      source: 'webhook'
    });
  }

  return updatedTask;
}

/**
 * Get task history
 * @param {string} jobId - Optional job ID to filter history
 * @param {number} limit - Optional limit on number of entries
 * @returns {Array} History entries
 */
async function getTaskHistory(jobId = null, limit = null) {
  // Try database first
  if (isConfigured()) {
    try {
      if (jobId) {
        return await taskHistoryModel.getTaskHistory(jobId, limit);
      } else {
        return await taskHistoryModel.getAllHistory({ limit });
      }
    } catch (error) {
      console.warn('Database getTaskHistory failed, falling back to file:', error.message);
    }
  }

  // Fallback to file-based storage
  const historyData = loadTaskHistory();
  let history = historyData.history || [];

  if (jobId) {
    history = history.filter(entry => entry.job_id === jobId);
  }

  history.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));

  if (limit && limit > 0) {
    history = history.slice(0, limit);
  }

  return history;
}

/**
 * Add history entry
 * @param {string} jobId - Job ID
 * @param {Object} entryData - History entry data
 */
async function addHistoryEntry(jobId, entryData) {
  // Try database first
  if (isConfigured()) {
    try {
      return await taskHistoryModel.addHistoryEntry(jobId, entryData);
    } catch (error) {
      console.warn('Database addHistoryEntry failed, falling back to file:', error.message);
    }
  }

  // Fallback to file-based storage
  const historyData = loadTaskHistory();
  const entry = {
    id: `HIST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    job_id: jobId,
    ...entryData,
    created_at: new Date().toISOString()
  };

  if (!historyData.history) {
    historyData.history = [];
  }

  historyData.history.push(entry);
  saveTaskHistory(historyData);

  return entry;
}

/**
 * Set task metadata (for custom fields not in Tookan)
 * @param {string} jobId - Job ID
 * @param {Object} metadata - Metadata to store
 */
async function setTaskMetadata(jobId, metadata) {
  // Try database first
  if (isConfigured()) {
    try {
      await taskMetadataModel.updateMetadata(jobId, metadata);
      return;
    } catch (error) {
      console.warn('Database setTaskMetadata failed, falling back to file:', error.message);
    }
  }

  // Fallback to file-based storage
  const task = await getTask(jobId) || {};
  await updateTask(jobId, {
    ...task,
    internal_metadata: {
      ...(task.internal_metadata || {}),
      ...metadata,
      last_updated: new Date().toISOString()
    }
  });
}

/**
 * Get task metadata
 * @param {string} jobId - Job ID
 * @returns {Object} Task metadata
 */
async function getTaskMetadata(jobId) {
  // Try database first
  if (isConfigured()) {
    try {
      const metadata = await taskMetadataModel.getMetadata(jobId);
      return metadata?.metadata || {};
    } catch (error) {
      console.warn('Database getTaskMetadata failed, falling back to file:', error.message);
    }
  }

  // Fallback to file-based storage
  const task = await getTask(jobId);
  return task?.internal_metadata || {};
}

/**
 * Get all tasks (for order aggregation)
 * @returns {Object} All tasks data (maintains backward compatibility)
 */
function getAllTasks() {
  // For backward compatibility, return file-based structure
  // This is used by cached orders endpoint which expects { tasks: {} } format
  // Will be updated when endpoints are migrated
  return loadTasks();
}

/**
 * Get all tasks from database (new method for database queries)
 * @param {Object} filters - Query filters
 * @returns {Array} Array of tasks
 */
async function getAllTasksFromDB(filters = {}) {
  if (isConfigured()) {
    try {
      return await taskModel.getAllTasks(filters);
    } catch (error) {
      console.warn('Database getAllTasksFromDB failed:', error.message);
      return [];
    }
  }
  return [];
}

module.exports = {
  getTask,
  updateTask,
  updateTaskFromWebhook,
  extractCODData,
  getTaskHistory,
  addHistoryEntry,
  setTaskMetadata,
  getTaskMetadata,
  getAllTasks
};

