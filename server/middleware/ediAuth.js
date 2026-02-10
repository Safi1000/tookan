const apiTokens = require('../db/models/apiTokens');

/**
 * Middleware to validate incoming API tokens for EDI requests
 * Expects 'Authorization: Bearer <token>'
 */
async function validateEdiToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ status: 'error', message: 'Missing Authorization header' });
        }

        const token = authHeader.replace('Bearer ', '');
        const tokenData = await apiTokens.validateToken(token);

        if (!tokenData) {
            return res.status(401).json({ status: 'error', message: 'Invalid or revoked API token' });
        }

        // Attach merchant info to request for downstream use
        req.merchant = {
            id: tokenData.merchant_id,
            token_name: tokenData.name
        };

        next();
    } catch (error) {
        console.error('Token validation error:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error during authentication' });
    }
}

module.exports = { validateEdiToken };
