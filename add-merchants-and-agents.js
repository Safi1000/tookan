/**
 * Script to add Merchants and Agents to Tookan account via API
 * 
 * Usage:
 *   node add-merchants-and-agents.js
 * 
 * Environment Variables Required:
 *   TOOKAN_API_KEY - Your Tookan API key
 */

require('dotenv').config();
const fetch = require('node-fetch');

const API_KEY = process.env.TOOKAN_API_KEY;
const TOOKAN_API_BASE = 'https://api.tookanapp.com/v2';

if (!API_KEY) {
  console.error('❌ Error: TOOKAN_API_KEY not found in environment variables');
  console.error('Please set TOOKAN_API_KEY in your .env file');
  process.exit(1);
}

// Sample merchants to add
// Note: Tookan customer/add API requires: api_key, user_type: 0, name, phone
const merchantsToAdd = [
  {
    name: 'Restaurant A',
    phone: '+97312345678'
  },
  {
    name: 'Shop B',
    phone: '+97323456789'
  },
  {
    name: 'Cafe C',
    phone: '+97334567890'
  }
];

// Sample agents to add
const agentsToAdd = [
  {
    fleet_name: 'Ahmed K.',
    fleet_phone: '+97311111111',
    fleet_email: 'ahmed.k@example.com',
    fleet_password: 'TempPass123!',
    fleet_type: 1 // 1 = Delivery Agent
  },
  {
    fleet_name: 'Mohammed S.',
    fleet_phone: '+97322222222',
    fleet_email: 'mohammed.s@example.com',
    fleet_password: 'TempPass123!',
    fleet_type: 1
  },
  {
    fleet_name: 'Fatima A.',
    fleet_phone: '+97333333333',
    fleet_email: 'fatima.a@example.com',
    fleet_password: 'TempPass123!',
    fleet_type: 1
  },
  {
    fleet_name: 'Ali H.',
    fleet_phone: '+97344444444',
    fleet_email: 'ali.h@example.com',
    fleet_password: 'TempPass123!',
    fleet_type: 1
  }
];

/**
 * Add a merchant (customer) to Tookan
 */
async function addMerchant(merchantData) {
  try {
    console.log(`\n📦 Adding merchant: ${merchantData.name}...`);
    
    // Tookan customer/add API requires: api_key, user_type: 0, name, phone
    const payload = {
      api_key: API_KEY,
      user_type: 0, // Required: 0 for customer/merchant
      name: merchantData.name.trim(),
      phone: merchantData.phone.trim()
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
      console.error(`❌ Failed to parse response: ${textResponse.substring(0, 200)}`);
      return null;
    }

    if (data.status === 200) {
      const vendorId = data.data?.vendor_id || data.data?.data?.vendor_id || data.data?.customer_id || data.data?.id;
      console.log(`✅ Merchant added successfully!`);
      console.log(`   Name: ${merchantData.name}`);
      console.log(`   Phone: ${merchantData.phone}`);
      console.log(`   Vendor ID: ${vendorId || 'Not returned'}`);
      console.log(`   Full Response:`, JSON.stringify(data, null, 2));
      return { ...merchantData, vendor_id: vendorId };
    } else {
      console.error(`❌ Failed to add merchant: ${data.message || 'Unknown error'}`);
      console.error(`   Response:`, JSON.stringify(data, null, 2));
      return null;
    }
  } catch (error) {
    console.error(`❌ Error adding merchant ${merchantData.name}:`, error.message);
    return null;
  }
}

/**
 * Add an agent (fleet/driver) to Tookan
 * Note: Tookan may not have a direct fleet/add endpoint via API
 * Agents may need to be added via dashboard or use a different endpoint
 */
async function addAgent(agentData) {
  try {
    console.log(`\n🚗 Adding agent: ${agentData.fleet_name}...`);
    console.log(`   ⚠️  Note: Tookan may not support adding agents via API.`);
    console.log(`   Please add agents manually via Tookan dashboard: Agents > Add Agent`);
    console.log(`   Or check Tookan API documentation for the correct endpoint.`);
    
    // Try using backend endpoint if available
    const BACKEND_URL = process.env.VITE_API_BASE_URL || 'http://localhost:3001';
    // Backend accepts both formats, but prefers fleet_* format
    const payload = {
      fleet_name: agentData.fleet_name,
      fleet_phone: agentData.fleet_phone,
      fleet_email: agentData.fleet_email,
      fleet_password: agentData.fleet_password,
      fleet_type: agentData.fleet_type || 1,
      // Also send as name/phone for compatibility
      name: agentData.fleet_name,
      phone: agentData.fleet_phone,
      email: agentData.fleet_email,
      password: agentData.fleet_password
    };

    console.log(`   Attempting via backend endpoint: ${BACKEND_URL}/api/tookan/fleet/add`);
    const response = await fetch(`${BACKEND_URL}/api/tookan/fleet/add`, {
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

    if (data.status === 'success' || data.status === 200) {
      const fleetId = data.data?.fleet_id || data.data?.data?.fleet_id || data.data?.id;
      console.log(`✅ Agent added successfully!`);
      console.log(`   Name: ${agentData.fleet_name}`);
      console.log(`   Phone: ${agentData.fleet_phone}`);
      console.log(`   Fleet ID: ${fleetId || 'Not returned'}`);
      return { ...agentData, fleet_id: fleetId };
    } else {
      console.error(`❌ Failed to add agent: ${data.message || 'Unknown error'}`);
      console.error(`   Response:`, JSON.stringify(data, null, 2));
      console.error(`   ⚠️  Agents may need to be added manually via Tookan dashboard.`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error adding agent ${agentData.fleet_name}:`, error.message);
    console.error(`   ⚠️  Agents may need to be added manually via Tookan dashboard.`);
    return null;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('TOOKAN MERCHANTS & AGENTS SETUP SCRIPT');
  console.log('='.repeat(60));
  console.log(`API Key: ${API_KEY.substring(0, 10)}...`);
  console.log(`Tookan API Base: ${TOOKAN_API_BASE}`);
  console.log('='.repeat(60));

  const successfulMerchants = [];
  const successfulAgents = [];

  // Add merchants
  console.log('\n📦 ADDING MERCHANTS');
  console.log('-'.repeat(60));
  for (const merchant of merchantsToAdd) {
    const result = await addMerchant(merchant);
    if (result) {
      successfulMerchants.push(result);
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Add agents
  console.log('\n🚗 ADDING AGENTS');
  console.log('-'.repeat(60));
  for (const agent of agentsToAdd) {
    const result = await addAgent(agent);
    if (result) {
      successfulAgents.push(result);
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Merchants added: ${successfulMerchants.length}/${merchantsToAdd.length}`);
  console.log(`✅ Agents added: ${successfulAgents.length}/${agentsToAdd.length}`);
  
  if (successfulMerchants.length > 0) {
    console.log('\nMerchants:');
    successfulMerchants.forEach(m => {
      console.log(`  - ${m.customer_name} (Vendor ID: ${m.vendor_id || 'N/A'})`);
    });
  }

  if (successfulAgents.length > 0) {
    console.log('\nAgents:');
    successfulAgents.forEach(a => {
      console.log(`  - ${a.fleet_name} (Fleet ID: ${a.fleet_id || 'N/A'})`);
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Setup complete!');
  console.log('='.repeat(60));
}

// Run the script
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

