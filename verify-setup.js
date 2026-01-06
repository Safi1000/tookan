/**
 * Complete Setup Verification Script
 * 
 * Verifies all configuration: Environment, Supabase, and Tookan API
 * 
 * Usage: node verify-setup.js
 */

require('dotenv').config();
const fetch = require('node-fetch');

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

function logSubsection(title) {
  log(`\n▶ ${title}`, 'blue');
}

const results = {
  environment: { passed: 0, failed: 0, tests: [] },
  supabase: { passed: 0, failed: 0, tests: [] },
  tookan: { passed: 0, failed: 0, tests: [] }
};

function recordResult(category, name, success, message) {
  const result = { name, success, message };
  results[category].tests.push(result);
  if (success) {
    results[category].passed++;
    log(`  ✅ ${name}: ${message}`, 'green');
  } else {
    results[category].failed++;
    log(`  ❌ ${name}: ${message}`, 'red');
  }
}

async function checkEnvironment() {
  logSection('1. ENVIRONMENT CONFIGURATION');
  
  // Check Tookan API Key
  logSubsection('Tookan Configuration');
  const tookanKey = process.env.TOOKAN_API_KEY;
  if (tookanKey && tookanKey !== 'your_tookan_api_key_here') {
    recordResult('environment', 'TOOKAN_API_KEY', true, `Configured (${tookanKey.substring(0, 8)}...)`);
  } else {
    recordResult('environment', 'TOOKAN_API_KEY', false, 'Not configured');
  }
  
  // Check Supabase Configuration
  logSubsection('Supabase Configuration');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnon = process.env.SUPABASE_ANON_KEY;
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (supabaseUrl && !supabaseUrl.includes('YOUR_')) {
    recordResult('environment', 'SUPABASE_URL', true, supabaseUrl);
  } else {
    recordResult('environment', 'SUPABASE_URL', false, 'Not configured - Update .env file');
  }
  
  if (supabaseAnon && !supabaseAnon.includes('YOUR_')) {
    recordResult('environment', 'SUPABASE_ANON_KEY', true, `Configured (${supabaseAnon.substring(0, 20)}...)`);
  } else {
    recordResult('environment', 'SUPABASE_ANON_KEY', false, 'Not configured - Update .env file');
  }
  
  if (supabaseService && !supabaseService.includes('YOUR_')) {
    recordResult('environment', 'SUPABASE_SERVICE_ROLE_KEY', true, `Configured (${supabaseService.substring(0, 20)}...)`);
  } else {
    recordResult('environment', 'SUPABASE_SERVICE_ROLE_KEY', false, 'Not configured - Update .env file');
  }
  
  // Check server configuration
  logSubsection('Server Configuration');
  const port = process.env.PORT || 3001;
  recordResult('environment', 'PORT', true, port.toString());
  
  const nodeEnv = process.env.NODE_ENV || 'development';
  recordResult('environment', 'NODE_ENV', true, nodeEnv);
}

async function checkSupabase() {
  logSection('2. SUPABASE CONNECTION');
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || supabaseUrl.includes('YOUR_') || !supabaseService || supabaseService.includes('YOUR_')) {
    recordResult('supabase', 'Connection', false, 'Supabase not configured - skipping connection test');
    log('\n  ⚠️  To test Supabase, add your credentials to .env file', 'yellow');
    return;
  }
  
  try {
    // Test Supabase REST API
    logSubsection('Testing Connection');
    const response = await fetch(`${supabaseUrl}/rest/v1/tasks?limit=1`, {
      method: 'GET',
      headers: {
        'apikey': supabaseService,
        'Authorization': `Bearer ${supabaseService}`
      }
    });
    
    if (response.ok || response.status === 200) {
      recordResult('supabase', 'Connection', true, 'Connected to Supabase');
      
      // Test tables
      logSubsection('Checking Tables');
      const tables = ['tasks', 'cod_queue', 'users', 'merchant_plans', 'withdrawal_requests', 'audit_logs'];
      
      for (const table of tables) {
        try {
          const tableResponse = await fetch(`${supabaseUrl}/rest/v1/${table}?limit=1`, {
            method: 'GET',
            headers: {
              'apikey': supabaseService,
              'Authorization': `Bearer ${supabaseService}`
            }
          });
          
          if (tableResponse.ok) {
            const data = await tableResponse.json();
            recordResult('supabase', `Table: ${table}`, true, `Exists (${Array.isArray(data) ? data.length : 0} rows)`);
          } else if (tableResponse.status === 404) {
            recordResult('supabase', `Table: ${table}`, false, 'Table not found - Run migrations');
          } else {
            recordResult('supabase', `Table: ${table}`, false, `Error: ${tableResponse.status}`);
          }
        } catch (error) {
          recordResult('supabase', `Table: ${table}`, false, error.message);
        }
      }
    } else if (response.status === 404) {
      recordResult('supabase', 'Tables', false, 'Database tables not found - Run migrations in Supabase SQL Editor');
    } else {
      const text = await response.text();
      recordResult('supabase', 'Connection', false, `HTTP ${response.status}: ${text.substring(0, 100)}`);
    }
  } catch (error) {
    recordResult('supabase', 'Connection', false, `Network error: ${error.message}`);
  }
}

