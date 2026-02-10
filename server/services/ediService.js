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
    // 1. Structure the payload for Tookan
    // Adjust fields based on Tookan's actual API documentation for v2/create_task
    const payload = {
        api_key: TOOKAN_API_KEY,
        order_id: orderData.order_reference,
        job_description: orderData.delivery_instructions,
        customer_email: orderData.contact_email,
        customer_username: orderData.contact_name,
        customer_phone: orderData.contact_phone,
        customer_address: orderData.dropoff_address,
        job_pickup_address: orderData.pickup_address,
        job_pickup_name: orderData.pickup_name,
        job_pickup_phone: orderData.pickup_phone,

        // Custom fields or meta data
        meta_data: [
            { label: 'Merchant_ID', data: merchantId },
            { label: 'Source', data: 'EDI' }
        ],

        // Delivery time (if provided)
        job_delivery_datetime: orderData.delivery_datetime,
        job_pickup_datetime: orderData.pickup_datetime,

        // Layout/Template ID if specific to merchant
        // layout_type: ... 
    };

    // 2. Add COD if applicable
    if (orderData.cod_amount) {
        payload.cod = 1; // Enable COD
        payload.cod_amount = orderData.cod_amount;
    }

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
 * Get the status of an order using Tookan's job_id or order_id
 * Implementation note: Tookan allows searching by order_id or job_id.
 */
async function getOrderStatus(referenceId, isJobId = false) {
    // Use get_job_details
    const payload = {
        api_key: TOOKAN_API_KEY,
        // If it's a job_id (numeric), pass job_ids array. If order_id, we might need a different search or filter.
        // For simplicity, let's assume we pass job_ids if isJobId is true.
        job_ids: isJobId ? [referenceId] : undefined,
        include_task_history: 0
    };

    // If searching by custom order reference, Tookan might not strictly support it in get_job_details directly 
    // without a different endpoint like get_all_tasks with filters.
    // However, `get_job_details` works best with job_id.

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
                status_code: job.job_status,
                status: STATUS_MAP[job.job_status] || 'Unknown',
                job_id: job.job_id,
                tracking_link: job.job_pickup_tracking_link || job.tracking_link // Fallback
            };
        } else {
            return {
                success: false,
                message: 'Order not found'
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
