/**
 * Script to fetch existing tasks/orders from Tookan account
 * 
 * Usage:
 *   node fetch-tookan-tasks.js
 * 
 * Environment Variables Required:
 *   TOOKAN_API_KEY - Your Tookan API key
 */

require('dotenv').config();
const fetch = require('node-fetch');

const API_KEY = process.env.TOOKAN_API_KEY;
const TOOKAN_API_BASE = 'https://api.tookanapp.com/v2';
const BACKEND_URL = process.env.VITE_API_BASE_URL || 'http://localhost:3001';

if (!API_KEY) {
  console.error('❌ Error: TOOKAN_API_KEY not found in environment variables');
  console.error('Please set TOOKAN_API_KEY in your .env file');
  process.exit(1);
}

/**
 * Fetch tasks using get_all_tasks endpoint
 */
async function fetchAllTasks() {
  try {
    console.log('\n📋 Fetching all tasks from Tookan...');
    
    // Try with date range (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Try method 1: With date range
    let payload = {
      api_key: API_KEY,
      start_date: formatDate(startDate),
      end_date: formatDate(endDate),
      is_pagination: 1,
      off_set: 0,
      limit: 50
    };

    console.log(`   Trying with date range: ${payload.start_date} to ${payload.end_date}`);
    let response = await fetch(`${TOOKAN_API_BASE}/get_all_tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      console.error(`❌ Failed to parse response: ${textResponse.substring(0, 200)}`);
      // Try without date range
      return await fetchAllTasksWithoutDate();
    }

    if (data.status === 200 && data.data) {
      const tasks = Array.isArray(data.data) ? data.data : (data.data.data || []);
      console.log(`✅ Found ${tasks.length} tasks with date range`);
      return tasks;
    } else {
      console.log(`   ⚠️  Date range method failed: ${data.message || 'Unknown error'}`);
      // Try without date range
      return await fetchAllTasksWithoutDate();
    }
  } catch (error) {
    console.error('❌ Error fetching tasks:', error.message);
    return await fetchAllTasksWithoutDate();
  }
}

/**
 * Fetch tasks without date range
 */
async function fetchAllTasksWithoutDate() {
  try {
    console.log(`   Trying without date range...`);
    
    const payload = {
      api_key: API_KEY,
      is_pagination: 1,
      off_set: 0,
      limit: 50
    };

    const response = await fetch(`${TOOKAN_API_BASE}/get_all_tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      console.error(`❌ Failed to parse response: ${textResponse.substring(0, 200)}`);
      return null;
    }

    if (data.status === 200 && data.data) {
      const tasks = Array.isArray(data.data) ? data.data : (data.data.data || []);
      console.log(`✅ Found ${tasks.length} tasks without date range`);
      return tasks;
    } else {
      console.log(`   ⚠️  API returned: ${data.message || 'Unknown error'}`);
      return [];
    }
  } catch (error) {
    console.error('❌ Error fetching tasks:', error.message);
    return null;
  }
}

/**
 * Fetch task details by job_id
 */
async function fetchTaskDetails(jobId) {
  try {
    console.log(`\n📋 Fetching task details for job_id: ${jobId}...`);
    
    const payload = {
      api_key: API_KEY,
      job_id: jobId
    };

    const response = await fetch(`${TOOKAN_API_BASE}/get_task_details`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      console.error(`❌ Failed to parse response: ${textResponse.substring(0, 200)}`);
      return null;
    }

    if (data.status === 200 && data.data) {
      console.log(`✅ Task details fetched successfully`);
      return data.data;
    } else {
      console.log(`⚠️  API returned: ${data.message || 'Unknown error'}`);
      return null;
    }
  } catch (error) {
    console.error('❌ Error fetching task details:', error.message);
    return null;
  }
}

/**
 * Test backend endpoint for fetching order details
 */
