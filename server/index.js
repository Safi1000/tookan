const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();
const codQueue = require('./codQueue');
const { generateExcel, generateCSV } = require('./exportUtils');
const taskStorage = require('./taskStorage');
const tagService = require('./tagService');
// Database models and middleware
const merchantPlansModel = require('./db/models/merchantPlans');
const withdrawalRequestsModel = require('./db/models/withdrawalRequests');
const taskModel = require('./db/models/tasks');
const userModel = require('./db/models/users');
const webhookEventsModel = require('./db/models/webhookEvents');
const { supabase, supabaseAnon, isConfigured } = require('./db/supabase');
const { authenticate, optionalAuth, requirePermission, requireRole, requireSuperadmin, checkUserStatus, isSuperadmin, SUPERADMIN_EMAIL } = require('./middleware/auth');
const auditLogger = require('./middleware/auditLogger');
// Order sync service for 6-month caching
const orderSyncService = require('./services/orderSyncService');
// Agent sync service for caching drivers/fleets
const agentSyncService = require('./services/agentSyncService');
const customerSyncService = require('./services/customerSyncService');
const agentModel = require('./db/models/agents');
const customerModel = require('./db/models/customers');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Get API key from environment variable
const getApiKey = () => {
  const apiKey = process.env.TOOKAN_API_KEY;
  if (!apiKey) {
    throw new Error('TOOKAN_API_KEY not configured in environment variables');
  }
  return apiKey;
};

// Get webhook secret
const getWebhookSecret = () => {
  const secret = process.env.TOOKAN_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('âš ï¸  TOOKAN_WEBHOOK_SECRET not set. Webhook requests will fail auth.');
  }
  return secret;
};

// Driver Wallet - Create Transaction
app.post('/api/tookan/driver-wallet/transaction', authenticate, requirePermission('manage_wallets'), async (req, res) => {
  try {
    console.log('\n=== DRIVER WALLET TRANSACTION REQUEST ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const apiKey = getApiKey();
    const { fleet_id, amount, description, transaction_type } = req.body;

    console.log('Extracted values:');
    console.log('  fleet_id:', fleet_id);
    console.log('  amount:', amount);
    console.log('  description:', description);
    console.log('  transaction_type:', transaction_type);

    if (!fleet_id || !amount || !description) {
      console.log('âŒ Validation failed: Missing required fields');
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: fleet_id, amount, description'
      });
    }

    // transaction_type is optional, defaults to 'credit' if not provided
    // Tookan API expects: 1 = debit, 2 = credit (as numbers, not strings)
    const validTransactionType = (transaction_type === 'debit') ? 'debit' : 'credit';
    const finalAmount = validTransactionType === 'debit' ? -Math.abs(amount) : Math.abs(amount);
    const tookanTransactionType = validTransactionType === 'debit' ? 1 : 2; // Convert to number: 1=debit, 2=credit

    // wallet_type is required: 1 = wallet transaction, 2 = credits
    // Default to 1 (wallet) since we're dealing with driver wallet transactions
    const walletType = 1; // 1 = wallet, 2 = credits

    console.log('Processed values:');
    console.log('  validTransactionType:', validTransactionType);
    console.log('  tookanTransactionType (numeric):', tookanTransactionType);
    console.log('  walletType (numeric):', walletType);
    console.log('  finalAmount:', finalAmount);

    const tookanPayload = {
      api_key: apiKey,
      fleet_id,
      amount: finalAmount,
      description: description.trim(),
      transaction_type: tookanTransactionType, // Tookan API requires: 1=debit, 2=credit (as number)
      wallet_type: walletType, // Tookan API requires: 1=wallet, 2=credits (as number)
    };

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/fleet/wallet/create_transaction');
    console.log('Tookan API payload:', JSON.stringify({ ...tookanPayload, api_key: '***HIDDEN***' }, null, 2));

    const response = await fetch('https://api.tookanapp.com/v2/fleet/wallet/create_transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tookanPayload),
    });

    console.log('Tookan API response status:', response.status, response.statusText);

    const textResponse = await response.text();
    console.log('Tookan API response (first 500 chars):', textResponse.substring(0, 500));

    let data;

    try {
      data = JSON.parse(textResponse);
      console.log('Tookan API parsed response:', JSON.stringify(data, null, 2));
    } catch (parseError) {
      console.log('âŒ Failed to parse Tookan API response as JSON');
      return res.status(500).json({
        status: 'error',
        message: `API returned non-JSON response: ${textResponse.substring(0, 200)}`,
        data: {}
      });
    }

    if (!response.ok || data.status !== 200) {
      console.log('âŒ Tookan API returned error');
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to process driver wallet transaction',
        data
      });
    }

    console.log('âœ… Transaction successful');
    console.log('=== END REQUEST ===\n');

    // Audit log
    await auditLogger.createAuditLog(
      req,
      `driver_wallet_${validTransactionType}`,
      'driver_wallet',
      fleet_id,
      null,
      { fleet_id, amount: finalAmount, description, transaction_type: validTransactionType }
    );

    res.json({
      status: 'success',
      action: validTransactionType === 'credit' ? 'wallet_credit' : 'wallet_debit',
      entity: 'driver',
      message: `Driver wallet ${validTransactionType} successful`,
      data
    });
  } catch (error) {
    console.error('âŒ Driver wallet transaction error:', error);
    console.error('Error stack:', error.stack);
    console.log('=== END REQUEST (ERROR) ===\n');
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// Driver Wallet - Get Balance/Transactions
app.post('/api/tookan/driver-wallet/balance', authenticate, async (req, res) => {
  try {
    const apiKey = getApiKey();
    const { fleet_id } = req.body;

    if (!fleet_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required field: fleet_id'
      });
    }

    // Note: Tookan API may not have a direct "get balance" endpoint
    // This endpoint attempts to get wallet transactions/balance
    // If the endpoint doesn't exist, we'll return a helpful error

    const response = await fetch('https://api.tookanapp.com/v2/get_fleet_wallet_balance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        fleet_id,
      }),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      // If endpoint doesn't exist or returns non-JSON, return helpful error
      if (textResponse.includes('Cannot POST') || textResponse.includes('404') || !response.ok) {
        return res.status(404).json({
          status: 'error',
          message: 'Tookan API endpoint for driver wallet balance not available. The endpoint /v2/get_fleet_wallet_balance may not exist in your Tookan API version.',
          data: { balance: 0 }
        });
      }
      return res.status(500).json({
        status: 'error',
        message: `API returned non-JSON response: ${textResponse.substring(0, 200)}`,
        data: { balance: 0 }
      });
    }

    if (!response.ok || (data.status !== 200 && data.status !== 'success')) {
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to fetch driver wallet balance',
        data: { balance: 0 }
      });
    }

    res.json({
      status: 'success',
      action: 'fetch_wallet',
      entity: 'driver',
      message: 'Driver wallet balance fetched successfully',
      data
    });
  } catch (error) {
    console.error('Driver wallet balance error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: { balance: 0 }
    });
  }
});

// Customer Wallet - Add Payment
app.post('/api/tookan/customer-wallet/payment', authenticate, requirePermission('manage_wallets'), async (req, res) => {
  try {
    const apiKey = getApiKey();
    const { vendor_id, vendor_ids, amount, description } = req.body;

    if ((!vendor_id && !vendor_ids) || !amount) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: vendor_id or vendor_ids, and amount'
      });
    }

    const payload = {
      api_key: apiKey,
      amount: Math.abs(amount),
    };

    if (vendor_id) {
      payload.vendor_id = vendor_id;
    } else if (vendor_ids) {
      payload.vendor_ids = vendor_ids;
    }

    if (description) {
      payload.description = description.trim();
    }

    const response = await fetch('https://api.tookanapp.com/v2/addCustomerPaymentViaDashboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: `API returned non-JSON response: ${textResponse.substring(0, 200)}`,
        data: {}
      });
    }

    if (!response.ok || data.status !== 200) {
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to add customer wallet payment',
        data
      });
    }

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'customer_wallet_payment',
      'customer_wallet',
      vendor_id || (vendor_ids && vendor_ids[0]) || null,
      null,
      { vendor_id, vendor_ids, amount, description }
    );

    res.json({
      status: 'success',
      action: 'wallet_credit',
      entity: 'customer',
      message: 'Customer wallet payment added successfully',
      data
    });
  } catch (error) {
    console.error('Customer wallet payment error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// Customer Wallet - Get Wallet Details
app.post('/api/tookan/customer-wallet/details', authenticate, async (req, res) => {
  try {
    const apiKey = getApiKey();
    const { vendor_id, vendor_ids, is_pagination, off_set, limit, total_used_credit, tags } = req.body;

    if (!vendor_id && !vendor_ids) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required field: vendor_id or vendor_ids'
      });
    }

    const payload = {
      api_key: apiKey,
    };

    if (vendor_id) {
      payload.vendor_id = vendor_id;
    } else if (vendor_ids) {
      payload.vendor_ids = vendor_ids;
    }

    if (is_pagination !== undefined) payload.is_pagination = is_pagination;
    if (off_set !== undefined) payload.off_set = off_set;
    if (limit !== undefined) payload.limit = limit;
    if (total_used_credit !== undefined) payload.total_used_credit = total_used_credit;
    if (tags) payload.tags = tags;

    const response = await fetch('https://api.tookanapp.com/v2/fetch_customers_wallet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: `API returned non-JSON response: ${textResponse.substring(0, 200)}`,
        data: {}
      });
    }

    if (!response.ok || data.status !== 200) {
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to fetch customer wallet details',
        data: {}
      });
    }

    res.json({
      status: 'success',
      action: 'fetch_wallet',
      entity: 'customer',
      message: 'Customer wallet details fetched successfully',
      data
    });
  } catch (error) {
    console.error('Customer wallet details error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// COD Queue - Add COD to driver queue (Step A)
app.post('/api/cod/queue/add', authenticate, requirePermission('add_cod'), async (req, res) => {
  try {
    console.log('\n=== ADD COD TO QUEUE REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { driverId, orderId, amount, merchantVendorId, date, notes } = req.body;

    if (!driverId || !amount || !merchantVendorId || !date) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: driverId, amount, merchantVendorId, date'
      });
    }

    const codEntry = await codQueue.addCODToQueue(driverId, {
      orderId: orderId || `ORD-${Date.now()}`,
      amount: parseFloat(amount),
      merchantVendorId: parseInt(merchantVendorId),
      date,
      notes
    });

    console.log('âœ… COD added to queue:', codEntry.codId);
    console.log('=== END REQUEST ===\n');

    res.json({
      status: 'success',
      message: 'COD added to queue successfully',
      data: codEntry
    });
  } catch (error) {
    console.error('âŒ Add COD to queue error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to add COD to queue',
      data: {}
    });
  }
});

// COD Queue - Get driver's COD queue
app.get('/api/cod/queue/:driverId', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET COD QUEUE REQUEST ===');
    console.log('Request received at:', new Date().toISOString());
    const { driverId } = req.params;
    console.log('Driver ID:', driverId);

    const queue = await codQueue.getDriverQueue(driverId);
    console.log(`Found ${queue.length} COD entries in queue`);
    console.log('=== END REQUEST ===\n');

    res.json({
      status: 'success',
      message: 'Driver COD queue fetched successfully',
      data: queue
    });
  } catch (error) {
    console.error('âŒ Get COD queue error:', error);
    console.log('=== END REQUEST (ERROR) ===\n');
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch COD queue',
      data: []
    });
  }
});

// COD Queue - Get oldest pending COD for driver
app.get('/api/cod/queue/pending/:driverId', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET OLDEST PENDING COD REQUEST ===');
    console.log('Request received at:', new Date().toISOString());
    const { driverId } = req.params;
    console.log('Driver ID:', driverId);

    const oldestPending = await codQueue.getOldestPendingCOD(driverId);

    if (!oldestPending) {
      console.log('No pending COD found for driver');
      console.log('=== END REQUEST ===\n');
      return res.json({
        status: 'success',
        message: 'No pending COD found',
        data: null
      });
    }

    console.log('Oldest pending COD found:');
    console.log('  COD ID:', oldestPending.codId);
    console.log('  Amount:', oldestPending.amount);
    console.log('  Status:', oldestPending.status);
    console.log('=== END REQUEST ===\n');

    res.json({
      status: 'success',
      message: 'Oldest pending COD fetched successfully',
      data: oldestPending
    });
  } catch (error) {
    console.error('âŒ Get pending COD error:', error);
    console.log('=== END REQUEST (ERROR) ===\n');
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch pending COD',
      data: null
    });
  }
});

// COD Queue - Settle COD transaction (Steps B & C)
app.post('/api/cod/queue/settle', authenticate, requirePermission('confirm_cod_payments'), async (req, res) => {
  try {
    console.log('\n=== SETTLE COD TRANSACTION REQUEST ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const apiKey = getApiKey();
    const { driverId, paidAmount, date, note, codId } = req.body;

    if (!driverId || !paidAmount) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: driverId, paidAmount'
      });
    }

    // Step B: Get oldest pending COD from driver's queue
    const driverQueue = await codQueue.getDriverQueue(driverId);
    const pendingCOD = codId
      ? driverQueue.find(c => c.codId === codId && c.status === 'PENDING')
      : await codQueue.getOldestPendingCOD(driverId);

    if (!pendingCOD) {
      return res.status(404).json({
        status: 'error',
        message: 'No pending COD found for this driver'
      });
    }

    // Validate amount matches exactly (no partial settlement)
    const codAmount = parseFloat(pendingCOD.amount);
    const paid = parseFloat(paidAmount);

    if (Math.abs(codAmount - paid) > 0.01) { // Allow small floating point differences
      return res.status(400).json({
        status: 'error',
        message: `Amount mismatch. COD amount: ${codAmount}, Paid amount: ${paid}. Partial settlement is not allowed.`
      });
    }

    console.log('âœ… Found pending COD in queue:');
    console.log('  COD ID:', pendingCOD.codId);
    console.log('  Order ID:', pendingCOD.orderId || 'N/A');
    console.log('  COD Amount:', codAmount);
    console.log('  Paid Amount:', paid);
    console.log('  Merchant Vendor ID:', pendingCOD.merchantVendorId);
    console.log('  Date:', pendingCOD.date);

    console.log('\nðŸ”„ Processing settlement...');

    // Step C: Atomic settlement transaction
    // 1. Credit driver wallet (+COD amount)
    console.log('Step 1: Crediting driver wallet...');
    const baseUrl = `http://localhost:${PORT}`;
    const driverWalletResponse = await fetch(`${baseUrl}/api/tookan/driver-wallet/transaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fleet_id: driverId,
        amount: codAmount,
        description: `COD settlement for ${pendingCOD.orderId || pendingCOD.codId}${note ? ` - ${note}` : ''}`,
        transaction_type: 'credit'
      }),
    });

    const driverWalletResult = await driverWalletResponse.json();

    if (driverWalletResult.status !== 'success') {
      console.error('âŒ Driver wallet credit failed:', driverWalletResult.message);
      console.log('Driver wallet response:', JSON.stringify(driverWalletResult, null, 2));
      return res.status(500).json({
        status: 'error',
        message: `Failed to credit driver wallet: ${driverWalletResult.message}`,
        data: {}
      });
    }

    console.log('âœ… Driver wallet credited successfully');
    console.log('  Driver wallet response status:', driverWalletResult.status);

    // 2. Credit merchant wallet (+COD amount)
    console.log('Step 2: Crediting merchant wallet...');
    const merchantWalletResponse = await fetch(`${baseUrl}/api/tookan/customer-wallet/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vendor_id: pendingCOD.merchantVendorId,
        amount: codAmount,
        description: `COD settlement for order ${pendingCOD.orderId || pendingCOD.codId}${note ? ` - ${note}` : ''}`
      }),
    });

    const merchantWalletResult = await merchantWalletResponse.json();

    if (merchantWalletResult.status !== 'success') {
      console.error('âŒ Merchant wallet credit failed:', merchantWalletResult.message);
      console.log('Merchant wallet response:', JSON.stringify(merchantWalletResult, null, 2));
      // Note: In production, you might want to rollback driver wallet credit here
      return res.status(500).json({
        status: 'error',
        message: `Failed to credit merchant wallet: ${merchantWalletResult.message}`,
        data: {}
      });
    }

    console.log('âœ… Merchant wallet credited successfully');
    console.log('  Merchant wallet response status:', merchantWalletResult.status);

    // 3. Mark COD as COMPLETED
    console.log('Step 3: Marking COD as COMPLETED...');
    const settledCOD = await codQueue.settleCOD(driverId, pendingCOD.codId, note);

    if (!settledCOD) {
      console.error('âŒ Failed to update COD status');
      return res.status(500).json({
        status: 'error',
        message: 'Failed to update COD status',
        data: {}
      });
    }

    console.log('âœ… COD marked as COMPLETED');

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'cod_settle',
      'cod_queue',
      settledCOD.codId || pendingCOD.codId,
      { status: 'PENDING', amount: codAmount },
      { status: 'COMPLETED', amount: codAmount, driverId, merchantVendorId: pendingCOD.merchantVendorId }
    );

    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      message: 'COD settlement completed successfully',
      data: {
        cod: settledCOD,
        driverWallet: driverWalletResult.data,
        merchantWallet: merchantWalletResult.data
      }
    });
  } catch (error) {
    console.error('âŒ Settle COD error:', error);
    console.error('Error stack:', error.stack);
    console.log('=== END REQUEST (ERROR) ===\n');
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to settle COD transaction',
      data: {}
    });
  }
});

// Dashboard - Export Daily Report
app.get('/api/reports/daily', authenticate, async (req, res) => {
  try {
    console.log('\n=== DAILY REPORT EXPORT REQUEST ===');
    console.log('Request received at:', new Date().toISOString());

    const today = new Date().toISOString().split('T')[0];

    // Mock data - in production, fetch from database
    const dailyData = [
      { Date: today, Orders: 245, Revenue: '$12,450', COD: '$8,230', Completed: 238, Pending: 7 },
    ];

    const format = req.query.format || 'excel';

    if (format === 'excel') {
      const buffer = generateExcel(dailyData, `daily-report-${today}`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=daily-report-${today}.xlsx`);
      res.send(buffer);
    } else {
      const csv = generateCSV(dailyData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=daily-report-${today}.csv`);
      res.send(csv);
    }

    console.log('âœ… Daily report exported successfully');
    console.log('=== END REQUEST ===\n');
  } catch (error) {
    console.error('âŒ Daily report export error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to export daily report'
    });
  }
});

// Dashboard - Export Monthly Report
app.get('/api/reports/monthly', authenticate, async (req, res) => {
  try {
    console.log('\n=== MONTHLY REPORT EXPORT REQUEST ===');
    console.log('Request received at:', new Date().toISOString());

    const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
    const monthName = new Date(month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });

    // Mock data - in production, fetch from database
    const monthlyData = [
      { Date: '2025-12-01', Orders: 245, Revenue: '$12,450', COD: '$8,230', Completed: 238 },
      { Date: '2025-12-02', Orders: 280, Revenue: '$14,200', COD: '$9,100', Completed: 275 },
      { Date: '2025-12-03', Orders: 312, Revenue: '$15,800', COD: '$10,500', Completed: 308 },
      // ... more days
    ];

    const format = req.query.format || 'excel';

    if (format === 'excel') {
      const buffer = generateExcel(monthlyData, `monthly-report-${month}`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=monthly-report-${month}.xlsx`);
      res.send(buffer);
    } else {
      const csv = generateCSV(monthlyData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=monthly-report-${month}.csv`);
      res.send(csv);
    }

    console.log('âœ… Monthly report exported successfully');
    console.log('=== END REQUEST ===\n');
  } catch (error) {
    console.error('âŒ Monthly report export error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to export monthly report'
    });
  }
});

// Reports Panel - Export Orders (Excel/CSV)
app.post('/api/reports/orders/export', authenticate, requirePermission('export_reports'), async (req, res) => {
  try {
    console.log('\n=== ORDERS EXPORT REQUEST ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { format, filters, columns } = req.body;

    // Fetch real order data from database or file fallback
    let ordersData = [];
    let tasks = [];

    try {
      // Try database first
      if (isConfigured()) {
        try {
          const dbFilters = {
            dateFrom: filters?.dateFrom || undefined,
            dateTo: filters?.dateTo || undefined,
            driverId: filters?.unifiedDriverSearch ? undefined : undefined, // Driver search handled client-side
            customerId: filters?.unifiedCustomerSearch || filters?.unifiedMerchantSearch ? undefined : undefined,
            search: filters?.orderIdSearch || filters?.unifiedCustomerSearch || filters?.unifiedMerchantSearch || filters?.unifiedDriverSearch || undefined
          };
          tasks = await taskModel.getAllTasks(dbFilters);
          console.log(`ðŸ“¦ Found ${tasks.length} tasks from database for export`);
        } catch (error) {
          console.warn('Database fetch failed, falling back to file storage:', error.message);
          // Fallback to file-based storage
          const tasksData = taskStorage.getAllTasks();
          tasks = Object.values(tasksData.tasks || {});
          console.log(`ðŸ“¦ Found ${tasks.length} tasks from file cache for export`);
        }
      } else {
        // Fallback to file-based storage
        const tasksData = taskStorage.getAllTasks();
        tasks = Object.values(tasksData.tasks || {});
        console.log(`ðŸ“¦ Found ${tasks.length} tasks from file cache for export`);
      }

      // Transform tasks to export format
      ordersData = tasks.map((task) => {
        const jobId = task.job_id || task.order_id;
        const codAmount = parseFloat(task.cod_amount || task.cod || 0);
        const orderPayment = parseFloat(task.order_fees || task.order_payment || 0);
        const creationDate = task.creation_datetime || task.job_time || task.webhook_received_at || new Date().toISOString();

        return {
          'Order ID': jobId?.toString() || '',
          'Date': creationDate.split('T')[0],
          'Merchant': task.customer_name || '',
          'Merchant Number': task.customer_phone || '',
          'Driver': task.fleet_name || '',
          'Customer': task.customer_name || '',
          'Customer Number': task.customer_phone || '',
          'COD': `$${codAmount.toFixed(2)}`,
          'COD Collected': task.cod_collected ? 'Yes' : 'No',
          'Tookan Fees': `$${orderPayment.toFixed(2)}`,
          'Order Fee': `$${orderPayment.toFixed(2)}`,
          'Status': getStatusText(task.status || task.job_status || 0),
          'Pickup Address': task.pickup_address || '',
          'Delivery Address': task.delivery_address || '',
          'Notes': task.notes || ''
        };
      });

      // Apply filters if provided
      if (filters) {
        if (filters.dateFrom && filters.dateTo) {
          const start = new Date(filters.dateFrom);
          const end = new Date(filters.dateTo);
          end.setHours(23, 59, 59, 999);

          ordersData = ordersData.filter(order => {
            const orderDate = new Date(order.Date);
            return orderDate >= start && orderDate <= end;
          });
        }

        if (filters.orderIdSearch) {
          ordersData = ordersData.filter(order =>
            order['Order ID'].toLowerCase().includes(filters.orderIdSearch.toLowerCase())
          );
        }

        if (filters.unifiedCustomerSearch) {
          const searchLower = filters.unifiedCustomerSearch.toLowerCase();
          ordersData = ordersData.filter(order =>
            order.Customer.toLowerCase().includes(searchLower) ||
            order['Customer Number'].includes(filters.unifiedCustomerSearch)
          );
        }

        if (filters.unifiedMerchantSearch) {
          const searchLower = filters.unifiedMerchantSearch.toLowerCase();
          ordersData = ordersData.filter(order =>
            order.Merchant.toLowerCase().includes(searchLower) ||
            order['Merchant Number'].includes(filters.unifiedMerchantSearch)
          );
        }

        if (filters.unifiedDriverSearch) {
          const searchLower = filters.unifiedDriverSearch.toLowerCase();
          ordersData = ordersData.filter(order =>
            order.Driver.toLowerCase().includes(searchLower)
          );
        }
      }

      console.log(`âœ… Exported ${ordersData.length} orders from cache`);
    } catch (cacheError) {
      console.warn('âš ï¸  Cache export failed, using mock data:', cacheError);
      // Fallback to mock data if cache fails
      ordersData = [
        {
          'Order ID': 'ORD-1234',
          'Date': '2025-12-08',
          'Merchant': 'Restaurant A',
          'Merchant Number': '+973 1234 5678',
          'Driver': 'Ahmed K.',
          'Customer': 'Sara Mohammed',
          'Customer Number': '+973 9999 1111',
          'COD': '$125.50',
          'Tookan Fees': '$2.50',
          'Order Fee': '$8.00',
          'Status': 'Delivered',
          'Delivery Time': '35 min',
          'Pickup Address': '123 Main St, Manama',
          'Dropoff Address': '456 Palm Ave, Riffa',
        },
        {
          'Order ID': 'ORD-1235',
          'Date': '2025-12-08',
          'Merchant': 'Shop B',
          'Merchant Number': '+973 2345 6789',
          'Driver': 'Mohammed S.',
          'Customer': 'Ali Hassan',
          'Customer Number': '+973 8888 2222',
          'COD': '$89.00',
          'Tookan Fees': '$2.00',
          'Order Fee': '$6.50',
          'Status': 'Ongoing',
          'Delivery Time': '-',
          'Pickup Address': '789 King Rd, Muharraq',
          'Dropoff Address': '321 Beach St, Sitra',
        },
        {
          'Order ID': 'ORD-1236',
          'Date': '2025-12-07',
          'Merchant': 'Cafe C',
          'Merchant Number': '+973 3456 7890',
          'Driver': 'Fatima A.',
          'Customer': 'Noor Abdullah',
          'Customer Number': '+973 7777 3333',
          'COD': '$210.00',
          'Tookan Fees': '$3.00',
          'Order Fee': '$12.00',
          'Status': 'Delivered',
          'Delivery Time': '28 min',
          'Pickup Address': '555 Market St, Hamad Town',
          'Dropoff Address': '777 Garden Ave, Isa Town',
        },
      ];
    }

    // Map column keys to labels (matching columnDefinitions from ReportsPanel)
    const columnKeyToLabel = {
      'id': 'Order ID',
      'date': 'Date',
      'merchant': 'Merchant',
      'merchantNumber': 'Merchant Number',
      'driver': 'Driver',
      'customer': 'Customer',
      'customerNumber': 'Customer Number',
      'cod': 'COD',
      'tookanFees': 'Tookan Fees',
      'fee': 'Order Fee',
      'status': 'Status',
      'addresses': 'Pickup Address' // Special handling below
    };

    // Filter columns if specified
    let filteredData = ordersData;
    if (columns && Array.isArray(columns) && columns.length > 0) {
      filteredData = ordersData.map(order => {
        const filtered = {};
        columns.forEach(colKey => {
          if (colKey === 'addresses') {
            // Special handling for addresses - split into pickup and dropoff
            filtered['Pickup Address'] = order['Pickup Address'] || '';
            filtered['Dropoff Address'] = order['Dropoff Address'] || '';
          } else {
            const label = columnKeyToLabel[colKey] || colKey;
            if (order[label] !== undefined) {
              filtered[label] = order[label];
            }
          }
        });
        return filtered;
      });
    }

    if (format === 'excel') {
      const buffer = generateExcel(filteredData, 'orders-export');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=orders-export-${new Date().toISOString().split('T')[0]}.xlsx`);
      res.send(buffer);
    } else {
      const csv = generateCSV(filteredData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=orders-export-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);
    }

    console.log('âœ… Orders export completed successfully');
    console.log('=== END REQUEST ===\n');
  } catch (error) {
    console.error('âŒ Orders export error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to export orders'
    });
  }
});

// System Logs - Export Excel
app.post('/api/logs/export', authenticate, requirePermission('export_reports'), async (req, res) => {
  try {
    console.log('\n=== SYSTEM LOGS EXPORT REQUEST ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { format, filters } = req.body;

    // Mock data - in production, fetch from database based on filters
    const logsData = [
      {
        'Timestamp': '2025-12-09 10:42:15',
        'User ID': 'USR-001',
        'User Name': 'Admin User',
        'Action Type': 'UPDATE',
        'Entity': 'Order',
        'Entity ID': 'ORD-1234',
        'Old Value': 'Status: Pending',
        'New Value': 'Status: Delivered',
        'Notes': 'Order marked as delivered by driver confirmation',
      },
      {
        'Timestamp': '2025-12-09 10:35:22',
        'User ID': 'USR-002',
        'User Name': 'Sarah Finance',
        'Action Type': 'APPROVE',
        'Entity': 'Wallet',
        'Entity ID': 'WDR-0089',
        'Old Value': 'Withdrawal: Pending ($500)',
        'New Value': 'Withdrawal: Approved ($500)',
        'Notes': 'Driver withdrawal approved',
      },
    ];

    if (format === 'excel') {
      const buffer = generateExcel(logsData, 'system-logs');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=system-logs-${new Date().toISOString().split('T')[0]}.xlsx`);
      res.send(buffer);
    } else {
      const csv = generateCSV(logsData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=system-logs-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);
    }

    console.log('âœ… System logs export completed successfully');
    console.log('=== END REQUEST ===\n');
  } catch (error) {
    console.error('âŒ System logs export error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to export system logs'
    });
  }
});

