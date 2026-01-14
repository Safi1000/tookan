/**
 * Customer Sync Service
 * 
 * Fetches customers from Tookan API and syncs them to Supabase.
 * Uses get_all_customers for IDs, then view_customer_profile for details.
 */

require('dotenv').config();
const fetch = require('node-fetch');
const { isConfigured } = require('../db/supabase');
const customerModel = require('../db/models/customers');

const TOOKAN_API_BASE = 'https://api.tookanapp.com/v2';

/**
 * Get API key from environment
 */
function getApiKey() {
    const apiKey = process.env.TOOKAN_API_KEY;
    if (!apiKey) {
        throw new Error('TOOKAN_API_KEY not configured');
    }
    return apiKey;
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all customer IDs from Tookan API using pagination
 * Uses requested_page instead of offset
 */
async function fetchAllCustomerIds() {
    const apiKey = getApiKey();
    const allCustomerIds = [];
    let page = 1;
    let totalPages = 1;

    console.log('📥 Fetching customer IDs from Tookan API...');

    do {
        try {
            const response = await fetch(`${TOOKAN_API_BASE}/get_all_customers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: apiKey,
                    is_pagination: 1,
                    requested_page: page
                }),
                timeout: 30000
            });

            const data = await response.json();

            if (data.status === 200 && Array.isArray(data.data)) {
                // Get total pages on first request
                if (page === 1 && data.total_page_count) {
                    totalPages = parseInt(data.total_page_count) || 1;
                    console.log(`   Total pages: ${totalPages}`);
                }

                const customers = data.data;
                for (const c of customers) {
                    if (c.customer_id) {
                        allCustomerIds.push(c.customer_id);
                    }
                }

                console.log(`   Page ${page}/${totalPages}: ${customers.length} customers`);
                page++;
                await sleep(200); // Rate limiting delay
            } else if (data.message && data.message.includes('No customer')) {
                break;
            } else {
                console.warn('⚠️  Tookan API response:', data.message || 'Unknown error');
                break;
            }
        } catch (error) {
            console.error('❌ Tookan API error:', error.message);
            break;
        }
    } while (page <= totalPages);

    console.log(`✅ Total customer IDs fetched: ${allCustomerIds.length}`);
    return allCustomerIds;
}

/**
 * Fetch customer profile details using view_customer_profile API
 * Response format: { data: { cust_details: [{ customer_id, customer_username, customer_phone, customer_email, customer_address, ... }] } }
 */
async function fetchCustomerProfile(customerId) {
    const apiKey = getApiKey();

    try {
        const response = await fetch(`${TOOKAN_API_BASE}/view_customer_profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: apiKey,
                customer_id: customerId
            }),
            timeout: 15000
        });

        const data = await response.json();

        // API returns data.cust_details array
        if (data.status === 200 && data.data && data.data.cust_details && data.data.cust_details.length > 0) {
            return data.data.cust_details[0];
        } else {
            console.warn(`   No profile data for customer ${customerId}`);
            return null;
        }
    } catch (error) {
        console.error(`❌ Error fetching customer ${customerId}:`, error.message);
        return null;
    }
}

/**
 * Sync all customers from Tookan to Supabase
 * @param {Object} options Options for sync
 * @param {boolean} options.ifEmptyOnly Only sync if database table is empty
 */
