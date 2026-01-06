/**
 * Withdrawal Requests Model
 * 
 * Database operations for withdrawal_requests table.
 * Replaces in-memory withdrawalRequestsStore.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Create withdrawal request
 */
async function createRequest(requestData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const requestRecord = {
    request_type: requestData.type || requestData.request_type,
    customer_id: requestData.customerId || requestData.customer_id || null,
    merchant_id: requestData.merchantId || requestData.merchant_id || null,
    driver_id: requestData.driverId || requestData.driver_id || null,
    vendor_id: requestData.vendor_id || requestData.vendorId || null,
    fleet_id: requestData.fleet_id || requestData.fleetId || null,
    amount: requestData.amount,
    status: 'pending'
  };

  const { data, error } = await supabase
    .from('withdrawal_requests')
    .insert(requestRecord)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get all withdrawal requests with filters
 */
async function getAllRequests(filters = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase.from('withdrawal_requests').select('*');

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  if (filters.customerId) {
    query = query.eq('customer_id', filters.customerId);
  }

  if (filters.merchantId) {
    query = query.eq('merchant_id', filters.merchantId);
  }

  if (filters.driverId) {
    query = query.eq('driver_id', filters.driverId);
  }

  if (filters.requestType) {
    query = query.eq('request_type', filters.requestType);
  }

  query = query.order('requested_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get request by ID
 */
async function getRequestById(id) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || null;
}

/**
 * Approve withdrawal request
 */
async function approveRequest(id, approvedBy) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('withdrawal_requests')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: approvedBy
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Reject withdrawal request
 */
async function rejectRequest(id, rejectedBy, reason = null) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('withdrawal_requests')
    .update({
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      rejected_by: rejectedBy,
      rejection_reason: reason || 'No reason provided'
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

module.exports = {
  createRequest,
  getAllRequests,
  getRequestById,
  approveRequest,
  rejectRequest
};











