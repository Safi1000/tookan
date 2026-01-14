/**
 * Customers Model
 * 
 * CRUD operations for the customers table synchronized from Tookan.
 */

const { supabase, isConfigured } = require('../supabase');

/**
 * Upsert a customer (insert or update on conflict)
 */
async function upsertCustomer(customer) {
    if (!isConfigured()) {
        console.warn('⚠️  Supabase not configured, skipping customer upsert');
        return null;
    }

    const record = {
        vendor_id: parseInt(customer.vendor_id || customer.customer_id),
        customer_name: customer.name || customer.customer_name || customer.username || null,
        customer_phone: customer.phone || customer.customer_phone || null,
        customer_email: customer.email || customer.customer_email || null,
        customer_address: customer.address || customer.customer_address || null,
        updated_at: new Date().toISOString()
    };

    if (!record.vendor_id) {
        console.warn('⚠️  Cannot upsert customer without vendor_id');
        return null;
    }

    const { data, error } = await supabase
        .from('customers')
        .upsert(record, { onConflict: 'vendor_id' })
        .select()
        .single();

    if (error) {
        console.error('❌ Customer upsert error:', error.message);
        return null;
    }

    return data;
}

/**
 * Bulk upsert customers
 */
async function bulkUpsertCustomers(customers) {
    if (!isConfigured()) {
        console.warn('⚠️  Supabase not configured, skipping bulk customer upsert');
        return { inserted: 0, errors: 0 };
    }

    if (!customers || customers.length === 0) {
        return { inserted: 0, errors: 0 };
    }

    const records = customers.map(c => ({
        vendor_id: parseInt(c.vendor_id || c.customer_id),
        customer_name: c.name || c.customer_name || c.username || null,
        customer_phone: c.phone || c.customer_phone || null,
        customer_email: c.email || c.customer_email || null,
        customer_address: c.address || c.customer_address || null,
        updated_at: new Date().toISOString()
    })).filter(r => r.vendor_id);

    // Process in chunks of 100
    const CHUNK_SIZE = 100;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);

        const { error } = await supabase
            .from('customers')
            .upsert(chunk, { onConflict: 'vendor_id' });

        if (error) {
            console.error(`❌ Bulk customer upsert error (chunk ${i / CHUNK_SIZE + 1}):`, error.message);
            errors += chunk.length;
        } else {
            inserted += chunk.length;
        }
    }

    return { inserted, errors };
}

/**
 * Delete a customer by vendor_id
 */
async function deleteCustomer(vendorId) {
    if (!isConfigured()) {
        console.warn('⚠️  Supabase not configured, skipping customer delete');
        return false;
    }

    const { error } = await supabase
        .from('customers')
        .delete()
        .eq('vendor_id', parseInt(vendorId));

    if (error) {
        console.error('❌ Customer delete error:', error.message);
        return false;
    }

    return true;
}

/**
 * Get a customer by vendor_id
 */
async function getCustomerById(vendorId) {
    if (!isConfigured()) {
        return null;
    }

    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('vendor_id', parseInt(vendorId))
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('❌ Customer fetch error:', error.message);
    }

    return data || null;
}

/**
 * Get all customers with optional pagination
 */
async function getAllCustomers(options = {}) {
    if (!isConfigured()) {
        return [];
    }

    const { limit = 1000, offset = 0 } = options;

    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('customer_name', { ascending: true })
        .range(offset, offset + limit - 1);

    if (error) {
        console.error('❌ Get all customers error:', error.message);
        return [];
    }

    return data || [];
}

/**
 * Get customer count
 */
async function getCustomerCount() {
    if (!isConfigured()) {
        return 0;
    }

    const { count, error } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('❌ Customer count error:', error.message);
        return 0;
    }

    return count || 0;
}

module.exports = {
    upsertCustomer,
    bulkUpsertCustomers,
    deleteCustomer,
    getCustomerById,
    getAllCustomers,
    getCustomerCount
};