// ============================================
// MERCHANTS & AGENTS - ADD ENDPOINTS
// ============================================

// Add Agent/Fleet (for setup and testing)
// Note: Tookan may not have a direct fleet/add API endpoint
// This endpoint attempts to add via Tookan API, but agents may need to be added via dashboard
app.post('/api/tookan/fleet/add', authenticate, requireRole('admin'), async (req, res) => {
  try {
    console.log('\n=== ADD FLEET/AGENT REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const apiKey = getApiKey();
    // Accept both formats: fleet_name/fleet_phone or name/phone
    const { fleet_name, fleet_phone, fleet_email, fleet_password, fleet_type = 1, name, phone, email, password } = req.body;

    const finalName = fleet_name || name;
    const finalPhone = fleet_phone || phone;
    const finalEmail = fleet_email || email;
    const finalPassword = fleet_password || password;

    if (!finalName || !finalPhone || !finalEmail || !finalPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: name (or fleet_name), phone (or fleet_phone), email (or fleet_email), password (or fleet_password)',
        data: {}
      });
    }

    // Note: Tookan may not have /v2/fleet/add endpoint
    // Try alternative endpoints or return error suggesting manual addition
    const payload = {
      api_key: apiKey,
      fleet_name: finalName.trim(),
      fleet_phone: finalPhone.trim(),
      fleet_email: finalEmail.trim(),
      fleet_password: finalPassword,
      fleet_type: parseInt(fleet_type) || 1, // 1 = Delivery Agent
      timezone: '+0300' // Bahrain timezone
    };

    console.log('âš ï¸  Attempting to call Tookan API: https://api.tookanapp.com/v2/fleet/add');
    console.log('âš ï¸  Note: This endpoint may not exist in Tookan API');
    console.log('Tookan API payload:', JSON.stringify({ ...payload, fleet_password: '***HIDDEN***' }, null, 2));

    const response = await fetch('https://api.tookanapp.com/v2/fleet/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: `API returned non-JSON response: ${textResponse.substring(0, 200)}`,
        data: {}
      });
    }

    // Check if endpoint exists (404 or 405 means endpoint doesn't exist)
    if (response.status === 404 || response.status === 405) {
      console.log('âš ï¸  Fleet/add endpoint not found in Tookan API');
      console.log('=== END REQUEST (ENDPOINT NOT AVAILABLE) ===\n');
      return res.status(501).json({
        status: 'error',
        action: 'add_fleet',
        entity: 'driver',
        message: 'Tookan API does not support adding agents/fleets via API. Please add agents manually via Tookan dashboard: Agents > Add Agent',
        data: {
          suggestion: 'Add agents via Tookan dashboard',
          dashboard_url: 'https://app.tookanapp.com'
        }
      });
    }

    if (!response.ok || data.status !== 200) {
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to add fleet/agent',
        data: {}
      });
    }

    const fleetId = data.data?.fleet_id || data.data?.data?.fleet_id || data.data?.id;

    console.log('âœ… Fleet/Agent added successfully:', fleetId);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'add_fleet',
      entity: 'driver',
      message: 'Fleet/Agent added successfully',
      data: {
        fleet_id: fleetId,
        fleet_name: finalName,
        fleet_phone: finalPhone,
        fleet_email: finalEmail
      }
    });
  } catch (error) {
    console.error('âŒ Add fleet error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// Add Customer via Tookan API
app.post('/api/tookan/customer/add', authenticate, requireRole('admin'), async (req, res) => {
  try {
    console.log('\n=== ADD CUSTOMER REQUEST ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const apiKey = getApiKey();
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: name, phone'
      });
    }

    // Prepare Tookan API payload
    const tookanPayload = {
      api_key: apiKey,
      user_type: 0, // Required: 0 for customer
      name: name,
      phone: phone
    };

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/customer/add');
    console.log('Tookan API payload:', JSON.stringify(tookanPayload, null, 2));

    // Call Tookan API
    const response = await fetch('https://api.tookanapp.com/v2/customer/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tookanPayload),
    });

    const responseText = await response.text();
    console.log('Tookan API response status:', response.status);
    console.log('Tookan API response:', responseText);

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Tookan API response as JSON:', parseError);
      // Handle non-JSON responses
      if (responseText.includes('session expired') || responseText.toLowerCase().includes('expired')) {
        return res.status(401).json({
          status: 'error',
          message: 'Session expired. Please check your API key.',
          data: {}
        });
      }
      return res.status(500).json({
        status: 'error',
        message: 'Invalid response from Tookan API',
        data: { rawResponse: responseText }
      });
    }

    if (response.ok && responseData.status === 200) {
      console.log('âœ… Customer added successfully');
      console.log('=== END REQUEST (SUCCESS) ===\n');
      res.json({
        status: 'success',
        message: 'Customer added successfully',
        data: responseData.data || responseData
      });
    } else {
      console.error('âŒ Tookan API error:', responseData.message || responseData);
      console.log('=== END REQUEST (ERROR) ===\n');
      res.status(response.status || 500).json({
        status: 'error',
        message: responseData.message || 'Failed to add customer',
        data: responseData
      });
    }
  } catch (error) {
    console.error('âŒ Add customer error:', error);
    console.error('Error stack:', error.stack);
    console.log('=== END REQUEST (ERROR) ===\n');
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to add customer',
      data: {}
    });
  }
});

// ============================================
// ORDER EDITOR PANEL - TWO-WAY SYNC ENDPOINTS
// ============================================

