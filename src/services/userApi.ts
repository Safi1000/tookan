/**
 * User Management API Service
 * 
 * Handles user authentication and management API calls
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

/**
 * Get authorization headers for API requests
 */
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

/**
 * Standard API response format
 */
export interface ApiResponse<T = any> {
  status: 'success' | 'error';
  message: string;
  data: T;
}

/**
 * User account interface
 */
export interface UserAccount {
  id: string;
  name: string;
  email: string;
  permissions: Record<string, boolean> | string[];
  status?: 'Active' | 'Inactive' | 'Banned';
  role?: string;
  lastLogin?: string;
  created_at?: string;
}

/**
 * Fetch all users
 */
export async function fetchAllUsers(filters?: { role?: string; search?: string }): Promise<ApiResponse<{ users: UserAccount[] }>> {
  try {
    const queryParams = new URLSearchParams();
    if (filters?.role) queryParams.append('role', filters.role);
    if (filters?.search) queryParams.append('search', filters.search);

    const response = await fetch(`${API_BASE_URL}/api/users?${queryParams.toString()}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const result = await response.json();
    
    if (response.status === 401) {
      // Redirect to login on 401
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/';
      return { status: 'error', message: 'Unauthorized', data: { users: [] } };
    }

    return result;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { users: [] }
    };
  }
}

/**
 * Create user
 */
export async function createUser(userData: {
  email: string;
  password: string;
  name: string;
  role?: string;
  permissions?: Record<string, boolean>;
}): Promise<ApiResponse<{ user: UserAccount }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(userData),
    });

    const result = await response.json();
    
    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/';
      return { status: 'error', message: 'Unauthorized', data: { user: {} as UserAccount } };
    }

    return result;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { user: {} as UserAccount }
    };
  }
}

/**
 * Update user
 */
export async function updateUser(userId: string, userData: {
  name?: string;
  email?: string;
  role?: string;
  permissions?: Record<string, boolean>;
}): Promise<ApiResponse<{ user: UserAccount }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(userData),
    });

    const result = await response.json();
    
    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/';
      return { status: 'error', message: 'Unauthorized', data: { user: {} as UserAccount } };
    }

    return result;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { user: {} as UserAccount }
    };
  }
}

/**
 * Update user permissions
 */
export async function updateUserPermissions(userId: string, permissions: Record<string, boolean>): Promise<ApiResponse<{ user: UserAccount }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${userId}/permissions`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ permissions }),
    });

    const result = await response.json();
    
    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/';
      return { status: 'error', message: 'Unauthorized', data: { user: {} as UserAccount } };
    }

    return result;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { user: {} as UserAccount }
    };
  }
}

/**
 * Update user role
 */
export async function updateUserRole(userId: string, role: string): Promise<ApiResponse<{ user: UserAccount }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${userId}/role`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ role }),
    });

    const result = await response.json();
    
    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/';
      return { status: 'error', message: 'Unauthorized', data: { user: {} as UserAccount } };
    }

    return result;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { user: {} as UserAccount }
    };
  }
}

/**
 * Delete user
 */
export async function deleteUser(userId: string): Promise<ApiResponse<{ deletedUserId: string }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    const result = await response.json();
    
    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/';
      return { status: 'error', message: 'Unauthorized', data: { deletedUserId: userId } };
    }

    return result;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { deletedUserId: userId }
    };
  }
}

/**
 * Change user password
 */
export async function changeUserPassword(userId: string, newPassword: string): Promise<ApiResponse<{ userId: string }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${userId}/password`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ newPassword }),
    });

    const result = await response.json();
    
    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/';
      return { status: 'error', message: 'Unauthorized', data: { userId } };
    }

    return result;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { userId }
    };
  }
}





