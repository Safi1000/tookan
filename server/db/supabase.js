/**
 * Supabase Database Client
 * 
 * Initializes and exports Supabase client for database operations.
 * Uses service role key for server-side operations (bypasses RLS).
 * Uses anon key for client-side operations (respects RLS).
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Check if Supabase is properly configured
const isSupabaseConfigured = !!(
  supabaseUrl && 
  supabaseServiceKey && 
  supabaseUrl.startsWith('https://') &&
  !supabaseUrl.includes('YOUR_')
);

if (!isSupabaseConfigured) {
  console.warn('⚠️  Supabase not configured - using file-based fallback');
  console.warn('   To enable database, add to .env:');
  console.warn('   SUPABASE_URL=https://your-project.supabase.co');
  console.warn('   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key');
}

// Create Supabase clients only if configured
let supabase = null;
let supabaseAnon = null;

if (isSupabaseConfigured) {
  // Service role client (for server-side operations, bypasses RLS)
  supabase = createClient(
    supabaseUrl,
    supabaseServiceKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  // Anon client (for client-side operations, respects RLS)
  supabaseAnon = createClient(
    supabaseUrl,
    supabaseAnonKey || supabaseServiceKey
  );
}

/**
 * Check if Supabase is properly configured
 */
function isConfigured() {
  return isSupabaseConfigured;
}

/**
 * Test database connection
 */
async function testConnection() {
  if (!isConfigured() || !supabase) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase.from('tasks').select('count').limit(1);
    if (error && error.code !== 'PGRST116') { // PGRST116 = table doesn't exist (expected before migration)
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  supabase,
  supabaseAnon,
  isConfigured,
  testConnection
};











