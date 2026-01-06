/**
 * Data Migration Script
 * 
 * Migrates existing JSON file data to Supabase database.
 * Run this script after setting up Supabase and running migrations.
 * 
 * Usage: node server/db/migrate-data.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabase, isConfigured, testConnection } = require('./supabase');
const taskModel = require('./models/tasks');
const taskHistoryModel = require('./models/taskHistory');
const codQueueModel = require('./models/codQueue');
const merchantPlansModel = require('./models/merchantPlans');
const withdrawalRequestsModel = require('./models/withdrawalRequests');
const tagConfigModel = require('./models/tagConfig');
const taskMetadataModel = require('./models/taskMetadata');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const TASK_HISTORY_FILE = path.join(DATA_DIR, 'taskHistory.json');
const COD_QUEUE_FILE = path.join(DATA_DIR, 'codQueue.json');
const TAG_CONFIG_FILE = path.join(DATA_DIR, 'tagConfig.json');

/**
 * Load JSON file
 */
function loadJSONFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error);
  }
  return null;
}

/**
 * Migrate tasks
 */
async function migrateTasks() {
  console.log('\n📦 Migrating tasks...');
  const tasksData = loadJSONFile(TASKS_FILE);
  
  if (!tasksData || !tasksData.tasks) {
    console.log('  No tasks to migrate');
    return { migrated: 0, errors: 0 };
  }

  const tasks = Object.values(tasksData.tasks);
  let migrated = 0;
  let errors = 0;

  for (const task of tasks) {
    try {
      const jobId = task.job_id || task.order_id;
      if (!jobId) {
        console.warn(`  Skipping task without job_id:`, task);
        continue;
      }

      const dbTaskData = {
        job_id: parseInt(jobId, 10),
        status: task.status || task.job_status || 0,
        customer_name: task.customer_name,
        customer_phone: task.customer_phone,
        customer_email: task.customer_email,
        vendor_id: task.vendor_id,
        fleet_id: task.fleet_id,
        fleet_name: task.fleet_name,
        cod_amount: task.cod_amount ? parseFloat(task.cod_amount) : 0,
        cod_collected: task.cod_collected || false,
        order_fees: task.order_fees || task.order_payment ? parseFloat(task.order_fees || task.order_payment) : 0,
        template_fields: task.template_fields || {},
        pickup_address: task.pickup_address,
        delivery_address: task.delivery_address,
        notes: task.notes,
        creation_datetime: task.creation_datetime || task.job_time || task.created_at,
        webhook_received_at: task.webhook_received_at,
        event_type: task.event_type
      };

      await taskModel.upsertTask(jobId, dbTaskData);
      migrated++;

      // Migrate metadata if exists
      if (task.internal_metadata) {
        try {
          await taskMetadataModel.setMetadata(parseInt(jobId, 10), task.internal_metadata);
        } catch (error) {
          console.warn(`  Warning: Could not migrate metadata for task ${jobId}:`, error.message);
        }
      }
    } catch (error) {
      console.error(`  Error migrating task ${task.job_id}:`, error.message);
      errors++;
    }
  }

  console.log(`  ✅ Migrated ${migrated} tasks, ${errors} errors`);
  return { migrated, errors };
}

/**
 * Migrate task history
 */
async function migrateTaskHistory() {
  console.log('\n📜 Migrating task history...');
  const historyData = loadJSONFile(TASK_HISTORY_FILE);
  
  if (!historyData || !historyData.history || historyData.history.length === 0) {
    console.log('  No history to migrate');
    return { migrated: 0, errors: 0 };
  }

  let migrated = 0;
  let errors = 0;

  for (const entry of historyData.history) {
    try {
      await taskHistoryModel.addHistoryEntry(entry.job_id, {
        field: entry.field,
        old_value: entry.old_value,
        new_value: entry.new_value,
        changed_by: entry.changed_by || null,
        changed_at: entry.changed_at || entry.created_at,
        source: entry.source || 'api'
      });
      migrated++;
    } catch (error) {
      console.error(`  Error migrating history entry ${entry.id}:`, error.message);
      errors++;
    }
  }

  console.log(`  ✅ Migrated ${migrated} history entries, ${errors} errors`);
  return { migrated, errors };
}

/**
 * Migrate COD queue
 */
