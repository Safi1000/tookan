/**
 * Sync Tookan Agents Script
 * 
 * Deletes all existing agents and re-fetches them from Tookan API.
 * Stores original name and creates normalized_name for search.
 * 
 * Usage: node sync-tookan-agents.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const TOOKAN_API_KEY = process.env.TOOKAN_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TOOKAN_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing required environment variables');
    console.error('Required: TOOKAN_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
 * Transform Tookan fleet data to agent record
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
        tags: Array.isArray(fleet.tags) ? fleet.tags :
            (typeof fleet.tags === 'string' ? fleet.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
        latitude: fleet.latitude ? parseFloat(fleet.latitude) : null,
        longitude: fleet.longitude ? parseFloat(fleet.longitude) : null,
        battery_level: fleet.battery_level ? parseInt(fleet.battery_level) : null,
        registration_status: fleet.registration_status ? parseInt(fleet.registration_status) : null,
        transport_type: fleet.transport_type ? parseInt(fleet.transport_type) : null,
        transport_desc: fleet.transport_desc || null,
        license: fleet.license || null,
        color: fleet.color || null,
        raw_data: fleet,
        last_synced_at: new Date().toISOString()
    };
}

/**
 * Fetch all agents from Tookan API
 */
async function fetchAllAgentsFromTookan() {
    console.log('📡 Fetching agents from Tookan API...');

    try {
        const response = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: TOOKAN_API_KEY
            })
        });

        const data = await response.json();

        if (data.status !== 200) {
            console.error('❌ Tookan API error:', data.message);
            return [];
        }

        const fleets = data.data || [];
        console.log(`   ✅ Fetched ${fleets.length} agents`);
        return fleets;
    } catch (error) {
        console.error('❌ Fetch error:', error.message);
        return [];
    }
}

/**
 * Main sync function
 */
async function syncAgents() {
    console.log('\n🔄 Starting Agent Sync...\n');

    // Step 1: Delete all existing agents
    console.log('🗑️  Deleting all existing agents...');
    const { error: deleteError } = await supabase
        .from('agents')
        .delete()
        .neq('fleet_id', -999999); // Delete all (workaround for no "delete all" method)

    if (deleteError) {
        console.error('❌ Delete error:', deleteError.message);
        return;
    }
    console.log('✅ All existing agents deleted\n');

    // Step 2: Fetch all agents from Tookan
    const fleets = await fetchAllAgentsFromTookan();
    console.log(`\n📥 Total agents fetched: ${fleets.length}\n`);

    if (fleets.length === 0) {
        console.log('⚠️  No agents found in Tookan API');
        return;
    }

    // Step 3: Transform and insert agents
    console.log('📤 Inserting agents into Supabase...');
    const agents = fleets.map(transformFleetToAgent);

    // Insert in chunks
    const CHUNK_SIZE = 50;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < agents.length; i += CHUNK_SIZE) {
        const chunk = agents.slice(i, i + CHUNK_SIZE);

        const { error } = await supabase
            .from('agents')
            .upsert(chunk, { onConflict: 'fleet_id' });

        if (error) {
            console.error(`   ❌ Chunk ${Math.floor(i / CHUNK_SIZE) + 1} error:`, error.message);
            errors += chunk.length;
        } else {
            inserted += chunk.length;
            console.log(`   ✅ Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${chunk.length} agents inserted`);
        }

        // Small delay between chunks
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n✅ Sync complete!`);
    console.log(`   Inserted: ${inserted}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Total: ${agents.length}\n`);

    // Show sample of normalized names
    console.log('📋 Sample agents with normalized names:');
    agents.slice(0, 5).forEach(a => {
        console.log(`   "${a.name}" → "${a.normalized_name}"`);
    });
}

syncAgents().catch(console.error);
