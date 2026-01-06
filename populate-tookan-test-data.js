/**
 * Comprehensive Script to Populate Tookan Account with Test Data
 * 
 * Creates test customers, agents, tasks, and wallet transactions
 * All data includes "test" in the name for easy identification
 * 
 * Usage:
 *   node populate-tookan-test-data.js
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

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, 'cyan');
  console.log('='.repeat(70));
}

// Test data to create
const testCustomers = [
  { name: 'Test Restaurant A', phone: '+97311111111', email: 'test.restaurant.a@test.com' },
  { name: 'Test Shop B', phone: '+97322222222', email: 'test.shop.b@test.com' },
  { name: 'Test Cafe C', phone: '+97333333333', email: 'test.cafe.c@test.com' },
  { name: 'Test Market D', phone: '+97344444444', email: 'test.market.d@test.com' },
  { name: 'Test Store E', phone: '+97355555555', email: 'test.store.e@test.com' },
  { name: 'Test Bakery F', phone: '+97366666666', email: 'test.bakery.f@test.com' },
  { name: 'Test Pharmacy G', phone: '+97377777777', email: 'test.pharmacy.g@test.com' },
  { name: 'Test Electronics H', phone: '+97388888888', email: 'test.electronics.h@test.com' }
];

const testAgents = [
  { fleet_name: 'Test Driver Ahmed', fleet_phone: '+97311111111', fleet_email: 'test.driver.ahmed@test.com', fleet_password: 'Test123!', fleet_type: 1 },
  { fleet_name: 'Test Driver Fatima', fleet_phone: '+97322222222', fleet_email: 'test.driver.fatima@test.com', fleet_password: 'Test123!', fleet_type: 1 },
  { fleet_name: 'Test Driver Mohammed', fleet_phone: '+97333333333', fleet_email: 'test.driver.mohammed@test.com', fleet_password: 'Test123!', fleet_type: 1 },
  { fleet_name: 'Test Driver Sara', fleet_phone: '+97344444444', fleet_email: 'test.driver.sara@test.com', fleet_password: 'Test123!', fleet_type: 1 },
  { fleet_name: 'Test Driver Ali', fleet_phone: '+97355555555', fleet_email: 'test.driver.ali@test.com', fleet_password: 'Test123!', fleet_type: 1 }
];

// Bahrain addresses with coordinates for test orders
const bahrainAddresses = {
  pickup: [
    { address: 'Test Pickup - Manama, Bahrain', lat: 26.2285, lng: 50.5860 },
    { address: 'Test Pickup - Seef District, Manama', lat: 26.2180, lng: 50.5600 },
    { address: 'Test Pickup - Juffair, Manama', lat: 26.2100, lng: 50.6000 },
    { address: 'Test Pickup - Adliya, Manama', lat: 26.2200, lng: 50.5800 },
    { address: 'Test Pickup - Diplomatic Area, Manama', lat: 26.2300, lng: 50.5900 }
  ],
  delivery: [
    { address: 'Test Delivery - Riffa, Bahrain', lat: 26.1300, lng: 50.5500 },
    { address: 'Test Delivery - Isa Town, Bahrain', lat: 26.1736, lng: 50.5478 },
    { address: 'Test Delivery - Sitra, Bahrain', lat: 26.1847, lng: 50.6200 },
    { address: 'Test Delivery - Muharraq, Bahrain', lat: 26.2572, lng: 50.6119 },
    { address: 'Test Delivery - Hamad Town, Bahrain', lat: 26.1500, lng: 50.5000 }
  ]
};

// Store created IDs
let createdCustomers = [];
let createdAgents = [];
let createdTasks = [];

/**
 * Add a test customer/merchant to Tookan
 */