async function syncAllCustomers(options = {}) {
    const { ifEmptyOnly = false } = options;

    console.log('\n' + '='.repeat(50));
    console.log('🔄 CUSTOMER SYNC');
    console.log('='.repeat(50));
    console.log(`Started at: ${new Date().toISOString()}`);

    if (!isConfigured()) {
        console.error('❌ Supabase not configured. Aborting sync.');
        return { success: false, message: 'Supabase not configured' };
    }

    try {
        // If ifEmptyOnly is true, check if table already has data
        if (ifEmptyOnly) {
            const count = await customerModel.getCustomerCount();
            if (count > 0) {
                console.log(`ℹ️  Database already has ${count} customers. Skipping auto-sync.`);
                console.log('='.repeat(50) + '\n');
                return { success: true, message: 'Table not empty, skipping', synced: 0 };
            }
        }
        // Step 1: Fetch all customer IDs
        const customerIds = await fetchAllCustomerIds();

        if (customerIds.length === 0) {
            console.log('ℹ️  No customers found in Tookan');
            return { success: true, synced: 0 };
        }

        // Step 2: Fetch details for each customer and upsert
        console.log(`\n📥 Fetching details for ${customerIds.length} customers...`);

        let synced = 0;
        let errors = 0;
        const batchSize = 50; // Process in batches for bulk upsert

        for (let i = 0; i < customerIds.length; i += batchSize) {
            const batchIds = customerIds.slice(i, i + batchSize);
            const customers = [];

            for (const customerId of batchIds) {
                const profile = await fetchCustomerProfile(customerId);
                if (profile) {
                    // Map fields from view_customer_profile response
                    customers.push({
                        vendor_id: profile.customer_id,
                        customer_name: profile.customer_username || profile.first_name || null,
                        customer_phone: profile.customer_phone || profile.phone_no || null,
                        customer_email: profile.customer_email || profile.email || null,
                        customer_address: profile.customer_address || profile.address || null
                    });
                }
                await sleep(100); // Rate limit between profile fetches
            }

            if (customers.length > 0) {
                const result = await customerModel.bulkUpsertCustomers(customers);
                synced += result.inserted;
                errors += result.errors;
            }

            console.log(`   Processed ${Math.min(i + batchSize, customerIds.length)}/${customerIds.length} customers`);
        }

        console.log('='.repeat(50));
        console.log('✅ SYNC COMPLETED');
        console.log(`   Synced: ${synced}`);
        console.log(`   Errors: ${errors}`);
        console.log(`   Completed at: ${new Date().toISOString()}`);
        console.log('='.repeat(50) + '\n');

        return {
            success: true,
            synced,
            errors
        };
    } catch (error) {
        console.error('❌ Customer sync failed:', error.message);
        return { success: false, message: error.message };
    }
}

/**
 * Handle customer webhook event
 */
async function handleCustomerWebhook(payload) {
    const eventType = (payload.event_type || payload.type || '').toLowerCase();
    const vendorId = payload.vendor_id || payload.customer_id || payload.id;

    console.log(`📬 Customer webhook: ${eventType}, vendor_id: ${vendorId}`);

    if (!vendorId) {
        console.warn('⚠️  Webhook missing vendor_id');
        return { success: false, message: 'Missing vendor_id' };
    }

    try {
        if (eventType.includes('delete') || eventType.includes('removed')) {
            // Delete customer
            const deleted = await customerModel.deleteCustomer(vendorId);
            console.log(`   ${deleted ? '✅ Deleted' : '⚠️  Not found'}: vendor_id ${vendorId}`);
            return { success: true, action: 'deleted' };
        } else {
            // For add/update, fetch fresh data from Tookan
            const profile = await fetchCustomerProfile(vendorId);

            if (profile) {
                const customer = await customerModel.upsertCustomer({
                    vendor_id: profile.customer_id,
                    customer_name: profile.customer_username || profile.first_name || null,
                    customer_phone: profile.customer_phone || profile.phone_no || null,
                    customer_email: profile.customer_email || profile.email || null,
                    customer_address: profile.customer_address || profile.address || null
                });
                console.log(`   ✅ Upserted: vendor_id ${vendorId}`);
                return { success: true, action: 'upserted', data: customer };
            } else {
                // Fallback to webhook payload
                const customer = await customerModel.upsertCustomer(payload);
                console.log(`   ✅ Upserted (from payload): vendor_id ${vendorId}`);
                return { success: true, action: 'upserted', data: customer };
            }
        }
    } catch (error) {
        console.error('❌ Webhook handler error:', error.message);
        return { success: false, message: error.message };
    }
}

module.exports = {
    fetchAllCustomerIds,
    fetchCustomerProfile,
    syncAllCustomers,
    handleCustomerWebhook
};
