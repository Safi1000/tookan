/**
 * Merchant Plans Model
 * 
 * Database operations for merchant_plans and merchant_plan_assignments tables.
 * Replaces in-memory merchantPlansStore.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Get all merchant plans
 */
async function getAllPlans() {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('merchant_plans')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get plan by ID
 */
async function getPlanById(id) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('merchant_plans')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || null;
}

/**
 * Create or update plan
 */
async function upsertPlan(planData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const planRecord = {
    name: planData.name,
    description: planData.description || null,
    fee_structure: planData.fee_structure || {},
    is_active: planData.is_active !== undefined ? planData.is_active : true
  };

  let query;
  if (planData.id) {
    // Update existing
    query = supabase
      .from('merchant_plans')
      .update(planRecord)
      .eq('id', planData.id)
      .select()
      .single();
  } else {
    // Insert new
    query = supabase
      .from('merchant_plans')
      .insert(planRecord)
      .select()
      .single();
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Delete plan
 */
async function deletePlan(id) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { error } = await supabase
    .from('merchant_plans')
    .delete()
    .eq('id', id);

  if (error) {
    throw error;
  }

  return true;
}

/**
 * Get plan assignment for merchant
 */
async function getMerchantPlan(merchantId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('merchant_plan_assignments')
    .select(`
      *,
      merchant_plans (*)
    `)
    .eq('merchant_id', merchantId)
    .order('assigned_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || null;
}

/**
 * Assign plan to merchant
 */
async function assignPlan(merchantId, planId, assignedBy = null) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Remove existing assignment
  await supabase
    .from('merchant_plan_assignments')
    .delete()
    .eq('merchant_id', merchantId);

  // Add new assignment
  const { data, error } = await supabase
    .from('merchant_plan_assignments')
    .insert({
      merchant_id: merchantId,
      plan_id: planId,
      assigned_by: assignedBy
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Remove plan assignment from merchant
 */
async function removePlanAssignment(merchantId) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { error } = await supabase
    .from('merchant_plan_assignments')
    .delete()
    .eq('merchant_id', merchantId);

  if (error) {
    throw error;
  }

  return true;
}

/**
 * Get all assignments
 */
async function getAllAssignments() {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('merchant_plan_assignments')
    .select(`
      *,
      merchant_plans (*)
    `);

  if (error) {
    throw error;
  }

  return data || [];
}

module.exports = {
  getAllPlans,
  getPlanById,
  upsertPlan,
  deletePlan,
  getMerchantPlan,
  assignPlan,
  removePlanAssignment,
  getAllAssignments
};











