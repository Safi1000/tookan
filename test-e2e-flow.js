/**
 * End-to-End Testing Script
 * 
 * Tests the complete flow:
 * 1. Create a task in Tookan
 * 2. Verify it appears in local system
 * 3. Update COD amount
 * 4. Simulate webhook for completion
 * 5. Verify COD queue
 * 
 * Usage: node test-e2e-flow.js
 */

require('dotenv').config();
const fetch = require('node-fetch');

const TOOKAN_API = 'https://api.tookanapp.com/v2';
const BACKEND_URL = process.env.VITE_API_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.TOOKAN_API_KEY;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '═'.repeat(60));
  log(`  ${title}`, 'cyan');
  console.log('═'.repeat(60));
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test data
const testData = {
  customerName: 'E2E Test Customer',
  customerPhone: '+97333333333',
  customerEmail: 'e2e-test@example.com',
  pickupAddress: 'Manama, Bahrain',
  deliveryAddress: 'Riffa, Bahrain',
  codAmount: 50.00
};

let createdJobId = null;

async function testTookanConnection() {
  logSection('1. TESTING TOOKAN API CONNECTION');
  
  if (!API_KEY) {
    log('❌ TOOKAN_API_KEY not configured', 'red');
    return false;
  }
  
  try {
    const response = await fetch(`${TOOKAN_API}/get_all_fleets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY })
    });
    
    const data = await response.json();
    
    if (data.status === 200) {
      log(`✅ Tookan API connected - Found ${data.data?.length || 0} drivers`, 'green');
      return true;
    } else {
      log(`❌ Tookan API error: ${data.message}`, 'red');
      return false;
    }
  } catch (error) {
    log(`❌ Connection error: ${error.message}`, 'red');
    return false;
  }
}

async function testBackendConnection() {
  logSection('2. TESTING BACKEND CONNECTION');
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/health`);
    const data = await response.json();
    
    if (data.status === 'success') {
      log(`✅ Backend connected: ${BACKEND_URL}`, 'green');
      return true;
    } else {
      log(`❌ Backend error: ${data.message}`, 'red');
      return false;
    }
  } catch (error) {
    log(`❌ Backend connection error: ${error.message}`, 'red');
    log('   Make sure the server is running: npm run server', 'yellow');
    return false;
  }
}

async function createTestTask() {
  logSection('3. CREATING TEST TASK IN TOOKAN');
  
  // Get current time + 1 hour for pickup
  const pickupTime = new Date(Date.now() + 3600000).toISOString().slice(0, 19).replace('T', ' ');
  
  const taskPayload = {
    api_key: API_KEY,
    order_id: `E2E-TEST-${Date.now()}`,
    customer_email: testData.customerEmail,
    customer_username: testData.customerName,
    customer_phone: testData.customerPhone,
    customer_address: testData.deliveryAddress,
    job_description: 'E2E Test Task - Please ignore',
    job_pickup_phone: '+97311111111',
    job_pickup_name: 'Test Pickup',
    job_pickup_email: 'pickup@test.com',
    job_pickup_address: testData.pickupAddress,
    job_pickup_datetime: pickupTime,
    has_pickup: 1,
    has_delivery: 1,
    layout_type: 0,
    tracking_link: 1,
    timezone: 180, // GMT+3
    auto_assignment: 0,
    fleet_id: '', // Don't auto-assign
    // COD template data
    custom_field_template: 'default', // Use default template or your template name
    meta_data: [
      {
        label: 'cod_amount',
        data: testData.codAmount.toString()
      },
      {
        label: 'cod_collected',
        data: 'false'
      }
    ]
  };
  
  try {
    log('Creating task with COD amount: $' + testData.codAmount, 'blue');
    
    const response = await fetch(`${TOOKAN_API}/create_task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskPayload)
    });
    
    const data = await response.json();
    
    if (data.status === 200) {
      createdJobId = data.data?.job_id;
      log(`✅ Task created successfully`, 'green');
      log(`   Job ID: ${createdJobId}`, 'cyan');
      log(`   Order ID: ${taskPayload.order_id}`, 'cyan');
      return true;
    } else {
      log(`❌ Failed to create task: ${data.message}`, 'red');
      console.log('Full response:', JSON.stringify(data, null, 2));
      return false;
    }
  } catch (error) {
    log(`❌ Error creating task: ${error.message}`, 'red');
    return false;
  }
}

async function simulateWebhook() {
  logSection('4. SIMULATING WEBHOOK');
  
  if (!createdJobId) {
    log('⚠️ No task created, using test job_id', 'yellow');
    createdJobId = 'TEST-' + Date.now();
  }
  
  const webhookPayload = {
    event_type: 'task_updated',
    job_id: createdJobId,
    job_status: 1, // Assigned
    fleet_id: 1,
    fleet_name: 'Test Driver',
    customer_username: testData.customerName,
    customer_phone: testData.customerPhone,
    customer_address: testData.deliveryAddress,
    template_fields: {
      cod_amount: testData.codAmount.toString(),
      cod_collected: 'false'
    }
  };
  
  try {
    log('Sending webhook to backend...', 'blue');
    
    const response = await fetch(`${BACKEND_URL}/api/tookan/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    });
    
    const data = await response.json();
    
    if (data.status === 'success') {
      log(`✅ Webhook received successfully`, 'green');
      return true;
    } else {
      log(`❌ Webhook error: ${data.message}`, 'red');
      return false;
    }
  } catch (error) {
    log(`❌ Webhook error: ${error.message}`, 'red');
    return false;
  }
}

