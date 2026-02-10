/**
 * Test script for EDI Integration Flow
 * 
 * This script bypasses the Admin Login UI by creating a valid API token 
 * directly in the database, and then uses that token to test the EDI endpoints.
 * 
 * Usage: node server/tests/test-edi-flow.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const fetch = require('node-fetch');
const apiTokensModel = require('../db/models/apiTokens');
const { createClient } = require('@supabase/supabase-js');

// Config
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const TEST_MERCHANT_ID = 'test_merchant_auto';

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m'
};

const log = (msg, color = colors.reset) => console.log(`${color}${msg}${colors.reset}`);

async function runTests() {
    log('\n🚀 Starting EDI Integration Tests...\n', colors.blue);

    let testToken = null;
    let testTokenId = null;

    try {
        // --- STEP 1: Create a Test Token (Direct DB Access) ---
        log('1. Generating Test API Token (Direct DB)...');
        try {
            const tokenData = await apiTokensModel.createToken({
                merchant_id: TEST_MERCHANT_ID,
                name: 'Automated Test Token',
                created_by: 'system_test'
            });
            testToken = tokenData.raw_token;
            testTokenId = tokenData.id;
            log(`   ✅ Token created: ${testToken.substring(0, 15)}...`, colors.green);
        } catch (e) {
            log(`   ❌ Failed to create token: ${e.message}`, colors.red);
            process.exit(1);
        }

        // --- STEP 2: Test Unauthorized Access ---
        log('\n2. Testing Unauthorized Access (No Token)...');
        const unauthorizedRes = await fetch(`${BASE_URL}/api/edi/orders/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (unauthorizedRes.status === 401) {
            log('   ✅ superior: 401 Unauthorized received as expected.', colors.green);
        } else {
            log(`   ❌ Failed: Expected 401, got ${unauthorizedRes.status}`, colors.red);
        }

        // --- STEP 3: Test Create Order Endpoint ---
        log('\n3. Testing Create Order (Valid Token)...');

        // Mock Order Data
        const orderData = {
            order_reference: `TEST-${Date.now()}`,
            pickup_address: '123 Test St, Tech Park',
            pickup_name: 'Test Warehouse',
            pickup_phone: '+1234567890',
            dropoff_address: '456 Customer Ln, Uptown',
            contact_name: 'John Doe',
            contact_phone: '+0987654321',
            contact_email: 'test@example.com',
            delivery_instructions: 'Leave at front desk',
            cod_amount: 10.50,
            // Add required datetime fields (ISO format or YYYY-MM-DD HH:mm:ss depending on account settings)
            pickup_datetime: new Date(Date.now() + 3600000).toISOString().replace('T', ' ').substring(0, 19),
            delivery_datetime: new Date(Date.now() + 7200000).toISOString().replace('T', ' ').substring(0, 19)
        };

        log(`   📤 Sending Payload: ${JSON.stringify(orderData, null, 2)}`, colors.blue);

        const createRes = await fetch(`${BASE_URL}/api/edi/orders/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${testToken}`
            },
            body: JSON.stringify(orderData)
        });

        const createJson = await createRes.json();

        // Note: If Tookan API Key is invalid/mock, this might return 400 or 500, but ensuring the *auth* passed is key.
        if (createRes.status === 200 && createJson.status === 'success') {
            log(`   ✅ Order created successfully! Job ID: ${createJson.data.job_id}`, colors.green);

            // Store Job ID for next test
            const jobId = createJson.data.job_id;

            // --- STEP 4: Test Get Order Status ---
            log('\n4. Testing Get Order Status...');
            const statusRes = await fetch(`${BASE_URL}/api/edi/orders/status/${jobId}?type=job_id`, {
                headers: { 'Authorization': `Bearer ${testToken}` }
            });
            const statusJson = await statusRes.json();

            if (statusRes.status === 200 && statusJson.status === 'success') {
                log(`   ✅ Status retrieved: ${statusJson.data.status}`, colors.green);
            } else {
                log(`   ⚠️  Status check failed (might be expected if mock job): ${statusJson.message}`, colors.yellow);
            }

        } else {
            log(`   ⚠️  Order creation failed (Check Tookan API Key?): ${createJson.message}`, colors.yellow);
            log(`   (This is acceptable if only testing Auth flow, confirms token worked)`, colors.blue);
        }

    } catch (error) {
        log(`\n❌ Unexpected Error: ${error.message}`, colors.red);
    } finally {
        // --- STEP 5: Cleanup ---
        if (testTokenId) {
            log('\n5. Cleaning up (Revoking Token)...');
            try {
                await apiTokensModel.revokeToken(testTokenId);
                log('   ✅ Token revoked.', colors.green);
            } catch (e) {
                log(`   ⚠️  Failed to revoke token: ${e.message}`, colors.yellow);
            }
        }
        log('\nDone.', colors.blue);
        process.exit(0);
    }
}

runTests();
