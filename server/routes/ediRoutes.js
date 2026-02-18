const express = require('express');
const router = express.Router();
const ediService = require('../services/ediService');
const { validateEdiToken } = require('../middleware/ediAuth');

// All EDI routes are protected by the token validator
router.use(validateEdiToken);

/**
 * Create a new order via EDI
 */
router.post('/orders/create', async (req, res) => {
    try {
        const orderData = req.body;

        // Basic validation
        if (!orderData.pickup_address || !orderData.delivery_address || !orderData.order_reference) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: pickup_address, delivery_address, order_reference'
            });
        }

        // Call service to create order in Tookan, passing the merchant ID from token
        const result = await ediService.createOrder(orderData, req.merchant.id);

        if (result.success) {
            res.json({
                status: 'success',
                data: {
                    job_id: result.job_id,
                    tracking_link: result.tracking_link,
                    pickup_tracking_link: result.pickup_tracking_link,
                    message: result.message
                }
            });
        } else {
            res.status(400).json({
                status: 'error',
                message: result.message
            });
        }
    } catch (error) {
        console.error('EDI Create Order Error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error processing EDI order'
        });
    }
});

/**
 * Retrieve order status by job_id
 */
router.get('/orders/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;

        const statusData = await ediService.getOrderStatus(jobId);

        if (statusData.success) {
            res.json({
                status: 'success',
                data: {
                    status: statusData.status,
                    fleet_id: statusData.fleet_id,
                    fleet_name: statusData.fleet_name,
                    job_status: statusData.job_status,
                    job_id: statusData.job_id,
                    job_delivery_datetime: statusData.job_delivery_datetime,
                    job_type: statusData.job_type
                }
            });
        } else {
            res.status(404).json({
                status: 'error',
                message: statusData.message || 'Order not found'
            });
        }
    } catch (error) {
        console.error('EDI Get Status Error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error retrieving status'
        });
    }
});

module.exports = router;
