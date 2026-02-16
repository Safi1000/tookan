/**
 * API Token Management Service
 * 
 * Handles API token CRUD operations for EDI integration
 */

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

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

export interface ApiToken {
    id: string;
    name: string;
    description: string | null;
    prefix: string;
    is_active: boolean;
    merchant_id: string;
    created_by: string | null;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
}

export interface CreateTokenResponse {
    id: string;
    name: string;
    description: string | null;
    token: string; // Raw token, only shown once
    prefix: string;
    created_at: string;
}

/**
 * Create a new API token
 */
export async function createToken(name: string, merchantId: string, description?: string): Promise<{ status: string; data?: CreateTokenResponse; message?: string }> {
    try {
        const response = await fetch(`${API_BASE_URL}/api/tokens/create`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name, merchant_id: merchantId, description: description || '' }),
        });

        if (response.status === 401) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            window.location.href = '/';
            return { status: 'error', message: 'Unauthorized' };
        }

        return await response.json();
    } catch (error: any) {
        return { status: 'error', message: error.message || 'Failed to create token' };
    }
}

/**
 * List all API tokens
 */
export async function listTokens(): Promise<{ status: string; data?: ApiToken[]; message?: string }> {
    try {
        const response = await fetch(`${API_BASE_URL}/api/tokens/list`, {
            method: 'GET',
            headers: getAuthHeaders(),
        });

        if (response.status === 401) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            window.location.href = '/';
            return { status: 'error', message: 'Unauthorized' };
        }

        return await response.json();
    } catch (error: any) {
        return { status: 'error', message: error.message || 'Failed to list tokens' };
    }
}

/**
 * Revoke an API token
 */
export async function revokeToken(tokenId: string): Promise<{ status: string; message?: string }> {
    try {
        const response = await fetch(`${API_BASE_URL}/api/tokens/revoke`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ token_id: tokenId }),
        });

        if (response.status === 401) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            window.location.href = '/';
            return { status: 'error', message: 'Unauthorized' };
        }

        return await response.json();
    } catch (error: any) {
        return { status: 'error', message: error.message || 'Failed to revoke token' };
    }
}
