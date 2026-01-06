/**
 * Test Database Connection Script
 * 
 * Tests Supabase connection and verifies tables exist.
 * Run this after setting up Supabase to verify everything is working.
 * 
 * Usage: node server/db/test-connection.js
 */

require('dotenv').config();
const { supabase, isConfigured, testConnection } = require('./supabase');

async function testDatabase() {
  console.log('========================================');
  console.log('  SUPABASE DATABASE CONNECTION TEST');
  console.log('========================================\n');

  // Check configuration
  if (!isConfigured()) {
    console.error('❌ Supabase not configured!');
    console.error('   Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env file');
    process.exit(1);
  }

  console.log('✅ Supabase credentials found\n');

  // Test connection
  console.log('🔌 Testing database connection...');
  const connectionTest = await testConnection();
  
  if (!connectionTest.success) {
    console.error('❌ Connection failed:', connectionTest.error);
    console.error('\n⚠️  Make sure you have:');
    console.error('   1. Created a Supabase project');
    console.error('   2. Run the SQL migration (001_initial_schema.sql)');
    console.error('   3. Added correct credentials to .env file');
    process.exit(1);
  }

  console.log('✅ Database connection successful\n');

  // Test table access
  console.log('📊 Testing table access...\n');
  
  const tables = [
    'tasks',
    'task_history',
    'cod_queue',
    'merchant_plans',
    'merchant_plan_assignments',
    'withdrawal_requests',
    'webhook_events',
    'audit_logs',
    'tag_config',
    'task_metadata',
    'users'
  ];

  let allTablesOk = true;

  for (const table of tables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(1);

      if (error && error.code !== 'PGRST116') {
        console.error(`❌ ${table}: ${error.message}`);
        allTablesOk = false;
      } else {
        console.log(`✅ ${table}: Accessible`);
      }
    } catch (error) {
      console.error(`❌ ${table}: ${error.message}`);
      allTablesOk = false;
    }
  }

  console.log('\n========================================');
  if (allTablesOk) {
    console.log('  ✅ ALL TESTS PASSED');
    console.log('========================================\n');
    console.log('Database is ready to use!');
    console.log('You can now run: node server/db/migrate-data.js\n');
  } else {
    console.log('  ⚠️  SOME TESTS FAILED');
    console.log('========================================\n');
    console.log('Please check:');
    console.log('  1. SQL migration was run successfully');
    console.log('  2. All tables were created');
    console.log('  3. RLS policies are configured correctly\n');
    process.exit(1);
  }
}

// Run test if called directly
if (require.main === module) {
  testDatabase().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

module.exports = { testDatabase };











