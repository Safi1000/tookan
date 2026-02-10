/**
 * Test script for Admin Token Routes
 * 
 * This script bypasses the Authentication Middleware by mocking the req.user object.
 * It manually tests the controller logic to verify tokens can be created/revoked.
 * 
 * Ideally, this would use supertest + app, but since app is initialized in index.js
 * which starts listening on import, we need to be careful not to trigger EADDRINUSE.
 * A simpler approach is to manually call the model functions or use supertest if app exported cleanly.
 * Since app doesn't export, we'll test the model/controller via direct DB operations.
 */

require('dotenv').config();
const apiTokensModel = require('../db/models/apiTokens');
const { createClient } = require('@supabase/supabase-js');

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m'
};

const log = (msg, color = colors.reset) => console.log(`${color}${msg}${colors.reset}`);

async function runAdminTests() {
    log('\n🚀 Starting Admin Token Logic Tests (Direct Model Access)...\n', colors.blue);

    let tokenId = null;
    let rawToken = null;

    try {
        // Test 1: Create Token
        log('1. Testing createToken (Model)...');
        const tokenData = await apiTokensModel.createToken({
            merchant_id: 'test_admin_merchant',
            name: 'Admin Logic Test Token',
            created_by: 'admin_user'
        });

        if (tokenData && tokenData.raw_token && tokenData.id) {
            log(`   ✅ Token created successfully: ${tokenData.raw_token.substring(0, 10)}...`, colors.green);
            tokenId = tokenData.id;
            rawToken = tokenData.raw_token;
        } else {
            throw new Error('createToken failed to return expected structure');
        }

        // Test 2: List Tokens
        log('\n2. Testing listTokens (Model)...');
        const list = await apiTokensModel.listTokens('test_admin_merchant');

        if (list && list.length > 0) {
            const found = list.find(t => t.id === tokenId);
            if (found) {
                log(`   ✅ Token found in list for merchant`, colors.green);
            } else {
                throw new Error('Created token not found in list');
            }
        } else {
            throw new Error('List tokens returned empty array');
        }

        // Test 3: Authenticate with Token
        log('\n3. Testing validateToken (Model)...');
        const validData = await apiTokensModel.validateToken(rawToken);

        if (validData && validData.merchant_id === 'test_admin_merchant') {
            log(`   ✅ Token validated successfully`, colors.green);
        } else {
            throw new Error('Token validation failed');
        }

        // Test 4: Revoke Token
        log('\n4. Testing revokeToken (Model)...');
        await apiTokensModel.revokeToken(tokenId);

        // Verify revocation
        const revokedCheck = await apiTokensModel.validateToken(rawToken);
        if (revokedCheck === null) {
            log(`   ✅ Token correctly revoked (validate returns null)`, colors.green);
        } else {
            throw new Error('Revoked token still valid!');
        }

    } catch (error) {
        log(`❌ Test Failed: ${error.message}`, colors.red);
        process.exit(1);
    } finally {
        log('\nDone.', colors.blue);
        process.exit(0);
    }
}

runAdminTests();
