/**
 * COD Queue Management
 * 
 * Manages FIFO queues per driver for COD (Cash on Delivery) transactions.
 * Uses Supabase database with file-based fallback for backward compatibility.
 */

const fs = require('fs');
const path = require('path');
const { isConfigured } = require('./db/supabase');
const codQueueModel = require('./db/models/codQueue');

const DATA_DIR = path.join(__dirname, 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'codQueue.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load COD queue from file
 */
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = fs.readFileSync(QUEUE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading COD queue:', error);
  }
  
  // Return default structure
  return {
    drivers: {},
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Save COD queue to file
 */
function saveQueue(queueData) {
  try {
    queueData.lastUpdated = new Date().toISOString();
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queueData, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving COD queue:', error);
    return false;
  }
}

/**
 * Get driver's COD queue (FIFO order - oldest first)
 */
async function getDriverQueue(driverId) {
  // Try database first
  if (isConfigured()) {
    try {
      const queue = await codQueueModel.getDriverQueue(driverId);
      // Transform database format to expected format
      return queue.map(entry => ({
        codId: `COD-${entry.id}`,
        orderId: entry.job_id?.toString(),
        date: entry.created_at,
        amount: parseFloat(entry.amount),
        merchantVendorId: null, // Will be populated from task
        status: entry.status === 'settled' ? 'COMPLETED' : 'PENDING',
        createdAt: entry.created_at,
        settledAt: entry.settled_at,
        notes: entry.payment_method || ''
      }));
    } catch (error) {
      console.warn('Database getDriverQueue failed, falling back to file:', error.message);
    }
  }
  
  // Fallback to file-based storage
  const queueData = loadQueue();
  const driverKey = `fleet_id_${driverId}`;
  return queueData.drivers[driverKey] || [];
}

/**
 * Get oldest pending COD for a driver
 */
async function getOldestPendingCOD(driverId) {
  // Try database first
  if (isConfigured()) {
    try {
      const entry = await codQueueModel.getOldestPending(driverId);
      if (entry) {
        return {
          codId: `COD-${entry.id}`,
          orderId: entry.job_id?.toString(),
          date: entry.created_at,
          amount: parseFloat(entry.amount),
          merchantVendorId: null,
          status: 'PENDING',
          createdAt: entry.created_at,
          settledAt: null,
          notes: ''
        };
      }
      return null;
    } catch (error) {
      console.warn('Database getOldestPendingCOD failed, falling back to file:', error.message);
    }
  }
  
  // Fallback to file-based storage
  const queue = await getDriverQueue(driverId);
  const pending = queue.filter(cod => cod.status === 'PENDING');
  if (pending.length === 0) return null;
  
  pending.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return pending[0];
}

/**
 * Add COD to driver's queue
 */
async function addCODToQueue(driverId, codData) {
  // Try database first
  if (isConfigured()) {
    try {
      const entry = await codQueueModel.addToQueue({
        driverId: driverId,
        job_id: codData.orderId,
        amount: codData.amount,
        status: 'pending',
        payment_method: codData.notes
      });
      
      return {
        codId: `COD-${entry.id}`,
        orderId: entry.job_id?.toString(),
        date: entry.created_at,
        amount: parseFloat(entry.amount),
        merchantVendorId: codData.merchantVendorId,
        status: 'PENDING',
        createdAt: entry.created_at,
        settledAt: null,
        notes: entry.payment_method || ''
      };
    } catch (error) {
      console.warn('Database addCODToQueue failed, falling back to file:', error.message);
    }
  }
  
  // Fallback to file-based storage
  const queueData = loadQueue();
  const driverKey = `fleet_id_${driverId}`;
  
  if (!queueData.drivers[driverKey]) {
    queueData.drivers[driverKey] = [];
  }
  
  const codEntry = {
    codId: codData.codId || `COD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    orderId: codData.orderId,
    date: codData.date,
    amount: codData.amount,
    merchantVendorId: codData.merchantVendorId,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    settledAt: null,
    notes: codData.notes || ''
  };
  
  queueData.drivers[driverKey].push(codEntry);
  saveQueue(queueData);
  
  return codEntry;
}

/**
 * Update COD status to COMPLETED
 */
async function settleCOD(driverId, codId, note) {
  // Try database first
  if (isConfigured()) {
    try {
      // Extract ID from codId (format: COD-123)
      const id = codId.replace('COD-', '');
      const entry = await codQueueModel.settleCODEntry(parseInt(id), null, note || 'cash');
      
      return {
        codId: `COD-${entry.id}`,
        orderId: entry.job_id?.toString(),
        date: entry.created_at,
        amount: parseFloat(entry.amount),
        merchantVendorId: null,
        status: 'COMPLETED',
        createdAt: entry.created_at,
        settledAt: entry.settled_at,
        notes: entry.payment_method || note || ''
      };
    } catch (error) {
      console.warn('Database settleCOD failed, falling back to file:', error.message);
    }
  }
  
  // Fallback to file-based storage
  const queueData = loadQueue();
  const driverKey = `fleet_id_${driverId}`;
  
  if (!queueData.drivers[driverKey]) {
    return null;
  }
  
  const cod = queueData.drivers[driverKey].find(c => c.codId === codId);
  if (!cod) {
    return null;
  }
  
  cod.status = 'COMPLETED';
  cod.settledAt = new Date().toISOString();
  if (note) {
    cod.notes = note;
  }
  
  saveQueue(queueData);
  return cod;
}

/**
 * Get all pending CODs for a driver
 */
async function getPendingCODs(driverId) {
  const queue = await getDriverQueue(driverId);
  return queue.filter(cod => cod.status === 'PENDING');
}

/**
 * Remove COD from queue (after settlement)
 * Note: We keep settled CODs for audit trail, but mark them as COMPLETED
 */
function removeCOD(driverId, codId) {
  const queueData = loadQueue();
  const driverKey = `fleet_id_${driverId}`;
  
  if (!queueData.drivers[driverKey]) {
    return false;
  }
  
  queueData.drivers[driverKey] = queueData.drivers[driverKey].filter(c => c.codId !== codId);
  saveQueue(queueData);
  return true;
}

/**
 * Get all COD queues for all drivers
 */
async function getQueue() {
  // Try database first
  if (isConfigured()) {
    try {
      const allQueues = await codQueueModel.getAllQueue();
      // Transform to expected format
      const result = {
        drivers: {},
        lastUpdated: new Date().toISOString()
      };
      
      // Group by driver
      allQueues.forEach(entry => {
        const driverKey = `fleet_id_${entry.driver_id}`;
        if (!result.drivers[driverKey]) {
          result.drivers[driverKey] = [];
        }
        result.drivers[driverKey].push({
          codId: `COD-${entry.id}`,
          orderId: entry.job_id?.toString(),
          date: entry.created_at,
          amount: parseFloat(entry.amount),
          merchantVendorId: null,
          status: entry.status === 'settled' ? 'COMPLETED' : 'PENDING',
          createdAt: entry.created_at,
          settledAt: entry.settled_at,
          notes: entry.payment_method || ''
        });
      });
      
      return result;
    } catch (error) {
      console.warn('Database getAllQueue failed, falling back to file:', error.message);
    }
  }
  
  // Fallback to file-based storage
  return loadQueue();
}

module.exports = {
  loadQueue,
  saveQueue,
  getDriverQueue,
  getOldestPendingCOD,
  addCODToQueue,
  settleCOD,
  getPendingCODs,
  removeCOD,
  getQueue
};