// GET Order Details
app.get('/api/tookan/order/:orderId', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET ORDER DETAILS REQUEST ===');
    console.log('Order ID:', req.params.orderId);
    console.log('Request received at:', new Date().toISOString());

    const apiKey = getApiKey();
    const orderId = req.params.orderId;

    if (!orderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Order ID is required',
        data: {}
      });
    }

    // Call Tookan API to get task details
    const tookanPayload = {
      api_key: apiKey,
      job_id: orderId
    };

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/get_task_details');
    console.log('Tookan API payload:', JSON.stringify({ ...tookanPayload, api_key: '***HIDDEN***' }, null, 2));

    const response = await fetch('https://api.tookanapp.com/v2/get_task_details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tookanPayload),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: `API returned non-JSON response: ${textResponse.substring(0, 200)}`,
        data: {}
      });
    }

    if (!response.ok || data.status !== 200) {
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to fetch order details',
        data: {}
      });
    }

    // Transform Tookan response to standardized format
    // Tookan API can return data in different structures - handle all cases
    let taskData = data.data || {};

    // If data.data is an array (tookanData), get first element
    if (Array.isArray(data.data) && data.data.length > 0) {
      taskData = data.data[0];
    } else if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
      // If it's an object, use it directly
      taskData = data.data;
    }

    // Get COD data from local storage (if available)
    const storedTask = await taskStorage.getTask(orderId);
    const codAmount = storedTask?.cod_amount !== undefined ? storedTask.cod_amount : parseFloat(taskData.cod || taskData.cod_amount || 0);
    const codCollected = storedTask?.cod_collected !== undefined ? storedTask.cod_collected : false;

    // Extract fields with multiple fallback paths
    const orderData = {
      orderId: taskData.job_id || orderId,
      orderDate: taskData.creation_datetime || taskData.created_at || taskData.job_time || new Date().toISOString(),
      status: taskData.job_status || taskData.status || 'unknown',
      codAmount: codAmount,
      codCollected: codCollected,
      orderFees: parseFloat(taskData.order_payment || taskData.order_fees || 0),
      assignedDriver: taskData.fleet_id || taskData.assigned_fleet_id || null,
      customerName: taskData.customer_name || taskData.customer_username || taskData.job_pickup_name || '',
      customerPhone: taskData.customer_phone || taskData.job_pickup_phone || '',
      customerEmail: taskData.customer_email || taskData.job_pickup_email || '',
      pickupAddress: taskData.job_pickup_address || taskData.pickup_address || '',
      deliveryAddress: taskData.job_address || taskData.delivery_address || '',
      distance: parseFloat(taskData.distance || 0),
      notes: taskData.customer_comments || taskData.job_description || '',
      lastModified: taskData.updated_at || taskData.creation_datetime || new Date().toISOString(),
      tookanData: Array.isArray(data.data) ? data.data : [taskData], // Preserve full Tookan response
      rawData: taskData // Include raw data for reference
    };

    console.log('âœ… Order fetched successfully:', orderId);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'fetch_order',
      entity: 'order',
      message: 'Order details fetched successfully',
      data: orderData
    });
  } catch (error) {
    console.error('âŒ Get order error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// UPDATE Order
app.put('/api/tookan/order/:orderId', authenticate, requirePermission('edit_order_financials'), async (req, res) => {
  try {
    console.log('\n=== UPDATE ORDER REQUEST ===');
    console.log('Order ID:', req.params.orderId);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const apiKey = getApiKey();
    const orderId = req.params.orderId;
    const { codAmount, orderFees, assignedDriver, notes } = req.body;

    if (!orderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Order ID is required',
        data: {}
      });
    }

    // First, fetch current order to check status
    const getTaskPayload = {
      api_key: apiKey,
      job_id: orderId
    };

    const getResponse = await fetch('https://api.tookanapp.com/v2/get_task_details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(getTaskPayload),
    });

    const getTextResponse = await getResponse.text();
    let getData;
    try {
      getData = JSON.parse(getTextResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch order for validation',
        data: {}
      });
    }

    if (!getResponse.ok || getData.status !== 200) {
      return res.status(getResponse.status || 500).json({
        status: 'error',
        message: getData.message || 'Order not found',
        data: {}
      });
    }

    const currentTask = getData.data || {};
    const currentStatus = currentTask.job_status || '';

    // Note: SRS requires editing even successful orders
    // Tookan API may restrict editing, but we'll attempt it
    // Only block cancelled orders (status 10) as they cannot be edited
    const nonEditableStatuses = [10]; // Only cancelled orders cannot be edited

    if (nonEditableStatuses.includes(parseInt(currentStatus)) ||
      ['cancelled'].includes(currentStatus.toString().toLowerCase())) {
      return res.status(400).json({
        status: 'error',
        message: `Order cannot be edited. Current status: ${currentStatus} (Cancelled)`,
        data: {}
      });
    }

    // Warn but allow editing successful orders (status 6, 7, 8)
    const successfulStatuses = [2]; // Tookan status 2 = Successful/Completed
    if (successfulStatuses.includes(parseInt(currentStatus))) {
      console.log('âš ï¸  Warning: Attempting to edit successful order. Tookan API may reject this.');
    }

    // Build update payload using custom_field_template and meta_data
    // This is the format required for the user's Tookan workflow
    const numericOrderId = parseInt(orderId, 10);
    if (isNaN(numericOrderId)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid order ID: ${orderId}. Must be a valid number.`,
        data: {}
      });
    }

    // Build the meta_data array for COD custom field
    const metaData = [];
    if (codAmount !== undefined) {
      metaData.push({
        label: 'CASH_NEEDS_TO_BE_COLLECTED',
        data: String(codAmount)
      });
    }

    // Build Tookan payload with custom_field_template
    const updatePayload = {
      api_key: apiKey,
      job_id: numericOrderId,
      custom_field_template: 'Order_editor_test'
    };

    // Add meta_data if we have COD to update
    if (metaData.length > 0) {
      updatePayload.meta_data = metaData;
    }

    // Add job_description (notes) if provided
    if (notes !== undefined) {
      updatePayload.job_description = notes;
    }

    // Add fleet_id if driver assignment is being updated
    if (assignedDriver !== undefined && assignedDriver !== null) {
      updatePayload.fleet_id = assignedDriver;
    }

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/edit_task');
    console.log('Template:', updatePayload.custom_field_template);
    console.log('Meta Data:', JSON.stringify(metaData, null, 2));
    console.log('Notes:', notes !== undefined ? notes : '(not changed)');

    const response = await fetch('https://api.tookanapp.com/v2/edit_task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: `API returned non-JSON response: ${textResponse.substring(0, 200)}`,
        data: {}
      });
    }

    if (!response.ok || data.status !== 200) {
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to update order',
        data: {}
      });
    }

    console.log('âœ… Tookan API update successful');

    // Update local Supabase database
    let dbUpdated = false;
    if (isConfigured()) {
      try {
        const updateData = {};
        if (codAmount !== undefined) updateData.cod_amount = parseFloat(codAmount);
        if (orderFees !== undefined) updateData.order_fees = parseFloat(orderFees);
        if (notes !== undefined) updateData.notes = notes;

        if (Object.keys(updateData).length > 0) {
          await taskModel.updateTask(numericOrderId, updateData);
          dbUpdated = true;
          console.log('âœ… Database updated');
        }
      } catch (dbError) {
        console.warn('âš ï¸ Database update failed:', dbError.message);
      }
    }

    // Fetch updated order to return complete data
    const updatedGetResponse = await fetch('https://api.tookanapp.com/v2/get_task_details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(getTaskPayload),
    });

    const updatedTextResponse = await updatedGetResponse.text();
    let updatedData;
    try {
      updatedData = JSON.parse(updatedTextResponse);
    } catch (parseError) {
      // If we can't fetch updated data, return success with update confirmation
      // Audit log with available data
      const oldValue = {
        codAmount: parseFloat(currentTask.cod || 0),
        orderFees: parseFloat(currentTask.order_payment || 0),
        assignedDriver: currentTask.fleet_id || null
      };
      await auditLogger.createAuditLog(
        req,
        'order_update',
        'order',
        orderId,
        oldValue,
        { codAmount, orderFees, assignedDriver, notes }
      );

      console.log('âœ… Order updated successfully (could not fetch updated data)');
      console.log('=== END REQUEST (SUCCESS) ===\n');
      return res.json({
        status: 'success',
        action: 'update_order',
        entity: 'order',
        message: 'Order updated successfully',
        data: { orderId: orderId }
      });
    }

    const updatedTaskData = updatedData.data || {};
    const updatedOrderData = {
      orderId: updatedTaskData.job_id || orderId,
      orderDate: updatedTaskData.creation_datetime || updatedTaskData.created_at || new Date().toISOString(),
      status: updatedTaskData.job_status || 'unknown',
      codAmount: parseFloat(updatedTaskData.cod || 0),
      orderFees: parseFloat(updatedTaskData.order_payment || 0),
      assignedDriver: updatedTaskData.fleet_id || null,
      customerName: updatedTaskData.customer_name || '',
      customerPhone: updatedTaskData.customer_phone || '',
      customerEmail: updatedTaskData.customer_email || '',
      pickupAddress: updatedTaskData.pickup_address || '',
      deliveryAddress: updatedTaskData.delivery_address || '',
      distance: parseFloat(updatedTaskData.distance || 0),
      notes: updatedTaskData.customer_comments || '',
      lastModified: updatedTaskData.updated_at || updatedTaskData.creation_datetime || new Date().toISOString()
    };

    // Prepare old and new values for audit log
    const oldValue = {
      codAmount: parseFloat(currentTask.cod || 0),
      orderFees: parseFloat(currentTask.order_payment || 0),
      assignedDriver: currentTask.fleet_id || null,
      notes: currentTask.customer_comments || ''
    };
    const newValue = {
      codAmount: updatedOrderData.codAmount,
      orderFees: updatedOrderData.orderFees,
      assignedDriver: updatedOrderData.assignedDriver,
      notes: updatedOrderData.notes
    };

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'order_update',
      'order',
      orderId,
      oldValue,
      newValue
    );

    console.log('âœ… Order updated successfully:', orderId);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'update_order',
      entity: 'order',
      message: 'Order updated successfully',
      data: updatedOrderData
    });
  } catch (error) {
    console.error('âŒ Update order error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// REORDER Order
app.post('/api/tookan/order/reorder', authenticate, requirePermission('perform_reorder'), async (req, res) => {
  try {
    if (process.env.DISABLE_ORDER_CREATION === 'true') {
      return res.status(400).json({
        status: 'error',
        message: 'Order creation is disabled on this runtime (use serverless/Vercel only).'
      });
    }
    console.log('\n=== REORDER REQUEST (2 TASKS) ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const apiKey = getApiKey();
    const { orderId, customerName, customerPhone, customerEmail, pickupAddress, deliveryAddress, codAmount, orderFees, assignedDriver, notes } = req.body;

    if (!orderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Original order ID is required',
        data: {}
      });
    }

    // If order data is not provided, fetch it from Tookan
    let orderData = {
      customerName, customerPhone, customerEmail, pickupAddress, deliveryAddress, codAmount, orderFees, assignedDriver, notes
    };

    // Check if we need to fetch order data
    if (!customerName || !customerPhone || !pickupAddress || !deliveryAddress) {
      console.log('📋 Fetching order data from Tookan...');

      const getTaskPayload = {
        api_key: apiKey,
        job_id: orderId
      };

      const getResponse = await fetch('https://api.tookanapp.com/v2/get_task_details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getTaskPayload),
      });

      const getTextResponse = await getResponse.text();
      let getData;
      try {
        getData = JSON.parse(getTextResponse);
      } catch (parseError) {
        return res.status(500).json({
          status: 'error',
          message: 'Failed to fetch original order data',
          data: {}
        });
      }

      if (!getResponse.ok || getData.status !== 200) {
        return res.status(getResponse.status || 500).json({
          status: 'error',
          message: getData.message || 'Original order not found',
          data: {}
        });
      }

      const currentTask = getData.data || {};

      console.log('📋 Tookan task data received:', JSON.stringify(currentTask, null, 2));

      // Use fetched data if not provided
      // Tookan uses different field names, so we need to check multiple possibilities
      // For notes: only use provided notes if it has actual content, otherwise use original
      const originalNotes = currentTask.customer_comments || currentTask.job_description || '';
      const effectiveNotes = (notes && notes.trim()) ? notes.trim() : originalNotes;

      orderData = {
        customerName: customerName || currentTask.customer_username || currentTask.customer_name || currentTask.job_pickup_name || 'Customer',
        customerPhone: customerPhone || currentTask.customer_phone || currentTask.job_pickup_phone || '+97300000000',
        customerEmail: customerEmail || currentTask.customer_email || currentTask.job_pickup_email || '',
        pickupAddress: pickupAddress || currentTask.job_pickup_address || currentTask.pickup_address || '',
        deliveryAddress: deliveryAddress || currentTask.customer_address || currentTask.job_address || currentTask.delivery_address || '',
        codAmount: codAmount !== undefined ? parseFloat(codAmount) : 0, // Default to 0 for reorder
        orderFees: orderFees !== undefined ? parseFloat(orderFees) : (parseFloat(currentTask.order_payment) || 0),
        assignedDriver: assignedDriver !== undefined ? assignedDriver : null, // Default unassigned
        notes: effectiveNotes
      };

      console.log('📋 Merged order data:', JSON.stringify(orderData, null, 2));
    }

    // Validate required fields
    if (!orderData.pickupAddress || !orderData.deliveryAddress) {
      return res.status(400).json({
        status: 'error',
        message: 'Pickup and delivery addresses are required',
        data: {}
      });
    }

    // Task times
    const now = new Date();
    const pickupTime = new Date(now.getTime() + 1 * 60 * 60 * 1000); // +1 hour
    const deliveryTime = new Date(now.getTime() + 3 * 60 * 60 * 1000); // +3 hours
    const formatDateTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
    const timezone = '-180';

    // Get tags for tasks
    const taskDataForTags = {
      customerName: orderData.customerName,
      customerPhone: orderData.customerPhone,
      pickupAddress: orderData.pickupAddress,
      deliveryAddress: orderData.deliveryAddress,
      ...orderData
    };
    const tags = tagService.getTagsForTask(taskDataForTags);

    // ========== TASK 1: PICKUP from merchant/warehouse ==========
    const pickupPayload = {
      api_key: apiKey,
      job_pickup_name: orderData.customerName,
      job_pickup_phone: orderData.customerPhone,
      job_pickup_email: orderData.customerEmail || '',
      job_pickup_address: orderData.pickupAddress,
      job_pickup_datetime: formatDateTime(pickupTime),
      has_pickup: 1,
      has_delivery: 0,
      layout_type: 0,
      timezone: timezone,
      cod: orderData.codAmount,
      order_payment: orderData.orderFees,
      job_description: orderData.notes || '',
      auto_assignment: 0,
      custom_field_template: 'Order editor test',
      meta_data: [
        {
          label: 'CASH NEEDS TO BE COLLECTED',
          data: String(orderData.codAmount)
        }
      ]
    };

    if (tags && tags.length > 0) pickupPayload.tags = tags;
    if (orderData.assignedDriver) pickupPayload.fleet_id = orderData.assignedDriver;

    console.log('Creating PICKUP task for reorder...');
    const pickupResponse = await fetch('https://api.tookanapp.com/v2/create_task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pickupPayload)
    });

    const pickupData = await pickupResponse.json();
    if (pickupData.status !== 200) {
      return res.status(500).json({
        status: 'error',
        message: pickupData.message || 'Failed to create pickup task for reorder'
      });
    }

    const pickupOrderId = pickupData.data?.job_id || null;
    console.log('✅ Pickup task created:', pickupOrderId);

    // ========== TASK 2: DELIVERY to customer ==========
    const deliveryPayload = {
      api_key: apiKey,
      customer_username: orderData.customerName,
      customer_phone: orderData.customerPhone,
      customer_email: orderData.customerEmail || '',
      customer_address: orderData.deliveryAddress,
      job_delivery_datetime: formatDateTime(deliveryTime),
      has_pickup: 0,
      has_delivery: 1,
      layout_type: 0,
      timezone: timezone,
      cod: orderData.codAmount,
      order_payment: orderData.orderFees,
      job_description: orderData.notes || '',
      auto_assignment: 0,
      custom_field_template: 'Order editor test',
      meta_data: [
        {
          label: 'CASH NEEDS TO BE COLLECTED',
          data: String(orderData.codAmount)
        }
      ]
    };

    if (tags && tags.length > 0) deliveryPayload.tags = tags;
    if (orderData.assignedDriver) deliveryPayload.fleet_id = orderData.assignedDriver;

    console.log('Creating DELIVERY task for reorder...');
    const deliveryResponse = await fetch('https://api.tookanapp.com/v2/create_task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deliveryPayload)
    });

    const deliveryData = await deliveryResponse.json();
    if (deliveryData.status !== 200) {
      return res.status(500).json({
        status: 'error',
        message: deliveryData.message || 'Failed to create delivery task for reorder'
      });
    }

    const deliveryOrderId = deliveryData.data?.job_id || null;
    console.log('✅ Delivery task created:', deliveryOrderId);
    console.log('✅ Reorder complete - Pickup:', pickupOrderId, 'Delivery:', deliveryOrderId);

    // Save BOTH tasks to Supabase
    if (isConfigured()) {
      try {
        if (pickupOrderId) {
          await taskModel.upsertTask(pickupOrderId, {
            job_id: pickupOrderId,
            customer_name: orderData.customerName,
            customer_phone: orderData.customerPhone,
            customer_email: orderData.customerEmail || null,
            pickup_address: orderData.pickupAddress,
            delivery_address: orderData.pickupAddress,
            cod_amount: orderData.codAmount,
            order_fees: orderData.orderFees,
            notes: orderData.notes || '',
            fleet_id: orderData.assignedDriver || null,
            status: 0,
            creation_datetime: new Date().toISOString(),
            source: 'reorder_pickup',
            tags: tags || null,
            last_synced_at: new Date().toISOString()
          });
          console.log('✅ Pickup task saved to Supabase:', pickupOrderId);
        }

        if (deliveryOrderId) {
          await taskModel.upsertTask(deliveryOrderId, {
            job_id: deliveryOrderId,
            customer_name: orderData.customerName,
            customer_phone: orderData.customerPhone,
            customer_email: orderData.customerEmail || null,
            pickup_address: orderData.pickupAddress,
            delivery_address: orderData.deliveryAddress,
            cod_amount: orderData.codAmount,
            order_fees: orderData.orderFees,
            notes: orderData.notes || '',
            fleet_id: orderData.assignedDriver || null,
            status: 0,
            creation_datetime: new Date().toISOString(),
            source: 'reorder_delivery',
            tags: tags || null,
            last_synced_at: new Date().toISOString()
          });
          console.log('✅ Delivery task saved to Supabase:', deliveryOrderId);
        }
      } catch (dbError) {
        console.error('⚠️ Failed to save reorder tasks to Supabase:', dbError.message);
      }
    }

    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'reorder',
      entity: 'order',
      message: 'Re-order created successfully (2 tasks: Pickup + Delivery)',
      data: {
        pickupOrderId,
        deliveryOrderId,
        originalOrderId: orderId,
        tasksCreated: 2
      }
    });
  } catch (error) {
    console.error('❌ Re-order error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// RETURN Order
app.post('/api/tookan/order/return', authenticate, requirePermission('perform_reorder'), async (req, res) => {
  try {
    if (process.env.DISABLE_ORDER_CREATION === 'true') {
      return res.status(400).json({
        status: 'error',
        message: 'Order creation is disabled on this runtime (use serverless/Vercel only).'
      });
    }
    console.log('\n=== RETURN ORDER REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const apiKey = getApiKey();
    const { orderId, customerName, customerPhone, customerEmail, pickupAddress, deliveryAddress, notes } = req.body;

    if (!orderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Order ID is required',
        data: {}
      });
    }

    // Use data from request body if provided, otherwise fetch from Tookan
    let orderData = {
      customerName: customerName || '',
      customerPhone: customerPhone || '',
      customerEmail: customerEmail || '',
      pickupAddress: pickupAddress || '',
      deliveryAddress: deliveryAddress || '',
      notes: notes || ''
    };

    // Only fetch from Tookan if addresses not provided
    if (!orderData.pickupAddress || !orderData.deliveryAddress) {
      console.log('ðŸ“‹ Fetching order data from Tookan for return...');
      const getTaskPayload = {
        api_key: apiKey,
        job_id: orderId
      };

      const getResponse = await fetch('https://api.tookanapp.com/v2/get_task_details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(getTaskPayload),
      });

      const getTextResponse = await getResponse.text();
      let getData;
      try {
        getData = JSON.parse(getTextResponse);
      } catch (parseError) {
        return res.status(500).json({
          status: 'error',
          message: 'Failed to fetch order for return',
          data: {}
        });
      }

      if (!getResponse.ok || getData.status !== 200) {
        return res.status(getResponse.status || 500).json({
          status: 'error',
          message: getData.message || 'Order not found',
          data: {}
        });
      }

      const currentTask = getData.data || {};

      // Merge with fetched data
      orderData.customerName = orderData.customerName || currentTask.customer_name || currentTask.customer_username || 'Customer';
      orderData.customerPhone = orderData.customerPhone || currentTask.customer_phone || '';
      orderData.customerEmail = orderData.customerEmail || currentTask.customer_email || '';
      orderData.pickupAddress = orderData.pickupAddress || currentTask.job_pickup_address || currentTask.pickup_address || '';
      orderData.deliveryAddress = orderData.deliveryAddress || currentTask.customer_address || currentTask.job_address || currentTask.delivery_address || '';
      orderData.notes = orderData.notes || currentTask.customer_comments || '';
    }

    // Get tags for return order
    const returnTaskData = {
      customerName: orderData.customerName,
      customerPhone: orderData.customerPhone,
      pickupAddress: orderData.deliveryAddress, // Reversed
      deliveryAddress: orderData.pickupAddress, // Reversed
      ...orderData
    };
    const tags = tagService.getTagsForTask(returnTaskData);

    // Get original addresses (from request body or merged data)
    const originalPickupAddr = (orderData.pickupAddress || '').trim();
    const originalDeliveryAddr = (orderData.deliveryAddress || '').trim();

    // Determine task type:
    // - Pickup tasks have SAME pickup and delivery address
    // - Delivery tasks have DIFFERENT pickup and delivery address
    const isPickupTask = originalPickupAddr === originalDeliveryAddr;
    const isDeliveryTask = originalPickupAddr !== originalDeliveryAddr;

    // Return Order is ONLY available for delivery tasks
    if (isPickupTask || !originalDeliveryAddr) {
      console.log('âŒ Return Order not available: This is a pickup task (pickup and delivery addresses are the same)');
      return res.status(400).json({
        status: 'error',
        message: 'Return Order is not available for pickup tasks. Pickup tasks already involve collecting items from the customer location - there is nothing to return. Return Order is only available for delivery tasks where items were delivered to a customer and need to be picked up back.',
        data: {}
      });
    }

    console.log('âœ… Original task is a delivery task â†’ Creating PICKUP + DELIVERY return tasks');
    console.log(`  Original pickup (merchant): ${originalPickupAddr}`);
    console.log(`  Original delivery (customer): ${originalDeliveryAddr}`);
    console.log(`  Return PICKUP: From customer location: ${originalDeliveryAddr}`);
    console.log(`  Return DELIVERY: To merchant location: ${originalPickupAddr}`);

    // Task time
    const now = new Date();
    const pickupTime = new Date(now.getTime() + 1 * 60 * 60 * 1000); // +1 hour for pickup
    const deliveryTime = new Date(now.getTime() + 3 * 60 * 60 * 1000); // +3 hours for delivery
    const formatDateTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

    // Timezone for Bahrain (UTC+3) = -180 minutes
    const timezone = '-180';

    // For return: 
    // - PICKUP from customer location (original delivery address)
    // - DELIVERY to merchant location (original pickup address)
    const returnPickupAddr = originalDeliveryAddr;
    const returnDeliveryAddr = originalPickupAddr;

    // Get assigned driver
    const assignedDriver = orderData.assignedDriver || null;

    // ========== TASK 1: PICKUP from customer ==========
    // PICKUP tasks use job_pickup_* fields, not customer_* fields
    const pickupPayload = {
      api_key: apiKey,
      job_pickup_name: orderData.customerName || 'Customer',
      job_pickup_phone: orderData.customerPhone || '',
      job_pickup_email: orderData.customerEmail || '',
      job_pickup_address: returnPickupAddr,
      job_pickup_datetime: formatDateTime(pickupTime),
      has_pickup: 1,
      has_delivery: 0,
      layout_type: 0,
      timezone: timezone,
      cod: 0, // COD removed for returns
      order_payment: parseFloat(orderData.orderFees) || 0,
      job_description: orderData.notes || '',
      auto_assignment: 0,
    };

    // Assign agent to pickup task
    if (assignedDriver) {
      pickupPayload.fleet_id = assignedDriver;
    }

    // Add tags if any
    if (tags && tags.length > 0) {
      pickupPayload.tags = tags;
    }

    console.log('Creating PICKUP task...');
    console.log('Pickup payload:', JSON.stringify({ ...pickupPayload, api_key: '***HIDDEN***' }, null, 2));

    const pickupResponse = await fetch('https://api.tookanapp.com/v2/create_task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pickupPayload),
    });

    const pickupTextResponse = await pickupResponse.text();
    let pickupData;
    try {
      pickupData = JSON.parse(pickupTextResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: `Pickup task API returned non-JSON response: ${pickupTextResponse.substring(0, 200)}`,
        data: {}
      });
    }

    if (!pickupResponse.ok || pickupData.status !== 200) {
      return res.status(pickupResponse.status || 500).json({
        status: 'error',
        message: pickupData.message || 'Failed to create pickup return task',
        data: {}
      });
    }

    const pickupOrderId = pickupData.data?.job_id || pickupData.data?.jobId || null;
    console.log('âœ… Pickup task created:', pickupOrderId);

    // ========== TASK 2: DELIVERY to merchant ==========
    // DELIVERY tasks only need customer_address
    const deliveryPayload = {
      api_key: apiKey,
      customer_username: orderData.customerName || 'Customer',
      customer_phone: orderData.customerPhone || '',
      customer_email: orderData.customerEmail || '',
      customer_address: returnDeliveryAddr,
      job_delivery_datetime: formatDateTime(deliveryTime),
      has_pickup: 0,
      has_delivery: 1,
      layout_type: 0,
      timezone: timezone,
      cod: 0, // COD removed for returns
      order_payment: parseFloat(orderData.orderFees) || 0,
      job_description: orderData.notes || '',
      auto_assignment: 0,
    };

    // Assign SAME agent to delivery task
    if (assignedDriver) {
      deliveryPayload.fleet_id = assignedDriver;
    }

    // Add tags if any
    if (tags && tags.length > 0) {
      deliveryPayload.tags = tags;
    }

    console.log('Creating DELIVERY task...');
    console.log('Delivery payload:', JSON.stringify({ ...deliveryPayload, api_key: '***HIDDEN***' }, null, 2));

    const response = await fetch('https://api.tookanapp.com/v2/create_task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deliveryPayload),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: `API returned non-JSON response: ${textResponse.substring(0, 200)}`,
        data: {}
      });
    }

    if (!response.ok || data.status !== 200) {
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to create return order',
        data: {}
      });
    }

    const deliveryOrderId = data.data?.job_id || data.data?.jobId || null;

    console.log('âœ… Delivery task created:', deliveryOrderId);
    console.log('âœ… Return order complete - Pickup:', pickupOrderId, 'Delivery:', deliveryOrderId);

    // Save BOTH return tasks to Supabase for caching
    if (isConfigured()) {
      try {
        // Save PICKUP task - pickup_address = delivery_address (same location for pickup tasks)
        if (pickupOrderId) {
          const pickupTaskRecord = {
            job_id: pickupOrderId,
            order_id: pickupData.data?.order_id || null,
            customer_name: orderData.customerName || 'Customer',
            customer_phone: orderData.customerPhone || '',
            customer_email: orderData.customerEmail || null,
            pickup_address: returnPickupAddr,
            delivery_address: returnPickupAddr, // SAME as pickup - Tookan pickup task format
            cod_amount: 0,
            order_fees: parseFloat(orderData.orderFees) || 0,
            notes: orderData.notes || '',
            fleet_id: assignedDriver,
            status: 0,
            creation_datetime: new Date().toISOString(),
            source: 'return_pickup',
            tags: tags || null,
            last_synced_at: new Date().toISOString()
          };
          await taskModel.upsertTask(pickupOrderId, pickupTaskRecord);
          console.log('âœ… Pickup task saved to Supabase:', pickupOrderId);
        }

        // Save DELIVERY task with both addresses
        if (deliveryOrderId) {
          const deliveryTaskRecord = {
            job_id: deliveryOrderId,
            order_id: data.data?.order_id || null,
            customer_name: orderData.customerName || 'Customer',
            customer_phone: orderData.customerPhone || '',
            customer_email: orderData.customerEmail || null,
            pickup_address: returnPickupAddr,
            delivery_address: returnDeliveryAddr,
            cod_amount: 0,
            order_fees: parseFloat(orderData.orderFees) || 0,
            notes: orderData.notes || '',
            fleet_id: assignedDriver,
            status: 0,
            creation_datetime: new Date().toISOString(),
            source: 'return_delivery',
            tags: tags || null,
            last_synced_at: new Date().toISOString()
          };
          await taskModel.upsertTask(deliveryOrderId, deliveryTaskRecord);
          console.log('âœ… Delivery task saved to Supabase:', deliveryOrderId);
        }
      } catch (dbError) {
        console.error('âš ï¸ Failed to save return tasks to Supabase:', dbError.message);
      }
    }

    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'return_order',
      entity: 'order',
      message: 'Return order created successfully (Pickup + Delivery tasks)',
      data: {
        pickupOrderId: pickupOrderId,
        deliveryOrderId: deliveryOrderId,
        originalOrderId: orderId,
        assignedDriver: assignedDriver
      }
    });
  } catch (error) {
    console.error('âŒ Return order error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});



// CHECK Order Conflicts
app.get('/api/tookan/order/:orderId/conflicts', authenticate, async (req, res) => {
  try {
    console.log('\n=== CHECK ORDER CONFLICTS REQUEST ===');
    console.log('Order ID:', req.params.orderId);
    console.log('Local timestamp:', req.query.localTimestamp);

    const apiKey = getApiKey();
    const orderId = req.params.orderId;
    const localTimestamp = req.query.localTimestamp;

    if (!orderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Order ID is required',
        data: {}
      });
    }

    if (!localTimestamp) {
      return res.status(400).json({
        status: 'error',
        message: 'Local timestamp is required',
        data: {}
      });
    }

    // Fetch order from Tookan
    const getTaskPayload = {
      api_key: apiKey,
      job_id: orderId
    };

    const getResponse = await fetch('https://api.tookanapp.com/v2/get_task_details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(getTaskPayload),
    });

    const getTextResponse = await getResponse.text();
    let getData;
    try {
      getData = JSON.parse(getTextResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch order for conflict check',
        data: {}
      });
    }

    if (!getResponse.ok || getData.status !== 200) {
      return res.status(getResponse.status || 500).json({
        status: 'error',
        message: getData.message || 'Order not found',
        data: {}
      });
    }

    const taskData = getData.data || {};
    const tookanTimestamp = taskData.updated_at || taskData.creation_datetime || new Date().toISOString();

    // Compare timestamps
    const localTime = new Date(localTimestamp).getTime();
    const tookanTime = new Date(tookanTimestamp).getTime();
    const hasConflict = tookanTime > localTime;

    console.log('Conflict check result:', hasConflict ? 'CONFLICT DETECTED' : 'NO CONFLICT');
    console.log('Local timestamp:', localTimestamp);
    console.log('Tookan timestamp:', tookanTimestamp);
    console.log('=== END REQUEST ===\n');

    res.json({
      status: 'success',
      action: 'check_conflicts',
      entity: 'order',
      message: hasConflict ? 'Conflict detected' : 'No conflict',
      data: {
        hasConflict: hasConflict,
        localTimestamp: localTimestamp,
        tookanTimestamp: tookanTimestamp
      }
    });
  } catch (error) {
    console.error('âŒ Conflict check error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// WEBHOOK Receiver
app.post('/api/tookan/webhook', async (req, res) => {
  let eventId = null;

  try {
    console.log('\n=== WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Webhook payload:', JSON.stringify(req.body, null, 2));

    const webhookData = req.body;

    // Log webhook event
    const eventType = webhookData.event_type || webhookData.type || 'unknown';
    const orderId = webhookData.job_id || webhookData.order_id || webhookData.task_id || 'unknown';

    console.log('Event Type:', eventType);
    console.log('Order ID:', orderId);

    // Persist webhook event to database
    if (isConfigured()) {
      try {
        const event = await webhookEventsModel.createEvent({
          event_type: eventType,
          job_id: orderId !== 'unknown' ? parseInt(orderId) : null,
          payload: webhookData
        });
        eventId = event.id;
        console.log('âœ… Webhook event persisted to database, ID:', eventId);
      } catch (persistError) {
        console.error('âš ï¸  Failed to persist webhook event:', persistError.message);
        // Continue processing even if persistence fails
      }
    }

    let processed = false;
    let eventAction = 'logged';
    let processingError = null;

    // Process webhook based on event type
    // Common events: task_created, task_updated, task_completed, task_assigned, etc.
    if (eventType.includes('task') || eventType.includes('order') || eventType.includes('job') || orderId !== 'unknown') {
      console.log('Processing order-related webhook event');
      console.log('â³ Waiting 10 seconds for Tookan data propagation...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      let taskDataToUpdate = webhookData;

      // Fetch fresh task details from Tookan API
      if (orderId && orderId !== 'unknown') {
        try {
          console.log(`ðŸ”„ Fetching fresh details for Job ID: ${orderId}`);
          const apiKey = getApiKey();
          const getTaskPayload = {
            api_key: apiKey,
            job_id: orderId
          };

          const getResponse = await fetch('https://api.tookanapp.com/v2/get_task_details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getTaskPayload),
          });

          if (getResponse.ok) {
            const getData = await getResponse.json();
            if (getData.status === 200 && getData.data) {
              console.log('âœ… Fresh task details fetched successfully');

              // Merge fresh data with webhook data, prioritizing fresh data
              // We keep webhook event info (type, etc.) but overwrite task properties
              const freshTask = getData.data;

              // Map Tookan's varied date fields to our standard usage
              const completedTime = freshTask.job_completed_datetime ||
                freshTask.completed_datetime ||
                freshTask.job_delivered_datetime ||
                freshTask.acknowledged_datetime ||
                webhookData.completed_datetime;

              taskDataToUpdate = {
                ...webhookData,
                ...freshTask,
                // Ensure explicit fields we care about are carried over/mapped
                completed_datetime: completedTime,
                job_status: freshTask.job_status || freshTask.status || webhookData.job_status,
                // Ensure template fields are preserved/merged
                template_fields: { ...(webhookData.template_fields || {}), ...(freshTask.template_fields || {}) },
                custom_fields: { ...(webhookData.custom_fields || {}), ...(freshTask.custom_fields || {}) }
              };

              console.log('ðŸ“… Confirmed completed_datetime:', taskDataToUpdate.completed_datetime);
            }
          }
        } catch (fetchError) {
          console.error('âš ï¸ Failed to fetch fresh task details:', fetchError.message);
          // Fallback to original webhook data
        }

        // Fetch COD amount from get_job_details with job_additional_info
        try {
          console.log(`ðŸ’° Fetching COD amount for Job ID: ${orderId}`);
          const apiKey = getApiKey();

          const codResponse = await fetch('https://api.tookanapp.com/v2/get_job_details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: apiKey,
              job_ids: [parseInt(orderId)],
              include_task_history: 0,
              job_additional_info: 1,
              include_job_report: 0
            }),
          });

          if (codResponse.ok) {
            const codData = await codResponse.json();
            if (codData.status === 200 && codData.data && codData.data.length > 0) {
              const jobData = codData.data[0];
              const customFields = jobData.custom_field || [];

              if (Array.isArray(customFields)) {
                const codField = customFields.find(field =>
                  field.label === 'CASH_NEEDS_TO_BE_COLLECTED' ||
                  field.display_name === 'CASH NEEDS TO BE COLLECTED'
                );

                if (codField && codField.data) {
                  const codValue = parseFloat(codField.data);
                  if (!isNaN(codValue)) {
                    taskDataToUpdate.cod_amount = codValue;
                    console.log('âœ… COD amount found:', codValue);
                  }
                }
              }

              // Also merge tags if available
              if (jobData.tags) {
                taskDataToUpdate.tags = jobData.tags;
              }
            }
          }
        } catch (codFetchError) {
          console.error('âš ï¸ Failed to fetch COD amount:', codFetchError.message);
          // Continue without COD
        }
      }

      // Update task storage with COD data from template fields
      try {
        const updatedTask = await taskStorage.updateTaskFromWebhook(taskDataToUpdate);

        if (updatedTask) {
          processed = true;
          eventAction = 'task_updated';
          console.log('âœ… Task updated in local storage');
          console.log('  COD Amount:', updatedTask.cod_amount);
          console.log('  COD Collected:', updatedTask.cod_collected);

          // Mark event as processed
          if (eventId && isConfigured()) {
            try {
              await webhookEventsModel.markProcessed(eventId);
            } catch (markError) {
              console.error('âš ï¸  Failed to mark event as processed:', markError.message);
            }
          }

          // In a real implementation, you would:
          // 1. Notify frontend if order is currently loaded (via WebSocket/SSE)
          // 2. Trigger conflict detection if needed
        } else {
          console.log('âš ï¸  Could not update task (missing job_id)');
          if (eventId && isConfigured()) {
            try {
              await webhookEventsModel.markProcessed(eventId);
            } catch (markError) {
              console.error('âš ï¸  Failed to mark event as processed:', markError.message);
            }
          }
        }
      } catch (storageError) {
        console.error('âŒ Error updating task storage:', storageError);
        processingError = storageError.message || 'Task storage update failed';

        // Mark event as failed
        if (eventId && isConfigured()) {
          try {
            await webhookEventsModel.markFailed(eventId, processingError);
          } catch (markError) {
            console.error('âš ï¸  Failed to mark event as failed:', markError.message);
          }
        }
        // Continue processing even if storage fails
      }
    } else {
      // Event not related to tasks, mark as processed
      if (eventId && isConfigured()) {
        try {
          await webhookEventsModel.markProcessed(eventId);
        } catch (markError) {
          console.error('âš ï¸  Failed to mark event as processed:', markError.message);
        }
      }
    }

    // Always return 200 OK to acknowledge receipt (even if processing fails)
    console.log(`âœ… Webhook processed: ${eventAction}`);
    console.log('=== END WEBHOOK ===\n');

    res.status(200).json({
      status: 'success',
      message: 'Webhook received and processed',
      data: {
        eventType: eventType,
        eventAction: eventAction,
        orderId: orderId,
        processed: processed,
        eventId: eventId
      },
      note: processed ? 'Task data updated from webhook template fields.' : 'Webhook logged but no task update performed.'
    });
  } catch (error) {
    console.error('âŒ Webhook processing error:', error);
    console.error('Error stack:', error.stack);

    // Mark event as failed if we have an eventId
    if (typeof eventId !== 'undefined' && eventId !== null && isConfigured()) {
      try {
        await webhookEventsModel.markFailed(eventId, error.message || 'Webhook processing failed');
      } catch (markError) {
        console.error('âš ï¸  Failed to mark event as failed:', markError.message);
      }
    }

    // Still return 200 to prevent Tookan from retrying
    res.status(200).json({
      status: 'error',
      message: 'Webhook received but processing failed',
      data: {}
    });
  }
});

// ============================================
// WEBHOOK MONITORING ENDPOINTS
// ============================================

// GET Webhook Events (Admin only)
app.get('/api/webhooks/events', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured',
        data: {}
      });
    }

    let events = [];
    if (status) {
      if (status === 'pending') {
        events = await webhookEventsModel.getPendingEvents(3);
      } else if (status === 'failed') {
        events = await webhookEventsModel.getFailedEvents();
      } else if (status === 'processed') {
        // Get processed events (limit to recent ones)
        const { data, error } = await supabase
          .from('webhook_events')
          .select('*')
          .eq('status', 'processed')
          .order('created_at', { ascending: false })
          .limit(parseInt(limit) || 100);
        if (!error && data) {
          events = data;
        }
      }
    } else {
      // Get all events (pending and failed)
      const [pending, failed] = await Promise.all([
        webhookEventsModel.getPendingEvents(3),
        webhookEventsModel.getFailedEvents()
      ]);
      events = [...pending, ...failed];
    }

    res.json({
      status: 'success',
      message: 'Webhook events retrieved successfully',
      data: {
        events: events.slice(offset, offset + parseInt(limit)),
        total: events.length
      }
    });
  } catch (error) {
    console.error('Get webhook events error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get webhook events',
      data: {}
    });
  }
});

// GET Pending Webhook Events Count
app.get('/api/webhooks/events/pending', authenticate, async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured',
        data: {}
      });
    }

    const events = await webhookEventsModel.getPendingEvents(3);

    res.json({
      status: 'success',
      message: 'Pending events count retrieved successfully',
      data: {
        count: events.length
      }
    });
  } catch (error) {
    console.error('Get pending events count error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get pending events count',
      data: {}
    });
  }
});

// GET Failed Webhook Events (Admin only)
app.get('/api/webhooks/events/failed', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured',
        data: {}
      });
    }

    const events = await webhookEventsModel.getFailedEvents();

    res.json({
      status: 'success',
      message: 'Failed events retrieved successfully',
      data: {
        events: events
      }
    });
  } catch (error) {
    console.error('Get failed events error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get failed events',
      data: {}
    });
  }
});

// POST Retry Webhook Event (Admin only)
app.post('/api/webhooks/events/:id/retry', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured',
        data: {}
      });
    }

    // Reset event for retry
    const event = await webhookEventsModel.resetForRetry(parseInt(id));

    res.json({
      status: 'success',
      message: 'Event reset for retry successfully',
      data: {
        event: event
      }
    });
  } catch (error) {
    console.error('Retry webhook event error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to retry event',
      data: {}
    });
  }
});

// ============================================
// TASK STORAGE - COD DATA ENDPOINTS
// ============================================

// GET Task with COD Data (from local storage)
app.get('/api/tookan/task/:jobId', authenticate, async (req, res) => {
  try {
    const jobId = req.params.jobId;

    if (!jobId) {
      return res.status(400).json({
        status: 'error',
        message: 'Job ID is required',
        data: {}
      });
    }

    const task = await taskStorage.getTask(jobId);

    if (!task) {
      return res.status(404).json({
        status: 'error',
        message: 'Task not found in local storage',
        data: {}
      });
    }

    res.json({
      status: 'success',
      message: 'Task data retrieved successfully',
      data: task
    });
  } catch (error) {
    console.error('âŒ Get task error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get task',
      data: {}
    });
  }
});

// GET Task History
app.get('/api/tookan/task/:jobId/history', authenticate, async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const limit = req.query.limit ? parseInt(req.query.limit) : null;

    if (!jobId) {
      return res.status(400).json({
        status: 'error',
        message: 'Job ID is required',
        data: []
      });
    }

    const history = await taskStorage.getTaskHistory(jobId, limit);

    res.json({
      status: 'success',
      message: 'Task history retrieved successfully',
      data: history
    });
  } catch (error) {
    console.error('âŒ Get task history error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get task history',
      data: []
    });
  }
});

// PUT Update COD in Tookan
app.put('/api/tookan/task/:jobId/cod', authenticate, requirePermission('edit_order_financials'), async (req, res) => {
  try {
    console.log('\n=== UPDATE COD REQUEST ===');
    console.log('Job ID:', req.params.jobId);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const apiKey = getApiKey();
    const jobId = req.params.jobId;
    const { cod_amount, cod_collected } = req.body;

    if (!jobId) {
      return res.status(400).json({
        status: 'error',
        message: 'Job ID is required',
        data: {}
      });
    }

    // Validate COD data
    if (cod_amount !== undefined && (isNaN(cod_amount) || cod_amount < 0)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid COD amount',
        data: {}
      });
    }

    // Update local storage first
    const task = await taskStorage.getTask(jobId) || {};
    const oldCodAmount = task.cod_amount;
    const oldCodCollected = task.cod_collected;

    const updatedTask = await taskStorage.updateTask(jobId, {
      ...task,
      cod_amount: cod_amount !== undefined ? parseFloat(cod_amount) : task.cod_amount,
      cod_collected: cod_collected !== undefined ? Boolean(cod_collected) : task.cod_collected
    });

    // Log to history if changed
    if (oldCodAmount !== updatedTask.cod_amount || oldCodCollected !== updatedTask.cod_collected) {
      await taskStorage.addHistoryEntry(jobId, {
        field: 'cod',
        old_value: {
          cod_amount: oldCodAmount,
          cod_collected: oldCodCollected
        },
        new_value: {
          cod_amount: updatedTask.cod_amount,
          cod_collected: updatedTask.cod_collected
        },
        changed_at: new Date().toISOString(),
        source: 'api'
      });

      // Audit log
      await auditLogger.createAuditLog(
        req,
        'order_update',
        'task',
        jobId,
        { cod_amount: oldCodAmount, cod_collected: oldCodCollected },
        { cod_amount: updatedTask.cod_amount, cod_collected: updatedTask.cod_collected }
      );
    }

    // Try to update in Tookan via edit_task API
    // Using custom_field_template and meta_data as per user's workflow
    try {
      // Convert job_id to number (Tookan API requires numeric job_id)
      const numericJobId = parseInt(jobId, 10);
      if (isNaN(numericJobId)) {
        throw new Error(`Invalid job_id: ${jobId}. Must be a valid number.`);
      }

      // Build the meta_data array for COD custom field
      const metaData = [];
      if (cod_amount !== undefined) {
        metaData.push({
          label: 'CASH_NEEDS_TO_BE_COLLECTED',
          data: String(cod_amount)
        });
      }

      // Build Tookan payload
      const tookanPayload = {
        api_key: apiKey,
        job_id: numericJobId,
        custom_field_template: 'Order_editor_test',
        meta_data: metaData
      };

      // Add job_description (notes) if provided in request
      const { notes } = req.body;
      if (notes !== undefined) {
        tookanPayload.job_description = notes;
      }

      console.log('\n=== ATTEMPTING TO UPDATE TASK IN TOOKAN ===');
      console.log('Job ID:', numericJobId);
      console.log('Template:', tookanPayload.custom_field_template);
      console.log('Meta Data:', JSON.stringify(metaData, null, 2));
      if (notes !== undefined) {
        console.log('Notes (job_description):', notes);
      }

      // Call Tookan edit_task endpoint
      const response = await fetch('https://api.tookanapp.com/v2/edit_task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tookanPayload),
      });

      const textResponse = await response.text();
      console.log('Tookan API Response Status:', response.status, response.statusText);
      console.log('Tookan API Response Body:', textResponse.substring(0, 500));

      let tookanData;

      try {
        tookanData = JSON.parse(textResponse);
        console.log('Tookan API Parsed Response:', JSON.stringify(tookanData, null, 2));
      } catch (parseError) {
        console.warn('âš ï¸  Tookan API returned non-JSON response, template field update may not be supported');
        console.warn('Parse Error:', parseError.message);
        console.warn('Raw Response:', textResponse);
        tookanData = { status: 0, message: 'Non-JSON response' };
      }

      // Check if Tookan API call was successful
      // Tookan returns status 200 even for errors, so check tookanData.status
      const isSuccess = response.ok && tookanData.status === 200;
      const errorMessage = tookanData.message || textResponse.substring(0, 500);
      const isJobIdError = errorMessage.toLowerCase().includes('job_id should be valid number') ||
        errorMessage.toLowerCase().includes('job_id should be valid') ||
        errorMessage.toLowerCase().includes('job_id must be');

      console.log('\n=== TOOKAN API RESULT ===');
      console.log('HTTP Status:', response.status);
      console.log('Tookan Status:', tookanData.status);
      console.log('Is Success:', isSuccess);
      console.log('Error Message:', errorMessage);
      console.log('Is Job ID Error:', isJobIdError);

      if (isSuccess) {
        console.log('âœ… COD updated in Tookan successfully');
        res.json({
          status: 'success',
          message: 'COD updated successfully in both local storage and Tookan',
          data: {
            task: updatedTask,
            tookan_synced: true,
            tookan_response: tookanData
          }
        });
      } else {
        console.warn('âš ï¸  Tookan API update failed or template fields not supported');
        console.warn('Response Status:', response.status);
        console.warn('Response Message:', errorMessage);
        console.warn('Full Response:', JSON.stringify(tookanData, null, 2));

        res.json({
          status: 'success',
          message: 'COD updated in local storage. Manual update may be required in Tookan dashboard.',
          data: {
            task: updatedTask,
            tookan_synced: false,
            tookan_error: errorMessage,
            is_job_id_error: isJobIdError,
            tookan_response: tookanData,
            tookan_http_status: response.status,
            tookan_api_status: tookanData.status,
            note: isJobIdError
              ? 'âš ï¸ job_id conversion may not be working correctly. Check server logs for details.'
              : 'Template field updates may not be supported by Tookan API. Please update manually in Tookan dashboard if needed.'
          }
        });
      }
    } catch (tookanError) {
      console.error('âŒ Error updating Tookan:', tookanError);
      console.error('Error stack:', tookanError.stack);
      // Still return success since local storage was updated
      const errorMsg = tookanError.message || String(tookanError);
      const isJobIdError = errorMsg.includes('job_id should be valid Number') ||
        errorMsg.includes('job_id should be valid number');

      res.json({
        status: 'success',
        message: 'COD updated in local storage. Tookan sync failed.',
        data: {
          task: updatedTask,
          tookan_synced: false,
          tookan_error: errorMsg,
          is_job_id_error: isJobIdError,
          error: errorMsg
        }
      });
    }

    console.log('=== END REQUEST ===\n');
  } catch (error) {
    console.error('âŒ Update COD error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update COD',
      data: {}
    });
  }
});


// ============================================
// TASK METADATA - INTERNAL CUSTOM FIELDS
// ============================================
// COD DATA AGGREGATION ENDPOINTS
// ============================================

// GET COD Confirmations
app.get('/api/cod/confirmations', authenticate, requirePermission('confirm_cod_payments'), async (req, res) => {
  try {
    console.log('\n=== GET COD CONFIRMATIONS REQUEST ===');
    const { dateFrom, dateTo, driverId, merchantId, status } = req.query;

    // Get all tasks from database or file fallback
    let tasks = [];

    if (isConfigured()) {
      try {
        const filters = {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          driverId: driverId || undefined,
          customerId: merchantId || undefined // merchantId maps to vendor_id/customer_id
        };
        tasks = await taskModel.getAllTasks(filters);
        console.log(`ðŸ“¦ Found ${tasks.length} tasks from database for COD confirmations`);
      } catch (error) {
        console.warn('Database fetch failed, falling back to file storage:', error.message);
        // Fallback to file-based storage
        const tasksData = taskStorage.getAllTasks();
        tasks = Object.values(tasksData.tasks || {});
        console.log(`ðŸ“¦ Found ${tasks.length} tasks from file cache for COD confirmations`);
      }
    } else {
      // Fallback to file-based storage
      const tasksData = taskStorage.getAllTasks();
      tasks = Object.values(tasksData.tasks || {});
      console.log(`ðŸ“¦ Found ${tasks.length} tasks from file cache for COD confirmations`);
    }

    // Filter tasks that have COD
    let codTasks = tasks.filter(task =>
      task.cod_amount && parseFloat(task.cod_amount) > 0
    );

    // Apply additional filters (if not already applied by database)
    if (!isConfigured() || (dateFrom && dateTo)) {
      if (dateFrom && dateTo) {
        const start = new Date(dateFrom);
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);

        codTasks = codTasks.filter(task => {
          const taskDate = new Date(task.creation_datetime || task.job_time || task.webhook_received_at || 0);
          return taskDate >= start && taskDate <= end;
        });
      }

      if (driverId) {
        codTasks = codTasks.filter(task =>
          task.fleet_id?.toString() === driverId?.toString()
        );
      }

      if (merchantId) {
        codTasks = codTasks.filter(task =>
          task.vendor_id?.toString() === merchantId?.toString()
        );
      }
    }

    // Transform to COD confirmation format
    const confirmations = codTasks.map((task, index) => ({
      id: `COD-${task.job_id || index}`,
      orderId: task.job_id || '',
      driverId: task.fleet_id?.toString() || '',
      driverName: task.fleet_name || 'Unknown Driver',
      amount: parseFloat(task.cod_amount || 0),
      date: task.creation_datetime || task.job_time || task.webhook_received_at || new Date().toISOString().split('T')[0],
      status: task.cod_collected ? 'Confirmed' : 'Pending',
      merchant: task.customer_name || 'Unknown Merchant',
      customer: task.customer_name || 'Unknown Customer',
      notes: task.notes || '',
      vendor_id: task.vendor_id || null
    }));

    // Apply status filter
    let filteredConfirmations = confirmations;
    if (status) {
      filteredConfirmations = confirmations.filter(cod =>
        cod.status.toLowerCase() === status.toLowerCase()
      );
    }

    console.log(`âœ… Returning ${filteredConfirmations.length} COD confirmations`);

    res.json({
      status: 'success',
      message: 'COD confirmations fetched successfully',
      data: filteredConfirmations
    });
  } catch (error) {
    console.error('âŒ Get COD confirmations error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch COD confirmations',
      data: []
    });
  }
});

// GET COD Calendar Data
app.get('/api/cod/calendar', authenticate, requirePermission('confirm_cod_payments'), async (req, res) => {
  try {
    console.log('\n=== GET COD CALENDAR REQUEST ===');
    const { dateFrom, dateTo } = req.query;

    // Get all tasks from database or file fallback
    let tasks = [];

    if (isConfigured()) {
      try {
        const filters = {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined
        };
        tasks = await taskModel.getAllTasks(filters);
        console.log(`ðŸ“¦ Found ${tasks.length} tasks from database for COD calendar`);
      } catch (error) {
        console.warn('Database fetch failed, falling back to file storage:', error.message);
        // Fallback to file-based storage
        const tasksData = taskStorage.getAllTasks();
        tasks = Object.values(tasksData.tasks || {});
        console.log(`ðŸ“¦ Found ${tasks.length} tasks from file cache for COD calendar`);
      }
    } else {
      // Fallback to file-based storage
      const tasksData = taskStorage.getAllTasks();
      tasks = Object.values(tasksData.tasks || {});
      console.log(`ðŸ“¦ Found ${tasks.length} tasks from file cache for COD calendar`);
    }

    // Filter tasks that have COD
    let codTasks = tasks.filter(task =>
      task.cod_amount && parseFloat(task.cod_amount) > 0
    );

    // Apply date filter (if not already applied by database)
    if (!isConfigured() || (dateFrom && dateTo)) {
      if (dateFrom && dateTo) {
        const start = new Date(dateFrom);
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);

        codTasks = codTasks.filter(task => {
          const taskDate = new Date(task.creation_datetime || task.job_time || task.webhook_received_at || 0);
          return taskDate >= start && taskDate <= end;
        });
      }
    }

    // Group by date
    const calendarMap = new Map();

    codTasks.forEach(task => {
      const taskDate = new Date(task.creation_datetime || task.job_time || task.webhook_received_at || new Date());
      const dateKey = taskDate.toISOString().split('T')[0]; // YYYY-MM-DD

      if (!calendarMap.has(dateKey)) {
        calendarMap.set(dateKey, {
          date: dateKey,
          codReceived: 0,
          codPending: 0,
          balancePaid: 0,
          note: '',
          codStatus: 'PENDING',
          codId: `CAL-${dateKey}`,
          merchantVendorId: task.vendor_id || null
        });
      }

      const entry = calendarMap.get(dateKey);
      const codAmount = parseFloat(task.cod_amount || 0);

      entry.codReceived += codAmount;

      if (task.cod_collected) {
        entry.balancePaid += codAmount;
      } else {
        entry.codPending += codAmount;
      }

      // Update status if any COD is collected
      if (task.cod_collected) {
        entry.codStatus = entry.codPending > 0 ? 'PENDING' : 'COMPLETED';
      }
    });

    const calendarData = Array.from(calendarMap.values());

    // Sort by date (most recent first)
    calendarData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    console.log(`âœ… Returning ${calendarData.length} calendar entries`);

    res.json({
      status: 'success',
      message: 'COD calendar data fetched successfully',
      data: calendarData
    });
  } catch (error) {
    console.error('âŒ Get COD calendar error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch COD calendar data',
      data: []
    });
  }
});

// GET COD Queue
app.get('/api/cod/queue', authenticate, async (req, res) => {
  try {
    const codQueue = require('./codQueue');
    const queue = await codQueue.getQueue();

    res.json({
      status: 'success',
      message: 'COD queue fetched successfully',
      data: queue
    });
  } catch (error) {
    console.error('âŒ Get COD queue error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch COD queue',
      data: {}
    });
  }
});

// GET Customer/Merchant Wallets
app.get('/api/customers/wallets', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET CUSTOMER WALLETS REQUEST ===');

    const apiKey = getApiKey();

    // Fetch customer wallets from Tookan
    const response = await fetch('https://api.tookanapp.com/v2/fetch_customers_wallet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        is_pagination: 1,
        off_set: 0,
        limit: 1000 // Adjust as needed
      }),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to parse Tookan API response',
        data: []
      });
    }

    if (!response.ok || data.status !== 200) {
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to fetch customer wallets',
        data: []
      });
    }

    // Transform to Financial Panel format
    // Ensure data.data is an array before mapping
    const walletsData = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
    const wallets = walletsData.map((wallet, index) => ({
      id: `CU${String(index + 1).padStart(3, '0')}`,
      vendor_id: wallet.vendor_id || null,
      name: wallet.customer_name || wallet.name || 'Unknown Customer',
      balance: parseFloat(wallet.wallet_balance || 0),
      pending: 0, // Calculate from COD queue if needed
      phone: wallet.phone || wallet.customer_phone || ''
    }));

    console.log(`âœ… Returning ${wallets.length} customer wallets`);

    res.json({
      status: 'success',
      message: 'Customer wallets fetched successfully',
      data: wallets,
      metadata: {
        source: 'Tookan',
        cached: false
      }
    });
  } catch (error) {
    console.error('âŒ Get customer wallets error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch customer wallets',
      data: []
    });
  }
});

// PUT COD Settlement (with wallet update)
app.put('/api/cod/settle/:codId', authenticate, requirePermission('confirm_cod_payments'), async (req, res) => {
  try {
    console.log('\n=== SETTLE COD REQUEST ===');
    const codId = req.params.codId;
    const { paymentMethod, userId } = req.body;

    if (!codId) {
      return res.status(400).json({
        status: 'error',
        message: 'COD ID is required',
        data: {}
      });
    }

    // Extract order ID from COD ID (format: COD-{orderId} or just orderId)
    const orderId = codId.startsWith('COD-') ? codId.substring(4) : codId;

    // Get task from storage
    const task = taskStorage.getTask(orderId);
    if (!task) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found',
        data: {}
      });
    }

    // Check if COD is already collected
    if (!task.cod_collected) {
      return res.status(400).json({
        status: 'error',
        message: 'COD must be collected before settlement',
        data: {}
      });
    }

    const codAmount = parseFloat(task.cod_amount || 0);
    const vendorId = task.vendor_id;

    if (!vendorId) {
      return res.status(400).json({
        status: 'error',
        message: 'Merchant vendor ID not found in order',
        data: {}
      });
    }

    // Update COD status in task storage (mark as settled)
    const updatedTask = taskStorage.updateTask(orderId, {
      ...task,
      cod_settled: true,
      cod_settled_at: new Date().toISOString(),
      cod_settled_by: userId || 'system',
      cod_payment_method: paymentMethod || 'cash'
    });

    // Update merchant wallet via Tookan API
    const apiKey = getApiKey();
    let walletUpdateResult = null;

    try {
      const walletResponse = await fetch('https://api.tookanapp.com/v2/customer_wallet_transaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          vendor_id: vendorId,
          transaction_type: 1, // 1 = credit
          amount: codAmount,
          description: `COD Settlement for Order ${orderId}`,
          transaction_date: new Date().toISOString()
        }),
      });

      const walletData = await walletResponse.json();

      if (walletResponse.ok && walletData.status === 200) {
        walletUpdateResult = walletData.data;
        console.log('âœ… Merchant wallet updated successfully');
      } else {
        console.warn('âš ï¸  Wallet update failed:', walletData.message);
        walletUpdateResult = { error: walletData.message };
      }
    } catch (walletError) {
      console.error('âŒ Error updating wallet:', walletError);
      walletUpdateResult = { error: walletError.message };
    }

    // Log to history
    await taskStorage.addHistoryEntry(orderId, {
      field: 'cod_settlement',
      old_value: {
        cod_settled: false
      },
      new_value: {
        cod_settled: true,
        cod_amount: codAmount,
        payment_method: paymentMethod,
        settled_by: userId
      },
      changed_at: new Date().toISOString(),
      source: 'api'
    });

    console.log(`âœ… COD ${codId} settled successfully`);

    res.json({
      status: 'success',
      message: 'COD settled successfully',
      data: {
        cod: {
          id: codId,
          orderId: orderId,
          amount: codAmount,
          settled: true,
          paymentMethod: paymentMethod,
          settledAt: updatedTask.cod_settled_at
        },
        walletUpdate: walletUpdateResult,
        task: updatedTask
      }
    });
  } catch (error) {
    console.error('âŒ Settle COD error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to settle COD',
      data: {}
    });
  }
});

// GET Task Metadata
app.get('/api/tookan/task/:jobId/metadata', optionalAuth, async (req, res) => {
  try {
    const jobId = req.params.jobId;

    if (!jobId) {
      return res.status(400).json({
        status: 'error',
        message: 'Job ID is required',
        data: {}
      });
    }

    const metadata = await taskStorage.getTaskMetadata(jobId);

    res.json({
      status: 'success',
      message: 'Task metadata retrieved successfully',
      data: metadata
    });
  } catch (error) {
    console.error('âŒ Get task metadata error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get task metadata',
      data: {}
    });
  }
});

// PUT Task Metadata
app.put('/api/tookan/task/:jobId/metadata', authenticate, requirePermission('edit_order_financials'), async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const metadata = req.body;

    if (!jobId) {
      return res.status(400).json({
        status: 'error',
        message: 'Job ID is required',
        data: {}
      });
    }

    if (!metadata || typeof metadata !== 'object') {
      return res.status(400).json({
        status: 'error',
        message: 'Metadata must be an object',
        data: {}
      });
    }

    await taskStorage.setTaskMetadata(jobId, metadata);
    const updatedMetadata = await taskStorage.getTaskMetadata(jobId);

    res.json({
      status: 'success',
      message: 'Task metadata updated successfully',
      data: updatedMetadata
    });
  } catch (error) {
    console.error('âŒ Update task metadata error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update task metadata',
      data: {}
    });
  }
});

// ============================================
// TAG MANAGEMENT - DELIVERY CHARGE TAGS
// ============================================

// GET Tag Configuration
app.get('/api/tookan/tags/config', authenticate, async (req, res) => {
  try {
    const config = tagService.loadTagConfig();
    res.json({
      status: 'success',
      message: 'Tag configuration retrieved successfully',
      data: config
    });
  } catch (error) {
    console.error('âŒ Get tag config error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get tag configuration',
      data: {}
    });
  }
});

// PUT Tag Configuration
app.put('/api/tookan/tags/config', authenticate, requirePermission('edit_order_financials'), async (req, res) => {
  try {
    const newConfig = req.body;

    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({
        status: 'error',
        message: 'Configuration must be an object',
        data: {}
      });
    }

    const success = tagService.updateTagConfig(newConfig);

    if (success) {
      const updatedConfig = tagService.loadTagConfig();
      res.json({
        status: 'success',
        message: 'Tag configuration updated successfully',
        data: updatedConfig
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: 'Failed to save tag configuration',
        data: {}
      });
    }
  } catch (error) {
    console.error('âŒ Update tag config error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update tag configuration',
      data: {}
    });
  }
});

// POST Suggest Tags
app.post('/api/tookan/tags/suggest', authenticate, async (req, res) => {
  try {
    const data = req.body;

    const suggestedTags = tagService.suggestTags(data || {});

    res.json({
      status: 'success',
      message: 'Tags suggested successfully',
      data: {
        tags: suggestedTags,
        input: data
      }
    });
  } catch (error) {
    console.error('âŒ Suggest tags error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to suggest tags',
      data: { tags: [] }
    });
  }
});

// GET All Tags
app.get('/api/tookan/tags', authenticate, async (req, res) => {
  try {
    const tags = tagService.getAllTags();
    res.json({
      status: 'success',
      message: 'Tags retrieved successfully',
      data: { tags }
    });
  } catch (error) {
    console.error('âŒ Get tags error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get tags',
      data: { tags: [] }
    });
  }
});

// ============================================
// REPORTS PANEL - DATA FETCHING ENDPOINTS
// ============================================

// Helper function to extract values from task meta_data / pickup_meta_data
function extractMetaValue(task, labels) {
  const metaFields = [
    ...(task.meta_data || []),
    ...(task.pickup_meta_data || [])
  ];

  for (const field of metaFields) {
    const fieldLabel = (field.label || '').toLowerCase();
    if (labels.some(l => fieldLabel.includes(l.toLowerCase()))) {
      // Handle different field structures
      const value = field.data || field.value || field.fleet_data || '0';
      // Remove currency symbols and parse
      const numStr = String(value).replace(/[^0-9.-]/g, '');
      return parseFloat(numStr) || 0;
    }
  }

  // Fallback to top-level fields
  if (labels.some(l => l.toLowerCase().includes('cod'))) {
    return parseFloat(task.cod || task.cod_amount || 0);
  }
  if (labels.some(l => l.toLowerCase().includes('fee'))) {
    return parseFloat(task.order_payment || 0);
  }
  if (labels.some(l => l.toLowerCase().includes('price') || l.toLowerCase().includes('value') || l.toLowerCase().includes('total'))) {
    return parseFloat(task.total_amount || task.order_value || task.cod || 0);
  }

  return 0;
}

// GET All Orders (with filters)
// Cache-first strategy: Check Supabase cache, fallback to Tookan API
// Supports 6-month date range (Tookan only keeps 6 months of data)
app.get('/api/tookan/orders', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET ALL ORDERS REQUEST (CACHE-FIRST) ===');
    console.log('Query params:', JSON.stringify(req.query, null, 2));
    console.log('Request received at:', new Date().toISOString());

    const { dateFrom, dateTo, driverId, customerId, status, search, limit = 100, page = 1, forceRefresh } = req.query;

    // Calculate default date range: last 6 months (Tookan only keeps 6 months)
    const formatDate = (date) => date.toISOString().split('T')[0];
    const today = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    let startDate = dateFrom || formatDate(sixMonthsAgo);
    let endDate = dateTo || formatDate(today);

    // Validate dates don't exceed 6 months ago
    const sixMonthsAgoDate = new Date();
    sixMonthsAgoDate.setMonth(sixMonthsAgoDate.getMonth() - 6);
    const requestedStart = new Date(startDate);
    if (requestedStart < sixMonthsAgoDate) {
      startDate = formatDate(sixMonthsAgoDate);
      console.log(`âš ï¸  Start date adjusted to 6 months ago: ${startDate}`);
    }

    console.log(`ðŸ“… Date range: ${startDate} to ${endDate}`);

    // Check if Supabase is configured and cache is available
    let useCache = false;
    let cacheOrders = [];

    if (isConfigured() && !forceRefresh) {
      try {
        // Check if cache is fresh (synced within last 24 hours)
        const isFresh = await taskModel.isCacheFresh(24);
        const cachedCount = await taskModel.getCachedTaskCount(startDate, endDate);

        console.log(`ðŸ“¦ Cache status: ${isFresh ? 'FRESH' : 'STALE'}, ${cachedCount} orders in range`);

        if (isFresh && cachedCount > 0) {
          useCache = true;
          console.log('âœ… Using cached orders from Supabase');

          // Fetch from cache with filters
          cacheOrders = await taskModel.getCachedOrders({
            dateFrom: startDate,
            dateTo: endDate,
            driverId: driverId || null,
            customerId: customerId || null,
            status: status !== undefined ? parseInt(status) : null,
            search: search || null
          });

          console.log(`ðŸ“¦ Retrieved ${cacheOrders.length} orders from cache`);
        }
      } catch (cacheError) {
        console.warn('âš ï¸  Cache check failed, falling back to API:', cacheError.message);
      }
    }

    let allOrders = [];

    if (useCache && cacheOrders.length > 0) {
      allOrders = cacheOrders;
    } else {
      // Fallback to Tookan API with retry logic
      console.log('ðŸ“¥ Fetching from Tookan API (cache miss or stale)...');

      const apiKey = getApiKey();
      const batchLimit = 50;
      const jobTypes = [0, 1, 2, 3]; // Pickup, Delivery, Appointment, FOS
      const jobTypeNames = ['Pickup', 'Delivery', 'Appointment', 'FOS'];

      // For API, we can only fetch 31 days at a time
      // Split into batches if date range exceeds 31 days
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      const daysDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24));

      // Generate 31-day batches
      const dateBatches = [];
      let currentEnd = new Date(endDateObj);

      while (currentEnd > startDateObj) {
        const batchStart = new Date(currentEnd);
        batchStart.setDate(batchStart.getDate() - 30);
        if (batchStart < startDateObj) {
          batchStart.setTime(startDateObj.getTime());
        }

        dateBatches.push({
          startDate: formatDate(batchStart),
          endDate: formatDate(currentEnd)
        });

        currentEnd = new Date(batchStart);
        currentEnd.setDate(currentEnd.getDate() - 1);
      }

      console.log(`ðŸ“… Split into ${dateBatches.length} date batches (31-day chunks)`);

      // Helper function with retry logic
      const fetchWithRetry = async (url, options, retries = 3) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            const response = await fetch(url, options);
            return response;
          } catch (error) {
            const isSSLError = error.message.includes('SSL') ||
              error.message.includes('ssl') ||
              error.message.includes('decryption') ||
              error.message.includes('ECONNRESET');

            if (isSSLError && attempt < retries) {
              const delay = 1000 * Math.pow(2, attempt - 1);
              console.log(`âš ï¸  Retry ${attempt}/${retries} after ${delay}ms`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            throw error;
          }
        }
      };

      // Fetch tasks for each batch and job type
      const tasks = [];

      for (const batch of dateBatches) {
        console.log(`   Processing batch: ${batch.startDate} to ${batch.endDate}`);

        for (const jobType of jobTypes) {
          let offset = 0;
          let hasMore = true;

          while (hasMore && tasks.length < 10000) {
            const payload = {
              api_key: apiKey,
              job_type: jobType,
              start_date: batch.startDate,
              end_date: batch.endDate,
              is_pagination: 1,
              off_set: offset,
              limit: batchLimit,
              custom_fields: 1
            };

            try {
              const response = await fetchWithRetry('https://api.tookanapp.com/v2/get_all_tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });

              const data = await response.json();

              if (data.status === 200 || data.status === 1) {
                const batchTasks = Array.isArray(data.data) ? data.data : [];
                tasks.push(...batchTasks);

                if (batchTasks.length < batchLimit) {
                  hasMore = false;
                } else {
                  offset += batchLimit;
                }
              } else {
                hasMore = false;
              }
            } catch (err) {
              console.error(`âŒ Error fetching ${jobTypeNames[jobType]} tasks:`, err.message);
              hasMore = false;
            }
          }
        }
      }

      console.log(`âœ… Fetched ${tasks.length} tasks from Tookan API`);

      // Transform and cache the results if Supabase is configured
      if (tasks.length > 0 && isConfigured()) {
        try {
          // Transform tasks to cache format
          const cacheRecords = tasks.map(task => orderSyncService.transformTaskToRecord(task));

          // Bulk upsert to cache (don't await to avoid blocking response)
          taskModel.bulkUpsertTasks(cacheRecords).then(result => {
            console.log(`ðŸ“¦ Cached ${result.inserted} orders to Supabase`);
          }).catch(err => {
            console.warn('âš ï¸  Failed to cache orders:', err.message);
          });
        } catch (cacheErr) {
          console.warn('âš ï¸  Failed to prepare cache:', cacheErr.message);
        }
      }

      // Transform Tookan task data to our order format
      allOrders = tasks.map((task) => {
        const jobId = task.job_id || task.id;
        const jobStatus = task.job_status || task.status || 0;

        const metaCod = extractMetaValue(task, ['COD', 'COD Total', 'Cash on Delivery']);
        const metaFee = extractMetaValue(task, ['Fee', 'Delivery Fee', 'Order Fee', 'Order Fees']);
        const metaValue = extractMetaValue(task, ['Price', 'Order Value', 'Total Value', 'Total', 'Amount']);

        const codAmount = metaCod || parseFloat(task.cod || task.cod_amount || 0);
        const orderPayment = metaFee || parseFloat(task.order_payment || task.order_fees || 0);
        const totalValue = metaValue || (codAmount + orderPayment);

        const creationDate = task.creation_datetime || task.created_at || task.job_time || task.creation_date || new Date().toISOString();
        const driverName = task.fleet_name || task.driver_name || '';
        const driverIdVal = task.fleet_id || task.driver_id || null;
        const customerName = task.customer_name || task.customer_username || task.job_pickup_name || '';
        const customerPhone = task.customer_phone || task.job_pickup_phone || '';
        const merchantName = task.merchant_name || task.vendor_name || '';
        const merchantIdVal = task.vendor_id || task.merchant_id || null;

        return {
          id: jobId?.toString() || '',
          jobId: jobId?.toString() || '',
          job_id: jobId,
          date: creationDate,
          status: jobStatus,
          statusText: getStatusText(jobStatus),
          jobType: task.job_type,
          jobTypeName: jobTypeNames[task.job_type] || 'Unknown',
          merchant: merchantName || customerName,
          merchantId: merchantIdVal || null,
          merchantNumber: task.merchant_phone || '',
          driver: driverName,
          driverId: driverIdVal?.toString() || null,
          customer: customerName,
          customerId: task.customer_id?.toString() || null,
          customerNumber: customerPhone,
          cod: codAmount,
          codAmount: codAmount,
          tookanFees: 0,
          fee: orderPayment,
          orderFees: orderPayment,
          totalValue: totalValue,
          pickupAddress: task.job_pickup_address || task.pickup_address || '',
          deliveryAddress: task.job_address || task.delivery_address || '',
          addresses: `${task.job_pickup_address || task.pickup_address || ''} â†’ ${task.job_address || task.delivery_address || ''}`,
          notes: task.customer_comments || task.job_description || '',
          source: 'api'
        };
      });
    }

    console.log(`âœ… Total orders: ${allOrders.length}`);

    // Apply additional client-side filtering (for filters not applied at cache/API level)
    let filteredOrders = allOrders;

    if (driverId && !useCache) {
      filteredOrders = filteredOrders.filter(order =>
        order.driverId === driverId?.toString() || order.driverId === driverId
      );
    }

    if (customerId && !useCache) {
      filteredOrders = filteredOrders.filter(order =>
        order.customerId === customerId?.toString() || order.merchantId === customerId?.toString()
      );
    }

    if (status !== undefined && status !== '' && !useCache) {
      filteredOrders = filteredOrders.filter(order =>
        order.status === parseInt(status) || order.statusText === status
      );
    }

    if (search && !useCache) {
      const searchLower = search.toLowerCase();
      filteredOrders = filteredOrders.filter(order =>
        (order.id && order.id.toLowerCase().includes(searchLower)) ||
        (order.orderId && order.orderId.toLowerCase().includes(searchLower)) ||
        (order.customer && order.customer.toLowerCase().includes(searchLower)) ||
        (order.driver && order.driver.toLowerCase().includes(searchLower)) ||
        (order.merchant && order.merchant.toLowerCase().includes(searchLower))
      );
    }

    // Apply pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedOrders = filteredOrders.slice(startIndex, startIndex + limitNum);

    console.log(`âœ… Returning ${paginatedOrders.length} orders (page ${pageNum}, total filtered: ${filteredOrders.length})`);
    console.log(`ðŸ“¦ Source: ${useCache ? 'CACHE' : 'API'}`);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'fetch_orders',
      entity: 'order',
      message: 'Orders fetched successfully',
      data: {
        orders: paginatedOrders,
        total: filteredOrders.length,
        totalFetched: allOrders.length,
        page: pageNum,
        limit: limitNum,
        hasMore: filteredOrders.length > startIndex + limitNum,
        source: useCache ? 'cache' : 'api',
        filters: {
          dateFrom: startDate,
          dateTo: endDate,
          driverId: driverId || null,
          customerId: customerId || null,
          status: status || null,
          search: search || null
        }
      }
    });
  } catch (error) {
    console.error('âŒ Get orders error:', error);
    res.status(500).json({
      status: 'error',
      action: 'fetch_orders',
      entity: 'order',
      message: error.message || 'Failed to fetch orders',
      data: {
        orders: [],
        total: 0,
        page: 1,
        limit: parseInt(req.query.limit) || 100,
        hasMore: false
      }
    });
  }
});

// GET Orders from Cache (database-first, paginated, minimal fields)
app.get('/api/tookan/orders/cached', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET CACHED ORDERS REQUEST ===');
    console.log('Query params:', JSON.stringify(req.query, null, 2));

    const { dateFrom, dateTo, driverId, customerId, status, search, limit = 50, page = 1, includePickups } = req.query;

    if (!isConfigured()) {
      return res.status(500).json({
        status: 'error',
        message: 'Supabase not configured',
        data: { orders: [], total: 0, page: 1, limit: 50, hasMore: false }
      });
    }

    const filters = {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      driverId: driverId || undefined,
      customerId: customerId || undefined,
      status: status ? parseInt(status) : undefined,
      search: search || undefined,
      includePickups: includePickups === 'true'
    };

    const result = await taskModel.getAllTasksPaginated(filters, page, limit);

    // Resolve driver phones for the results
    const { data: allAgents } = await supabase.from('agents').select('fleet_id, phone');
    const agentPhoneMap = {};
    if (allAgents) {
      allAgents.forEach(a => {
        // Use string keys to ensure matching works regardless of type (int/string)
        agentPhoneMap[String(a.fleet_id)] = a.phone || '';
      });
    }

    const orders = (result.tasks || []).map(task => {
      const codAmount = parseFloat(task.cod_amount || 0);
      const orderFees = parseFloat(task.order_fees || 0);
      // Ensure fleet_id is handled safely for lookup
      const fleetIdStr = task.fleet_id ? String(task.fleet_id) : '';

      return {
        jobId: task.job_id?.toString() || '',
        job_id: task.job_id,  // Also include snake_case for frontend compatibility
        order_id: task.order_id || '',
        completed_datetime: task.completed_datetime || '',
        codAmount,
        cod_amount: codAmount,  // Also include snake_case
        orderFees,
        order_fees: orderFees,  // Also include snake_case
        fleet_id: task.fleet_id || null,
        assignedDriver: task.fleet_id || null,
        fleet_name: task.fleet_name || '',
        assignedDriverName: task.fleet_name || '',
        vendor_id: task.vendor_id || null,  // Customer/merchant ID
        driver_phone: agentPhoneMap[fleetIdStr] || task.raw_data?.fleet_phone || '',
        driverPhone: agentPhoneMap[fleetIdStr] || task.raw_data?.fleet_phone || '',
        notes: task.notes || '',
        date: task.creation_datetime || null,
        creation_datetime: task.creation_datetime || null,
        customer_name: task.customer_name || '',
        customerName: task.customer_name || '',
        customer_phone: task.customer_phone || '',
        customerPhone: task.customer_phone || '',
        customerEmail: task.customer_email || '',
        pickup_address: task.pickup_address || '',
        pickupAddress: task.pickup_address || '',
        delivery_address: task.delivery_address || '',
        deliveryAddress: task.delivery_address || '',
        status: task.status ?? null,  // 0=Assigned, 1=Started, 2=Successful, 3=Failed
        tags: task.tags || ''
      };
    });

    const hasMore = (result.page * result.limit) < result.total;

    console.log(`âœ… Returning ${orders.length} cached orders (page ${result.page}, total: ${result.total})`);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'fetch_orders_cached',
      entity: 'order',
      message: 'Cached orders fetched successfully',
      data: {
        orders,
        total: result.total,
        page: result.page,
        limit: result.limit,
        hasMore,
        filters: {
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          driverId: driverId || null,
          customerId: customerId || null,
          status: status || null,
          search: search || null
        },
        source: 'database'
      }
    });
  } catch (error) {
    console.error('âŒ Get cached orders error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: { orders: [], total: 0, page: 1, limit: 50, hasMore: false }
    });
  }
});

// ============================================================
// Tookan Webhooks
// ============================================================

// TASK webhook (create/update)
app.post('/api/webhooks/tookan/task', async (req, res) => {
  try {
    const secretHeader = req.headers['x-webhook-secret'];
    const expected = getWebhookSecret();
    const payload = req.body || {};
    const bodySecret = payload.tookan_shared_secret;

    if (!expected || (secretHeader !== expected && bodySecret !== expected)) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }
    const jobId = payload.job_id || payload.id || payload.task_id;

    if (!jobId) {
      return res.status(400).json({ status: 'error', message: 'job_id is required' });
    }

    // Check if task is deleted
    const isDeleted = payload.is_deleted === 1 || payload.is_deleted === '1' || payload.is_deleted === true;

    if (isDeleted) {
      // Remove from Supabase if deleted
      if (isConfigured()) {
        await supabase
          .from('tasks')
          .delete()
          .eq('job_id', parseInt(jobId));
        console.log('âœ… Webhook: Deleted task removed from Supabase:', jobId);
      }
      return res.status(200).json({ status: 'success', message: 'Task deleted from cache' });
    }

    // Debug: Log payload keys to identify completed_datetime field name
    console.log('ðŸ“¥ Webhook payload keys:', Object.keys(payload));
    console.log('ðŸ“… completed_datetime candidates:', {
      completed_datetime: payload.completed_datetime,
      job_delivered_datetime: payload.job_delivered_datetime,
      acknowledged_datetime: payload.acknowledged_datetime,
      completed_date_time: payload.completed_date_time,
      delivery_datetime: payload.delivery_datetime,
      job_status: payload.job_status || payload.status
    });

    const record = {
      job_id: parseInt(jobId) || jobId,
      order_id: payload.order_id || payload.job_pickup_name || '',
      cod_amount: parseFloat(payload.cod_amount || payload.cod || 0),
      order_fees: parseFloat(payload.order_fees || payload.order_payment || 0),
      fleet_id: payload.fleet_id ? parseInt(payload.fleet_id) : null,
      fleet_name: payload.fleet_name || payload.driver_name || payload.username || '',
      notes: payload.customer_comments || payload.customer_comment || payload.notes || '',
      status: payload.job_status || payload.status || null,
      customer_name: payload.customer_name || payload.customer_username || '',
      customer_phone: payload.customer_phone || '',
      customer_email: payload.customer_email || '',
      pickup_address: payload.job_pickup_address || payload.pickup_address || '',
      delivery_address: payload.customer_address || payload.job_address || payload.delivery_address || '',
      creation_datetime: payload.creation_datetime || payload.job_time || payload.created_at || payload.timestamp || new Date().toISOString(),
      // Expanded completed_datetime lookup - check all possible Tookan field names
      completed_datetime: payload.completed_datetime || payload.job_delivered_datetime || payload.acknowledged_datetime || payload.completed_date_time || payload.delivery_datetime || null,
      tags: payload.tags || payload.job_tags || '',
      raw_data: payload,
      last_synced_at: new Date().toISOString()
    };

    console.log('ðŸ“ Record completed_datetime value:', record.completed_datetime);

    await taskModel.upsertTask(record.job_id, record);

    return res.status(200).json({ status: 'success', message: 'Task upserted' });
  } catch (error) {
    console.error('âŒ Webhook task error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Internal error' });
  }
});

// GET Driver Performance statistics via RPC
app.get('/api/reports/driver-performance', authenticate, async (req, res) => {
  try {
    const { search, dateFrom, dateTo, status } = req.query;
    console.log('\n=== GET DRIVER PERFORMANCE (LOCAL) ===');
    console.log('Search:', search, 'From:', dateFrom, 'To:', dateTo, 'Status:', status);

    if (!isConfigured()) {
      return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
    }

    const { supabase } = require('./db/supabase');

    if (!search) {
      return res.json({ status: 'success', data: [] });
    }

    let driverIds = [];
    const searchTerm = search.toString().trim();
    // Normalize search: trim, collapse spaces, lowercase (same as normalized_name column)
    const normalizedSearchName = searchTerm.replace(/\s+/g, ' ').toLowerCase();
    const normalizedSearchPhone = searchTerm.replace(/\D/g, '');

    // Fetch all agents to perform robust matching in JS
    const { data: allAgents, error: agentsError } = await supabase
      .from('agents')
      .select('fleet_id, name, normalized_name, phone');

    if (agentsError) throw agentsError;

    if (allAgents && allAgents.length > 0) {
      const matchedAgents = allAgents.filter(agent => {
        const agentPhoneDigits = String(agent.phone || '').replace(/\D/g, '');
        // Use normalized_name for exact matching
        const agentNormalizedName = agent.normalized_name || String(agent.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
        const agentIdStr = String(agent.fleet_id);

        const nameMatch = agentNormalizedName === normalizedSearchName;
        const idMatch = agentIdStr === searchTerm;
        const phoneMatch = normalizedSearchPhone && agentPhoneDigits === normalizedSearchPhone;


        return nameMatch || idMatch || phoneMatch;
      });

      if (matchedAgents.length > 0) {
        driverIds = matchedAgents.map(a => ({ id: a.fleet_id, name: a.name }));
      } else if (/^\d+$/.test(searchTerm)) {
        // Fallback for numeric ID if not found in table
        driverIds = [{ id: parseInt(searchTerm, 10), name: 'Driver #' + searchTerm }];
      }
    }

    if (driverIds.length === 0) {
      return res.json({ status: 'success', data: [] });
    }

    console.log('ðŸ” Driver IDs found:', JSON.stringify(driverIds));

    // Use RPC function for optimized stats calculation
    const results = await Promise.all(driverIds.map(async (driver) => {
      const { data, error } = await supabase.rpc('get_driver_statistics_v2', {
        p_fleet_id: driver.id,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_status: status ? parseInt(status, 10) : null
      });

      if (error) {
        console.error(`RPC error for driver ${driver.id}:`, error);
        return {
          fleet_id: driver.id,
          name: driver.name,
          total_orders: 0,
          cod_total: 0,
          order_fees: 0,
          avg_delivery_time: 0
        };
      }

      console.log(`ðŸ” RPC response for driver ${driver.id}:`, JSON.stringify(data));
      const stats = data && data[0] ? data[0] : { total_orders: 0, cod_total: 0, order_fees: 0, avg_delivery_time_minutes: 0 };
      return {
        fleet_id: driver.id,
        name: driver.name,
        total_orders: parseInt(stats.total_orders || 0),
        cod_total: parseFloat(stats.cod_total || 0),
        order_fees: parseFloat(stats.order_fees || 0),
        avg_delivery_time: parseFloat(stats.avg_delivery_time_minutes || 0)
      };
    }));

    res.json({ status: 'success', data: results });
  } catch (error) {
    console.error('Driver performance error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// GET Tookan Fee Rate setting
app.get('/api/settings/tookan-fee', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET TOOKAN FEE SETTING ===');

    if (!isConfigured()) {
      // Return default if not configured
      return res.json({ status: 'success', data: { feeRate: 0.05 } });
    }

    const { supabase } = require('./db/supabase');

    // Get from tag_config table (reusing existing table)
    const { data, error } = await supabase
      .from('tag_config')
      .select('config')
      .eq('id', 1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching tookan fee:', error);
    }

    const feeRate = data?.config?.tookanFeeRate ?? 0.05;
    console.log('Tookan fee rate:', feeRate);

    res.json({ status: 'success', data: { feeRate } });
  } catch (error) {
    console.error('Get tookan fee error:', error);
    res.json({ status: 'success', data: { feeRate: 0.05 } }); // Default fallback
  }
});

// PUT Tookan Fee Rate setting
app.put('/api/settings/tookan-fee', authenticate, async (req, res) => {
  try {
    const { feeRate } = req.body;
    console.log('\n=== UPDATE TOOKAN FEE SETTING ===');
    console.log('New fee rate:', feeRate);

    if (typeof feeRate !== 'number' || feeRate < 0) {
      return res.status(400).json({ status: 'error', message: 'Fee rate must be a positive number' });
    }

    if (!isConfigured()) {
      return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
    }

    const { supabase } = require('./db/supabase');

    // Get existing config
    const { data: existingData } = await supabase
      .from('tag_config')
      .select('config')
      .eq('id', 1)
      .single();

    const existingConfig = existingData?.config || {};
    const newConfig = { ...existingConfig, tookanFeeRate: feeRate };

    // Upsert the config
    const { error } = await supabase
      .from('tag_config')
      .upsert({ id: 1, config: newConfig }, { onConflict: 'id' });

    if (error) {
      console.error('Error updating tookan fee:', error);
      return res.status(500).json({ status: 'error', message: error.message });
    }

    console.log('âœ… Tookan fee rate updated to:', feeRate);
    res.json({ status: 'success', data: { feeRate } });
  } catch (error) {
    console.error('Update tookan fee error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// GET Related Delivery Address for Pickup Tasks (Return Orders)
// For pickup tasks where pickup_address = delivery_address, fetch the actual delivery address
app.get('/api/tookan/job/:jobId/related-address', authenticate, async (req, res) => {
  try {
    const { jobId } = req.params;
    console.log('\n=== GET RELATED DELIVERY ADDRESS ===');
    console.log('Job ID:', jobId);

    const apiKey = getApiKey();

    // Step 1: Get job details to find pickup_delivery_relationship
    const jobDetailsResponse = await fetch('https://api.tookanapp.com/v2/get_job_details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        job_ids: [parseInt(jobId)],
        include_task_history: 0,
        job_additional_info: 1,
        include_job_report: 0
      })
    });

    const jobDetailsData = await jobDetailsResponse.json();

    if (jobDetailsData.status !== 200 || !jobDetailsData.data || jobDetailsData.data.length === 0) {
      console.log('Job details not found');
      return res.json({ status: 'error', message: 'Job details not found' });
    }

    const jobData = jobDetailsData.data[0];
    const pickupDeliveryRelationship = jobData.pickup_delivery_relationship;

    if (!pickupDeliveryRelationship) {
      console.log('No pickup_delivery_relationship found');
      return res.json({ status: 'success', data: { hasRelatedTask: false } });
    }

    console.log('Found pickup_delivery_relationship:', pickupDeliveryRelationship);

    // Step 2: Get related tasks to find the delivery address
    const relatedTasksResponse = await fetch('https://api.tookanapp.com/v2/get_related_tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        pickup_delivery_relationship: pickupDeliveryRelationship
      })
    });

    const relatedTasksData = await relatedTasksResponse.json();

    if (relatedTasksData.status !== 200 || !relatedTasksData.data || relatedTasksData.data.length === 0) {
      console.log('Related tasks not found');
      return res.json({ status: 'success', data: { hasRelatedTask: false } });
    }

    // Find the delivery task (the one that is NOT the current pickup task)
    const relatedTasks = relatedTasksData.data;
    const deliveryTask = relatedTasks.find(task =>
      String(task.job_id) !== String(jobId) && task.job_type === 1 // job_type 1 = delivery
    ) || relatedTasks.find(task => String(task.job_id) !== String(jobId));

    if (deliveryTask) {
      console.log('Found delivery task:', deliveryTask.job_id, 'Address:', deliveryTask.job_address);
      return res.json({
        status: 'success',
        data: {
          hasRelatedTask: true,
          deliveryAddress: deliveryTask.job_address || '',
          deliveryJobId: deliveryTask.job_id,
          deliveryCustomerName: deliveryTask.customer_username || deliveryTask.customer_name || ''
        }
      });
    }

    console.log('No delivery task found in related tasks');
    return res.json({ status: 'success', data: { hasRelatedTask: false } });

  } catch (error) {
    console.error('Get related address error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// GET/Sync COD Amount for a single order
// Fetches COD from Tookan's get_job_details API (CASH_NEEDS_TO_BE_COLLECTED in job_additional_info)
app.get('/api/orders/:jobId/sync-cod', authenticate, async (req, res) => {
  try {
    const { jobId } = req.params;
    console.log('\n=== SYNC COD AMOUNT ===');
    console.log('Job ID:', jobId);

    const apiKey = getApiKey();

    // Fetch job details with additional info
    const response = await fetch('https://api.tookanapp.com/v2/get_job_details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        job_ids: [parseInt(jobId)],
        include_task_history: 0,
        job_additional_info: 1,
        include_job_report: 0
      })
    });

    const data = await response.json();

    if (data.status !== 200 || !data.data || data.data.length === 0) {
      console.log('Job details not found');
      return res.json({ status: 'error', message: 'Job details not found' });
    }

    const jobData = data.data[0];

    // Extract COD from custom_field array
    const customFields = jobData.custom_field || [];
    let codAmount = null;

    if (Array.isArray(customFields)) {
      const codField = customFields.find(field =>
        field.label === 'CASH_NEEDS_TO_BE_COLLECTED' ||
        field.display_name === 'CASH NEEDS TO BE COLLECTED'
      );

      if (codField && codField.data) {
        const codValue = parseFloat(codField.data);
        codAmount = isNaN(codValue) ? null : codValue;
      }
    }

    console.log('Found COD amount:', codAmount);

    // Update Supabase if configured
    if (isConfigured() && codAmount !== null) {
      const { supabase } = require('./db/supabase');
      const { error } = await supabase
        .from('tasks')
        .update({
          cod_amount: codAmount,
          updated_at: new Date().toISOString()
        })
        .eq('job_id', parseInt(jobId));

      if (error) {
        console.error('Failed to update COD in Supabase:', error.message);
      } else {
        console.log('âœ… COD updated in Supabase');
      }
    }

    res.json({
      status: 'success',
      data: {
        jobId: parseInt(jobId),
        codAmount: codAmount,
        tags: jobData.tags || null
      }
    });

  } catch (error) {
    console.error('Sync COD error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// GET Customer Performance statistics
app.get('/api/reports/customer-performance', authenticate, async (req, res) => {
  try {
    const { search, dateFrom, dateTo, status } = req.query;
    console.log('\n=== GET CUSTOMER PERFORMANCE (LOCAL) ===');
    console.log('Search:', search, 'From:', dateFrom, 'To:', dateTo, 'Status:', status);

    if (!isConfigured()) {
      return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
    }

    const { supabase } = require('./db/supabase');

    if (!search) {
      return res.json({ status: 'success', data: [] });
    }

    const searchTerm = search.toString().trim();

    // Detect search type: numeric (vendor_id), phone (contains + or all digits), or name
    const isPhoneLike = /^[\d+\s-]+$/.test(searchTerm); // Contains only digits, +, spaces, dashes
    const isNumericOnly = /^\d+$/.test(searchTerm);
    const numericValue = isNumericOnly ? parseInt(searchTerm, 10) : null;
    const isValidVendorId = numericValue && numericValue <= 2147483647;

    let p_customer_name = null;
    let p_vendor_id = null;
    let p_customer_phone = null;

    if (isPhoneLike) {
      // Search by phone number - strip non-digits for exact matching
      const phoneDigits = searchTerm.replace(/\D/g, '');
      p_customer_phone = phoneDigits;
      // Also try vendor_id if it's purely numeric and valid range
      if (isValidVendorId) {
        p_vendor_id = numericValue;
      }
    } else {
      // Search by exact customer name
      p_customer_name = searchTerm;
    }

    console.log('ðŸ” Search params:', { p_customer_name, p_vendor_id, p_customer_phone });

    // Use RPC function for optimized stats calculation
    const { data, error } = await supabase.rpc('get_customer_statistics', {
      p_customer_name,
      p_vendor_id,
      p_customer_phone,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_status: status ? parseInt(status, 10) : null
    });

    if (error) {
      console.error('Customer performance RPC error:', error);
      throw error;
    }

    console.log('ðŸ” RPC results:', data?.length || 0);

    if (!data || data.length === 0) {
      return res.json({ status: 'success', data: [] });
    }

    // Map RPC results to expected format
    const results = data.map(stats => ({
      vendor_id: stats.vendor_id,
      customer_name: stats.customer_name || `Customer #${stats.vendor_id}`,
      total_orders: parseInt(stats.total_orders || 0),
      cod_received: parseFloat(stats.cod_received || 0),
      order_fees: parseFloat(stats.order_fees || 0),
      revenue_distribution: parseFloat(stats.revenue_distribution || 0),

    }));

    console.log('ðŸ” Final results:', results.length);

    res.json({ status: 'success', data: results });
  } catch (error) {
    console.error('Customer performance error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// AGENT webhook (if enabled on Tookan side)
app.post('/api/webhooks/tookan/agent', async (req, res) => {
  try {
    const secretHeader = req.headers['x-webhook-secret'];
    const expected = getWebhookSecret();
    const payload = req.body || {};
    const bodySecret = payload.tookan_shared_secret;

    if (!expected || (secretHeader !== expected && bodySecret !== expected)) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }
    const fleetId = payload.fleet_id || payload.id;

    if (!fleetId) {
      return res.status(400).json({ status: 'error', message: 'fleet_id is required' });
    }

    // Check if agent is deleted
    const isDeleted = payload.is_deleted === 1 || payload.is_deleted === '1' || payload.is_deleted === true;

    if (isDeleted) {
      // Remove agent from Supabase if deleted
      console.log('ðŸ—‘ï¸  Webhook: Agent deleted in Tookan, removing from DB:', fleetId);
      if (isConfigured()) {
        await supabase
          .from('agents')
          .delete()
          .eq('fleet_id', fleetId);
      }
      return res.status(200).json({ status: 'success', message: 'Agent deleted from DB' });
    }

    const agentRecord = agentModel.transformFleetToAgent(payload);
    await agentModel.upsertAgent(agentRecord.fleet_id, agentRecord);

    return res.status(200).json({ status: 'success', message: 'Agent upserted' });
  } catch (error) {
    console.error('âŒ Webhook agent error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Internal error' });
  }
});

