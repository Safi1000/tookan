#!/usr/bin/env node

/**
 * Sync Merchants Script
 * 
 * Fetches merchants from Tookan's viewCustomersWithPagination API
 * and upserts them into the Supabase merchants table.
 * Maps vendor_id -> merchant_id.
 * 
 * Usage:
 *   node sync-merchants.js          # Sync all merchants
 *   node sync-merchants.js --status # Show current merchant count
 */

require('dotenv').config();

const { supabase, isConfigured } = require('./server/db/supabase');

const args = process.argv.slice(2);
const showStatus = args.includes('--status') || args.includes('-s');

const TOOKAN_API_KEY = process.env.TOOKAN_API_KEY;
const LIMIT = 50;

async function showMerchantStatus() {
    console.log('\n📊 MERCHANT STATUS');
    console.log('='.repeat(40));

    if (!isConfigured()) {
        console.log('❌ Supabase not configured');
        return;
    }

    const { count } = await supabase
        .from('merchants')
        .select('*', { count: 'exact', head: true });

    const { count: blockedCount } = await supabase
        .from('merchants')
        .select('*', { count: 'exact', head: true })
        .eq('is_blocked', 1);

    console.log(`Total merchants: ${count || 0}`);
    console.log(`Blocked: ${blockedCount || 0}`);
    console.log('='.repeat(40));
}

async function syncMerchants() {
    console.log('\n🚀 MERCHANT SYNC');
    console.log('='.repeat(40));

    if (!TOOKAN_API_KEY) {
        console.error('❌ TOOKAN_API_KEY not found in .env');
        process.exit(1);
    }

    if (!isConfigured()) {
        console.error('❌ Supabase not configured');
        process.exit(1);
    }

    console.log(`✅ Tookan API Key: ${TOOKAN_API_KEY.substring(0, 10)}...`);
    console.log(`✅ Supabase URL: ${process.env.SUPABASE_URL}`);
    console.log('='.repeat(40));

    // Fetch all merchants with pagination
    let offset = 0;
    let allMerchants = [];
    let totalCount = 0;

    console.log('\n📋 Fetching merchants from Tookan...');

    while (true) {
        try {
            const response = await fetch('https://api.tookanapp.com/v2/viewCustomersWithPagination', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: TOOKAN_API_KEY,
                    userType: 1,
                    limit: LIMIT,
                    offset
                })
            });

            const data = await response.json();

            if (data.status !== 200 || !data.data?.customerData) {
                if (allMerchants.length === 0) {
                    console.error('❌ Tookan API error:', data.message || 'Unknown error');
                    process.exit(1);
                }
                break;
            }

            totalCount = data.data.customerCount || 0;
            allMerchants = allMerchants.concat(data.data.customerData);
            console.log(`   Fetched ${allMerchants.length}/${totalCount}`);

            if (allMerchants.length >= totalCount || data.data.customerData.length < LIMIT) {
                break;
            }
            offset += LIMIT;
        } catch (err) {
            console.error(`❌ Fetch error at offset ${offset}:`, err.message);
            if (allMerchants.length === 0) process.exit(1);
            break;
        }
    }

    console.log(`\n✅ Fetched ${allMerchants.length} merchants total`);

    // Upsert to Supabase
    let upserted = 0;
    let errors = 0;

    console.log('\n📤 Upserting to Supabase...');

    for (const m of allMerchants) {
        const row = {
            customer_id: m.customer_id,
            customer_username: m.customer_username || null,
            customer_phone: m.customer_phone || null,
            customer_email: m.customer_email || null,
            customer_address: m.customer_address || null,
            company: m.company || null,
            description: m.description || null,
            customer_latitude: m.customer_latitude || null,
            customer_longitude: m.customer_longitude || null,
            creation_datetime: m.creation_datetime || null,
            merchant_id: m.vendor_id, // vendor_id -> merchant_id
            tags: m.tags || null,
            registration_status: m.registration_status || 1,
            is_blocked: m.is_blocked || 0,
            vendor_image: m.vendor_image || null,
            source: m.source || null,
            is_form_user: m.is_form_user || false,
            synced_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from('merchants')
            .upsert(row, { onConflict: 'customer_id' });

        if (error) {
            console.error(`   ❌ customer_id ${m.customer_id}: ${error.message}`);
            errors++;
        } else {
            upserted++;
        }
    }

    console.log('\n' + '='.repeat(40));
    console.log('✅ MERCHANT SYNC COMPLETE');
    console.log(`   Total from Tookan: ${totalCount}`);
    console.log(`   Upserted: ${upserted}`);
    console.log(`   Errors: ${errors}`);
    console.log('='.repeat(40) + '\n');
}

// Run
if (showStatus) {
    showMerchantStatus().then(() => process.exit(0));
} else {
    syncMerchants().then(() => process.exit(0));
}
