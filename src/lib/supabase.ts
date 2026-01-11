import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create client only if both URL and key are provided
let supabaseInstance: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnonKey) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
} else {
    console.warn('Supabase not configured: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY required');
}

export const supabase = supabaseInstance;
export const isSupabaseConfigured = () => !!supabaseInstance;
