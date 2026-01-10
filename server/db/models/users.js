/**
 * Users Model
 * 
 * Database operations for users table.
 * Extends Supabase auth.users with additional profile information.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Get user by ID with permissions
 */
async function getUserById(id) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || null;
}

/**
 * Get user by email
 */
async function getUserByEmail(email) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data || null;
}

/**
 * Update user permissions
 */
async function updateUserPermissions(id, permissions) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('users')
    .update({
      permissions: permissions || {},
      updated_at: new Date().toISOString()
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
 * Update user role
 */
async function updateUserRole(id, role) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase
    .from('users')
    .update({
      role: role,
      updated_at: new Date().toISOString()
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
 * Update user profile
 */
async function updateUser(id, userData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const updateData = {
    updated_at: new Date().toISOString()
  };

  if (userData.name !== undefined) {
    updateData.name = userData.name;
  }
  if (userData.email !== undefined) {
    updateData.email = userData.email;
  }
  if (userData.role !== undefined) {
    updateData.role = userData.role;
  }
  if (userData.permissions !== undefined) {
    updateData.permissions = userData.permissions;
  }

  const { data, error } = await supabase
    .from('users')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get all users
 */
async function getAllUsers(filters = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  let query = supabase.from('users').select('*');

  if (filters.role) {
    query = query.eq('role', filters.role);
  }

  if (filters.search) {
    const searchTerm = `%${filters.search}%`;
    query = query.or(`email.ilike.${searchTerm},name.ilike.${searchTerm}`);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Check if user has permission
 */
async function hasPermission(userId, permission) {
  const user = await getUserById(userId);
  if (!user) {
    return false;
  }

  // Admin role has all permissions
  if (user.role === 'admin') {
    return true;
  }

  // Check permissions JSONB field
  const permissions = user.permissions || {};
  return permissions[permission] === true || permissions[permission] === 'true';
}

/**
 * Check if user has role
 */
async function hasRole(userId, role) {
  const user = await getUserById(userId);
  if (!user) {
    return false;
  }

  return user.role === role;
}

/**
 * Get Tookan user by Tookan ID
 */
async function getUserByTookanId(tookanId, userType) {
  if (!isConfigured()) {
    return null;
  }

  try {
    // First try to find by tookan_id column if it exists
    let { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('tookan_id', tookanId.toString())
      .eq('user_type', userType)
      .single();

    if (error && error.message && error.message.includes('tookan_id')) {
      // Column doesn't exist, search in permissions JSONB
      const { data: allUsers, error: allError } = await supabase
        .from('users')
        .select('*');

      if (!allError && allUsers) {
        data = allUsers.find(user => {
          const perms = user.permissions || {};
          return perms.tookan_id === tookanId.toString() && perms.user_type === userType;
        }) || null;
        error = data ? null : { code: 'PGRST116' };
      }
    }

    if (error && error.code !== 'PGRST116') {
      console.warn('Error fetching Tookan user:', error.message);
      return null;
    }

    // Extract password_hash from permissions if stored there
    if (data && data.permissions && data.permissions.password_hash) {
      data.password_hash = data.permissions.password_hash;
    }

    return data || null;
  } catch (error) {
    console.warn('Error in getUserByTookanId:', error.message);
    return null;
  }
}

/**
 * Create or update Tookan user
 */
async function createTookanUser(userData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    // Try to find existing user
    const existing = await getUserByTookanId(userData.tookan_id, userData.user_type);
    
    if (existing) {
      // Update existing user
      const { data, error } = await supabase
        .from('users')
        .update({
          email: userData.email,
          name: userData.name,
          password_hash: userData.password_hash,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    } else {
      // Create new user
      // For Tookan users, use tookan_id as the primary identifier
      // We'll use a generated UUID but store tookan_id separately
      const { v4: uuidv4 } = require('uuid');
      const userId = uuidv4();

      // Try to insert, but if users table doesn't support tookan_id yet, use a workaround
      const insertData = {
        id: userId,
        email: userData.email,
        name: userData.name,
        role: userData.role || 'user',
        permissions: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Add Tookan-specific fields if table supports them (check by trying to insert)
      // Store tookan_id in a JSONB field or separate column if exists
      try {
        const { data, error } = await supabase
          .from('users')
          .insert(insertData)
          .select()
          .single();

        if (error && error.message.includes('tookan_id')) {
          // Table doesn't have tookan_id column, store in permissions JSONB as fallback
          insertData.permissions = {
            tookan_id: userData.tookan_id.toString(),
            user_type: userData.user_type,
            password_hash: userData.password_hash
          };
        } else if (!error) {
          // If insert worked, try to update with Tookan fields
          return data;
        }
      } catch (err) {
        // Fallback: store in permissions
        insertData.permissions = {
          tookan_id: userData.tookan_id.toString(),
          user_type: userData.user_type,
          password_hash: userData.password_hash
        };
      }

      const { data, error } = await supabase
        .from('users')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    }
  } catch (error) {
    console.error('Error creating/updating Tookan user:', error);
    throw error;
  }
}

/**
 * Update user status (enabled/disabled/banned)
 */
async function updateUserStatus(id, status) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const validStatuses = ['active', 'disabled', 'banned'];
  if (!validStatuses.includes(status.toLowerCase())) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  const { data, error } = await supabase
    .from('users')
    .update({
      status: status.toLowerCase(),
      updated_at: new Date().toISOString()
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
 * Create a new user (for Supabase auth users)
 */
async function createUser(userData) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { v4: uuidv4 } = require('uuid');
  const userId = userData.id || uuidv4();

  const insertData = {
    id: userId,
    email: userData.email,
    name: userData.name || userData.email,
    role: userData.role || 'user',
    permissions: userData.permissions || {},
    status: userData.status || 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('users')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Delete a user
 */
async function deleteUser(id) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', id);

  if (error) {
    throw error;
  }

  return true;
}

module.exports = {
  getUserById,
  getUserByEmail,
  updateUserPermissions,
  updateUserRole,
  updateUser,
  updateUserStatus,
  getAllUsers,
  hasPermission,
  hasRole,
  getUserByTookanId,
  createTookanUser,
  createUser,
  deleteUser
};