// Helper function to convert Tookan status codes to text
function getStatusText(status) {
  const statusMap = {
    0: 'Created',
    1: 'Assigned',
    2: 'Started',
    3: 'Arrived',
    4: 'Picked Up',
    5: 'In Transit',
    6: 'Delivered',
    7: 'Completed',
    8: 'Successful',
    9: 'Failed',
    10: 'Cancelled'
  };
  return statusMap[status] || 'Unknown';
}

// ============================================================
// AGENTS ENDPOINTS (Supabase-cached)
// ============================================================

// GET Agents from Database
app.get('/api/agents', authenticate, async (req, res) => {
  try {
    const apiKey = getApiKey();
    const { isActive, teamId, search } = req.query;

    const response = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });

    const result = await response.json();
    if (result.status !== 200) {
      return res.status(500).json({ status: 'error', message: result.message || 'Tookan API Error', data: { agents: [], total: 0 } });
    }

    const fleets = result.data || [];

    let filteredFleets = fleets;

    if (isActive !== undefined) {
      const is_active_bool = isActive === 'true';
      filteredFleets = filteredFleets.filter(f => f.status === (is_active_bool ? 1 : 0));
    }

    if (teamId) {
      filteredFleets = filteredFleets.filter(f => f.team_id?.toString() === teamId.toString());
    }

    if (search) {
      const term = search.toLowerCase();
      filteredFleets = filteredFleets.filter(f =>
        (f.name && f.name.toLowerCase().includes(term)) ||
        (f.email && f.email.toLowerCase().includes(term)) ||
        (f.phone && f.phone.includes(term))
      );
    }

    return res.json({
      status: 'success',
      message: 'Agents fetched successfully',
      data: {
        agents: filteredFleets,
        total: filteredFleets.length,
        source: 'tookan_api'
      }
    });
  } catch (error) {
    console.error('Get agents error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Internal error',
      data: { agents: [], total: 0 }
    });
  }
});

