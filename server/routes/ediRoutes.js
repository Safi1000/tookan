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
        if (!orderData.pickup_address || !orderData.order_reference) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: pickup_address, order_reference'
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
 * Retrieve order status
 */
router.get('/orders/status/:referenceId', async (req, res) => {
    try {
        const { referenceId } = req.params;
        const isJobId = req.query.type === 'job_id'; // Optional query param to specify type

        const statusData = await ediService.getOrderStatus(referenceId, isJobId);

        if (statusData.success) {
            res.json({
                status: 'success',
                data: {
                    status: statusData.status,
                    status_code: statusData.status_code,
                    job_id: statusData.job_id,
                    tracking_link: statusData.tracking_link
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
