/**
 * Find Available Tookan Users for Authentication
 * 
 * Fetches drivers and customers from Tookan to identify valid login credentials
 * 
 * Usage:
 *   node find-tookan-users.js
 */

require('dotenv').config();
const fetch = require('node-fetch');

const TOOKAN_API_KEY = process.env.TOOKAN_API_KEY;
const TOOKAN_API_BASE = 'https://api.tookanapp.com/v2';

if (!TOOKAN_API_KEY) {
  console.error('❌ Error: TOOKAN_API_KEY not found in environment variables');
  process.exit(1);
}

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function fetchTookanUsers() {
  console.log('\n' + '='.repeat(70));
  log('🔍 FETCHING TOOKAN USERS FOR AUTHENTICATION', 'cyan');
  console.log('='.repeat(70) + '\n');

  const users = {
    drivers: [],
    customers: []
  };

  // Fetch Drivers/Fleets
  log('📦 Fetching Drivers/Fleets...', 'blue');
  try {
    const fleetPayload = {
      api_key: TOOKAN_API_KEY
    };

    let fleetResponse = await fetch(`${TOOKAN_API_BASE}/get_all_agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fleetPayload),
    });

    if (!fleetResponse.ok) {
      fleetResponse = await fetch(`${TOOKAN_API_BASE}/get_all_fleets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fleetPayload),
      });
    }

    const fleetTextResponse = await fleetResponse.text();
    let fleetData;

    try {
      fleetData = JSON.parse(fleetTextResponse);
    } catch (e) {
      log(`   ⚠️  Could not parse response`, 'yellow');
      fleetData = null;
    }

    if (fleetResponse.ok && fleetData) {
      let fleets = [];
      
      if (fleetData.status === 200 && Array.isArray(fleetData.data)) {
        fleets = fleetData.data;
      } else if (Array.isArray(fleetData.data)) {
        fleets = fleetData.data;
      } else if (Array.isArray(fleetData)) {
        fleets = fleetData;
      } else if (fleetData.agents && Array.isArray(fleetData.agents)) {
        fleets = fleetData.agents;
      } else if (fleetData.fleets && Array.isArray(fleetData.fleets)) {
        fleets = fleetData.fleets;
      }

      log(`   ✅ Found ${fleets.length} drivers/fleets`, 'green');
      
      fleets.forEach((fleet, index) => {
        const fleetId = fleet.fleet_id || fleet.agent_id || fleet.id || fleet.fleetId || fleet.agentId;
        const fleetEmail = fleet.fleet_email || fleet.agent_email || fleet.email || fleet.fleetEmail || fleet.agentEmail || '';
        const fleetPhone = fleet.fleet_phone || fleet.agent_phone || fleet.phone || fleet.fleetPhone || fleet.agentPhone || '';
        const fleetName = fleet.fleet_name || fleet.agent_name || fleet.name || fleet.fleetName || fleet.agentName || 'Unknown';

        users.drivers.push({
          id: fleetId,
          name: fleetName,
          email: fleetEmail,
          phone: fleetPhone
        });

        if (index < 5) {
          log(`   ${index + 1}. ${fleetName}`, 'reset');
          if (fleetEmail) log(`      Email: ${fleetEmail}`, 'cyan');
          if (fleetPhone) log(`      Phone: ${fleetPhone}`, 'cyan');
          if (fleetId) log(`      ID: ${fleetId}`, 'cyan');
        }
      });
    } else {
      log(`   ❌ Failed to fetch drivers: ${fleetData?.message || 'Unknown error'}`, 'red');
    }
  } catch (error) {
    log(`   ❌ Error fetching drivers: ${error.message}`, 'red');
  }

  console.log('');

  // Fetch Customers/Merchants
  log('🏪 Fetching Customers/Merchants...', 'blue');
  try {
    const customerPayload = {
      api_key: TOOKAN_API_KEY
    };

    const customerResponse = await fetch(`${TOOKAN_API_BASE}/fetch_customers_wallet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...customerPayload,
        is_pagination: 1,
        off_set: 0,
        limit: 100
      }),
    });

    const customerTextResponse = await customerResponse.text();
    let customerData;

    try {
      customerData = JSON.parse(customerTextResponse);
    } catch (e) {
      log(`   ⚠️  Could not parse response`, 'yellow');
      customerData = null;
    }

    if (customerResponse.ok && customerData) {
      let customers = [];
      
      if (customerData.status === 200 && Array.isArray(customerData.data)) {
        customers = customerData.data;
      } else if (Array.isArray(customerData.data)) {
        customers = customerData.data;
      } else if (Array.isArray(customerData)) {
        customers = customerData;
      } else if (customerData.customers && Array.isArray(customerData.customers)) {
        customers = customerData.customers;
      }

      log(`   ✅ Found ${customers.length} customers/merchants`, 'green');
      
      customers.forEach((customer, index) => {
        const vendorId = customer.vendor_id || customer.customer_id || customer.id || customer.vendorId || customer.customerId;
        const customerEmail = customer.customer_email || customer.vendor_email || customer.email || customer.customerEmail || customer.vendorEmail || '';
        const customerPhone = customer.customer_phone || customer.vendor_phone || customer.phone || customer.customerPhone || customer.vendorPhone || '';
        const customerName = customer.customer_name || customer.vendor_name || customer.name || customer.customerName || customer.vendorName || 'Unknown';

        users.customers.push({
          id: vendorId,
          name: customerName,
          email: customerEmail,
          phone: customerPhone
        });

        if (index < 5) {
          log(`   ${index + 1}. ${customerName}`, 'reset');
          if (customerEmail) log(`      Email: ${customerEmail}`, 'cyan');
          if (customerPhone) log(`      Phone: ${customerPhone}`, 'cyan');
          if (vendorId) log(`      ID: ${vendorId}`, 'cyan');
        }
      });
    } else {
      log(`   ❌ Failed to fetch customers: ${customerData?.message || 'Unknown error'}`, 'red');
    }
  } catch (error) {
    log(`   ❌ Error fetching customers: ${error.message}`, 'red');
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  log('📊 SUMMARY', 'cyan');
  console.log('='.repeat(70));
  log(`Total Drivers: ${users.drivers.length}`, 'green');
  log(`Total Customers: ${users.customers.length}`, 'green');
  
  console.log('\n💡 You can use any of these for authentication:');
  console.log('   - Email addresses (from drivers or customers)');
  console.log('   - Phone numbers (from drivers or customers)');
  console.log('   - IDs (fleet_id or vendor_id)');
  console.log('\n   Example: TEST_EMAIL=<email_or_phone_or_id>');
  console.log('            TEST_PASSWORD=<any_password>');
  console.log('\n' + '='.repeat(70) + '\n');

  return users;
}

// Run
fetchTookanUsers().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

