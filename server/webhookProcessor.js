/**
 * Webhook Event Processor
 * 
 * Background job to retry failed webhook events.
 * Run this periodically (e.g., every 5 minutes) via cron or setInterval.
 * 
 * Usage:
 *   node server/webhookProcessor.js
 * 
 * Or run continuously:
 *   while true; do node server/webhookProcessor.js; sleep 300; done
 */

require('dotenv').config();
const webhookEventsModel = require('./db/models/webhookEvents');
const taskStorage = require('./taskStorage');
const { isConfigured } = require('./db/supabase');

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 60000; // 1 minute base delay

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(retryCount) {
  return RETRY_DELAY_BASE * Math.pow(2, retryCount);
}

/**
 * Process a single webhook event
 */
async function processWebhookEvent(event) {
  console.log(`Processing webhook event ${event.id} (retry ${event.retry_count})`);
  
  try {
    const payload = event.payload || {};
    const eventType = event.event_type || payload.event_type || payload.type || 'unknown';
    const orderId = event.job_id || payload.job_id || payload.order_id || payload.task_id || 'unknown';
    
    // Only process task/order related events
    if (eventType.includes('task') || eventType.includes('order') || eventType.includes('job') || orderId !== 'unknown') {
      // Update task storage with COD data from template fields
      const updatedTask = await taskStorage.updateTaskFromWebhook(payload);
      
      if (updatedTask) {
        // Mark as processed
        await webhookEventsModel.markProcessed(event.id);
        console.log(`✅ Event ${event.id} processed successfully`);
        return true;
      } else {
        // Could not update task, but mark as processed (no job_id)
        await webhookEventsModel.markProcessed(event.id);
        console.log(`✅ Event ${event.id} processed (no task update needed)`);
        return true;
      }
    } else {
      // Not a task-related event, mark as processed
      await webhookEventsModel.markProcessed(event.id);
      console.log(`✅ Event ${event.id} processed (not task-related)`);
      return true;
    }
  } catch (error) {
    console.error(`❌ Error processing event ${event.id}:`, error.message);
    
    // Mark as failed (will increment retry_count)
    await webhookEventsModel.markFailed(event.id, error.message || 'Processing failed');
    
    // Check if we've exceeded max retries
    const failedEvent = await webhookEventsModel.getFailedEvents();
    const thisEvent = failedEvent.find(e => e.id === event.id);
    if (thisEvent && thisEvent.retry_count >= MAX_RETRIES) {
      console.error(`⚠️  Event ${event.id} has exceeded max retries (${MAX_RETRIES}). Manual intervention required.`);
    }
    
    return false;
  }
}

/**
 * Process pending webhook events
 */
async function processPendingEvents() {
  if (!isConfigured()) {
    console.warn('⚠️  Supabase not configured. Webhook processor cannot run.');
    return;
  }

  try {
    console.log('\n=== WEBHOOK PROCESSOR RUN ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    // Get pending events
    const pendingEvents = await webhookEventsModel.getPendingEvents(MAX_RETRIES);
    
    if (pendingEvents.length === 0) {
      console.log('✅ No pending events to process');
      return;
    }
    
    console.log(`Found ${pendingEvents.length} pending event(s)`);
    
    // Process events sequentially to avoid overwhelming the system
    for (const event of pendingEvents) {
      // Check if enough time has passed since last retry (exponential backoff)
      if (event.last_retry_at) {
        const lastRetryTime = new Date(event.last_retry_at).getTime();
        const delay = getRetryDelay(event.retry_count || 0);
        const now = Date.now();
        
        if (now - lastRetryTime < delay) {
          console.log(`⏳ Event ${event.id} is in backoff period. Skipping.`);
          continue;
        }
      }
      
      await processWebhookEvent(event);
      
      // Small delay between events to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('=== WEBHOOK PROCESSOR COMPLETE ===\n');
  } catch (error) {
    console.error('❌ Webhook processor error:', error);
    console.error('Error stack:', error.stack);
  }
}

// Run if executed directly
if (require.main === module) {
  processPendingEvents()
    .then(() => {
      console.log('Webhook processor completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = {
  processPendingEvents,
  processWebhookEvent
};