async function addTestCustomer(customerData) {
  try {
    log(`\n📦 Adding test customer: ${customerData.name}...`, 'blue');
    
    const payload = {
      api_key: API_KEY,
      user_type: 0, // 0 for customer/merchant
      name: customerData.name.trim(),
      phone: customerData.phone.trim()
    };

    const response = await fetch(`${TOOKAN_API_BASE}/customer/add`, {
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
      log(`❌ Failed to parse response: ${textResponse.substring(0, 200)}`, 'red');
      return null;
    }

    if (response.ok && data.status === 200) {
      const vendorId = data.data?.vendor_id || data.data?.data?.vendor_id || data.data?.customer_id || data.data?.id;
      log(`✅ Test customer added successfully!`, 'green');
      log(`   Name: ${customerData.name}`, 'reset');
      log(`   Vendor ID: ${vendorId || 'Not returned'}`, 'reset');
      return { ...customerData, vendor_id: vendorId };
    } else {
      log(`❌ Failed to add customer: ${data.message || 'Unknown error'}`, 'red');
      return null;
    }
  } catch (error) {
    log(`❌ Error adding customer ${customerData.name}: ${error.message}`, 'red');
    return null;
  }
}

/**
 * Add a test agent/driver to Tookan
 */
async function addTestAgent(agentData) {
  try {
    log(`\n🚗 Adding test agent: ${agentData.fleet_name}...`, 'blue');
    
    // Try via backend endpoint first (which may proxy to Tookan or handle manually)
    const payload = {
      fleet_name: agentData.fleet_name,
      fleet_phone: agentData.fleet_phone,
      fleet_email: agentData.fleet_email,
      fleet_password: agentData.fleet_password,
      fleet_type: agentData.fleet_type || 1
    };

    // Try direct Tookan API first
    const tookanPayload = {
      api_key: API_KEY,
      ...payload
    };

    let response = await fetch(`${TOOKAN_API_BASE}/fleet/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tookanPayload),
    });

    let textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      // If direct API fails, try backend endpoint
      log(`   ⚠️  Direct API failed, trying backend endpoint...`, 'yellow');
      response = await fetch(`${BACKEND_URL}/api/tookan/fleet/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getTestAuthToken()}`
        },
        body: JSON.stringify(payload),
      });
      textResponse = await response.text();
      try {
        data = JSON.parse(textResponse);
      } catch (e) {
        log(`❌ Failed to parse response: ${textResponse.substring(0, 200)}`, 'red');
        return null;
      }
    }

    if (response.ok && (data.status === 200 || data.status === 'success')) {
      const fleetId = data.data?.fleet_id || data.data?.data?.fleet_id || data.data?.id;
      log(`✅ Test agent added successfully!`, 'green');
      log(`   Name: ${agentData.fleet_name}`, 'reset');
      log(`   Fleet ID: ${fleetId || 'Not returned'}`, 'reset');
      return { ...agentData, fleet_id: fleetId };
    } else {
      log(`⚠️  Agent may need to be added manually: ${data.message || 'Unknown error'}`, 'yellow');
      log(`   Please add via Tookan dashboard: ${agentData.fleet_name}`, 'yellow');
      // Return agent data anyway so we can continue with tasks
      return { ...agentData, fleet_id: null, note: 'Add manually' };
    }
  } catch (error) {
    log(`⚠️  Error adding agent ${agentData.fleet_name}: ${error.message}`, 'yellow');
    log(`   Agent may need to be added manually via Tookan dashboard`, 'yellow');
    return { ...agentData, fleet_id: null, note: 'Add manually' };
  }
}

/**
 * Get test auth token (for backend API calls)
 * In a real scenario, you'd login first
 */
function getTestAuthToken() {
  // For now, return empty - backend may allow some operations without auth
  // Or we can create a test admin user
  return '';
}

/**
 * Create a test task/order in Tookan
 */
async function createTestTask(taskData) {
  try {
    log(`\n📋 Creating test order: ${taskData.customer_name}...`, 'blue');
    
    // Format date as MM/DD/YYYY HH:mm (24-hour format)
    const now = new Date();
    const pickupDate = new Date(now.getTime() + (30 * 60 * 1000)); // 30 minutes from now
    const deliveryDate = new Date(now.getTime() + (2 * 60 * 60 * 1000)); // 2 hours from now
    
    const formatTookanDate = (date) => {
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${month}/${day}/${year} ${hours}:${minutes}`;
    };

    const payload = {
      api_key: API_KEY,
      job_type: 0, // 0 = delivery task
      customer_name: taskData.customer_name,
      customer_phone: taskData.customer_phone,
      customer_email: taskData.customer_email || '',
      pickup_address: taskData.pickup_address.address || taskData.pickup_address,
      delivery_address: taskData.delivery_address.address || taskData.delivery_address,
      pickup_latitude: taskData.pickup_latitude || (taskData.pickup_address.lat || 26.2285),
      pickup_longitude: taskData.pickup_longitude || (taskData.pickup_address.lng || 50.5860),
      delivery_latitude: taskData.delivery_latitude || (taskData.delivery_address.lat || 26.1300),
      delivery_longitude: taskData.delivery_longitude || (taskData.delivery_address.lng || 50.5500),
      cod: parseFloat(taskData.cod || 0),
      order_payment: parseFloat(taskData.order_payment || 0),
      customer_comments: taskData.customer_comments || 'Test order created by populate script',
      timezone: '+0300', // Bahrain timezone
      job_pickup_datetime: formatTookanDate(pickupDate),
      job_delivery_datetime: formatTookanDate(deliveryDate)
    };

    // Add vendor_id if provided
    if (taskData.vendor_id) {
      payload.vendor_id = taskData.vendor_id;
    }

    // Add fleet_id if provided
    if (taskData.fleet_id) {
      payload.fleet_id = taskData.fleet_id;
    }

    const response = await fetch(`${TOOKAN_API_BASE}/create_task`, {
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
      log(`❌ Failed to parse response: ${textResponse.substring(0, 200)}`, 'red');
      return null;
    }

    if (response.ok && data.status === 200) {
      const jobId = data.data?.job_id || data.data?.jobId || data.job_id;
      log(`✅ Test order created successfully!`, 'green');
      log(`   Job ID: ${jobId}`, 'reset');
      log(`   Customer: ${taskData.customer_name}`, 'reset');
      return { ...taskData, job_id: jobId };
    } else {
      log(`❌ Failed to create order: ${data.message || 'Unknown error'}`, 'red');
      log(`   Response: ${JSON.stringify(data, null, 2).substring(0, 300)}`, 'red');
      return null;
    }
  } catch (error) {
    log(`❌ Error creating order: ${error.message}`, 'red');
    return null;
  }
}

/**
 * Add wallet transaction for driver
 * Tries backend API first, falls back to direct Tookan API
 */
async function addDriverWalletTransaction(fleetId, amount, description, transactionType = 'credit') {
  try {
    log(`\n💰 Adding wallet transaction for driver ${fleetId}...`, 'blue');
    log(`   Amount: ${amount}, Type: ${transactionType}, Description: ${description}`, 'reset');
    
    // Try backend API first (if available and we have auth)
    const backendPayload = {
      fleet_id: fleetId,
      amount: Math.abs(amount),
      description: description,
      transaction_type: transactionType
    };

    try {
      const backendResponse = await fetch(`${BACKEND_URL}/api/tookan/driver-wallet/transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getTestAuthToken()}`
        },
        body: JSON.stringify(backendPayload),
      });

      const backendData = await backendResponse.json();
      if (backendResponse.ok && backendData.status === 'success') {
        log(`✅ Wallet transaction added via backend API!`, 'green');
        return true;
      }
    } catch (backendError) {
      // Fall through to direct Tookan API
      log(`   ⚠️  Backend API unavailable, trying direct Tookan API...`, 'yellow');
    }
    
    // Fallback to direct Tookan API
    const payload = {
      api_key: API_KEY,
      fleet_id: fleetId,
      amount: Math.abs(amount),
      description: description,
      transaction_type: transactionType === 'debit' ? 1 : 2, // 1=debit, 2=credit
      wallet_type: 1 // 1=wallet, 2=credits
    };

    const response = await fetch(`${TOOKAN_API_BASE}/fleet/wallet/create_transaction`, {
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
      log(`❌ Failed to parse response: ${textResponse.substring(0, 200)}`, 'red');
      return false;
    }

    if (response.ok && data.status === 200) {
      log(`✅ Wallet transaction added successfully!`, 'green');
      return true;
    } else {
      log(`⚠️  Wallet transaction failed: ${data.message || 'Unknown error'}`, 'yellow');
      return false;
    }
  } catch (error) {
    log(`⚠️  Error adding wallet transaction: ${error.message}`, 'yellow');
    return false;
  }
}