// POST Sync Agents from Tookan
app.post('/api/agents/sync', authenticate, requirePermission('manage_system'), async (req, res) => {
  try {
    console.log('\n=== SYNC AGENTS REQUEST ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Requested by user:', req.user?.email || 'unknown');

    const result = await agentSyncService.syncAgents();

    if (result.success) {
      res.json({
        status: 'success',
        message: result.message,
        data: {
          synced: result.synced,
          errors: result.errors
        }
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: result.message,
        data: {
          synced: result.synced,
          errors: result.errors
        }
      });
    }
  } catch (error) {
    console.error('âŒ Sync agents error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to sync agents',
      data: {}
    });
  }
});

// GET Agent Sync Status
app.get('/api/agents/sync/status', authenticate, async (req, res) => {
  try {
    const status = await agentSyncService.getSyncStatus();

    res.json({
      status: 'success',
      message: 'Sync status retrieved',
      data: status || { totalAgents: 0, activeAgents: 0, lastSyncedAt: null }
    });
  } catch (error) {
    console.error('âŒ Get sync status error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get sync status',
      data: {}
    });
  }
});

// PUT Assign Driver to Order
// Updates both Tookan API and Supabase database
app.put('/api/orders/:jobId/assign', authenticate, requirePermission('edit_order_financials'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const { fleet_id, notes } = req.body;

    console.log('\n=== ASSIGN DRIVER TO ORDER ===');
    console.log('Job ID:', jobId);
    console.log('New Fleet ID:', fleet_id);
    console.log('Request received at:', new Date().toISOString());

    if (!jobId) {
      return res.status(400).json({
        status: 'error',
        message: 'Job ID is required'
      });
    }

    if (fleet_id === undefined) {
      return res.status(400).json({
        status: 'error',
        message: 'fleet_id is required'
      });
    }

    const apiKey = getApiKey();

    // Step 1: Fetch current task from Tookan to get existing data
    console.log('Fetching current task from Tookan...');
    const getTaskResponse = await fetch('https://api.tookanapp.com/v2/get_task_details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        job_id: jobId
      }),
    });

    const getTaskText = await getTaskResponse.text();
    let currentTaskData;

    try {
      currentTaskData = JSON.parse(getTaskText);
    } catch (parseError) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to parse task data from Tookan'
      });
    }

    if (!getTaskResponse.ok || currentTaskData.status !== 200) {
      return res.status(404).json({
        status: 'error',
        message: currentTaskData.message || 'Task not found in Tookan'
      });
    }

    const currentTask = Array.isArray(currentTaskData.data)
      ? currentTaskData.data[0]
      : currentTaskData.data;

    const oldFleetId = currentTask.fleet_id;

    // Step 2: Update task in Tookan using edit_task API
    console.log('Updating task in Tookan...');
    const updatePayload = {
      api_key: apiKey,
      job_id: parseInt(jobId),
      fleet_id: fleet_id ? parseInt(fleet_id) : null,
      // Preserve existing task data
      customer_name: currentTask.customer_name || '',
      customer_phone: currentTask.customer_phone || '',
      customer_email: currentTask.customer_email || '',
      job_pickup_address: currentTask.job_pickup_address || currentTask.pickup_address || '',
      job_address: currentTask.job_address || currentTask.delivery_address || '',
      job_type: currentTask.job_type || 0
    };

    // Add notes if provided
    if (notes !== undefined) {
      updatePayload.customer_comments = notes;
    }

    const editResponse = await fetch('https://api.tookanapp.com/v2/edit_task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload),
    });

    const editText = await editResponse.text();
    let editData;

    try {
      editData = JSON.parse(editText);
    } catch (parseError) {
      console.error('Failed to parse Tookan edit response:', editText.substring(0, 200));
      return res.status(500).json({
        status: 'error',
        message: 'Failed to parse response from Tookan'
      });
    }

    if (!editResponse.ok || editData.status !== 200) {
      console.error('Tookan edit_task failed:', editData);
      return res.status(500).json({
        status: 'error',
        message: editData.message || 'Failed to update task in Tookan'
      });
    }

    console.log('âœ… Task updated in Tookan');

    // Step 3: Update task in Supabase database
    let databaseUpdated = false;
    let fleetName = null;

    if (isConfigured()) {
      try {
        // Get fleet name from agents table if available
        if (fleet_id) {
          const agent = await agentModel.getAgent(parseInt(fleet_id));
          fleetName = agent?.name || null;
        }

        const updateData = {
          fleet_id: fleet_id ? parseInt(fleet_id) : null,
          fleet_name: fleetName
        };

        if (notes !== undefined) {
          updateData.notes = notes;
        }

        await taskModel.updateTask(parseInt(jobId), updateData);
        databaseUpdated = true;
        console.log('âœ… Task updated in database');
      } catch (dbError) {
        console.warn('âš ï¸  Database update failed (will rely on next sync):', dbError.message);
      }
    }

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'assign_driver',
      'order',
      jobId,
      { fleet_id: oldFleetId },
      { fleet_id: fleet_id }
    );

    console.log('âœ… Driver assignment completed');
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      message: 'Driver assigned successfully',
      data: {
        jobId: jobId,
        fleet_id: fleet_id,
        fleet_name: fleetName,
        tookan_synced: true,
        database_synced: databaseUpdated
      }
    });
  } catch (error) {
    console.error('âŒ Assign driver error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to assign driver',
      data: {}
    });
  }
});

