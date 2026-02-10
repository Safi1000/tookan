const { supabase } = require('../supabase');
const crypto = require('crypto');

/**
 * Generate a secure API token
 * Returns { token, hash, prefix }
 * - token: The raw token to show to user (only once)
 * - hash: The hashed version to store in DB
 * - prefix: The first few chars for identification
 */
function generateToken() {
    const rawToken = 'edi_' + crypto.randomBytes(32).toString('hex');
    const prefix = rawToken.substring(0, 8);
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    return { token: rawToken, hash, prefix };
}

/**
 * Create a new API token
 */
async function createToken({ merchant_id, name, created_by }) {
    const { token, hash, prefix } = generateToken();

    const { data, error } = await supabase
        .from('api_tokens')
        .insert({
            merchant_id,
            name,
            token_hash: hash,
            prefix,
            created_by,
            is_active: true
        })
        .select()
        .single();

    if (error) throw error;

    // Return the raw token ONLY here. It can never be retrieved again.
    return { ...data, raw_token: token };
}

/**
 * Validate an API token
 */
async function validateToken(rawToken) {
    if (!rawToken || !rawToken.startsWith('edi_')) return null;

    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const { data, error } = await supabase
        .from('api_tokens')
        .select('*')
        .eq('token_hash', hash)
        .eq('is_active', true)
        .single();

    if (error || !data) return null;

    // Update last used timestamp (fire and forget)
    supabase
        .from('api_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', data.id)
        .then(() => { });

    return data;
}

/**
 * Revoke a token
 */
async function revokeToken(id) {
    const { data, error } = await supabase
        .from('api_tokens')
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq('id', id)
        .select();

    if (error) throw error;
    return data;
}

/**
 * List tokens for a merchant
 */
async function listTokens(merchant_id) {
    const { data, error } = await supabase
        .from('api_tokens')
        .select('id, name, prefix, created_at, last_used_at, is_active')
        .eq('merchant_id', merchant_id)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

module.exports = {
    createToken,
    validateToken,
    revokeToken,
    listTokens
};