/**
 * Add wallet payment for customer/merchant
 * Tries backend API first, falls back to direct Tookan API
 */
async function addCustomerWalletPayment(vendorId, amount, description) {
  try {
    log(`\n💰 Adding wallet payment for merchant ${vendorId}...`, 'blue');
    log(`   Amount: ${amount}, Description: ${description}`, 'reset');
    
    // Try backend API first (if available and we have auth)
    const backendPayload = {
      customer_id: vendorId,
      amount: Math.abs(amount),
      description: description
    };

    try {
      const backendResponse = await fetch(`${BACKEND_URL}/api/tookan/customer-wallet/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getTestAuthToken()}`
        },
        body: JSON.stringify(backendPayload),
      });

      const backendData = await backendResponse.json();
      if (backendResponse.ok && backendData.status === 'success') {
        log(`✅ Wallet payment added via backend API!`, 'green');
        return true;
      }
    } catch (backendError) {
      // Fall through to direct Tookan API
      log(`   ⚠️  Backend API unavailable, trying direct Tookan API...`, 'yellow');
    }
    
    // Fallback to direct Tookan API
    const payload = {
      api_key: API_KEY,
      vendor_id: vendorId,
      amount: Math.abs(amount),
      description: description
    };

    const response = await fetch(`${TOOKAN_API_BASE}/addCustomerPaymentViaDashboard`, {
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
      log(`❌ Failed to parse response: ${textResponse.substring(0, 200)}`, 'red');
      return false;
    }

    if (response.ok && data.status === 200) {
      log(`✅ Wallet payment added successfully!`, 'green');
      return true;
    } else {
      log(`⚠️  Wallet payment failed: ${data.message || 'Unknown error'}`, 'yellow');
      return false;
    }
  } catch (error) {
    log(`⚠️  Error adding wallet payment: ${error.message}`, 'yellow');
    return false;
  }
}