async function checkTookan() {
  logSection('3. TOOKAN API');
  
  const apiKey = process.env.TOOKAN_API_KEY;
  
  if (!apiKey || apiKey === 'your_tookan_api_key_here') {
    recordResult('tookan', 'API Key', false, 'Not configured');
    return;
  }
  
  // Test Tookan API - Get Fleets (Drivers)
  logSubsection('Testing API Connection');
  try {
    const fleetsResponse = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey })
    });
    
    const fleetsData = await fleetsResponse.json();
    
    if (fleetsData.status === 200) {
      const fleetCount = fleetsData.data?.length || 0;
      recordResult('tookan', 'Get Fleets (Drivers)', true, `Found ${fleetCount} drivers`);
    } else {
      recordResult('tookan', 'Get Fleets (Drivers)', false, fleetsData.message || 'API error');
    }
  } catch (error) {
    recordResult('tookan', 'Get Fleets (Drivers)', false, error.message);
  }
  
  // Test Get Customers (Form Users/Vendors)
  try {
    const customersResponse = await fetch('https://api.tookanapp.com/v2/get_all_customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey })
    });
    
    const customersData = await customersResponse.json();
    
    if (customersData.status === 200) {
      const customerCount = customersData.data?.length || 0;
      recordResult('tookan', 'Get Customers (Merchants)', true, `Found ${customerCount} customers/merchants`);
    } else {
      recordResult('tookan', 'Get Customers (Merchants)', false, customersData.message || 'API error');
    }
  } catch (error) {
    recordResult('tookan', 'Get Customers (Merchants)', false, error.message);
  }
  
  // Test Get Tasks
  try {
    const tasksResponse = await fetch('https://api.tookanapp.com/v2/get_all_tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        api_key: apiKey,
        job_status: '0,1,2,3,4,5,6,7,8,9',
        limit: 10
      })
    });
    
    const tasksData = await tasksResponse.json();
    
    if (tasksData.status === 200) {
      const taskCount = tasksData.data?.length || 0;
      recordResult('tookan', 'Get Tasks (Orders)', true, `Found ${taskCount} recent tasks`);
    } else {
      recordResult('tookan', 'Get Tasks (Orders)', false, tasksData.message || 'API error');
    }
  } catch (error) {
    recordResult('tookan', 'Get Tasks (Orders)', false, error.message);
  }
  
  // Test Customer Wallet API
  logSubsection('Testing Customer Wallet API');
  try {
    const walletResponse = await fetch('https://api.tookanapp.com/v2/fetch_customers_wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        api_key: apiKey,
        is_pagination: 1,
        off_set: 0,
        limit: 10
      })
    });
    
    const walletData = await walletResponse.json();
    
    if (walletData.status === 200) {
      const walletCount = walletData.data?.length || 0;
      recordResult('tookan', 'Fetch Customer Wallets', true, `API available (${walletCount} wallets)`);
    } else {
      recordResult('tookan', 'Fetch Customer Wallets', false, walletData.message || 'API error');
    }
  } catch (error) {
    recordResult('tookan', 'Fetch Customer Wallets', false, error.message);
  }
}

function printSummary() {
  logSection('SUMMARY');
  
  const categories = ['environment', 'supabase', 'tookan'];
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const cat of categories) {
    const { passed, failed } = results[cat];
    totalPassed += passed;
    totalFailed += failed;
    
    const statusIcon = failed === 0 ? '✅' : (passed > 0 ? '⚠️' : '❌');
    const categoryName = cat.charAt(0).toUpperCase() + cat.slice(1);
    log(`  ${statusIcon} ${categoryName}: ${passed}/${passed + failed} passed`, failed === 0 ? 'green' : 'yellow');
  }
  
  console.log('\n' + '─'.repeat(60));
  
  if (totalFailed === 0) {
    log('\n  🎉 All checks passed! Your setup is complete.', 'green');
    log('  You can now start the server: npm run dev:all\n', 'cyan');
  } else {
    log(`\n  ⚠️  ${totalFailed} check(s) failed. See above for details.`, 'yellow');
    log('\n  Next steps:', 'cyan');
    
    if (results.environment.failed > 0) {
      log('  1. Update your .env file with correct credentials', 'yellow');
    }
    if (results.supabase.failed > 0) {
      log('  2. Run database migrations in Supabase SQL Editor', 'yellow');
      log('     - Copy server/db/migrations/001_initial_schema.sql', 'yellow');
      log('     - Paste and run in Supabase SQL Editor', 'yellow');
    }
    if (results.tookan.failed > 0) {
      log('  3. Verify your Tookan API key is correct', 'yellow');
    }
    console.log('');
  }
}

async function main() {
  console.clear();
  log('\n' + '╔' + '═'.repeat(58) + '╗', 'cyan');
  log('║' + ' '.repeat(10) + 'TURBO BAHRAIN SETUP VERIFICATION' + ' '.repeat(14) + '║', 'cyan');
  log('╚' + '═'.repeat(58) + '╝\n', 'cyan');
  
  await checkEnvironment();
  await checkSupabase();
  await checkTookan();
  printSummary();
}

main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