// ============================================================
// END AGENTS ENDPOINTS
// ============================================================

// GET All Fleets (Drivers/Agents)
// Note: In Tookan API, Drivers are called "Agents" or "Fleets"
app.get('/api/tookan/fleets', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET ALL FLEETS (DRIVERS/AGENTS) REQUEST ===');
    console.log('Request received at:', new Date().toISOString());

    const apiKey = getApiKey();

    // Call Tookan API to get all fleets (agents/drivers)
    // Note: Tookan API endpoint may be /v2/get_all_fleets or similar
    const tookanPayload = {
      api_key: apiKey
    };

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/get_all_fleets');
    console.log('Tookan API payload:', JSON.stringify({ ...tookanPayload, api_key: '***HIDDEN***' }, null, 2));

    const response = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tookanPayload),
    });

    const textResponse = await response.text();
    let data;

    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      // If endpoint doesn't exist or returns non-JSON, return structure
      console.log('âš ï¸  Tookan API may not have get_all_fleets endpoint');
      console.log('Response:', textResponse.substring(0, 200));
      console.log('=== END REQUEST ===\n');

      return res.json({
        status: 'success',
        action: 'fetch_fleets',
        entity: 'driver',
        message: 'Fleets endpoint ready - Tookan API endpoint may need verification',
        data: {
          fleets: [],
          total: 0
        },
        note: 'Tookan API endpoint /v2/get_all_fleets may not exist. Alternative: fetch from local DB or use different endpoint.'
      });
    }

    if (!response.ok || data.status !== 200) {
      // If endpoint fails, return empty structure
      console.log('âš ï¸  Tookan API returned error:', data.message);
      console.log('=== END REQUEST ===\n');

      return res.json({
        status: 'success',
        action: 'fetch_fleets',
        entity: 'driver',
        message: 'Fleets endpoint ready - Tookan API may need different endpoint',
        data: {
          fleets: [],
          total: 0
        },
        note: `Tookan API error: ${data.message || 'Unknown error'}`
      });
    }

    // Transform Tookan response to standardized format
    // Note: Tookan returns "fleets" which are drivers/agents
    const fleetsData = data.data || [];
    const fleets = Array.isArray(fleetsData) ? fleetsData.map((fleet) => ({
      id: fleet.fleet_id || fleet.id || '',
      name: fleet.fleet_name || fleet.name || '',
      phone: fleet.fleet_phone || fleet.phone || '',
      email: fleet.fleet_email || fleet.email || '',
      status: fleet.fleet_status || fleet.status || 'active',
      rawData: fleet
    })) : [];

    console.log('âœ… Fleets (Drivers/Agents) fetched successfully:', fleets.length);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'fetch_fleets',
      entity: 'driver', // UI terminology: "driver", Tookan terminology: "agent/fleet"
      message: 'Fleets (Drivers/Agents) fetched successfully',
      data: {
        fleets: fleets,
        total: fleets.length
      }
    });
  } catch (error) {
    console.error('âŒ Get fleets error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// GET All Customers/Merchants
// Note: In Tookan API, Merchants are called "Customers" (vendor_id)
// Duplicate /api/tookan/customers removed in favor of consolidated implementation at line 5648


// ============================================
// MERCHANT PLANS - PLAN MANAGEMENT
// ============================================

// Note: Tookan API may not support direct merchant plan assignment
// This implementation stores plans locally and applies fees during order creation/editing

// Merchant Plans - Database models (already imported at top)

// GET All Merchant Plans
app.get('/api/merchant-plans', authenticate, async (req, res) => {
  try {
    let plans = [];
    let assignments = {};

    // Try database first
    if (isConfigured()) {
      try {
        plans = await merchantPlansModel.getAllPlans();
        const allAssignments = await merchantPlansModel.getAllAssignments();

        // Transform assignments to expected format
        assignments = {};
        allAssignments.forEach(assignment => {
          if (assignment.merchant_id) {
            assignments[assignment.merchant_id] = assignment.plan_id;
          }
        });
      } catch (error) {
        console.warn('Database fetch failed, using empty data:', error.message);
      }
    }

    res.json({
      status: 'success',
      action: 'fetch_plans',
      entity: 'merchant_plan',
      message: 'Merchant plans fetched successfully',
      data: {
        plans: plans,
        assignments: assignments
      },
      note: 'Plans are stored in database. Tookan API does not support direct plan assignment.'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch plans',
      data: {}
    });
  }
});

// POST Create/Update Merchant Plan
app.post('/api/merchant-plans', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id, name, feeType, feeAmount, feePercentage, tieredFees, description } = req.body;

    if (!name || !feeType) {
      return res.status(400).json({
        status: 'error',
        message: 'Plan name and fee type are required',
        data: {}
      });
    }

    const feeStructure = {
      feeType,
      feeAmount: parseFloat(feeAmount || 0),
      feePercentage: parseFloat(feePercentage || 0),
      tieredFees: tieredFees || []
    };

    let plan;
    let oldPlan = null;

    if (isConfigured()) {
      try {
        // Get old plan if updating
        if (id) {
          oldPlan = await merchantPlansModel.getPlanById(parseInt(id));
        }

        plan = await merchantPlansModel.upsertPlan({
          id: id ? parseInt(id) : undefined,
          name,
          description: description || '',
          fee_structure: feeStructure,
          is_active: true
        });

        // Transform to expected format
        plan = {
          id: plan.id.toString(),
          name: plan.name,
          feeType: plan.fee_structure?.feeType || feeType,
          feeAmount: plan.fee_structure?.feeAmount || 0,
          feePercentage: plan.fee_structure?.feePercentage || 0,
          tieredFees: plan.fee_structure?.tieredFees || [],
          description: plan.description || '',
          createdAt: plan.created_at,
          updatedAt: plan.updated_at
        };

        // Audit log
        await auditLogger.createAuditLog(
          req,
          id ? 'merchant_plan_update' : 'merchant_plan_create',
          'merchant_plan',
          plan.id,
          oldPlan ? { name: oldPlan.name, fee_structure: oldPlan.fee_structure } : null,
          { name: plan.name, feeType, feeAmount, feePercentage, tieredFees }
        );
      } catch (error) {
        console.error('Database save failed:', error);
        throw error;
      }
    } else {
      // Fallback: return error if database not configured
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured. Please set up Supabase.',
        data: {}
      });
    }

    res.json({
      status: 'success',
      action: 'save_plan',
      entity: 'merchant_plan',
      message: 'Plan saved successfully',
      data: { plan }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to save plan',
      data: {}
    });
  }
});

// POST Assign Plan to Merchant
app.post('/api/merchant-plans/assign', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { merchantId, planId } = req.body;

    if (!merchantId) {
      return res.status(400).json({
        status: 'error',
        message: 'Merchant ID is required',
        data: {}
      });
    }

    if (isConfigured()) {
      try {
        // Get old assignment for audit log
        const oldAssignment = await merchantPlansModel.getMerchantPlan(parseInt(merchantId));

        if (planId) {
          await merchantPlansModel.assignPlan(
            parseInt(merchantId),
            parseInt(planId),
            req.userId || null
          );

          // Audit log
          await auditLogger.createAuditLog(
            req,
            'merchant_plan_assign',
            'merchant_plan_assignment',
            merchantId,
            oldAssignment ? { planId: oldAssignment.plan_id } : null,
            { planId: parseInt(planId), merchantId: parseInt(merchantId) }
          );
        } else {
          await merchantPlansModel.removePlanAssignment(parseInt(merchantId));

          // Audit log
          await auditLogger.createAuditLog(
            req,
            'merchant_plan_unassign',
            'merchant_plan_assignment',
            merchantId,
            oldAssignment ? { planId: oldAssignment.plan_id } : null,
            { planId: null, merchantId: parseInt(merchantId) }
          );
        }
      } catch (error) {
        console.error('Database assignment failed:', error);
        throw error;
      }
    } else {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured. Please set up Supabase.',
        data: {}
      });
    }

    res.json({
      status: 'success',
      action: 'assign_plan',
      entity: 'merchant_plan',
      message: planId ? 'Plan assigned successfully' : 'Plan unassigned successfully',
      data: { merchantId, planId: planId || null },
      note: 'Plan assignment is stored in database. Fees will be applied during order creation/editing.'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to assign plan',
      data: {}
    });
  }
});

// Helper function to calculate plan fee
function calculatePlanFee(plan, orderAmount, orderCount) {
  if (!plan) return 0;

  if (plan.feeType === 'fixed') {
    return plan.feeAmount || 0;
  } else if (plan.feeType === 'percentage') {
    return (orderAmount * (plan.feePercentage || 0)) / 100;
  } else if (plan.feeType === 'tiered' && orderCount !== undefined) {
    const tier = plan.tieredFees?.find((t) =>
      orderCount >= t.minOrders && (t.maxOrders === null || orderCount <= t.maxOrders)
    );
    return tier ? tier.fee : 0;
  }

  return 0;
}

// GET Analytics (KPIs, Charts, Performance Data)
app.get('/api/reports/analytics', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET ANALYTICS REQUEST ===');
    console.log('Query params:', JSON.stringify(req.query, null, 2));
    console.log('Request received at:', new Date().toISOString());

    const apiKey = getApiKey();
    const { dateFrom, dateTo } = req.query;

    // Prepare date range - default to last 30 days
    let startDate = dateFrom;
    let endDate = dateTo;

    if (!startDate || !endDate) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);

      if (!startDate) startDate = start.toISOString().split('T')[0];
      if (!endDate) endDate = end.toISOString().split('T')[0];
    }

    // Fetch orders and drivers (customers count comes from database now)
    // Use localhost for internal API calls to avoid proxy/port issues
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;

    const authHeader = req.headers.authorization || '';

    const [ordersResult, driversResult] = await Promise.all([
      fetch(`${baseUrl}/api/tookan/orders?dateFrom=${startDate}&dateTo=${endDate}&limit=500`, {
        headers: authHeader ? { Authorization: authHeader } : {}
      }).then(r => r.json()).catch(err => {
        console.error('Error fetching orders for analytics:', err);
        return { status: 'error', data: { orders: [] } };
      }),
      fetch(`${baseUrl}/api/tookan/fleets`, {
        headers: authHeader ? { Authorization: authHeader } : {}
      }).then(r => r.json()).catch(err => {
        console.error('Error fetching drivers for analytics:', err);
        return { status: 'error', data: { fleets: [] } };
      })
      // Customers count is now fetched from database, no API call needed
    ]);

    const orders = ordersResult.status === 'success' ? (ordersResult.data?.orders || []) : [];
    const drivers = driversResult.status === 'success' ? (driversResult.data?.fleets || []) : [];

    // Get customer count from Supabase database (instead of Tookan API)
    let totalCustomers = 0;
    if (isConfigured()) {
      try {
        totalCustomers = await customerModel.getCustomerCount();
      } catch (err) {
        console.error('Error getting customer count from DB:', err.message);
      }
    }

    console.log(`ðŸ“Š Processing analytics for ${orders.length} orders, ${drivers.length} drivers, ${totalCustomers} customers (from DB)`);

    // Log if orders are empty but we have drivers (indicates API issue)
    if (orders.length === 0 && drivers.length > 0) {
      console.log('âš ï¸  No orders found, but drivers exist. This may indicate a Tookan API issue with order fetching.');
    }

    // Calculate KPIs - Match Reports Panel (Total Orders, Drivers, Customers, Deliveries)
    const totalOrders = orders.length;
    const totalDrivers = drivers.length;
    const totalMerchants = totalCustomers; // Use DB count

    // Calculate COD metrics
    const pendingCOD = orders
      .filter(o => [0, 1, 3, 4, 6, 7].includes(parseInt(o.status))) // Ongoing orders (exclude Successful=2 and Canceled=8,9)
      .reduce((sum, o) => sum + (parseFloat(o.cod) || 0), 0);

    const collectedCOD = orders
      .filter(o => [2].includes(parseInt(o.status))) // Tookan status 2 = Successful/Completed
      .reduce((sum, o) => sum + (parseFloat(o.cod) || 0), 0);

    const completedDeliveries = orders.filter(o => [2].includes(parseInt(o.status))).length;

    // Calculate COD Collection Status (for pie chart)
    // Note: Settled COD would come from COD queue settlement data
    // For now, we'll use collected vs pending
    const codStatus = [
      { name: 'COD Collected', value: collectedCOD, color: '#DE3544' },
      { name: 'Settled', value: 0, color: '#10B981' }, // Would need COD queue data
      { name: 'Pending', value: pendingCOD, color: '#F59E0B' }
    ];

    // Calculate Order Volume (last 7 days for bar chart)
    const orderVolume = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });

      const dayOrders = orders.filter(o => {
        // Handle different date field names and formats
        const orderDateValue = o.date || o.job_pickup_datetime || o.created_at || o.order_date;
        if (!orderDateValue) return false;

        try {
          const orderDate = new Date(orderDateValue);
          if (isNaN(orderDate.getTime())) return false;
          return orderDate.toISOString().split('T')[0] === dateStr;
        } catch (e) {
          return false;
        }
      });

      orderVolume.push({
        day: dayName,
        orders: dayOrders.length
      });
    }

    // Calculate Driver Performance using RPC (last 7 days, top 5)
    let driverPerformance = [];
    if (isConfigured()) {
      try {
        // Get order counts per fleet from RPC
        const { data: fleetCounts, error: rpcErr } = await supabase.rpc('get_fleet_order_counts_last_7_days');

        if (!rpcErr && fleetCounts && fleetCounts.length > 0) {
          // Get ALL agent names from agents table (safer matching)
          const { data: agents } = await supabase
            .from('agents')
            .select('fleet_id, name');

          // Create a map of fleet_id (as string) to name
          const agentMap = new Map();
          if (agents) {
            agents.forEach(a => agentMap.set(String(a.fleet_id), a.name));
          }

          // Build leaderboard (top 5) using string lookup
          driverPerformance = fleetCounts.slice(0, 5).map(f => ({
            name: agentMap.get(String(f.fleet_id)) || `Driver ${f.fleet_id}`,
            deliveries: parseInt(f.total_orders) || 0
          }));
        }
      } catch (e) {
        console.log('Driver performance RPC failed:', e.message);
      }
    }

    // Calculate trends (compare with previous period)
    const previousStart = new Date(startDate);
    previousStart.setDate(previousStart.getDate() - (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    const previousEnd = new Date(startDate);
    previousEnd.setDate(previousEnd.getDate() - 1);

    // Note: Would need to fetch previous period data for accurate trends
    // For now, return placeholder trends
    const trends = {
      orders: '+0%',
      drivers: '+0%',
      merchants: '+0%',
      pendingCOD: '+0%',
      driversPending: '+0%',
      completed: '+0%'
    };

    console.log('âœ… Analytics calculated successfully');
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'fetch_analytics',
      entity: 'analytics',
      message: 'Analytics fetched successfully',
      data: {
        kpis: {
          totalOrders: totalOrders,
          totalDrivers: totalDrivers,
          totalMerchants: totalMerchants,
          pendingCOD: pendingCOD,
          driversWithPending: 0,
          completedDeliveries: completedDeliveries
        },
        codStatus: codStatus,
        orderVolume: orderVolume,
        driverPerformance: driverPerformance,
        trends: trends,
        filters: {
          dateFrom: startDate,
          dateTo: endDate
        }
      }
    });
  } catch (error) {
    console.error('âŒ Get analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});


// GET Reports Totals (FAST - Only counts, no full data)
app.get('/api/reports/totals', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET REPORTS TOTALS (FAST) ===');
    const startTime = Date.now();

    // Parallel fetch: RPC for orders/deliveries, API for drivers/customers
    const promises = [];

    // 1. Supabase RPC for orders + completed deliveries (fast SQL)
    if (isConfigured()) {
      promises.push(supabase.rpc('get_order_stats'));
    } else {
      promises.push(Promise.resolve({ data: null, error: null }));
    }

    // 2. Tookan API for drivers count (lightweight - just need count)
    promises.push(
      fetch('https://api.tookanapp.com/v2/get_all_fleets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: getApiKey() })
      }).then(r => r.json()).catch(() => ({ status: 200, data: [] }))
    );

    // 3. Supabase database for customers count
    if (isConfigured()) {
      promises.push(customerModel.getCustomerCount());
    } else {
      promises.push(Promise.resolve(0));
    }

    const [orderStats, driversResp, customerCount] = await Promise.all(promises);

    // Extract totals
    const totals = {
      orders: 0,
      drivers: 0,
      customers: customerCount || 0,
      deliveries: 0
    };

    // From Supabase RPC
    if (orderStats.data && orderStats.data.length > 0) {
      totals.orders = orderStats.data[0].total_orders || 0;
      totals.deliveries = orderStats.data[0].completed_deliveries || 0;
    }

    // From Tookan API
    totals.drivers = driversResp.data?.length || 0;

    const elapsed = Date.now() - startTime;
    console.log(`ðŸ“Š Totals fetched in ${elapsed}ms: orders=${totals.orders}, drivers=${totals.drivers}, customers=${totals.customers}, deliveries=${totals.deliveries}`);

    res.json({
      status: 'success',
      data: { totals }
    });
  } catch (error) {
    console.error('Reports totals error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch totals',
      data: { totals: { orders: 0, drivers: 0, customers: 0, deliveries: 0 } }
    });
  }
});

