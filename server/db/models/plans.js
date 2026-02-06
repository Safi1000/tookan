/**
 * Plans Model
 * 
 * CRUD operations for the plans table.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Create a new plan
 */
async function createPlan(plan) {
    if (!isConfigured()) {
        console.warn('⚠️  Supabase not configured, skipping create plan');
        return null;
    }

    const { data, error } = await supabase
        .from('plans')
        .insert(plan)
        .select()
        .single();

    if (error) {
        console.error('❌ Create plan error:', error.message);
        throw error;
    }

    return data;
}

/**
 * Get all plans
 */
async function getAllPlans() {
    if (!isConfigured()) {
        return [];
    }

    const { data, error } = await supabase
        .from('plans')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('❌ Get all plans error:', error.message);
        return [];
    }

    return data || [];
}

/**
 * Get plan by ID
 */
async function getPlanById(id) {
    if (!isConfigured()) {
        return null;
    }

    const { data, error } = await supabase
        .from('plans')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('❌ Get plan by ID error:', error.message);
        return null;
    }

    return data;
}

/**
 * Update a plan
 */
async function updatePlan(id, updates) {
    if (!isConfigured()) {
        return null;
    }

    const { data, error } = await supabase
        .from('plans')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('❌ Update plan error:', error.message);
        throw error;
    }

    return data;
}

/**
 * Delete a plan
 */
async function deletePlan(id) {
    if (!isConfigured()) {
        return false;
    }

    const { error } = await supabase
        .from('plans')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('❌ Delete plan error:', error.message);
        return false;
    }

    return true;
}

module.exports = {
    createPlan,
    getAllPlans,
    getPlanById,
    updatePlan,
    deletePlan
};