async function testBackendOrderFetch(jobId) {
  try {
    console.log(`\n🔍 Testing backend endpoint for order: ${jobId}...`);
    
    const response = await fetch(`${BACKEND_URL}/api/tookan/order/${jobId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (data.status === 'success' && data.data) {
      console.log(`✅ Backend endpoint working!`);
      return data.data;
    } else {
      console.log(`⚠️  Backend returned: ${data.message || 'Unknown error'}`);
      return null;
    }
  } catch (error) {
    console.error('❌ Error testing backend:', error.message);
    return null;
  }
}

/**
 * Fetch tasks via backend endpoint
 */
async function fetchTasksViaBackend() {
  try {
    console.log('\n📋 Fetching tasks via backend endpoint...');
    
    const response = await fetch(`${BACKEND_URL}/api/tookan/orders`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (data.status === 'success' && data.data) {
      const orders = data.data.orders || [];
      console.log(`✅ Found ${orders.length} orders via backend`);
      return orders;
    } else {
      console.log(`⚠️  Backend returned: ${data.message || 'Unknown error'}`);
      return [];
    }
  } catch (error) {
    console.error('❌ Error fetching via backend:', error.message);
    return null;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('TOOKAN TASKS FETCHER');
  console.log('='.repeat(60));
  console.log(`API Key: ${API_KEY.substring(0, 10)}...`);
  console.log(`Tookan API Base: ${TOOKAN_API_BASE}`);
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log('='.repeat(60));

  // Try fetching via backend first (if webhook cache exists)
  let tasks = await fetchTasksViaBackend();
  
  // If backend doesn't have tasks, try direct API
  if (!tasks || tasks.length === 0) {
    tasks = await fetchAllTasks();
  }

  // Check if user provided a job_id as argument
  const jobIdArg = process.argv[2];
  if (jobIdArg) {
    console.log(`\n📋 Using provided Job ID: ${jobIdArg}`);
    const taskDetails = await fetchTaskDetails(jobIdArg);
    if (taskDetails) {
      console.log('\n📋 Task Details:');
      console.log(JSON.stringify(taskDetails, null, 2));
      
      // Test backend endpoint
      const backendResult = await testBackendOrderFetch(jobIdArg);
      if (backendResult) {
        console.log('\n✅ Backend Order Fetch Result:');
        console.log(JSON.stringify(backendResult, null, 2));
      }
      
      console.log('\n' + '='.repeat(60));
      console.log('✅ Task ID for testing:');
      console.log(`   export TEST_ORDER_ID=${jobIdArg}`);
      console.log(`   Or set in .env: TEST_ORDER_ID=${jobIdArg}`);
      console.log('='.repeat(60));
      return;
    }
  }

  if (!tasks || tasks.length === 0) {
    console.log('\n⚠️  No tasks found via API.');
    console.log('\n💡 Options:');
    console.log('   1. Create a task in Tookan dashboard');
    console.log('   2. Run this script with a job_id: node fetch-tookan-tasks.js <JOB_ID>');
    console.log('   3. Check Tookan dashboard for existing task IDs');
    console.log('='.repeat(60));
    return;
  }

  // Display first few tasks
  console.log('\n📋 Available Tasks:');
  console.log('-'.repeat(60));
  tasks.slice(0, 10).forEach((task, index) => {
    const jobId = task.job_id || task.id || 'N/A';
    const status = task.job_status || task.status || 'N/A';
    const customerName = task.customer_name || task.customer_name || 'N/A';
    console.log(`${index + 1}. Job ID: ${jobId}`);
    console.log(`   Status: ${status}`);
    console.log(`   Customer: ${customerName}`);
    console.log(`   COD: ${task.cod || task.cod_amount || '0'}`);
    console.log('');
  });

  // Get first task for detailed testing
  const firstTask = tasks[0];
  const jobId = firstTask.job_id || firstTask.id;

  if (jobId) {
    console.log('='.repeat(60));
    console.log(`Using first task (Job ID: ${jobId}) for testing...`);
    console.log('='.repeat(60));

    // Fetch detailed task info
    const taskDetails = await fetchTaskDetails(jobId);
    if (taskDetails) {
      console.log('\n📋 Task Details:');
      console.log(JSON.stringify(taskDetails, null, 2));
    }

    // Test backend endpoint
    const backendResult = await testBackendOrderFetch(jobId);
    if (backendResult) {
      console.log('\n✅ Backend Order Fetch Result:');
      console.log(JSON.stringify(backendResult, null, 2));
    }

    // Save job ID to .env or output for use in other scripts
    console.log('\n' + '='.repeat(60));
    console.log('✅ Task ID for testing:');
    console.log(`   export TEST_ORDER_ID=${jobId}`);
    console.log(`   Or set in .env: TEST_ORDER_ID=${jobId}`);
    console.log('='.repeat(60));
  }
}

// Run the script
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

