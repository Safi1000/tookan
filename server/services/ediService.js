const fetch = require('node-fetch');
require('dotenv').config();

const TOOKAN_API_BASE = 'https://api.tookanapp.com/v2';
const TOOKAN_API_KEY = process.env.TOOKAN_API_KEY;

// Map internal status codes to human readable strings
const STATUS_MAP = {
    0: 'Assigned',
    1: 'Started',
    2: 'Successful',
    3: 'Failed',
    4: 'InProgress/Arrived',
    6: 'Unassigned',
    7: 'Accepted/Acknowledged',
    8: 'Decline',
    9: 'Cancel',
    10: 'Deleted'
};

/**
 * Create a new task in Tookan
 * @param {Object} orderData - The order data from the EDI request
 * @param {string} merchantId - The merchant ID from the token
 */
async function createOrder(orderData, merchantId) {
    // Build meta_data array with merchant identity + source + optional COD
    const metaData = [
        { label: 'Merchant_ID', data: String(merchantId) },
        { label: 'Source', data: 'EDI' },
    ];

    // COD Amount via template meta_data (not direct cod/cod_amount)
    if (orderData.cod_amount) {
        metaData.push({ label: 'COD_Amount', data: String(orderData.cod_amount) });
    }

    // Structure the payload for Tookan v2/create_task
    const payload = {
        api_key: TOOKAN_API_KEY,
        order_id: orderData.order_reference,
        job_description: orderData.delivery_instructions || '',

        // Pickup fields
        job_pickup_name: orderData.pickup_name || '',
        job_pickup_phone: orderData.pickup_phone || '',
        job_pickup_address: orderData.pickup_address,
        job_pickup_datetime: orderData.pickup_datetime || '',

        // Delivery fields (Tookan's customer_* = delivery recipient)
        customer_username: orderData.delivery_name || '',
        customer_phone: orderData.delivery_phone || '',
        customer_email: orderData.delivery_email || '',
        customer_address: orderData.delivery_address,
        job_delivery_datetime: orderData.delivery_datetime || '',

        // Task configuration
        has_pickup: '1',
        has_delivery: '1',
        layout_type: 0,
        timezone: '-180',
        custom_field_template: 'Same_day',

        // Meta data (merchant identity, source, COD)
        meta_data: metaData,
    };

    // Log payload for debugging
    console.log('Sending payload to Tookan:', JSON.stringify(payload, null, 2));

    try {
        const response = await fetch(`${TOOKAN_API_BASE}/create_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.status === 200) {
            return {
                success: true,
                job_id: data.data.job_id,
                tracking_link: data.data.tracking_link,
                pickup_tracking_link: data.data.pickup_tracking_link,
                message: 'Order created successfully'
            };
        } else {
            console.error('Tookan API Error:', data.message, JSON.stringify(data));
            return {
                success: false,
                message: data.message || 'Failed to create order in Tookan',
                details: data // Return full data for debugging
            };
        }
    } catch (error) {
        console.error('Network Error during order creation:', error);
        throw new Error('Network error interacting with Tookan API');
    }
}

/**
 * Get the status of an order using Tookan's get_job_details
 * @param {string|number} jobId - The Tookan job_id
 */
async function getOrderStatus(jobId) {
    const payload = {
        api_key: TOOKAN_API_KEY,
        job_ids: [jobId],
        include_task_history: 0,
        job_additional_info: 1,
        include_job_report: 0
    };

    try {
        const response = await fetch(`${TOOKAN_API_BASE}/get_job_details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.status === 200 && data.data && data.data.length > 0) {
            const job = data.data[0];
            return {
                success: true,
                status: STATUS_MAP[job.job_status] || 'Unknown',
                fleet_id: job.fleet_id,
                fleet_name: job.fleet_name,
                job_status: job.job_status,
                job_id: job.job_id,
                job_delivery_datetime: job.job_delivery_datetime,
                job_type: job.job_type
            };
        } else {
            return {
                success: false,
                message: data.message || 'Order not found'
            };
        }
    } catch (error) {
        console.error('Error fetching order status:', error);
        throw new Error('Failed to fetch order status');
    }
}

module.exports = {
    createOrder,
    getOrderStatus
};