async function migrateCODQueue() {
  console.log('\n💰 Migrating COD queue...');
  const queueData = loadJSONFile(COD_QUEUE_FILE);
  
  if (!queueData || !queueData.drivers) {
    console.log('  No COD queue to migrate');
    return { migrated: 0, errors: 0 };
  }

  let migrated = 0;
  let errors = 0;

  for (const [driverKey, codEntries] of Object.entries(queueData.drivers)) {
    const driverId = driverKey.replace('fleet_id_', '');
    
    for (const cod of codEntries) {
      try {
        await codQueueModel.addToQueue({
          driverId: parseInt(driverId, 10),
          job_id: cod.orderId ? parseInt(cod.orderId, 10) : null,
          amount: parseFloat(cod.amount),
          status: cod.status === 'COMPLETED' ? 'settled' : 'pending',
          payment_method: cod.notes || null
        });
        migrated++;
      } catch (error) {
        console.error(`  Error migrating COD ${cod.codId}:`, error.message);
        errors++;
      }
    }
  }

  console.log(`  ✅ Migrated ${migrated} COD entries, ${errors} errors`);
  return { migrated, errors };
}

/**
 * Migrate tag config
 */
async function migrateTagConfig() {
  console.log('\n🏷️  Migrating tag config...');
  const tagConfig = loadJSONFile(TAG_CONFIG_FILE);
  
  if (!tagConfig || !tagConfig.rules) {
    console.log('  No tag config to migrate');
    return { migrated: 0, errors: 0 };
  }

  try {
    await tagConfigModel.updateConfig(tagConfig);
    console.log('  ✅ Migrated tag config');
    return { migrated: 1, errors: 0 };
  } catch (error) {
    console.error('  Error migrating tag config:', error.message);
    return { migrated: 0, errors: 1 };
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('========================================');
  console.log('  DATA MIGRATION TO SUPABASE');
  console.log('========================================\n');

  // Check if Supabase is configured
  if (!isConfigured()) {
    console.error('❌ Supabase not configured!');
    console.error('   Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env file');
    process.exit(1);
  }

  // Test connection
  console.log('🔌 Testing database connection...');
  const connectionTest = await testConnection();
  if (!connectionTest.success) {
    console.error('❌ Database connection failed:', connectionTest.error);
    console.error('   Make sure you have run the migration SQL in Supabase dashboard');
    process.exit(1);
  }
  console.log('✅ Database connection successful\n');

  // Backup data files
  console.log('📦 Creating backups...');
  const backupDir = path.join(DATA_DIR, 'backup_' + new Date().toISOString().split('T')[0]);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  if (fs.existsSync(TASKS_FILE)) {
    fs.copyFileSync(TASKS_FILE, path.join(backupDir, 'tasks.json'));
  }
  if (fs.existsSync(TASK_HISTORY_FILE)) {
    fs.copyFileSync(TASK_HISTORY_FILE, path.join(backupDir, 'taskHistory.json'));
  }
  if (fs.existsSync(COD_QUEUE_FILE)) {
    fs.copyFileSync(COD_QUEUE_FILE, path.join(backupDir, 'codQueue.json'));
  }
  if (fs.existsSync(TAG_CONFIG_FILE)) {
    fs.copyFileSync(TAG_CONFIG_FILE, path.join(backupDir, 'tagConfig.json'));
  }
  console.log(`✅ Backups created in ${backupDir}\n`);

  // Run migrations
  const results = {
    tasks: await migrateTasks(),
    history: await migrateTaskHistory(),
    codQueue: await migrateCODQueue(),
    tagConfig: await migrateTagConfig()
  };

  // Summary
  console.log('\n========================================');
  console.log('  MIGRATION SUMMARY');
  console.log('========================================\n');
  
  const totalMigrated = Object.values(results).reduce((sum, r) => sum + r.migrated, 0);
  const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors, 0);

  console.log(`Total migrated: ${totalMigrated}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log('\n✅ Migration complete!');
  console.log(`📁 Backups saved to: ${backupDir}`);
  console.log('\n⚠️  Note: File-based storage will still work as fallback');
  console.log('   Update endpoints to use database models to fully migrate.\n');
}

// Run migration if called directly
if (require.main === module) {
  migrate().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { migrate };