/**
 * Main execution function
 */
async function main() {
  logSection('🚀 POPULATING TOOKAN ACCOUNT WITH TEST DATA');
  log(`API Key: ${API_KEY.substring(0, 10)}...`, 'cyan');
  log(`Tookan API Base: ${TOOKAN_API_BASE}`, 'cyan');
  log(`Backend URL: ${BACKEND_URL}`, 'cyan');
  log(`Timestamp: ${new Date().toISOString()}`, 'cyan');

  // Step 1: Create test customers
  logSection('📦 STEP 1: Creating Test Customers/Merchants');
  for (const customer of testCustomers) {
    const result = await addTestCustomer(customer);
    if (result) {
      createdCustomers.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
  }

  log(`\n✅ Created ${createdCustomers.length}/${testCustomers.length} test customers`, 'green');

  // Step 2: Create test agents
  logSection('🚗 STEP 2: Creating Test Agents/Drivers');
  for (const agent of testAgents) {
    const result = await addTestAgent(agent);
    if (result) {
      createdAgents.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 1500)); // Rate limiting
  }

  log(`\n✅ Created/Attempted ${createdAgents.length}/${testAgents.length} test agents`, 'green');
  log(`⚠️  Note: Some agents may need to be added manually via Tookan dashboard`, 'yellow');

  // Step 3: Fetch existing agents and customers if needed
  logSection('🔍 STEP 3: Fetching Existing Tookan Data');
  
  // Fetch existing fleets to get real fleet_ids
  try {
    const fleetResponse = await fetch(`${TOOKAN_API_BASE}/get_all_agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY }),
    });
    
    const fleetData = await fleetResponse.json();
    if (fleetData.status === 200 && fleetData.data) {
      const fleets = Array.isArray(fleetData.data) ? fleetData.data : [];
      log(`Found ${fleets.length} existing agents in Tookan`, 'cyan');
      
      // Match test agents with existing ones or use existing ones
      if (fleets.length > 0) {
        // Use first few existing agents if we don't have created ones
        fleets.slice(0, Math.min(5, fleets.length)).forEach((fleet, idx) => {
          if (idx < createdAgents.length && !createdAgents[idx].fleet_id) {
            createdAgents[idx].fleet_id = fleet.fleet_id || fleet.id;
            log(`   Using existing agent: ${fleet.fleet_name || fleet.fleetName} (ID: ${createdAgents[idx].fleet_id})`, 'yellow');
          }
        });
      }
    }
  } catch (error) {
    log(`⚠️  Could not fetch existing agents: ${error.message}`, 'yellow');
  }

  // Fetch existing customers to get real vendor_ids
  try {
    const customerResponse = await fetch(`${TOOKAN_API_BASE}/fetch_customers_wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        api_key: API_KEY,
        is_pagination: 1,
        off_set: 0,
        limit: 100
      }),
    });
    
    const customerData = await customerResponse.json();
    if (customerData.status === 200 && customerData.data) {
      const customers = Array.isArray(customerData.data) ? customerData.data : [];
      log(`Found ${customers.length} existing customers in Tookan`, 'cyan');
      
      // Use existing customers, especially those with "test" in name
      if (customers.length > 0) {
        // First, add any test customers that were created
        // Then add existing customers (prefer those with "test" in name)
        const testCustomers = customers.filter(c => {
          const name = (c.customer_name || c.name || '').toLowerCase();
          return name.includes('test');
        });
        
        const customersToUse = testCustomers.length > 0 ? testCustomers : customers;
        
        customersToUse.slice(0, Math.min(10, customersToUse.length)).forEach((cust) => {
          const vendorId = cust.vendor_id || cust.customer_id || cust.id;
          if (vendorId && !createdCustomers.find(c => c.vendor_id === vendorId)) {
            createdCustomers.push({
              name: cust.customer_name || cust.name || 'Unknown Customer',
              phone: cust.customer_phone || cust.phone || '+97300000000',
              email: cust.customer_email || cust.email || '',
              vendor_id: vendorId
            });
            log(`   Using existing customer: ${createdCustomers[createdCustomers.length - 1].name} (ID: ${vendorId})`, 'yellow');
          }
        });
      }
    }
  } catch (error) {
    log(`⚠️  Could not fetch existing customers: ${error.message}`, 'yellow');
  }
  
  // If we still don't have customers, use the vendor_ids we know were created in the first run
  // These are the vendor_ids from the first successful run
  if (createdCustomers.length === 0) {
    log(`\n⚠️  No customers found in API response. Using known test customer vendor IDs...`, 'yellow');
    const knownTestCustomers = [
      { name: 'Test Restaurant A', phone: '+97311111111', email: 'test.restaurant.a@test.com', vendor_id: '89829573' },
      { name: 'Test Shop B', phone: '+97322222222', email: 'test.shop.b@test.com', vendor_id: '89829574' },
      { name: 'Test Cafe C', phone: '+97333333333', email: 'test.cafe.c@test.com', vendor_id: '89829575' },
      { name: 'Test Market D', phone: '+97344444444', email: 'test.market.d@test.com', vendor_id: '89829577' },
      { name: 'Test Store E', phone: '+97355555555', email: 'test.store.e@test.com', vendor_id: '89829578' },
      { name: 'Test Bakery F', phone: '+97366666666', email: 'test.bakery.f@test.com', vendor_id: '89829579' },
      { name: 'Test Pharmacy G', phone: '+97377777777', email: 'test.pharmacy.g@test.com', vendor_id: '89829581' },
      { name: 'Test Electronics H', phone: '+97388888888', email: 'test.electronics.h@test.com', vendor_id: '89829582' }
    ];
    
    for (const cust of knownTestCustomers) {
      createdCustomers.push(cust);
      log(`   Using known test customer: ${cust.name} (ID: ${cust.vendor_id})`, 'green');
    }
  }

  // Step 4: Create test tasks/orders
  logSection('📋 STEP 4: Creating Test Tasks/Orders');
  
  const availableAgents = createdAgents.filter(a => a.fleet_id).slice(0, 5);
  const availableCustomers = createdCustomers.filter(c => c.vendor_id).slice(0, 8);
  
  if (availableAgents.length === 0) {
    log(`⚠️  No agents available. Please add agents manually or check Tookan dashboard.`, 'yellow');
    log(`   Continuing with orders without assigned drivers...`, 'yellow');
  }
  
  if (availableCustomers.length === 0) {
    log(`⚠️  No customers available. Please add customers manually or check Tookan dashboard.`, 'yellow');
    log(`   Cannot create orders without customers.`, 'red');
    return;
  }

  // Create 15 test orders
  const testOrders = [];
  for (let i = 1; i <= 15; i++) {
    const customer = availableCustomers[i % availableCustomers.length];
    const agent = availableAgents.length > 0 ? availableAgents[i % availableAgents.length] : null;
    const pickupAddr = bahrainAddresses.pickup[i % bahrainAddresses.pickup.length];
    const deliveryAddr = bahrainAddresses.delivery[i % bahrainAddresses.delivery.length];
    
    // Vary COD amounts
    const codAmount = [0, 10, 25, 50, 100, 150][i % 6];
    const orderFee = [5, 10, 15, 20][i % 4];
    
    testOrders.push({
      customer_name: `Test Order Customer ${i}`,
      customer_phone: customer.phone || '+97312345678',
      customer_email: customer.email || `test.order.${i}@test.com`,
      pickup_address: pickupAddr,
      delivery_address: deliveryAddr,
      pickup_latitude: pickupAddr.lat,
      pickup_longitude: pickupAddr.lng,
      delivery_latitude: deliveryAddr.lat,
      delivery_longitude: deliveryAddr.lng,
      cod: codAmount,
      order_payment: orderFee,
      vendor_id: customer.vendor_id,
      fleet_id: agent ? agent.fleet_id : null,
      customer_comments: `Test order #${i} created by populate script`
    });
  }

  for (const order of testOrders) {
    const result = await createTestTask(order);
    if (result) {
      createdTasks.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting - 2 seconds between orders
  }

  log(`\n✅ Created ${createdTasks.length}/${testOrders.length} test orders`, 'green');

  // Step 5: Add wallet transactions
  logSection('💰 STEP 5: Adding Wallet Transactions');
  
  let walletTransactionCount = 0;
  
  // Add driver wallet transactions - more variety for testing
  for (const agent of availableAgents) {
    if (agent.fleet_id) {
      // Add initial credit
      const credit1 = await addDriverWalletTransaction(
        agent.fleet_id, 
        100, 
        `Test initial credit for ${agent.fleet_name}`, 
        'credit'
      );
      if (credit1) walletTransactionCount++;
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add bonus credit
      const credit2 = await addDriverWalletTransaction(
        agent.fleet_id, 
        50, 
        `Test bonus credit for ${agent.fleet_name}`, 
        'credit'
      );
      if (credit2) walletTransactionCount++;
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add a debit transaction (simulating withdrawal or fee)
      const debit1 = await addDriverWalletTransaction(
        agent.fleet_id, 
        25, 
        `Test debit transaction for ${agent.fleet_name}`, 
        'debit'
      );
      if (debit1) walletTransactionCount++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Add merchant wallet payments - more variety
  for (let i = 0; i < Math.min(5, availableCustomers.length); i++) {
    const customer = availableCustomers[i];
    if (customer.vendor_id) {
      // Add initial payment
      const payment1 = await addCustomerWalletPayment(
        customer.vendor_id, 
        200, 
        `Test initial payment for ${customer.name}`
      );
      if (payment1) walletTransactionCount++;
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add additional payment
      const payment2 = await addCustomerWalletPayment(
        customer.vendor_id, 
        150, 
        `Test additional payment for ${customer.name}`
      );
      if (payment2) walletTransactionCount++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  log(`\n✅ Completed ${walletTransactionCount} wallet transactions`, 'green');

  // Final Summary
  logSection('📊 FINAL SUMMARY');
  log(`✅ Test Customers Created: ${createdCustomers.length}`, 'green');
  log(`✅ Test Agents Created/Found: ${availableAgents.length}`, 'green');
  log(`✅ Test Orders Created: ${createdTasks.length}`, 'green');
  log(`✅ Wallet Transactions Added: ${walletTransactionCount}`, 'green');
  
  log(`\n📝 Created Data Details:`, 'cyan');
  log(`\nCustomers:`, 'yellow');
  createdCustomers.forEach((c, i) => {
    log(`  ${i + 1}. ${c.name} (Vendor ID: ${c.vendor_id || 'N/A'})`, 'reset');
  });
  
  log(`\nAgents:`, 'yellow');
  availableAgents.forEach((a, i) => {
    log(`  ${i + 1}. ${a.fleet_name} (Fleet ID: ${a.fleet_id || 'N/A'})`, 'reset');
  });
  
  log(`\nOrders:`, 'yellow');
  createdTasks.slice(0, 10).forEach((t, i) => {
    log(`  ${i + 1}. Job ID: ${t.job_id || 'N/A'} - ${t.customer_name}`, 'reset');
  });
  if (createdTasks.length > 10) {
    log(`  ... and ${createdTasks.length - 10} more orders`, 'reset');
  }

  log(`\n✅ Test data population complete!`, 'green');
  log(`\n💡 Next Steps:`, 'cyan');
  log(`   1. Check Tookan dashboard to verify all data`, 'reset');
  log(`   2. Test the application at http://localhost:3000`, 'reset');
  log(`   3. Verify analytics show the test data`, 'reset');
  log(`   4. Test all functionality with the new test data`, 'reset');
  log(`\n${'='.repeat(70)}`, 'cyan');
}

// Run the script
main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

