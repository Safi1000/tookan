const express = require('express');
const router = express.Router();
const apiTokensModel = require('../db/models/apiTokens');

// Middleware to ensure user is admin
// Assumes authentication middleware is already applied upstream or will be applied here
// For now, let's assume `authenticate` is available or check req.user.role
const ensureAdmin = (req, res, next) => {
    // If authenticate middleware populates req.user
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        // Or check if a specific admin secret is provided
        // For now, we'll respond with 403 Forbidden if not admin
        res.status(403).json({ status: 'error', message: 'Admin access required' });
    }
};

/**
 * Generate a new API token
 * Body: { merchant_id, name }
 */
router.post('/create', ensureAdmin, async (req, res) => {
    try {
        const { merchant_id, name } = req.body;

        if (!merchant_id || !name) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields: merchant_id, name' });
        }

        const tokenData = await apiTokensModel.createToken({
            merchant_id,
            name,
            created_by: req.user.id // Assuming current user ID is available
        });

        res.json({
            status: 'success',
            data: {
                id: tokenData.id,
                name: tokenData.name,
                // Only return the raw token once!
                token: tokenData.raw_token,
                prefix: tokenData.prefix,
                created_at: tokenData.created_at
            }
        });
    } catch (error) {
        console.error('Error creating token:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create token' });
    }
});

/**
 * Revoke an API token
 * Body: { token_id }
 */
router.post('/revoke', ensureAdmin, async (req, res) => {
    try {
        const { token_id } = req.body;

        if (!token_id) {
            return res.status(400).json({ status: 'error', message: 'Missing token_id' });
        }

        await apiTokensModel.revokeToken(token_id);

        res.json({ status: 'success', message: 'Token revoked successfully' });
    } catch (error) {
        console.error('Error revoking token:', error);
        res.status(500).json({ status: 'error', message: 'Failed to revoke token' });
    }
});

/**
 * List tokens for a merchant
 * Query: ?merchant_id=...
 */
router.get('/list', ensureAdmin, async (req, res) => {
    try {
        const { merchant_id } = req.query;

        if (!merchant_id) {
            return res.status(400).json({ status: 'error', message: 'Missing merchant_id query parameter' });
        }

        const tokens = await apiTokensModel.listTokens(merchant_id);

        res.json({
            status: 'success',
            data: tokens
        });
    } catch (error) {
        console.error('Error listing tokens:', error);
        res.status(500).json({ status: 'error', message: 'Failed to list tokens' });
    }
});

module.exports = router;