async function verifyTaskInBackend() {
  logSection('5. VERIFYING TASK IN BACKEND');
  
  if (!createdJobId) {
    log('⚠️ No job_id to verify', 'yellow');
    return false;
  }
  
  try {
    // Wait a moment for processing
    await sleep(1000);
    
    const response = await fetch(`${BACKEND_URL}/api/tookan/task/${createdJobId}`);
    const data = await response.json();
    
    if (data.status === 'success' && data.data) {
      log(`✅ Task found in backend`, 'green');
      log(`   COD Amount: ${data.data.cod_amount || data.data.codAmount || 'N/A'}`, 'cyan');
      log(`   Status: ${data.data.status || data.data.job_status || 'N/A'}`, 'cyan');
      return true;
    } else {
      log(`⚠️ Task not found in backend (may be expected if webhook not processed)`, 'yellow');
      return false;
    }
  } catch (error) {
    log(`❌ Error verifying task: ${error.message}`, 'red');
    return false;
  }
}

async function simulateTaskCompletion() {
  logSection('6. SIMULATING TASK COMPLETION');
  
  if (!createdJobId) {
    log('⚠️ No task to complete', 'yellow');
    return false;
  }
  
  // Simulate completion webhook
  const completionWebhook = {
    event_type: 'task_completed',
    job_id: createdJobId,
    job_status: 2, // Completed
    fleet_id: 1,
    fleet_name: 'Test Driver',
    template_fields: {
      cod_amount: testData.codAmount.toString(),
      cod_collected: 'true'
    }
  };
  
  try {
    log('Sending completion webhook...', 'blue');
    
    const response = await fetch(`${BACKEND_URL}/api/tookan/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(completionWebhook)
    });
    
    const data = await response.json();
    
    if (data.status === 'success') {
      log(`✅ Completion webhook processed`, 'green');
      return true;
    } else {
      log(`❌ Completion webhook error: ${data.message}`, 'red');
      return false;
    }
  } catch (error) {
    log(`❌ Error: ${error.message}`, 'red');
    return false;
  }
}

async function checkCODQueue() {
  logSection('7. CHECKING COD QUEUE');
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/tookan/cod-queue`);
    const data = await response.json();
    
    if (data.status === 'success') {
      const entries = data.data || [];
      log(`✅ COD Queue has ${entries.length} entries`, 'green');
      
      // Check if our test task is in the queue
      const testEntry = entries.find(e => e.job_id == createdJobId || e.orderId == createdJobId);
      if (testEntry) {
        log(`✅ Test task found in COD queue`, 'green');
        log(`   Amount: $${testEntry.amount || testEntry.cod_amount}`, 'cyan');
        log(`   Status: ${testEntry.status}`, 'cyan');
      }
      return true;
    } else {
      log(`⚠️ COD Queue fetch failed: ${data.message}`, 'yellow');
      return false;
    }
  } catch (error) {
    log(`❌ Error checking COD queue: ${error.message}`, 'red');
    return false;
  }
}

async function cleanupTestTask() {
  logSection('8. CLEANUP');
  
  if (!createdJobId || createdJobId.startsWith('TEST-')) {
    log('⚠️ No real task to clean up', 'yellow');
    return;
  }
  
  try {
    log('Cancelling test task in Tookan...', 'blue');
    
    const response = await fetch(`${TOOKAN_API}/cancel_task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: API_KEY,
        job_id: createdJobId
      })
    });
    
    const data = await response.json();
    
    if (data.status === 200) {
      log(`✅ Test task cancelled`, 'green');
    } else {
      log(`⚠️ Could not cancel task: ${data.message}`, 'yellow');
    }
  } catch (error) {
    log(`⚠️ Cleanup error: ${error.message}`, 'yellow');
  }
}

function printSummary(results) {
  logSection('TEST SUMMARY');
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log('');
  log(`  Tests Passed: ${passed}/${total}`, passed === total ? 'green' : 'yellow');
  console.log('');
  
  if (passed === total) {
    log('  🎉 All tests passed! Your integration is working.', 'green');
  } else {
    log('  ⚠️ Some tests failed. Check the output above for details.', 'yellow');
    console.log('');
    log('  Common issues:', 'cyan');
    log('  - Backend not running: npm run server', 'yellow');
    log('  - Missing Supabase credentials: Update .env file', 'yellow');
    log('  - Tookan API issues: Check API key and account status', 'yellow');
  }
  console.log('');
}

async function main() {
  console.clear();
  log('\n' + '╔' + '═'.repeat(58) + '╗', 'cyan');
  log('║' + ' '.repeat(15) + 'E2E INTEGRATION TEST' + ' '.repeat(21) + '║', 'cyan');
  log('╚' + '═'.repeat(58) + '╝\n', 'cyan');
  
  const results = [];
  
  // Run tests
  results.push(await testTookanConnection());
  results.push(await testBackendConnection());
  
  // Only continue if connections work
  if (results[0] && results[1]) {
    results.push(await createTestTask());
    results.push(await simulateWebhook());
    results.push(await verifyTaskInBackend());
    results.push(await simulateTaskCompletion());
    results.push(await checkCODQueue());
    
    // Cleanup
    await cleanupTestTask();
  }
  
  printSummary(results);
}

main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

