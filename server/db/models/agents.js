/**
 * Agents Model
 * 
 * Database operations for agents (fleets/drivers) table.
 * Stores cached Tookan fleet data for fast lookups.
 */

const { supabase, isConfigured } = require('../supabase');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Normalize a name for case-insensitive search
 * - Trim leading/trailing spaces
 * - Replace multiple spaces with single space
 * - Convert to lowercase
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Get agent by fleet_id
 */
async function getAgent(fleetId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('fleet_id', fleetId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = not found
    throw error;
  }

  return data || null;
}

/**
 * Get all agents with optional filters
 */
async function getAllAgents(filters = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase.from('agents').select('*');

  if (filters.isActive !== undefined) {
    query = query.eq('is_active', filters.isActive);
  }

  if (filters.teamId) {
    query = query.eq('team_id', filters.teamId);
  }

  if (filters.search) {
    const searchTerm = `%${filters.search}%`;
    query = query.or(`name.ilike.${searchTerm},email.ilike.${searchTerm},phone.ilike.${searchTerm}`);
  }

  query = query.order('name', { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get active agents only (for driver dropdown)
 */
async function getActiveAgents() {
  return getAllAgents({ isActive: true });
}

/**
 * Create or update agent
 */
async function upsertAgent(fleetId, agentData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const agentRecord = {
    fleet_id: fleetId,
    ...agentData,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('agents')
    .upsert(agentRecord, {
      onConflict: 'fleet_id',
      ignoreDuplicates: false
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Bulk upsert agents
 */
async function bulkUpsertAgents(agents) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  if (agents.length === 0) {
    return { inserted: 0, errors: 0 };
  }

  const now = new Date().toISOString();
  const records = agents.map(agent => ({
    ...agent,
    updated_at: now,
    last_synced_at: now
  }));

  // Process in chunks to avoid payload size limits
  const CHUNK_SIZE = 50;
  const MAX_RETRIES = 3;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    let success = false;

    for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
      try {
        const { data, error } = await supabase
          .from('agents')
          .upsert(chunk, {
            onConflict: 'fleet_id',
            ignoreDuplicates: false
          });

        if (error) {
          const isTransient = error.message.includes('fetch') ||
            error.message.includes('timeout') ||
            error.message.includes('500') ||
            error.message.includes('503');

          if (isTransient && attempt < MAX_RETRIES) {
            console.log(`   ⚠️  Retry ${attempt}/${MAX_RETRIES} for agents chunk due to: ${error.message.substring(0, 80)}`);
            await sleep(500 * attempt);
            continue;
          }

          console.error(`❌ Bulk upsert agents error: ${error.message.substring(0, 120)}`);
          errors += chunk.length;
        } else {
          inserted += chunk.length;
        }
        success = true;
      } catch (err) {
        const isTransient = err.message.includes('fetch') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('timeout');

        if (isTransient && attempt < MAX_RETRIES) {
          console.log(`   ⚠️  Retry ${attempt}/${MAX_RETRIES} for agents chunk due to: ${err.message.substring(0, 80)}`);
          await sleep(500 * attempt);
          continue;
        }

        console.error(`❌ Bulk upsert agents exception: ${err.message.substring(0, 120)}`);
        errors += chunk.length;
        success = true;
      }
    }

    // Small delay between chunks
    await sleep(100);
  }

  return { inserted, errors };
}

/**
 * Update agent
 */
async function updateAgent(fleetId, agentData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('agents')
    .update({
      ...agentData,
      updated_at: new Date().toISOString()
    })
    .eq('fleet_id', fleetId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Delete agent
 */
async function deleteAgent(fleetId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { error } = await supabase
    .from('agents')
    .delete()
    .eq('fleet_id', fleetId);

  if (error) {
    throw error;
  }

  return true;
}

/**
 * Mark agent as inactive (soft delete)
 */
async function deactivateAgent(fleetId) {
  return updateAgent(fleetId, { is_active: false });
}

/**
 * Get agent count
 */
async function getAgentCount(filters = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase.from('agents').select('*', { count: 'exact', head: true });

  if (filters.isActive !== undefined) {
    query = query.eq('is_active', filters.isActive);
  }

  const { count, error } = await query;

  if (error) {
    throw error;
  }

  return count || 0;
}

/**
 * Get last sync timestamp
 */
async function getLastSyncTimestamp() {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('agents')
    .select('last_synced_at')
    .order('last_synced_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data?.last_synced_at || null;
}

/**
 * Transform Tookan fleet data to agent record format
 */
function transformFleetToAgent(fleet) {
  const originalName = fleet.fleet_name || fleet.name || fleet.username || 'Unknown Agent';

  return {
    fleet_id: parseInt(fleet.fleet_id || fleet.id),
    name: originalName,
    normalized_name: normalizeName(originalName),
    email: fleet.email || null,
    phone: fleet.phone || fleet.fleet_phone || null,
    username: fleet.username || null,
    status: parseInt(fleet.status) || 1,
    is_active: fleet.is_active !== false && fleet.status !== 0,
    team_id: fleet.team_id ? parseInt(fleet.team_id) : null,
    team_name: fleet.team_name || null,
    tags: normalizeTags(fleet.tags),
    latitude: fleet.latitude ? parseFloat(fleet.latitude) : null,
    longitude: fleet.longitude ? parseFloat(fleet.longitude) : null,
    battery_level: fleet.battery_level ? parseInt(fleet.battery_level) : null,
    registration_status: fleet.registration_status ? parseInt(fleet.registration_status) : null,
    transport_type: fleet.transport_type ? parseInt(fleet.transport_type) : null,
    transport_desc: fleet.transport_desc || null,
    license: fleet.license || null,
    color: fleet.color || null,
    raw_data: fleet
  };
}

/**
 * Record a payment to an agent (updates total_paid and balance)
 * @param {number} fleetId - The fleet ID of the agent
 * @param {number} paymentAmount - The amount being paid
 * @param {number} codTotal - The current COD total for the agent (optional, for balance calculation)
 * @returns {object} Updated agent record
 */
async function recordAgentPayment(fleetId, paymentAmount, codTotal = null) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  // First, get the current agent data
  const agent = await getAgent(fleetId);
  if (!agent) {
    throw new Error(`Agent with fleet_id ${fleetId} not found`);
  }

  const currentPaid = parseFloat(agent.total_paid || 0);
  const newTotalPaid = currentPaid + parseFloat(paymentAmount);

  // Calculate new balance if codTotal is provided
  // Balance = COD Total - Total Paid
  let newBalance = parseFloat(agent.balance || 0);
  if (codTotal !== null) {
    newBalance = parseFloat(codTotal) - newTotalPaid;
  } else {
    // If no codTotal provided, just subtract the payment from current balance
    newBalance = newBalance - parseFloat(paymentAmount);
  }

  const { data, error } = await supabase
    .from('agents')
    .update({
      total_paid: newTotalPaid,
      balance: newBalance,
      updated_at: new Date().toISOString()
    })
    .eq('fleet_id', fleetId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Update agent balance (recalculate from COD total)
 * @param {number} fleetId - The fleet ID of the agent
 * @param {number} codTotal - The total COD amount for the agent
 * @returns {object} Updated agent record
 */
async function updateAgentBalance(fleetId, codTotal) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Get the current agent data
  const agent = await getAgent(fleetId);
  if (!agent) {
    throw new Error(`Agent with fleet_id ${fleetId} not found`);
  }

  const totalPaid = parseFloat(agent.total_paid || 0);
  const newBalance = parseFloat(codTotal) - totalPaid;

  const { data, error } = await supabase
    .from('agents')
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString()
    })
    .eq('fleet_id', fleetId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get agent payment summary
 * @param {number} fleetId - The fleet ID of the agent
 * @returns {object} Payment summary with total_paid and balance
 */
async function getAgentPaymentSummary(fleetId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('agents')
    .select('fleet_id, name, total_paid, balance')
    .eq('fleet_id', fleetId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data ? {
    fleetId: data.fleet_id,
    name: data.name,
    totalPaid: parseFloat(data.total_paid || 0),
    balance: parseFloat(data.balance || 0)
  } : null;
}

module.exports = {
  getAgent,
  getAllAgents,
  getActiveAgents,
  upsertAgent,
  bulkUpsertAgents,
  updateAgent,
  deleteAgent,
  deactivateAgent,
  getAgentCount,
  getLastSyncTimestamp,
  transformFleetToAgent,
  recordAgentPayment,
  updateAgentBalance,
  getAgentPaymentSummary
};

