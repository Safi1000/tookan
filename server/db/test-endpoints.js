/**
 * Test Endpoints with Database
 * 
 * Tests all endpoints to ensure database integration works correctly.
 * Run this after data migration to verify endpoints are working.
 * 
 * Usage: node server/db/test-endpoints.js
 */

require('dotenv').config();
const { isConfigured } = require('./supabase');
const taskModel = require('./models/tasks');
const codQueueModel = require('./models/codQueue');
const merchantPlansModel = require('./models/merchantPlans');
const withdrawalRequestsModel = require('./models/withdrawalRequests');

async function testEndpoints() {
  console.log('========================================');
  console.log('  ENDPOINT DATABASE INTEGRATION TEST');
  console.log('========================================\n');

  if (!isConfigured()) {
    console.error('❌ Supabase not configured!');
    console.error('   Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env file');
    process.exit(1);
  }

  console.log('✅ Supabase configured\n');

  const tests = [];
  let passed = 0;
  let failed = 0;

  // Test 1: Tasks Model
  console.log('📦 Testing Tasks Model...');
  try {
    const tasks = await taskModel.getAllTasks({ limit: 5 });
    console.log(`  ✅ getAllTasks: Found ${tasks.length} tasks`);
    tests.push({ name: 'Tasks getAllTasks', status: 'PASS' });
    passed++;
  } catch (error) {
    console.error(`  ❌ getAllTasks: ${error.message}`);
    tests.push({ name: 'Tasks getAllTasks', status: 'FAIL', error: error.message });
    failed++;
  }

  // Test 2: COD Queue Model
  console.log('\n💰 Testing COD Queue Model...');
  try {
    const queue = await codQueueModel.getAllQueue({ limit: 5 });
    console.log(`  ✅ getAllQueue: Found ${queue.length} entries`);
    tests.push({ name: 'COD Queue getAllQueue', status: 'PASS' });
    passed++;
  } catch (error) {
    console.error(`  ❌ getAllQueue: ${error.message}`);
    tests.push({ name: 'COD Queue getAllQueue', status: 'FAIL', error: error.message });
    failed++;
  }

  // Test 3: Merchant Plans Model
  console.log('\n📋 Testing Merchant Plans Model...');
  try {
    const plans = await merchantPlansModel.getAllPlans();
    console.log(`  ✅ getAllPlans: Found ${plans.length} plans`);
    tests.push({ name: 'Merchant Plans getAllPlans', status: 'PASS' });
    passed++;
  } catch (error) {
    console.error(`  ❌ getAllPlans: ${error.message}`);
    tests.push({ name: 'Merchant Plans getAllPlans', status: 'FAIL', error: error.message });
    failed++;
  }

  // Test 4: Withdrawal Requests Model
  console.log('\n💸 Testing Withdrawal Requests Model...');
  try {
    const requests = await withdrawalRequestsModel.getAllRequests({ limit: 5 });
    console.log(`  ✅ getAllRequests: Found ${requests.length} requests`);
    tests.push({ name: 'Withdrawal Requests getAllRequests', status: 'PASS' });
    passed++;
  } catch (error) {
    console.error(`  ❌ getAllRequests: ${error.message}`);
    tests.push({ name: 'Withdrawal Requests getAllRequests', status: 'FAIL', error: error.message });
    failed++;
  }

  // Summary
  console.log('\n========================================');
  console.log('  TEST SUMMARY');
  console.log('========================================\n');
  console.log(`Total Tests: ${tests.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}\n`);

  if (failed === 0) {
    console.log('✅ ALL TESTS PASSED');
    console.log('\nDatabase integration is working correctly!');
    console.log('You can now use the application with database storage.\n');
  } else {
    console.log('⚠️  SOME TESTS FAILED');
    console.log('\nPlease check:');
    console.log('  1. Database tables exist');
    console.log('  2. Data migration was successful');
    console.log('  3. RLS policies allow service role access\n');
    process.exit(1);
  }
}

// Run test if called directly
if (require.main === module) {
  testEndpoints().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

module.exports = { testEndpoints };