// GET Search Order by job_id (from Supabase, bypasses RLS)
app.get('/api/search/order/:jobId', authenticate, async (req, res) => {
  try {
    const { jobId } = req.params;
    console.log('\n=== SEARCH ORDER BY JOB_ID ===');
    console.log('Job ID:', jobId);

    if (!isConfigured()) {
      return res.status(400).json({ status: 'error', message: 'Database not configured' });
    }

    const { data: task, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('job_id', parseInt(jobId))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.json({ status: 'success', data: null, message: 'Order not found' });
      }
      throw error;
    }

    // Resolve driver phone
    let driverPhone = task.raw_data?.fleet_phone || '';
    if (task.fleet_id) {
      const { data: agent } = await supabase
        .from('agents')
        .select('phone')
        .eq('fleet_id', task.fleet_id)
        .single();
      if (agent) driverPhone = agent.phone || driverPhone;
    }

    const codAmount = parseFloat(task.cod_amount || 0);
    const orderFees = parseFloat(task.order_fees || 0);

    const mappedOrder = {
      jobId: task.job_id?.toString() || '',
      job_id: task.job_id,
      order_id: task.order_id || '',
      completed_datetime: task.completed_datetime || '',
      codAmount,
      cod_amount: codAmount,
      orderFees,
      order_fees: orderFees,
      fleet_id: task.fleet_id || null,
      assignedDriver: task.fleet_id || null,
      fleet_name: task.fleet_name || '',
      assignedDriverName: task.fleet_name || '',
      driver_phone: driverPhone,
      driverPhone: driverPhone,
      notes: task.notes || '',
      date: task.creation_datetime || null,
      creation_datetime: task.creation_datetime || null,
      customer_name: task.customer_name || '',
      customerName: task.customer_name || '',
      customer_phone: task.customer_phone || '',
      customerPhone: task.customer_phone || '',
      customerEmail: task.customer_email || '',
      pickup_address: task.pickup_address || '',
      pickupAddress: task.pickup_address || '',
      delivery_address: task.delivery_address || '',
      deliveryAddress: task.delivery_address || '',
      status: task.status ?? null,
      tags: task.tags || ''
    };

    res.json({ status: 'success', data: mappedOrder });
  } catch (error) {
    console.error('Search order error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// GET Search Customers by ID, Name, or Phone (from Supabase, bypasses RLS)
app.get('/api/search/customers', authenticate, async (req, res) => {
  try {
    const { q } = req.query;
    console.log('\n=== SEARCH CUSTOMERS ===');
    console.log('Query:', q);

    if (!q) {
      return res.json({ status: 'success', data: [] });
    }

    if (!isConfigured()) {
      return res.status(400).json({ status: 'error', message: 'Database not configured' });
    }

    const searchTerm = q.toString().trim();

    // Search in customers table
    const { data, error } = await supabase
      .from('customers')
      .select('vendor_id, customer_name, customer_phone, customer_address')
      .or(`vendor_id.eq.${isNumeric ? searchTerm : -1},customer_name.ilike.%${searchTerm}%,customer_phone.ilike.%${searchTerm}%`)
      .limit(50);

    if (error) throw error;

    res.json({ status: 'success', data: data || [] });
  } catch (error) {
    console.error('Search customers error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// GET Search Drivers/Agents by ID or Name (from Supabase, bypasses RLS)
app.get('/api/search/drivers', authenticate, async (req, res) => {
  try {
    const { q } = req.query;
    console.log('\n=== SEARCH DRIVERS ===');
    console.log('Query:', q);

    if (!q) {
      return res.json({ status: 'success', data: [] });
    }

    if (!isConfigured()) {
      return res.status(400).json({ status: 'error', message: 'Database not configured' });
    }

    const searchTerm = q.toString().trim();
    const isNumeric = /^\d+$/.test(searchTerm);

    // Normalize the search input (same rules as normalized_name column)
    const normalizedSearch = searchTerm.replace(/\s+/g, ' ').toLowerCase();

    let query = supabase.from('agents').select('*');

    if (isNumeric) {
      query = query.eq('fleet_id', parseInt(searchTerm));
    } else {
      // Search against normalized_name for exact matching
      query = query.eq('normalized_name', normalizedSearch);
    }

    const { data, error } = await query.limit(50);

    if (error) throw error;

    res.json({ status: 'success', data: data || [] });
  } catch (error) {
    console.error('Search drivers error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// GET All Customers (from Database)
app.get('/api/tookan/customers', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET ALL CUSTOMERS (FROM DATABASE) ===');
    console.log('Request received at:', new Date().toISOString());

    if (!isConfigured()) {
      return res.status(400).json({ status: 'error', message: 'Database not configured' });
    }

    const { data: customers, error } = await supabase
      .from('customers')
      .select('*')
      .order('customer_name', { ascending: true });

    if (error) throw error;

    console.log('âœ… Customers fetched from database:', customers?.length || 0);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      data: {
        customers: customers || []
      }
    });
  } catch (error) {
    console.error('âŒ Fetch all customers error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {
        customers: []
      }
    });
  }
});

// GET Reports Summary (Aggregated Data)
app.get('/api/reports/summary', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET REPORTS SUMMARY REQUEST ===');
    console.log('Query params:', JSON.stringify(req.query, null, 2));
    console.log('Request received at:', new Date().toISOString());

    const { dateFrom, dateTo } = req.query;

    // Prepare date range
    let startDate = dateFrom;
    let endDate = dateTo;

    if (!startDate || !endDate) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);

      if (!startDate) startDate = start.toISOString().split('T')[0];
      if (!endDate) endDate = end.toISOString().split('T')[0];
    }

    // Fetch orders, drivers, and customers using internal API calls (reuse auth header)
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    const authHeader = req.headers.authorization || '';

    // FAST PATH: Use RPC for totals, skip heavy order fetching
    // The RPC provides accurate all-time totals instantly
    let orders = [];
    let drivers = [];
    let customers = [];
    let rpcTotals = null;

    // Get totals from RPC (fast)
    if (isConfigured()) {
      try {
        const { data: stats } = await supabase.rpc('get_order_stats');
        if (stats && stats.length > 0) {
          rpcTotals = stats[0];
        }
      } catch (e) {
        console.log('RPC unavailable, will use empty orders:', e.message);
      }
    }

    try {
      const driversResponse = await fetch(`${baseUrl}/api/tookan/fleets`, {
        headers: authHeader ? { Authorization: authHeader } : {}
      });
      const driversData = await driversResponse.json();
      drivers = driversData.status === 'success' ? (driversData.data?.fleets || []) : [];
    } catch (err) {
      console.error('Error fetching drivers for summary:', err);
    }

    // Get customer count from database instead of API
    let dbCustomerCount = 0;
    if (isConfigured()) {
      try {
        dbCustomerCount = await customerModel.getCustomerCount();
      } catch (err) {
        console.error('Error fetching customer count for summary:', err);
      }
    }

    // Calculate driver summaries - Include ALL drivers from fleets
    const driverMap = new Map();

    // Step 1: Create driver map from ALL fleets (regardless of task assignment)
    drivers.forEach(driver => {
      const id = (driver.fleet_id || driver.id)?.toString();
      if (id) {
        driverMap.set(id, {
          driverId: id,
          driverName: driver.fleet_name || driver.name || driver.username || 'Unknown Driver',
          driverEmail: driver.email || '',
          driverPhone: driver.phone || driver.fleet_phone || '',
          tasks: [],
          codTotal: 0,
          feesTotal: 0,
          totalOrderValue: 0,
          deliveryTimes: []
        });
      }
    });

    // Step 2: Group ALL tasks/orders by fleet_id (no status filter)
    orders.forEach(order => {
      const fleetId = (order.driverId || order.fleet_id || order.rawData?.fleet_id)?.toString();

      if (fleetId && driverMap.has(fleetId)) {
        const driverData = driverMap.get(fleetId);
        driverData.tasks.push(order);

        // Extract COD from meta_data or fallback to top-level fields
        const rawTask = order.rawData || order;
        const cod = extractMetaValue(rawTask, ['COD', 'COD Total', 'Cash on Delivery', 'cod']);
        const fee = extractMetaValue(rawTask, ['Fee', 'Delivery Fee', 'Order Fee', 'Order Fees', 'fee']);
        const price = extractMetaValue(rawTask, ['Price', 'Order Value', 'Total Value', 'Total', 'Amount']);

        driverData.codTotal += cod;
        driverData.feesTotal += fee;
        driverData.totalOrderValue += price > 0 ? price : (cod + fee);

        // Calculate delivery time for completed tasks only (status 2 = Successful)
        const taskStatus = parseInt(rawTask.job_status || order.status || 0);
        if (taskStatus === 2) {
          const completedTime = rawTask.completed_datetime;
          const startedTime = rawTask.started_datetime || rawTask.creation_datetime;

          if (completedTime && startedTime &&
            !completedTime.includes('0000-00-00') && !startedTime.includes('0000-00-00')) {
            const start = new Date(startedTime);
            const end = new Date(completedTime);
            const minutes = (end.getTime() - start.getTime()) / (1000 * 60);
            if (minutes > 0 && minutes < 1440) { // Sanity check: less than 24 hours
              driverData.deliveryTimes.push(minutes);
            }
          }
        }
      }
    });

    // Build driver summaries array with enhanced fields
    const driverSummaries = Array.from(driverMap.values()).map(driver => ({
      driverId: driver.driverId,
      driverName: driver.driverName,
      driverEmail: driver.driverEmail,
      driverPhone: driver.driverPhone,
      numberOfOrders: driver.tasks.length,
      totalOrders: driver.tasks.length, // Alias for backward compatibility
      codTotal: Math.round(driver.codTotal * 100) / 100,
      orderFees: Math.round(driver.feesTotal * 100) / 100,
      feesTotal: Math.round(driver.feesTotal * 100) / 100, // Alias for backward compatibility
      totalOrderValue: Math.round(driver.totalOrderValue * 100) / 100,
      averageDeliveryTime: driver.deliveryTimes.length > 0
        ? Math.round(driver.deliveryTimes.reduce((a, b) => a + b, 0) / driver.deliveryTimes.length)
        : 0
    }));

    // Calculate merchant summaries
    const merchantMap = new Map();
    orders.forEach(order => {
      if (order.merchantId) {
        const merchantId = order.merchantId.toString();
        if (!merchantMap.has(merchantId)) {
          const merchant = customers.find(c => c.id === merchantId);
          merchantMap.set(merchantId, {
            merchantId: merchantId,
            merchantName: merchant?.name || order.merchant || 'Unknown Merchant',
            orders: [],
            codTotal: 0,
            feesTotal: 0
          });
        }

        const merchantData = merchantMap.get(merchantId);
        merchantData.orders.push(order);
        merchantData.codTotal += parseFloat(order.cod || 0);
        merchantData.feesTotal += parseFloat(order.fee || order.orderFees || 0);
      }
    });

    const merchantSummaries = Array.from(merchantMap.values()).map(merchant => ({
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName,
      totalOrders: merchant.orders.length,
      codTotal: merchant.codTotal,
      feesTotal: merchant.feesTotal,
      averageOrderValue: merchant.orders.length > 0
        ? (merchant.codTotal / merchant.orders.length).toFixed(2)
        : '0'
    }));

    // Calculate totals - Use RPC for orders/deliveries, API for drivers, Database for customers
    let totals = {
      orders: rpcTotals?.total_orders || orders.length,
      drivers: drivers.length,
      customers: dbCustomerCount,
      merchants: dbCustomerCount,
      deliveries: rpcTotals?.completed_deliveries || orders.filter(o => [2].includes(parseInt(o.status))).length
    };

    console.log(`ðŸš€ [BACKEND] Reports Summary: dbCustomerCount=${dbCustomerCount}, totals.merchants=${totals.merchants}`);
    console.log('ðŸ“Š Reports Summary Totals:', JSON.stringify(totals, null, 2));
    console.log('ðŸ“Š Supabase RPC stats: orders=%d, deliveries=%d', totals.orders, totals.deliveries);

    console.log('âœ… Reports summary calculated successfully');
    console.log(`   - Total drivers in summary: ${driverSummaries.length}`);
    console.log(`   - Drivers with orders: ${driverSummaries.filter(d => d.numberOfOrders > 0).length}`);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'fetch_reports_summary',
      entity: 'report',
      message: 'Reports summary fetched successfully',
      data: {
        totals: totals,
        driverSummaries: driverSummaries,
        customerSummaries: merchantSummaries, // Renamed from merchantSummaries
        merchantSummaries: merchantSummaries, // Keep for backward compatibility
        filters: {
          dateFrom: startDate,
          dateTo: endDate
        }
      }
    });
  } catch (error) {
    console.error('âŒ Get reports summary error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// ============================================
// WITHDRAWAL REQUESTS - BACKEND ENDPOINTS
// ============================================

// POST Create Withdrawal Request (from mobile app)
app.post('/api/withdrawal/request', authenticate, async (req, res) => {
  try {
    console.log('\n=== CREATE WITHDRAWAL REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const { type, merchantId, driverId, amount, iban, phone, name } = req.body;

    if (!type || !amount || !iban) {
      return res.status(400).json({
        status: 'error',
        message: 'Type, amount, and IBAN are required',
        data: {}
      });
    }

    if (type === 'merchant' && !merchantId) {
      return res.status(400).json({
        status: 'error',
        message: 'Merchant ID is required for merchant withdrawal',
        data: {}
      });
    }

    if (type === 'driver' && !driverId) {
      return res.status(400).json({
        status: 'error',
        message: 'Driver ID is required for driver withdrawal',
        data: {}
      });
    }

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured. Please set up Supabase.',
        data: {}
      });
    }

    // Verify wallet balance (would fetch from Tookan in production)
    // For now, we'll accept the request and verify during approval

    // Create withdrawal request in database
    const requestData = {
      type: type,
      merchantId: type === 'merchant' ? parseInt(merchantId) : null,
      driverId: type === 'driver' ? parseInt(driverId) : null,
      amount: parseFloat(amount)
    };

    const withdrawalRequest = await withdrawalRequestsModel.createRequest(requestData);

    // Transform to expected format for response
    const transformedRequest = {
      id: withdrawalRequest.id,
      type: withdrawalRequest.request_type,
      merchantId: withdrawalRequest.merchant_id,
      driverId: withdrawalRequest.driver_id,
      merchant: type === 'merchant' ? name : null,
      driverName: type === 'driver' ? name : null,
      phone: phone || '',
      iban: iban,
      withdrawalAmount: parseFloat(withdrawalRequest.amount),
      walletAmount: 0, // Will be fetched during approval
      date: withdrawalRequest.requested_at.split('T')[0],
      status: withdrawalRequest.status,
      createdAt: withdrawalRequest.requested_at
    };

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'withdrawal_create',
      'withdrawal_request',
      withdrawalRequest.id,
      null,
      { type: withdrawalRequest.request_type, amount: withdrawalRequest.amount, status: 'pending' }
    );

    console.log('âœ… Withdrawal request created:', withdrawalRequest.id);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'create_withdrawal_request',
      entity: 'withdrawal',
      message: 'Withdrawal request created successfully',
      data: { withdrawalRequest: transformedRequest }
    });
  } catch (error) {
    console.error('âŒ Create withdrawal request error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// GET All Withdrawal Requests
app.get('/api/withdrawal/requests', authenticate, requirePermission('manage_wallets'), async (req, res) => {
  try {
    const { status, type, dateFrom, dateTo, customerId } = req.query;

    let requests = [];

    if (isConfigured()) {
      try {
        const filters = {};
        if (status) filters.status = status;
        if (type) filters.requestType = type;
        if (customerId) filters.customerId = customerId;

        requests = await withdrawalRequestsModel.getAllRequests(filters);

        // Apply date filters (client-side for now, can be moved to DB query)
        if (dateFrom || dateTo) {
          requests = requests.filter(w => {
            const requestDate = w.requested_at.split('T')[0];
            if (dateFrom && requestDate < dateFrom) return false;
            if (dateTo && requestDate > dateTo) return false;
            return true;
          });
        }

        // Transform to expected format
        requests = requests.map(w => ({
          id: w.id,
          type: w.request_type,
          merchantId: w.merchant_id,
          driverId: w.driver_id,
          merchant: w.merchant_id ? `Merchant ${w.merchant_id}` : null,
          driverName: w.driver_id ? `Driver ${w.driver_id}` : null,
          phone: '',
          iban: '',
          withdrawalAmount: parseFloat(w.amount),
          walletAmount: 0,
          date: w.requested_at.split('T')[0],
          status: w.status,
          createdAt: w.requested_at,
          approvedAt: w.approved_at,
          rejectedAt: w.rejected_at,
          rejectionReason: w.rejection_reason
        }));
      } catch (error) {
        console.warn('Database fetch failed:', error.message);
      }
    }

    res.json({
      status: 'success',
      action: 'fetch_withdrawal_requests',
      entity: 'withdrawal',
      message: 'Withdrawal requests fetched successfully',
      data: {
        requests: requests,
        total: requests.length
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch withdrawal requests',
      data: {}
    });
  }
});

// PUT Approve Withdrawal Request
app.put('/api/withdrawal/request/:id/approve', authenticate, requirePermission('manage_wallets'), async (req, res) => {
  try {
    console.log('\n=== APPROVE WITHDRAWAL REQUEST ===');
    const { id } = req.params;
    const { userId } = req.body;
    const requestId = parseInt(id);

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured. Please set up Supabase.',
        data: {}
      });
    }

    const request = await withdrawalRequestsModel.getRequestById(requestId);
    if (!request) {
      return res.status(404).json({
        status: 'error',
        message: 'Withdrawal request not found',
        data: {}
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: `Request is already ${request.status}`,
        data: {}
      });
    }

    const apiKey = getApiKey();

    // Update wallet balance in Tookan
    const vendorId = request.request_type === 'merchant' ? request.merchant_id : null;
    const fleetId = request.request_type === 'driver' ? request.driver_id : null;

    if (request.request_type === 'merchant' && vendorId) {
      // Use customer wallet transaction API
      const walletPayload = {
        api_key: apiKey,
        vendor_id: vendorId,
        transaction_type: 2, // Withdrawal
        amount: request.amount,
        transaction_description: `Withdrawal approved`
      };

      const walletResponse = await fetch('https://api.tookanapp.com/v2/customer_wallet_transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(walletPayload)
      });

      const walletData = await walletResponse.json();
      if (!walletResponse.ok || walletData.status !== 200) {
        return res.status(500).json({
          status: 'error',
          message: walletData.message || 'Failed to update merchant wallet',
          data: {}
        });
      }
    } else if (request.request_type === 'driver' && fleetId) {
      // Use fleet wallet transaction API
      const walletPayload = {
        api_key: apiKey,
        fleet_id: fleetId,
        transaction_type: 2, // Withdrawal
        amount: request.amount,
        transaction_description: `Withdrawal approved`
      };

      const walletResponse = await fetch('https://api.tookanapp.com/v2/fleet_wallet_transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(walletPayload)
      });

      const walletData = await walletResponse.json();
      if (!walletResponse.ok || walletData.status !== 200) {
        return res.status(500).json({
          status: 'error',
          message: walletData.message || 'Failed to update driver wallet',
          data: {}
        });
      }
    }

    // Update request status in database
    const approvedRequest = await withdrawalRequestsModel.approveRequest(requestId, userId || req.userId || null);

    // Transform to expected format
    const transformedRequest = {
      id: approvedRequest.id,
      type: approvedRequest.request_type,
      merchantId: approvedRequest.merchant_id,
      driverId: approvedRequest.driver_id,
      withdrawalAmount: parseFloat(approvedRequest.amount),
      status: approvedRequest.status,
      approvedAt: approvedRequest.approved_at,
      approvedBy: approvedRequest.approved_by
    };

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'withdrawal_approve',
      'withdrawal_request',
      requestId,
      { status: 'pending', amount: request.amount },
      { status: 'approved', amount: approvedRequest.amount, approvedBy: approvedRequest.approved_by }
    );

    console.log('âœ… Withdrawal request approved:', requestId);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'approve_withdrawal',
      entity: 'withdrawal',
      message: 'Withdrawal request approved and wallet updated',
      data: { withdrawalRequest: transformedRequest }
    });
  } catch (error) {
    console.error('âŒ Approve withdrawal error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// PUT Reject Withdrawal Request
app.put('/api/withdrawal/request/:id/reject', authenticate, requirePermission('manage_wallets'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, userId } = req.body;
    const requestId = parseInt(id);

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured. Please set up Supabase.',
        data: {}
      });
    }

    const request = await withdrawalRequestsModel.getRequestById(requestId);
    if (!request) {
      return res.status(404).json({
        status: 'error',
        message: 'Withdrawal request not found',
        data: {}
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: `Request is already ${request.status}`,
        data: {}
      });
    }

    const rejectedRequest = await withdrawalRequestsModel.rejectRequest(
      requestId,
      userId || req.userId || null,
      reason || 'No reason provided'
    );

    // Transform to expected format
    const transformedRequest = {
      id: rejectedRequest.id,
      type: rejectedRequest.request_type,
      merchantId: rejectedRequest.merchant_id,
      driverId: rejectedRequest.driver_id,
      withdrawalAmount: parseFloat(rejectedRequest.amount),
      status: rejectedRequest.status,
      rejectionReason: rejectedRequest.rejection_reason,
      rejectedAt: rejectedRequest.rejected_at,
      rejectedBy: rejectedRequest.rejected_by
    };

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'withdrawal_reject',
      'withdrawal_request',
      requestId,
      { status: 'pending', amount: request.amount },
      { status: 'rejected', amount: rejectedRequest.amount, reason: rejectedRequest.rejection_reason, rejectedBy: rejectedRequest.rejected_by }
    );

    res.json({
      status: 'success',
      action: 'reject_withdrawal',
      entity: 'withdrawal',
      message: 'Withdrawal request rejected',
      data: { withdrawalRequest: transformedRequest }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to reject withdrawal request',
      data: {}
    });
  }
});

// ============================================
// USER AUTHENTICATION & MANAGEMENT
// ============================================

// POST Login (Tookan User Authentication)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Email and password are required',
        data: {}
      });
    }

    const apiKey = getApiKey();
    let tookanUser = null;
    let userType = null;

    console.log('\n=== TOOKAN USER LOGIN ATTEMPT ===');
    console.log('Email/Phone/ID:', email);
    console.log('Request received at:', new Date().toISOString());

    // Check if input is a numeric ID (Tookan fleet_id or vendor_id)
    const isNumericId = /^\d+$/.test(email);
    const searchId = isNumericId ? parseInt(email, 10) : null;

    // First, try to find user in Tookan Agents/Fleets (Drivers)
    // Try multiple endpoints as Tookan API may use different endpoint names
    try {
      const fleetPayload = {
        api_key: apiKey
      };

      // Try get_all_agents first (common Tookan endpoint)
      let fleetResponse = await fetch('https://api.tookanapp.com/v2/get_all_agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fleetPayload),
      });

      // If that fails, try get_all_fleets
      if (!fleetResponse.ok) {
        console.log('âš ï¸  get_all_agents failed, trying get_all_fleets...');
        fleetResponse = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fleetPayload),
        });
      }

      const fleetTextResponse = await fleetResponse.text();
      let fleetData;

      try {
        fleetData = JSON.parse(fleetTextResponse);
      } catch (parseError) {
        console.log('âš ï¸  Could not parse fleet response');
        console.log('Response text:', fleetTextResponse.substring(0, 500));
      }

      console.log('Fleet API Response Status:', fleetResponse.status);
      console.log('Fleet API Response Data:', JSON.stringify(fleetData, null, 2).substring(0, 1000));

      if (fleetResponse.ok && fleetData) {
        // Tookan API response format can vary:
        // - { status: 200, data: [...] }
        // - { data: [...] }
        // - Direct array [...]
        let fleets = [];

        if (fleetData.status === 200 && Array.isArray(fleetData.data)) {
          fleets = fleetData.data;
        } else if (Array.isArray(fleetData.data)) {
          fleets = fleetData.data;
        } else if (Array.isArray(fleetData)) {
          fleets = fleetData;
        } else if (fleetData.agents && Array.isArray(fleetData.agents)) {
          fleets = fleetData.agents;
        } else if (fleetData.fleets && Array.isArray(fleetData.fleets)) {
          fleets = fleetData.fleets;
        }

        console.log(`Found ${fleets.length} agents/fleets in Tookan account`);

        if (fleets.length > 0) {
          console.log('Sample agent/fleet structure:', JSON.stringify(fleets[0], null, 2).substring(0, 500));
        }

        // Match by ID, email, or phone
        // Tookan API may return different field names, check all variations
        tookanUser = fleets.find(fleet => {
          // Try various ID field names
          const fleetId = fleet.fleet_id || fleet.agent_id || fleet.id || fleet.fleetId || fleet.agentId;

          // Try various email field names
          const fleetEmail = (
            fleet.fleet_email ||
            fleet.agent_email ||
            fleet.email ||
            fleet.fleetEmail ||
            fleet.agentEmail ||
            ''
          ).toLowerCase();

          // Try various phone field names
          const fleetPhone = fleet.fleet_phone || fleet.agent_phone || fleet.phone || fleet.fleetPhone || fleet.agentPhone || '';

          const searchEmail = email.toLowerCase();

          // Match by ID if input is numeric
          if (searchId && fleetId) {
            const idMatch = parseInt(fleetId) === searchId ||
              fleetId.toString() === email ||
              fleetId.toString() === searchId.toString();
            if (idMatch) {
              console.log('âœ… Matched agent/fleet by ID:', fleetId);
              return true;
            }
          }

          // Match by email
          if (fleetEmail && fleetEmail === searchEmail) {
            console.log('âœ… Matched agent/fleet by email:', fleetEmail);
            return true;
          }

          // Match by phone (exact or digits only)
          if (fleetPhone) {
            const phoneNormalized = fleetPhone.replace(/\D/g, '');
            const searchNormalized = email.replace(/\D/g, '');
            if (fleetPhone === email || (phoneNormalized && searchNormalized && phoneNormalized === searchNormalized)) {
              console.log('âœ… Matched agent/fleet by phone:', fleetPhone);
              return true;
            }
          }

          return false;
        });

        if (tookanUser) {
          userType = 'driver';
          console.log('âœ… Found user in Tookan Fleets (Driver/Agent)');
        } else {
          console.log('âŒ No matching fleet found. Searched email/phone:', email);
          if (fleets.length > 0) {
            console.log('Sample fleet emails:', fleets.slice(0, 3).map(f => f.fleet_email || f.email).filter(Boolean));
          }
        }
      } else {
        console.log('âš ï¸  Fleet API returned error or unexpected format');
        console.log('Status:', fleetResponse.status);
        console.log('Response:', fleetTextResponse.substring(0, 500));
      }
    } catch (fleetError) {
      console.error('âŒ Error fetching fleets:', fleetError.message);
      console.error('Stack:', fleetError.stack);
    }

    // If not found in fleets, try Customers (Merchants)
    if (!tookanUser) {
      try {
        const customerPayload = {
          api_key: apiKey,
          is_pagination: 1,
          off_set: 0,
          limit: 1000
        };

        const customerResponse = await fetch('https://api.tookanapp.com/v2/fetch_customers_wallet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(customerPayload),
        });

        const customerTextResponse = await customerResponse.text();
        let customerData;

        try {
          customerData = JSON.parse(customerTextResponse);
        } catch (parseError) {
          console.log('âš ï¸  Could not parse customer response');
          console.log('Response text:', customerTextResponse.substring(0, 500));
        }

        console.log('Customer API Response Status:', customerResponse.status);
        console.log('Customer API Response Data:', JSON.stringify(customerData, null, 2).substring(0, 1000));

        if (customerResponse.ok && customerData) {
          // Tookan API response format can vary
          let customers = [];

          if (customerData.status === 200 && Array.isArray(customerData.data)) {
            customers = customerData.data;
          } else if (Array.isArray(customerData.data)) {
            customers = customerData.data;
          } else if (Array.isArray(customerData)) {
            customers = customerData;
          } else if (customerData.customers && Array.isArray(customerData.customers)) {
            customers = customerData.customers;
          }

          console.log(`Found ${customers.length} customers/merchants in Tookan account`);

          if (customers.length > 0) {
            console.log('Sample customer structure:', JSON.stringify(customers[0], null, 2).substring(0, 500));
          }

          // Match by ID, email, or phone
          // Tookan API may return different field names, check all variations
          tookanUser = customers.find(customer => {
            // Try various ID field names
            const vendorId = customer.vendor_id || customer.customer_id || customer.vendorId || customer.customerId || customer.id;

            // Try various email field names
            const customerEmail = (
              customer.customer_email ||
              customer.vendor_email ||
              customer.email ||
              customer.customerEmail ||
              customer.vendorEmail ||
              ''
            ).toLowerCase();

            // Try various phone field names
            const customerPhone = customer.customer_phone || customer.vendor_phone || customer.phone || customer.customerPhone || customer.vendorPhone || '';

            const searchEmail = email.toLowerCase();

            // Match by ID if input is numeric
            if (searchId && vendorId) {
              const idMatch = parseInt(vendorId) === searchId ||
                vendorId.toString() === email ||
                vendorId.toString() === searchId.toString();
              if (idMatch) {
                console.log('âœ… Matched customer/merchant by ID:', vendorId);
                return true;
              }
            }

            // Match by email
            if (customerEmail && customerEmail === searchEmail) {
              console.log('âœ… Matched customer/merchant by email:', customerEmail);
              return true;
            }

            // Match by phone (exact or digits only)
            if (customerPhone) {
              const phoneNormalized = customerPhone.replace(/\D/g, '');
              const searchNormalized = email.replace(/\D/g, '');
              if (customerPhone === email || (phoneNormalized && searchNormalized && phoneNormalized === searchNormalized)) {
                console.log('âœ… Matched customer/merchant by phone:', customerPhone);
                return true;
              }
            }

            return false;
          });

          if (tookanUser) {
            userType = 'merchant';
            console.log('âœ… Found user in Tookan Customers (Merchant)');
          } else {
            console.log('âŒ No matching customer found. Searched email/phone:', email);
            if (customers.length > 0) {
              console.log('Sample customer emails:', customers.slice(0, 3).map(c => c.customer_email || c.email).filter(Boolean));
            }
          }
        } else {
          console.log('âš ï¸  Customer API returned error or unexpected format');
          console.log('Status:', customerResponse.status);
          console.log('Response:', customerTextResponse.substring(0, 500));
        }
      } catch (customerError) {
        console.error('âŒ Error fetching customers:', customerError.message);
        console.error('Stack:', customerError.stack);
      }
    }

    // If user not found in Tookan, fall back to Supabase Auth (for admin users)
    if (!tookanUser && isConfigured()) {
      try {
        const { data, error } = await supabaseAnon.auth.signInWithPassword({
          email,
          password
        });

        if (!error && data && data.user) {
          // Get user profile from database
          const userProfile = await userModel.getUserById(data.user.id);

          // Check if user is disabled or banned
          if (userProfile && userProfile.status === 'disabled') {
            console.log('âŒ User account is disabled:', data.user.email);
            return res.status(403).json({
              status: 'error',
              message: 'Your account has been disabled. Please contact the administrator.',
              data: {}
            });
          }

          if (userProfile && userProfile.status === 'banned') {
            console.log('âŒ User account is banned:', data.user.email);
            return res.status(403).json({
              status: 'error',
              message: 'Your account has been banned. Please contact the administrator.',
              data: {}
            });
          }

          console.log('âœ… Found user in Supabase (Admin/Internal User)');

          return res.json({
            status: 'success',
            message: 'Login successful',
            data: {
              user: {
                id: data.user.id,
                email: data.user.email,
                name: userProfile?.name || data.user.email,
                role: userProfile?.role || 'admin',
                permissions: userProfile?.permissions || {},
                source: 'supabase'
              },
              session: {
                access_token: data.session.access_token,
                expires_at: data.session.expires_at
              }
            }
          });
        }
      } catch (supabaseError) {
        console.log('âš ï¸  Supabase auth failed:', supabaseError.message);
      }
    }

    // If user found in Tookan, verify password and create session
    if (tookanUser) {
      // Extract user data - handle various Tookan API field name variations
      const userId = userType === 'driver'
        ? (tookanUser.fleet_id || tookanUser.agent_id || tookanUser.fleetId || tookanUser.agentId || tookanUser.id || '').toString()
        : (tookanUser.vendor_id || tookanUser.customer_id || tookanUser.vendorId || tookanUser.customerId || tookanUser.id || '').toString();

      const userName = userType === 'driver'
        ? (tookanUser.fleet_name || tookanUser.agent_name || tookanUser.fleetName || tookanUser.agentName || tookanUser.name || '')
        : (tookanUser.customer_name || tookanUser.vendor_name || tookanUser.customerName || tookanUser.vendorName || tookanUser.name || '');

      const userEmail = userType === 'driver'
        ? (tookanUser.fleet_email || tookanUser.agent_email || tookanUser.fleetEmail || tookanUser.agentEmail || tookanUser.email || email)
        : (tookanUser.customer_email || tookanUser.vendor_email || tookanUser.customerEmail || tookanUser.vendorEmail || tookanUser.email || email);

      // Verify password if stored locally, otherwise allow first login
      let passwordValid = true; // Default to true for first-time Tookan users

      if (isConfigured()) {
        try {
          // Check if user exists in our database with password
          const localUser = await userModel.getUserByTookanId(userId, userType);

          if (localUser && localUser.password_hash) {
            // Verify password using bcrypt
            try {
              const bcrypt = require('bcryptjs');
              passwordValid = await bcrypt.compare(password, localUser.password_hash);

              if (!passwordValid) {
                console.log('âŒ Password verification failed for Tookan user');
                return res.status(401).json({
                  status: 'error',
                  message: 'Invalid password',
                  data: {}
                });
              }
              console.log('âœ… Password verified for Tookan user');
            } catch (bcryptError) {
              console.log('âš ï¸  Bcrypt error, allowing login:', bcryptError.message);
              passwordValid = true;
            }
          } else {
            // First time login - store password hash for future logins
            console.log('âš ï¸  First login for Tookan user - storing password');
            try {
              const bcrypt = require('bcryptjs');
              const passwordHash = await bcrypt.hash(password, 10);

              await userModel.createTookanUser({
                tookan_id: userId,
                email: userEmail,
                name: userName,
                user_type: userType,
                password_hash: passwordHash,
                role: userType === 'driver' ? 'driver' : 'merchant'
              });
              console.log('âœ… Password stored for future logins');
            } catch (createError) {
              console.log('âš ï¸  Could not store password, allowing login anyway:', createError.message);
              // Allow login even if storage fails
            }
          }
        } catch (dbError) {
          console.log('âš ï¸  Database error, allowing login:', dbError.message);
          // Allow login if DB check fails (for development)
        }
      } else {
        // No database configured, allow login (for development)
        console.log('âš ï¸  No database configured - allowing login without password verification');
      }

      // Check if user is disabled or banned (check by email in users table)
      if (isConfigured()) {
        try {
          const userProfile = await userModel.getUserByEmail(userEmail);
          if (userProfile && userProfile.status === 'disabled') {
            console.log('âŒ Tookan user account is disabled:', userEmail);
            return res.status(403).json({
              status: 'error',
              message: 'Your account has been disabled. Please contact the administrator.',
              data: {}
            });
          }
          if (userProfile && userProfile.status === 'banned') {
            console.log('âŒ Tookan user account is banned:', userEmail);
            return res.status(403).json({
              status: 'error',
              message: 'Your account has been banned. Please contact the administrator.',
              data: {}
            });
          }
        } catch (statusError) {
          console.log('âš ï¸  Could not check user status:', statusError.message);
          // Continue with login if status check fails
        }
      }

      // Generate a simple session token (in production, use JWT or similar)
      const sessionToken = Buffer.from(`${userId}:${Date.now()}:${userEmail}`).toString('base64');
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

      console.log('âœ… Login successful for Tookan user');
      console.log('   User ID:', userId);
      console.log('   Name:', userName);
      console.log('   Type:', userType);
      console.log('=== END LOGIN (SUCCESS) ===\n');

      return res.json({
        status: 'success',
        message: 'Login successful',
        data: {
          user: {
            id: userId,
            email: userEmail,
            name: userName,
            role: userType === 'driver' ? 'driver' : 'merchant',
            permissions: {},
            tookanUserId: userId,
            userType: userType,
            source: 'tookan'
          },
          session: {
            access_token: sessionToken,
            expires_at: expiresAt
          }
        }
      });
    }

    // User not found
    console.log('âŒ User not found in Tookan or Supabase');
    console.log('=== END LOGIN (FAILED) ===\n');

    return res.status(401).json({
      status: 'error',
      message: 'Invalid email or password. User not found in Tookan system.',
      data: {}
    });
  } catch (error) {
    console.error('âŒ Login error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Login failed',
      data: {}
    });
  }
});

