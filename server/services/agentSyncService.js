/**
 * Agent Sync Service
 * 
 * Fetches agents/fleets from Tookan API and syncs them to Supabase.
 * Auto-syncs on server startup and can be triggered manually.
 */

require('dotenv').config();
const fetch = require('node-fetch');
const { isConfigured } = require('../db/supabase');
const agentModel = require('../db/models/agents');

const TOOKAN_API_BASE = 'https://api.tookanapp.com/v2';

/**
 * Get API key from environment
 */
function getApiKey() {
  const apiKey = process.env.TOOKAN_API_KEY;
  if (!apiKey) {
    throw new Error('TOOKAN_API_KEY not configured in environment variables');
  }
  return apiKey;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all fleets from Tookan API
 */
async function fetchFleetsFromTookan() {
  const apiKey = getApiKey();

  console.log('📡 Fetching fleets from Tookan API...');

  const response = await fetch(`${TOOKAN_API_BASE}/get_all_fleets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey
    }),
  });

  const textResponse = await response.text();
  let data;

  try {
    data = JSON.parse(textResponse);
  } catch (parseError) {
    console.error('❌ Failed to parse Tookan API response:', textResponse.substring(0, 200));
    throw new Error('Tookan API returned invalid JSON');
  }

  if (!response.ok || data.status !== 200) {
    console.error('❌ Tookan API error:', data.message || 'Unknown error');
    throw new Error(data.message || 'Failed to fetch fleets from Tookan');
  }

  const fleets = data.data || [];
  console.log(`✅ Fetched ${fleets.length} fleets from Tookan`);

  return fleets;
}

/**
 * Sync agents from Tookan to Supabase
 */
async function syncAgents() {
  console.log('\n' + '='.repeat(50));
  console.log('🔄 AGENT SYNC');
  console.log('='.repeat(50));
  console.log(`Started at: ${new Date().toISOString()}`);

  if (!isConfigured()) {
    console.log('⚠️  Supabase not configured, skipping agent sync');
    return { success: false, message: 'Supabase not configured', synced: 0, errors: 0 };
  }

  try {
    // Fetch fleets from Tookan
    const fleets = await fetchFleetsFromTookan();

    if (fleets.length === 0) {
      console.log('ℹ️  No fleets to sync');
      return { success: true, message: 'No fleets to sync', synced: 0, errors: 0 };
    }

    // Transform fleets to agent records
    const agents = fleets.map(fleet => agentModel.transformFleetToAgent(fleet));

    console.log(`📥 Upserting ${agents.length} agents to database...`);

    // Bulk upsert to database
    const result = await agentModel.bulkUpsertAgents(agents);

    console.log('='.repeat(50));
    console.log('✅ AGENT SYNC COMPLETED');
    console.log(`   Synced: ${result.inserted}`);
    console.log(`   Errors: ${result.errors}`);
    console.log(`   Completed at: ${new Date().toISOString()}`);
    console.log('='.repeat(50) + '\n');

    return {
      success: true,
      message: 'Agents synced successfully',
      synced: result.inserted,
      errors: result.errors
    };

  } catch (error) {
    console.error('❌ Agent sync failed:', error.message);
    return {
      success: false,
      message: error.message,
      synced: 0,
      errors: 1
    };
  }
}

/**
 * Get sync status
 */
async function getSyncStatus() {
  if (!isConfigured()) {
    return null;
  }

  try {
    const count = await agentModel.getAgentCount();
    const activeCount = await agentModel.getAgentCount({ isActive: true });
    const lastSync = await agentModel.getLastSyncTimestamp();

    return {
      totalAgents: count,
      activeAgents: activeCount,
      lastSyncedAt: lastSync
    };
  } catch (error) {
    console.error('Failed to get agent sync status:', error.message);
    return null;
  }
}

module.exports = {
  syncAgents,
  fetchFleetsFromTookan,
  getSyncStatus
};