// POST Register (Superadmin only - creates user in Supabase Auth)
app.post('/api/auth/register', authenticate, requireSuperadmin(), async (req, res) => {
  try {
    const { email, password, name, role, permissions } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Email and password are required',
        data: {}
      });
    }

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Authentication not configured. Please set up Supabase.',
        data: {}
      });
    }

    // Create user in Supabase Auth (must use service role client)
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name: name || email,
        role: role || 'user',
        permissions: permissions || {}
      }
    });

    if (error || !data.user) {
      return res.status(400).json({
        status: 'error',
        message: error?.message || 'Failed to create user',
        data: {}
      });
    }

    // User profile will be created automatically by trigger (003_users_table_setup.sql)
    // But we can update it if needed
    if (name || role || permissions) {
      try {
        await userModel.updateUser(data.user.id, {
          name: name || email,
          role: role || 'user',
          permissions: permissions || {}
        });
      } catch (updateError) {
        console.warn('Could not update user profile:', updateError.message);
      }
    }

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'user_create',
      'user',
      data.user.id,
      null,
      { email, name: name || email, role: role || 'user', permissions: permissions || {} }
    );

    res.json({
      status: 'success',
      message: 'User created successfully',
      data: {
        user: {
          id: data.user.id,
          email: data.user.email,
          name: name || email,
          role: role || 'user',
          permissions: permissions || {}
        }
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Registration failed',
      data: {}
    });
  }
});

// GET All Users (Superadmin only)
app.get('/api/users', authenticate, requireSuperadmin(), async (req, res) => {
  try {
    const { role, search } = req.query;

    const filters = {};
    if (role) filters.role = role;
    if (search) filters.search = search;

    const users = await userModel.getAllUsers(filters);

    // Transform to expected format
    const transformedUsers = users.map(user => {
      const rawStatus = (user.status || 'active').toString().toLowerCase();

      return {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role || 'user',
        permissions: user.permissions || {},
        status: rawStatus, // keep raw; front-end handles label mapping
        lastLogin: user.last_login || null,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      };
    });

    res.json({
      status: 'success',
      message: 'Users fetched successfully',
      data: {
        users: transformedUsers,
        total: transformedUsers.length
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch users',
      data: {}
    });
  }
});

// PUT Update User (Superadmin only)
app.put('/api/users/:id', authenticate, requireSuperadmin(), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, permissions } = req.body;

    // Get old user data for audit log
    const oldUser = await userModel.getUserById(id);

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (permissions !== undefined) updateData.permissions = permissions;

    const updatedUser = await userModel.updateUser(id, updateData);

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'user_update',
      'user',
      id,
      oldUser ? { name: oldUser.name, email: oldUser.email, role: oldUser.role, permissions: oldUser.permissions } : null,
      { name: updatedUser.name, email: updatedUser.email, role: updatedUser.role, permissions: updatedUser.permissions }
    );

    res.json({
      status: 'success',
      message: 'User updated successfully',
      data: {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          role: updatedUser.role,
          permissions: updatedUser.permissions || {}
        }
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update user',
      data: {}
    });
  }
});

// PUT Update User Permissions (Superadmin only)
app.put('/api/users/:id/permissions', authenticate, requireSuperadmin(), async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({
        status: 'error',
        message: 'Permissions object is required',
        data: {}
      });
    }

    // Get old permissions for audit log
    const oldUser = await userModel.getUserById(id);

    const updatedUser = await userModel.updateUserPermissions(id, permissions);

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'user_permissions_update',
      'user',
      id,
      oldUser ? { permissions: oldUser.permissions || {} } : null,
      { permissions: updatedUser.permissions || {} }
    );

    res.json({
      status: 'success',
      message: 'User permissions updated successfully',
      data: {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          permissions: updatedUser.permissions || {}
        }
      }
    });
  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update permissions',
      data: {}
    });
  }
});

// DELETE User (Superadmin only)
app.delete('/api/users/:id', authenticate, requireSuperadmin(), async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.userId) {
      return res.status(400).json({
        status: 'error',
        message: 'You cannot delete your own account',
        data: {}
      });
    }

    // Get user info for audit log
    const user = await userModel.getUserById(id);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
        data: {}
      });
    }

    // Prevent deleting admin users
    if (user.role === 'admin') {
      return res.status(400).json({
        status: 'error',
        message: 'Admin users cannot be deleted',
        data: {}
      });
    }

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured',
        data: {}
      });
    }

    // Delete user from Supabase Auth (this will cascade delete from users table via trigger)
    const { error: deleteError } = await supabaseAnon.auth.admin.deleteUser(id);

    if (deleteError) {
      return res.status(500).json({
        status: 'error',
        message: deleteError.message || 'Failed to delete user',
        data: {}
      });
    }

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'user_delete',
      'user',
      id,
      { email: user.email, name: user.name, role: user.role },
      null
    );

    res.json({
      status: 'success',
      message: 'User deleted successfully',
      data: {
        deletedUserId: id
      }
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to delete user',
      data: {}
    });
  }
});

// PUT Update User Status (Superadmin only - enable/disable/ban users)
app.put('/api/users/:id/status', authenticate, requireSuperadmin(), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        status: 'error',
        message: 'Status is required. Valid values: active, disabled, banned',
        data: {}
      });
    }

    // Prevent modifying own status
    if (req.userId === id) {
      return res.status(400).json({
        status: 'error',
        message: 'You cannot change your own status',
        data: {}
      });
    }

    // Get user info
    const user = await userModel.getUserById(id);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
        data: {}
      });
    }

    // Update status
    const updatedUser = await userModel.updateUserStatus(id, status);

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'user_status_update',
      'user',
      id,
      { status: user.status || 'active' },
      { status: status }
    );

    res.json({
      status: 'success',
      action: 'update_user_status',
      entity: 'user',
      message: `User ${status === 'active' ? 'enabled' : status === 'banned' ? 'banned' : 'disabled'} successfully`,
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        status: updatedUser.status
      }
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update user status',
      data: {}
    });
  }
});

// PUT Update User Password (Superadmin or self)
app.put('/api/users/:id/password', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        status: 'error',
        message: 'Password is required and must be at least 6 characters',
        data: {}
      });
    }

    // Check if user is admin or updating their own password
    const currentUser = await userModel.getUserById(req.userId);
    if (!currentUser) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized',
        data: {}
      });
    }

    if (currentUser.role !== 'admin' && id !== req.userId) {
      return res.status(403).json({
        status: 'error',
        message: 'You can only change your own password, unless you are an admin',
        data: {}
      });
    }

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured',
        data: {}
      });
    }

    // Update password in Supabase Auth
    const { error: updateError } = await supabaseAnon.auth.admin.updateUserById(id, {
      password: newPassword
    });

    if (updateError) {
      return res.status(500).json({
        status: 'error',
        message: updateError.message || 'Failed to update password',
        data: {}
      });
    }

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'user_password_change',
      'user',
      id,
      null,
      { changed: true }
    );

    res.json({
      status: 'success',
      message: 'Password updated successfully',
      data: {
        userId: id
      }
    });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update password',
      data: {}
    });
  }
});

// GET Current User Info
app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    // Handle Tookan users (source: 'tookan') differently from Supabase users
    if (req.user && req.user.source === 'tookan') {
      // For Tookan users, return info from req.user (set in authenticate middleware)
      return res.json({
        status: 'success',
        message: 'User info retrieved successfully',
        data: {
          user: {
            id: req.user.id,
            email: req.user.email || '',
            name: req.user.name || req.user.email || 'Tookan User',
            role: req.user.role || 'user',
            permissions: req.user.permissions || {},
            source: 'tookan'
          }
        }
      });
    }

    // For Supabase users, fetch from database
    if (isConfigured()) {
      try {
        const user = await userModel.getUserById(req.userId);

        if (!user) {
          return res.status(404).json({
            status: 'error',
            message: 'User not found',
            data: {}
          });
        }

        return res.json({
          status: 'success',
          message: 'User info retrieved successfully',
          data: {
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              permissions: user.permissions || {}
            }
          }
        });
      } catch (dbError) {
        // If database lookup fails (e.g., invalid UUID format for Tookan ID), return user from token
        if (req.user) {
          return res.json({
            status: 'success',
            message: 'User info retrieved successfully',
            data: {
              user: {
                id: req.user.id,
                email: req.user.email || '',
                name: req.user.name || 'User',
                role: req.user.role || 'user',
                permissions: req.user.permissions || {}
              }
            }
          });
        }
        throw dbError;
      }
    }

    // Fallback: return user from token
    res.json({
      status: 'success',
      message: 'User info retrieved successfully',
      data: {
        user: {
          id: req.userId,
          email: req.user?.email || '',
          name: req.user?.name || 'User',
          role: req.user?.role || 'user',
          permissions: req.user?.permissions || {}
        }
      }
    });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get user info',
      data: {}
    });
  }
});

// PUT Update User Role (Superadmin only)
app.put('/api/users/:id/role', authenticate, requireSuperadmin(), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        status: 'error',
        message: 'Role is required',
        data: {}
      });
    }

    const validRoles = ['admin', 'user', 'finance', 'staff'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
        data: {}
      });
    }

    // Get old role for audit log
    const oldUser = await userModel.getUserById(id);

    const updatedUser = await userModel.updateUserRole(id, role);

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'user_role_update',
      'user',
      id,
      oldUser ? { role: oldUser.role } : null,
      { role: updatedUser.role }
    );

    res.json({
      status: 'success',
      message: 'User role updated successfully',
      data: {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          role: updatedUser.role
        }
      }
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update role',
      data: {}
    });
  }
});

// ============================================
// REPORTING ENDPOINTS
// ============================================

// Duplicate Reports Summary endpoint removed in favor of consolidate implementation at line 5670


// ============================================
// AUDIT LOGS ENDPOINTS
// ============================================

// GET Audit Logs (Admin only)
app.get('/api/audit-logs', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { user_id, action, entity_type, entity_id, dateFrom, dateTo, limit = 100 } = req.query;

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured',
        data: {}
      });
    }

    const auditLogsModel = require('./db/models/auditLogs');
    const logs = await auditLogsModel.getLogs({
      userId: user_id,
      action,
      entityType: entity_type,
      entityId: entity_id,
      dateFrom,
      dateTo,
      limit: parseInt(limit)
    });

    res.json({
      status: 'success',
      message: 'Audit logs retrieved successfully',
      data: {
        logs: logs,
        total: logs.length
      }
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get audit logs',
      data: {}
    });
  }
});

// GET Audit Logs for Specific Entity
app.get('/api/audit-logs/:entityType/:entityId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { entityType, entityId } = req.params;

    if (!isConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Database not configured',
        data: {}
      });
    }

    const auditLogsModel = require('./db/models/auditLogs');
    const logs = await auditLogsModel.getEntityLogs(entityType, entityId);

    res.json({
      status: 'success',
      message: 'Audit logs retrieved successfully',
      data: {
        logs: logs,
        entityType,
        entityId
      }
    });
  } catch (error) {
    console.error('Get entity audit logs error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get audit logs',
      data: {}
    });
  }
});

// ============================================
// ADMIN SYNC ENDPOINTS
// Endpoints for managing order cache sync
// ============================================

// GET Sync Status
app.get('/api/admin/sync/status', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET SYNC STATUS ===');

    const status = await taskModel.getSyncStatus();
    const cachedCount = await taskModel.getCachedTaskCount();
    const isFresh = await taskModel.isCacheFresh(24);

    res.json({
      status: 'success',
      data: {
        syncStatus: status || { status: 'never_synced' },
        cachedOrderCount: cachedCount,
        isCacheFresh: isFresh,
        supabaseConfigured: isConfigured()
      }
    });
  } catch (error) {
    console.error('Get sync status error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to get sync status'
    });
  }
});

// POST Trigger Full Sync (Admin only)
app.post('/api/admin/sync/orders', authenticate, requireRole('admin'), async (req, res) => {
  try {
    console.log('\n=== TRIGGER FULL ORDER SYNC ===');
    console.log('Requested by:', req.user?.email || 'Unknown');

    if (!isConfigured()) {
      return res.status(400).json({
        status: 'error',
        message: 'Supabase not configured. Cannot run sync without database.'
      });
    }

    const { forceSync, resumeFromBatch } = req.body;

    // Check if sync is already running
    const currentStatus = await taskModel.getSyncStatus();
    if (currentStatus?.status === 'in_progress' && !forceSync) {
      return res.status(409).json({
        status: 'error',
        message: 'Sync already in progress. Use forceSync: true to override.',
        data: { currentStatus }
      });
    }

    // Start sync in background (don't block response)
    res.json({
      status: 'success',
      message: 'Sync started in background. Check /api/admin/sync/status for progress.',
      data: {
        startedAt: new Date().toISOString(),
        forceSync: !!forceSync,
        resumeFromBatch: resumeFromBatch || 0
      }
    });

    // Run sync after response is sent
    setImmediate(async () => {
      try {
        const result = await orderSyncService.syncOrders({
          forceSync: !!forceSync,
          resumeFromBatch: resumeFromBatch || 0
        });
        console.log('Full sync completed:', result);
      } catch (syncError) {
        console.error('Full sync failed:', syncError);
      }
    });

  } catch (error) {
    console.error('Trigger sync error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to trigger sync'
    });
  }
});

// POST Trigger Incremental Sync
app.post('/api/admin/sync/incremental', authenticate, requireRole('admin'), async (req, res) => {
  try {
    console.log('\n=== TRIGGER INCREMENTAL SYNC ===');
    console.log('Requested by:', req.user?.email || 'Unknown');

    if (!isConfigured()) {
      return res.status(400).json({
        status: 'error',
        message: 'Supabase not configured. Cannot run sync without database.'
      });
    }

    // Check if sync is already running
    const currentStatus = await taskModel.getSyncStatus();
    if (currentStatus?.status === 'in_progress') {
      return res.status(409).json({
        status: 'error',
        message: 'Sync already in progress. Please wait for it to complete.',
        data: { currentStatus }
      });
    }

    // Start sync in background
    res.json({
      status: 'success',
      message: 'Incremental sync started in background.',
      data: {
        startedAt: new Date().toISOString()
      }
    });

    // Run sync after response is sent
    setImmediate(async () => {
      try {
        const result = await orderSyncService.incrementalSync();
        console.log('Incremental sync completed:', result);
      } catch (syncError) {
        console.error('Incremental sync failed:', syncError);
      }
    });

  } catch (error) {
    console.error('Trigger incremental sync error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to trigger incremental sync'
    });
  }
});

// DELETE Clear Order Cache (Admin only)
app.delete('/api/admin/sync/cache', authenticate, requireRole('admin'), async (req, res) => {
  try {
    console.log('\n=== CLEAR ORDER CACHE ===');
    console.log('Requested by:', req.user?.email || 'Unknown');

    if (!isConfigured()) {
      return res.status(400).json({
        status: 'error',
        message: 'Supabase not configured.'
      });
    }

    // Delete all cached tasks
    const { error } = await supabase
      .from('tasks')
      .delete()
      .neq('job_id', 0); // Delete all

    if (error) {
      throw error;
    }

    // Reset sync status
    await taskModel.updateSyncStatus({
      status: 'idle',
      last_successful_sync: null,
      synced_records: 0,
      completed_batches: 0
    });

    res.json({
      status: 'success',
      message: 'Order cache cleared successfully'
    });
  } catch (error) {
    console.error('Clear cache error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to clear cache'
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API server is running' });
});

// =====================================
// CUSTOMER WEBHOOK ENDPOINT
// =====================================
// URL to configure in Tookan: POST /api/webhooks/tookan/customer
// Header: x-webhook-secret: YOUR_TOOKAN_WEBHOOK_SECRET
app.post('/api/webhooks/tookan/customer', async (req, res) => {
  try {
    console.log('\n=== CUSTOMER WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());

    // Validate webhook secret
    const secretHeader = req.headers['x-webhook-secret'];
    const expectedSecret = getWebhookSecret();
    const bodySecret = req.body?.tookan_shared_secret;

    if (expectedSecret && (secretHeader !== expectedSecret && bodySecret !== expectedSecret)) {
      console.warn('âš ï¸  Unauthorized webhook attempt');
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }

    const payload = req.body || {};
    console.log('Payload keys:', Object.keys(payload));

    // Handle the webhook
    const result = await customerSyncService.handleCustomerWebhook(payload);

    console.log('=== END CUSTOMER WEBHOOK ===\n');

    res.status(200).json({
      status: 'success',
      message: 'Customer webhook processed',
      data: result
    });
  } catch (error) {
    console.error('âŒ Customer webhook error:', error.message);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.listen(PORT, async () => {
  console.log(`ðŸš€ Tookan API Proxy Server running on http://localhost:${PORT}`);
  console.log(`ðŸ“¡ Proxying requests to Tookan API`);

  // Auto-sync agents on startup (non-blocking)
  if (isConfigured()) {
    console.log('\nðŸ”„ Starting automatic agent sync...');
    agentSyncService.syncAgents()
      .then(result => {
        if (result.success) {
          console.log(`âœ… Agent sync completed: ${result.synced} agents synced`);
        } else {
          console.log(`âš ï¸  Agent sync failed: ${result.message}`);
        }
      })
      .catch(err => {
        console.error('âŒ Agent sync error:', err.message);
      });

    // Auto-sync customers on startup (non-blocking)
    console.log('ðŸ”„ Starting automatic customer sync (if table empty)...');
    customerSyncService.syncAllCustomers({ ifEmptyOnly: true })
      .then(result => {
        if (result.success) {
          console.log(`âœ… Customer sync completed: ${result.synced} customers synced`);
        } else {
          console.log(`âš ï¸  Customer sync failed: ${result.message}`);
        }
      })
      .catch(err => {
        console.error('âŒ Customer sync error:', err.message);
      });
  } else {
    console.log('âš ï¸  Supabase not configured, skipping auto-sync');
  }
});



// DELETE Task (and connected task)
app.post('/api/tookan/delete-task', authenticate, requirePermission('perform_reorder'), async (req, res) => {
  try {
    console.log('\n=== DELETE TASK REQUEST ===');
    const { jobId } = req.body;

    if (!jobId) {
      return res.status(400).json({ status: 'error', message: 'Job ID is required' });
    }

    // 1. Fetch task details from DB to find connected task
    const { data: task, error: fetchError } = await supabase
      .from('tasks')
      .select('job_id, raw_data')
      .eq('job_id', jobId)
      .single();

    if (fetchError || !task) {
      console.error('Failed to find task in DB:', jobId);
      return res.status(404).json({ status: 'error', message: 'Task not found in database' });
    }

    // 2. Identify connected task
    // Try to find connected task ID from raw_data or relationship logic
    // Usually mapped in raw_data.pickup_delivery_relationship or by matching tracking link etc.
    // For now, we will query the DB for the OTHER task that shares the same order_id or tracking link if possible.
    // BETTER STRATEGY: Use the 'order_id' or 'pickup_delivery_relationship' field if available.
    // Let's assume the user wants to delete the "Job" they clicked, AND if it's part of a P/D pair, the other one.

    // In Tookan, pickup_delivery_relationship is often a unique string shared by both.
    const relationshipId = task.raw_data?.pickup_delivery_relationship;
    let connectedJobIds = [jobId];

    if (relationshipId) {
      // Find all tasks with this relationship ID
      const { data: relatedTasks } = await supabase
        .from('tasks')
        .select('job_id')
        .eq('raw_data->>pickup_delivery_relationship', relationshipId);

      if (relatedTasks) {
        connectedJobIds = relatedTasks.map(t => t.job_id);
      }
    }

    // Ensure we have unique IDs (in case logic adds duplicates)
    connectedJobIds = [...new Set(connectedJobIds)];
    console.log(`ðŸ—‘ï¸ Deleting tasks: ${connectedJobIds.join(', ')}`);

    const apiKey = getApiKey();
    const results = [];

    // 3. Delete from Tookan (Loop through IDs)
    for (const id of connectedJobIds) {
      const response = await fetch('https://api.tookanapp.com/v2/delete_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, job_id: String(id) })
      });
      const data = await response.json();
      results.push({ id, status: data.status, message: data.message });
    }

    // 4. Delete from Supabase
    const { error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .in('job_id', connectedJobIds);

    if (deleteError) {
      console.error('Failed to delete from Supabase:', deleteError);
    }

    console.log('âœ… Delete operation completed');
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      message: 'Tasks deleted successfully',
      data: { deletedIds: connectedJobIds, results }
    });

  } catch (error) {
    console.error('âŒ Delete task error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});
