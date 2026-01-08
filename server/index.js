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
const { authenticate, optionalAuth, requirePermission, requireRole } = require('./middleware/auth');
const auditLogger = require('./middleware/auditLogger');

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
      console.log('❌ Validation failed: Missing required fields');
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
      console.log('❌ Failed to parse Tookan API response as JSON');
      return res.status(500).json({
        status: 'error',
        message: `API returned non-JSON response: ${textResponse.substring(0, 200)}`,
        data: {}
      });
    }

    if (!response.ok || data.status !== 200) {
      console.log('❌ Tookan API returned error');
      return res.status(response.status || 500).json({
        status: 'error',
        message: data.message || 'Failed to process driver wallet transaction',
        data
      });
    }

    console.log('✅ Transaction successful');
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
    console.error('❌ Driver wallet transaction error:', error);
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

    console.log('✅ COD added to queue:', codEntry.codId);
    console.log('=== END REQUEST ===\n');

    res.json({
      status: 'success',
      message: 'COD added to queue successfully',
      data: codEntry
    });
  } catch (error) {
    console.error('❌ Add COD to queue error:', error);
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
    console.error('❌ Get COD queue error:', error);
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
    console.error('❌ Get pending COD error:', error);
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

    console.log('✅ Found pending COD in queue:');
    console.log('  COD ID:', pendingCOD.codId);
    console.log('  Order ID:', pendingCOD.orderId || 'N/A');
    console.log('  COD Amount:', codAmount);
    console.log('  Paid Amount:', paid);
    console.log('  Merchant Vendor ID:', pendingCOD.merchantVendorId);
    console.log('  Date:', pendingCOD.date);
    
    console.log('\n🔄 Processing settlement...');

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
      console.error('❌ Driver wallet credit failed:', driverWalletResult.message);
      console.log('Driver wallet response:', JSON.stringify(driverWalletResult, null, 2));
      return res.status(500).json({
        status: 'error',
        message: `Failed to credit driver wallet: ${driverWalletResult.message}`,
        data: {}
      });
    }

    console.log('✅ Driver wallet credited successfully');
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
      console.error('❌ Merchant wallet credit failed:', merchantWalletResult.message);
      console.log('Merchant wallet response:', JSON.stringify(merchantWalletResult, null, 2));
      // Note: In production, you might want to rollback driver wallet credit here
      return res.status(500).json({
        status: 'error',
        message: `Failed to credit merchant wallet: ${merchantWalletResult.message}`,
        data: {}
      });
    }

    console.log('✅ Merchant wallet credited successfully');
    console.log('  Merchant wallet response status:', merchantWalletResult.status);

    // 3. Mark COD as COMPLETED
    console.log('Step 3: Marking COD as COMPLETED...');
    const settledCOD = await codQueue.settleCOD(driverId, pendingCOD.codId, note);
    
    if (!settledCOD) {
      console.error('❌ Failed to update COD status');
      return res.status(500).json({
        status: 'error',
        message: 'Failed to update COD status',
        data: {}
      });
    }

    console.log('✅ COD marked as COMPLETED');
    
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
    console.error('❌ Settle COD error:', error);
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
    
    console.log('✅ Daily report exported successfully');
    console.log('=== END REQUEST ===\n');
  } catch (error) {
    console.error('❌ Daily report export error:', error);
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
    
    console.log('✅ Monthly report exported successfully');
    console.log('=== END REQUEST ===\n');
  } catch (error) {
    console.error('❌ Monthly report export error:', error);
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
          console.log(`📦 Found ${tasks.length} tasks from database for export`);
        } catch (error) {
          console.warn('Database fetch failed, falling back to file storage:', error.message);
          // Fallback to file-based storage
          const tasksData = taskStorage.getAllTasks();
          tasks = Object.values(tasksData.tasks || {});
          console.log(`📦 Found ${tasks.length} tasks from file cache for export`);
        }
      } else {
        // Fallback to file-based storage
        const tasksData = taskStorage.getAllTasks();
        tasks = Object.values(tasksData.tasks || {});
        console.log(`📦 Found ${tasks.length} tasks from file cache for export`);
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
      
      console.log(`✅ Exported ${ordersData.length} orders from cache`);
    } catch (cacheError) {
      console.warn('⚠️  Cache export failed, using mock data:', cacheError);
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
    
    console.log('✅ Orders export completed successfully');
    console.log('=== END REQUEST ===\n');
  } catch (error) {
    console.error('❌ Orders export error:', error);
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
    
    console.log('✅ System logs export completed successfully');
    console.log('=== END REQUEST ===\n');
  } catch (error) {
    console.error('❌ System logs export error:', error);
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

    console.log('⚠️  Attempting to call Tookan API: https://api.tookanapp.com/v2/fleet/add');
    console.log('⚠️  Note: This endpoint may not exist in Tookan API');
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
      console.log('⚠️  Fleet/add endpoint not found in Tookan API');
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
    
    console.log('✅ Fleet/Agent added successfully:', fleetId);
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
    console.error('❌ Add fleet error:', error);
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
      console.log('✅ Customer added successfully');
      console.log('=== END REQUEST (SUCCESS) ===\n');
      res.json({
        status: 'success',
        message: 'Customer added successfully',
        data: responseData.data || responseData
      });
    } else {
      console.error('❌ Tookan API error:', responseData.message || responseData);
      console.log('=== END REQUEST (ERROR) ===\n');
      res.status(response.status || 500).json({
        status: 'error',
        message: responseData.message || 'Failed to add customer',
        data: responseData
      });
    }
  } catch (error) {
    console.error('❌ Add customer error:', error);
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

    console.log('✅ Order fetched successfully:', orderId);
    console.log('=== END REQUEST (SUCCESS) ===\n');
    
    res.json({
      status: 'success',
      action: 'fetch_order',
      entity: 'order',
      message: 'Order details fetched successfully',
      data: orderData
    });
  } catch (error) {
    console.error('❌ Get order error:', error);
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
    const successfulStatuses = [6, 7, 8]; // Completed, Delivered, etc.
    if (successfulStatuses.includes(parseInt(currentStatus))) {
      console.log('⚠️  Warning: Attempting to edit successful order. Tookan API may reject this.');
    }

    // Build update payload - only include fields that are provided
    // Convert job_id to number for Tookan API
    const numericOrderId = parseInt(orderId, 10);
    if (isNaN(numericOrderId)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid order ID: ${orderId}. Must be a valid number.`,
        data: {}
      });
    }
    
    const updatePayload = {
      api_key: apiKey,
      job_id: numericOrderId  // Already converted to number above
    };
    
    console.log('Order Update - Job ID type:', typeof numericOrderId, 'Value:', numericOrderId);

    // Add fields only if they are provided
    if (codAmount !== undefined) {
      updatePayload.cod = parseFloat(codAmount) || 0;
    }
    if (orderFees !== undefined) {
      updatePayload.order_payment = parseFloat(orderFees) || 0;
    }
    if (assignedDriver !== undefined && assignedDriver !== null) {
      updatePayload.fleet_id = assignedDriver;
    }
    if (notes !== undefined) {
      updatePayload.customer_comments = notes || '';
    }

    // Preserve existing fields that aren't being updated
    if (!updatePayload.cod) updatePayload.cod = parseFloat(currentTask.cod || 0);
    if (!updatePayload.order_payment) updatePayload.order_payment = parseFloat(currentTask.order_payment || 0);
    if (!updatePayload.fleet_id) updatePayload.fleet_id = currentTask.fleet_id || '';
    if (!updatePayload.customer_comments) updatePayload.customer_comments = currentTask.customer_comments || '';

    // Include required fields from current task
    updatePayload.customer_name = currentTask.customer_name || '';
    updatePayload.customer_phone = currentTask.customer_phone || '';
    updatePayload.customer_email = currentTask.customer_email || '';
    updatePayload.pickup_address = currentTask.pickup_address || '';
    updatePayload.delivery_address = currentTask.delivery_address || '';
    updatePayload.job_type = currentTask.job_type || 0;

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/edit_task');
    console.log('Tookan API payload:', JSON.stringify({ ...updatePayload, api_key: '***HIDDEN***' }, null, 2));

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
      
      console.log('✅ Order updated successfully (could not fetch updated data)');
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

    console.log('✅ Order updated successfully:', orderId);
    console.log('=== END REQUEST (SUCCESS) ===\n');
    
    res.json({
      status: 'success',
      action: 'update_order',
      entity: 'order',
      message: 'Order updated successfully',
      data: updatedOrderData
    });
  } catch (error) {
    console.error('❌ Update order error:', error);
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
    console.log('\n=== REORDER REQUEST ===');
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
      
      // Use fetched data if not provided
      // Tookan uses different field names, so we need to check multiple possibilities
      orderData = {
        customerName: customerName || currentTask.customer_name || currentTask.customer_username || currentTask.job_pickup_name || '',
        customerPhone: customerPhone || currentTask.customer_phone || currentTask.job_pickup_phone || '',
        customerEmail: customerEmail || currentTask.customer_email || currentTask.job_pickup_email || '',
        pickupAddress: pickupAddress || currentTask.pickup_address || currentTask.job_pickup_address || '',
        deliveryAddress: deliveryAddress || currentTask.delivery_address || currentTask.job_address || currentTask.delivery_address || '',
        codAmount: codAmount !== undefined ? codAmount : (currentTask.cod || 0),
        orderFees: orderFees !== undefined ? orderFees : (currentTask.order_payment || 0),
        assignedDriver: assignedDriver !== undefined ? assignedDriver : (currentTask.fleet_id || null),
        notes: notes || currentTask.customer_comments || currentTask.job_description || ''
      };
    }

    // Validate required fields
    if (!orderData.customerName || !orderData.customerPhone || !orderData.pickupAddress || !orderData.deliveryAddress) {
      return res.status(400).json({
        status: 'error',
        message: 'Original order ID and order data are required',
        data: {}
      });
    }

    // Get tags for this task
    const taskDataForTags = {
      customerName: orderData.customerName,
      customerPhone: orderData.customerPhone,
      pickupAddress: orderData.pickupAddress,
      deliveryAddress: orderData.deliveryAddress,
      customerPlan: orderData.customerPlan,
      deliveryZone: orderData.deliveryZone,
      ...orderData
    };
    const tags = tagService.getTagsForTask(taskDataForTags);
    
    // Create new task with same data
    const createPayload = {
      api_key: apiKey,
      job_type: 0, // 0 = delivery task
      customer_name: orderData.customerName,
      customer_phone: orderData.customerPhone,
      customer_email: orderData.customerEmail || '',
      pickup_address: orderData.pickupAddress,
      delivery_address: orderData.deliveryAddress,
      cod: parseFloat(orderData.codAmount) || 0,
      order_payment: parseFloat(orderData.orderFees) || 0,
      customer_comments: orderData.notes || '',
    };

    // Add tags if any
    if (tags && tags.length > 0) {
      createPayload.tags = tags;
      console.log('Tags assigned to re-order:', tags);
    }

    // Add fleet_id if driver is assigned
    if (orderData.assignedDriver) {
      createPayload.fleet_id = orderData.assignedDriver;
    }

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/create_task');
    console.log('Tookan API payload:', JSON.stringify({ ...createPayload, api_key: '***HIDDEN***' }, null, 2));

    const response = await fetch('https://api.tookanapp.com/v2/create_task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createPayload),
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
        message: data.message || 'Failed to create re-order',
        data: {}
      });
    }

    const newOrderId = data.data?.job_id || data.data?.jobId || null;

    console.log('✅ Re-order created successfully:', newOrderId);
    console.log('=== END REQUEST (SUCCESS) ===\n');
    
    res.json({
      status: 'success',
      action: 'reorder',
      entity: 'order',
      message: 'Re-order created successfully',
      data: { newOrderId: newOrderId, originalOrderId: orderId }
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
app.post('/api/tookan/order/return', authenticate, requirePermission('perform_return'), async (req, res) => {
  try {
    console.log('\n=== RETURN ORDER REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const apiKey = getApiKey();
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        status: 'error',
        message: 'Order ID is required',
        data: {}
      });
    }

    // First, fetch current order to get addresses
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

    // Get tags for return order
    const returnTaskData = {
      customerName: currentTask.customer_name,
      customerPhone: currentTask.customer_phone,
      pickupAddress: currentTask.delivery_address, // Reversed
      deliveryAddress: currentTask.pickup_address, // Reversed
      customerPlan: currentTask.customer_plan,
      deliveryZone: currentTask.delivery_zone,
      ...currentTask
    };
    const tags = tagService.getTagsForTask(returnTaskData);
    
    // Create return order with reversed addresses and COD = 0
    const createPayload = {
      api_key: apiKey,
      job_type: 0, // 0 = delivery task
      customer_name: currentTask.customer_name || '',
      customer_phone: currentTask.customer_phone || '',
      customer_email: currentTask.customer_email || '',
      pickup_address: currentTask.delivery_address || '', // Reversed
      delivery_address: currentTask.pickup_address || '', // Reversed
      cod: 0, // COD automatically removed for returns
      order_payment: parseFloat(currentTask.order_payment || 0),
      customer_comments: `Return order for ${orderId}. ${currentTask.customer_comments || ''}`.trim(),
    };

    // Add tags if any
    if (tags && tags.length > 0) {
      createPayload.tags = tags;
      console.log('Tags assigned to return order:', tags);
    }

    // Add fleet_id if driver was assigned
    if (currentTask.fleet_id) {
      createPayload.fleet_id = currentTask.fleet_id;
    }

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/create_task');
    console.log('Tookan API payload:', JSON.stringify({ ...createPayload, api_key: '***HIDDEN***' }, null, 2));

    const response = await fetch('https://api.tookanapp.com/v2/create_task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createPayload),
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

    const returnOrderId = data.data?.job_id || data.data?.jobId || null;

    console.log('✅ Return order created successfully:', returnOrderId);
    console.log('=== END REQUEST (SUCCESS) ===\n');
    
    res.json({
      status: 'success',
      action: 'return_order',
      entity: 'order',
      message: 'Return order created successfully',
      data: { returnOrderId: returnOrderId, originalOrderId: orderId }
    });
  } catch (error) {
    console.error('❌ Return order error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// DELETE Order
app.delete('/api/tookan/order/:orderId', authenticate, requirePermission('delete_ongoing_orders'), async (req, res) => {
  try {
    console.log('\n=== DELETE ORDER REQUEST ===');
    console.log('Order ID:', req.params.orderId);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const apiKey = getApiKey();
    const orderId = req.params.orderId;
    const { note } = req.body || {};

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
        message: 'Failed to fetch order for deletion',
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
    const statusInt = parseInt(currentStatus);
    
    // Check if order is successful (delivered/completed)
    // Status 6 = Completed, 7 = Delivered, etc.
    const successfulStatuses = [6, 7, 8]; // Completed, Delivered, etc.
    const isSuccessful = successfulStatuses.includes(statusInt) || 
                         ['completed', 'delivered'].includes(currentStatus.toString().toLowerCase());

    if (isSuccessful) {
      // Cannot delete successful orders, add note instead
      if (!note || !note.trim()) {
        return res.status(400).json({
          status: 'error',
          message: 'Note is required for successful orders',
          data: {}
        });
      }

      // Update order with note
      const updatePayload = {
        api_key: apiKey,
        job_id: orderId,
        customer_name: currentTask.customer_name || '',
        customer_phone: currentTask.customer_phone || '',
        customer_email: currentTask.customer_email || '',
        pickup_address: currentTask.pickup_address || '',
        delivery_address: currentTask.delivery_address || '',
        cod: parseFloat(currentTask.cod || 0),
        order_payment: parseFloat(currentTask.order_payment || 0),
        customer_comments: `${currentTask.customer_comments || ''}\n[DELETION NOTE: ${note}]`.trim(),
        job_type: currentTask.job_type || 0
      };

      if (currentTask.fleet_id) {
        updatePayload.fleet_id = currentTask.fleet_id;
      }

      const updateResponse = await fetch('https://api.tookanapp.com/v2/edit_task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatePayload),
      });

      const updateTextResponse = await updateResponse.text();
      let updateData;
      try {
        updateData = JSON.parse(updateTextResponse);
      } catch (parseError) {
        return res.status(500).json({
          status: 'error',
          message: 'Failed to add note to order',
          data: {}
        });
      }

      if (!updateResponse.ok || updateData.status !== 200) {
        return res.status(updateResponse.status || 500).json({
          status: 'error',
          message: updateData.message || 'Failed to add note to order',
          data: {}
        });
      }

      console.log('✅ Note added to successful order:', orderId);
      console.log('=== END REQUEST (SUCCESS) ===\n');
      
      return res.json({
        status: 'success',
        action: 'add_note',
        entity: 'order',
        message: 'Note added. Successful orders cannot be deleted.',
        data: { cannotDelete: true, orderId: orderId, note: note }
      });
    }

    // Delete ongoing order
    const deletePayload = {
      api_key: apiKey,
      job_id: orderId
    };

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/delete_task');
    console.log('Tookan API payload:', JSON.stringify({ ...deletePayload, api_key: '***HIDDEN***' }, null, 2));

    const response = await fetch('https://api.tookanapp.com/v2/delete_task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(deletePayload),
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
        message: data.message || 'Failed to delete order',
        data: {}
      });
    }

    // Audit log
    await auditLogger.createAuditLog(
      req,
      'order_delete',
      'order',
      orderId,
      { orderId, status: currentTask.job_status, customerName: currentTask.customer_name },
      null
    );

    console.log('✅ Order deleted successfully:', orderId);
    console.log('=== END REQUEST (SUCCESS) ===\n');
    
    res.json({
      status: 'success',
      action: 'delete_order',
      entity: 'order',
      message: 'Order deleted successfully',
      data: { orderId: orderId }
    });
  } catch (error) {
    console.error('❌ Delete order error:', error);
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
    console.error('❌ Conflict check error:', error);
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
        console.log('✅ Webhook event persisted to database, ID:', eventId);
      } catch (persistError) {
        console.error('⚠️  Failed to persist webhook event:', persistError.message);
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
      
      // Update task storage with COD data from template fields
      try {
        const updatedTask = await taskStorage.updateTaskFromWebhook(webhookData);
        
        if (updatedTask) {
          processed = true;
          eventAction = 'task_updated';
          console.log('✅ Task updated in local storage');
          console.log('  COD Amount:', updatedTask.cod_amount);
          console.log('  COD Collected:', updatedTask.cod_collected);
          
          // Mark event as processed
          if (eventId && isConfigured()) {
            try {
              await webhookEventsModel.markProcessed(eventId);
            } catch (markError) {
              console.error('⚠️  Failed to mark event as processed:', markError.message);
            }
          }
          
          // In a real implementation, you would:
          // 1. Notify frontend if order is currently loaded (via WebSocket/SSE)
          // 2. Trigger conflict detection if needed
        } else {
          console.log('⚠️  Could not update task (missing job_id)');
          if (eventId && isConfigured()) {
            try {
              await webhookEventsModel.markProcessed(eventId);
            } catch (markError) {
              console.error('⚠️  Failed to mark event as processed:', markError.message);
            }
          }
        }
      } catch (storageError) {
        console.error('❌ Error updating task storage:', storageError);
        processingError = storageError.message || 'Task storage update failed';
        
        // Mark event as failed
        if (eventId && isConfigured()) {
          try {
            await webhookEventsModel.markFailed(eventId, processingError);
          } catch (markError) {
            console.error('⚠️  Failed to mark event as failed:', markError.message);
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
          console.error('⚠️  Failed to mark event as processed:', markError.message);
        }
      }
    }
    
    // Always return 200 OK to acknowledge receipt (even if processing fails)
    console.log(`✅ Webhook processed: ${eventAction}`);
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
    console.error('❌ Webhook processing error:', error);
    console.error('Error stack:', error.stack);
    
    // Mark event as failed if we have an eventId
    if (typeof eventId !== 'undefined' && eventId !== null && isConfigured()) {
      try {
        await webhookEventsModel.markFailed(eventId, error.message || 'Webhook processing failed');
      } catch (markError) {
        console.error('⚠️  Failed to mark event as failed:', markError.message);
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
    console.error('❌ Get task error:', error);
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
    console.error('❌ Get task history error:', error);
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
    
    // Try to update in Tookan via task update API
    // Note: Tookan API may or may not support template field updates
    // We'll attempt it and fallback gracefully if it doesn't work
    try {
      const { TEMPLATE_FIELDS } = require('./config/tookanConfig');
      
      // Build template fields object for Tookan
      const templateFields = {
        ...(task.template_fields || {}),
        [TEMPLATE_FIELDS.COD_AMOUNT]: updatedTask.cod_amount,
        [TEMPLATE_FIELDS.COD_COLLECTED]: updatedTask.cod_collected
      };
      
      // Convert job_id to number (Tookan API requires numeric job_id)
      const numericJobId = parseInt(jobId, 10);
      if (isNaN(numericJobId)) {
        throw new Error(`Invalid job_id: ${jobId}. Must be a valid number.`);
      }
      
      const tookanPayload = {
        api_key: apiKey,
        job_id: numericJobId,
        template_fields: templateFields
      };
      
      console.log('\n=== ATTEMPTING TO UPDATE COD IN TOOKAN ===');
      console.log('Original job_id (from URL param):', jobId, `(type: ${typeof jobId})`);
      console.log('Converted job_id (numeric):', numericJobId, `(type: ${typeof numericJobId})`);
      console.log('Is numericJobId a number?', typeof numericJobId === 'number');
      console.log('\nTookan API Payload (API key hidden):');
      const logPayload = { ...tookanPayload, api_key: '***HIDDEN***' };
      console.log(JSON.stringify(logPayload, null, 2));
      console.log('\nVerification - job_id in payload:');
      console.log('  Value:', tookanPayload.job_id);
      console.log('  Type:', typeof tookanPayload.job_id);
      console.log('  JSON representation:', JSON.stringify({ job_id: tookanPayload.job_id }));
      
      // Try Tookan task update endpoint
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
        console.warn('⚠️  Tookan API returned non-JSON response, template field update may not be supported');
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
        console.log('✅ COD updated in Tookan successfully');
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
        console.warn('⚠️  Tookan API update failed or template fields not supported');
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
              ? '⚠️ job_id conversion may not be working correctly. Check server logs for details.'
              : 'Template field updates may not be supported by Tookan API. Please update manually in Tookan dashboard if needed.'
          }
        });
      }
    } catch (tookanError) {
      console.error('❌ Error updating Tookan:', tookanError);
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
    console.error('❌ Update COD error:', error);
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
        console.log(`📦 Found ${tasks.length} tasks from database for COD confirmations`);
      } catch (error) {
        console.warn('Database fetch failed, falling back to file storage:', error.message);
        // Fallback to file-based storage
        const tasksData = taskStorage.getAllTasks();
        tasks = Object.values(tasksData.tasks || {});
        console.log(`📦 Found ${tasks.length} tasks from file cache for COD confirmations`);
      }
    } else {
      // Fallback to file-based storage
      const tasksData = taskStorage.getAllTasks();
      tasks = Object.values(tasksData.tasks || {});
      console.log(`📦 Found ${tasks.length} tasks from file cache for COD confirmations`);
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
    
    console.log(`✅ Returning ${filteredConfirmations.length} COD confirmations`);
    
    res.json({
      status: 'success',
      message: 'COD confirmations fetched successfully',
      data: filteredConfirmations
    });
  } catch (error) {
    console.error('❌ Get COD confirmations error:', error);
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
        console.log(`📦 Found ${tasks.length} tasks from database for COD calendar`);
      } catch (error) {
        console.warn('Database fetch failed, falling back to file storage:', error.message);
        // Fallback to file-based storage
        const tasksData = taskStorage.getAllTasks();
        tasks = Object.values(tasksData.tasks || {});
        console.log(`📦 Found ${tasks.length} tasks from file cache for COD calendar`);
      }
    } else {
      // Fallback to file-based storage
      const tasksData = taskStorage.getAllTasks();
      tasks = Object.values(tasksData.tasks || {});
      console.log(`📦 Found ${tasks.length} tasks from file cache for COD calendar`);
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
    
    console.log(`✅ Returning ${calendarData.length} calendar entries`);
    
    res.json({
      status: 'success',
      message: 'COD calendar data fetched successfully',
      data: calendarData
    });
  } catch (error) {
    console.error('❌ Get COD calendar error:', error);
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
    console.error('❌ Get COD queue error:', error);
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
    
    console.log(`✅ Returning ${wallets.length} customer wallets`);
    
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
    console.error('❌ Get customer wallets error:', error);
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
        console.log('✅ Merchant wallet updated successfully');
      } else {
        console.warn('⚠️  Wallet update failed:', walletData.message);
        walletUpdateResult = { error: walletData.message };
      }
    } catch (walletError) {
      console.error('❌ Error updating wallet:', walletError);
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
    
    console.log(`✅ COD ${codId} settled successfully`);
    
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
    console.error('❌ Settle COD error:', error);
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
    console.error('❌ Get task metadata error:', error);
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
    console.error('❌ Update task metadata error:', error);
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
    console.error('❌ Get tag config error:', error);
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
    console.error('❌ Update tag config error:', error);
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
    console.error('❌ Suggest tags error:', error);
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
    console.error('❌ Get tags error:', error);
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

// GET All Orders (with filters)
// Fetches orders from Tookan API using /v2/get_all_tasks with date filtering and pagination
app.get('/api/tookan/orders', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET ALL ORDERS REQUEST ===');
    console.log('Query params:', JSON.stringify(req.query, null, 2));
    console.log('Request received at:', new Date().toISOString());
    
    const apiKey = getApiKey();
    const { dateFrom, dateTo, driverId, customerId, status, limit = 100, page = 1 } = req.query;

    // Prepare date range - Tookan API allows MAX 31 days
    // If no dates provided, fetch last 31 days
    let startDate = dateFrom;
    let endDate = dateTo;
    
    if (!startDate || !endDate) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 31); // Max 31 days allowed by Tookan
      
      if (!startDate) {
        startDate = start.toISOString().split('T')[0]; // YYYY-MM-DD format
      }
      if (!endDate) {
        endDate = end.toISOString().split('T')[0];
      }
    }
    
    // Validate date range is not more than 31 days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (daysDiff > 31) {
      // Adjust to last 31 days
      const adjustedEnd = new Date();
      const adjustedStart = new Date();
      adjustedStart.setDate(adjustedStart.getDate() - 31);
      startDate = adjustedStart.toISOString().split('T')[0];
      endDate = adjustedEnd.toISOString().split('T')[0];
      console.log(`⚠️  Date range adjusted to max 31 days: ${startDate} to ${endDate}`);
    }
    
    console.log(`📅 Fetching orders from ${startDate} to ${endDate} (${daysDiff} days)`);

    // Fetch orders from Tookan API with pagination
    const allOrders = [];
    let offset = 0;
    const batchLimit = 50; // Tookan API limit per request
    let hasMore = true;
    let totalFetched = 0;
    let useDateRange = true;

    // Tookan API seems to require dates - use today's date if no dates provided
    // This ensures we get recent orders
    let actualStartDate = startDate;
    let actualEndDate = endDate;
    
    if (!actualStartDate || !actualEndDate) {
      const today = new Date();
      actualEndDate = today.toISOString().split('T')[0];
      const start = new Date(today);
      start.setDate(start.getDate() - 7); // Last 7 days by default
      actualStartDate = start.toISOString().split('T')[0];
      console.log(`📅 Using default date range: ${actualStartDate} to ${actualEndDate}`);
    }
    
    while (hasMore && allOrders.length < parseInt(limit) * 2) {
      const tookanPayload = {
        api_key: apiKey,
        start_date: actualStartDate,
        end_date: actualEndDate,
        is_pagination: 1,
        off_set: offset,
        limit: batchLimit
      };

      console.log(`📥 Fetching orders batch: offset=${offset}, limit=${batchLimit}, dates: ${actualStartDate} to ${actualEndDate}`);

      const response = await fetch('https://api.tookanapp.com/v2/get_all_tasks', {
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
        console.error('❌ Failed to parse Tookan API response:', textResponse.substring(0, 200));
        // If date format is wrong, try without dates
        if (textResponse.includes('date') || textResponse.includes('Date') || textResponse.includes('invalid')) {
          console.log('⚠️  Date format issue detected, retrying without date range...');
          const retryPayload = {
            api_key: apiKey,
            is_pagination: 1,
            off_set: offset,
            limit: batchLimit
          };
          
          const retryResponse = await fetch('https://api.tookanapp.com/v2/get_all_tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(retryPayload),
          });
          
          const retryText = await retryResponse.text();
          try {
            data = JSON.parse(retryText);
            console.log('✅ Retry successful, got response without date filter');
          } catch (e) {
            console.error('❌ Retry also failed to parse:', retryText.substring(0, 200));
            hasMore = false;
            break;
          }
        } else {
          console.error('❌ Failed to parse response:', textResponse.substring(0, 300));
          hasMore = false;
          break;
        }
      }

      // Tookan API can return status 200 or 1 for success
      // If date range error, retry without dates
      if (!response.ok || (data.status !== 200 && data.status !== 1)) {
        if (useDateRange && (data.message?.includes('Date range') || data.message?.includes('date'))) {
          console.log('⚠️  Date range issue, retrying without date filter...');
          useDateRange = false;
          continue; // Retry without dates
        }
        
        console.log('⚠️  Tookan API returned error:', data.message || 'Unknown');
        console.log('Response status:', data.status);
        console.log('Response keys:', Object.keys(data).join(', '));
        if (data.data) {
          console.log('Data type:', typeof data.data, Array.isArray(data.data) ? '(array)' : '(object)');
        }
        hasMore = false;
        break;
      }

      // Tookan API can return data in different structures
      // Try multiple possible paths
      let tasks = [];
      if (Array.isArray(data.data)) {
        tasks = data.data;
        console.log(`✅ Found ${tasks.length} tasks in data array`);
      } else if (data.data && Array.isArray(data.data.data)) {
        tasks = data.data.data;
        console.log(`✅ Found ${tasks.length} tasks in data.data array`);
      } else if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
        // Check if it's an object with task properties (single task)
        if (data.data.job_id || data.data.id) {
          tasks = [data.data];
          console.log('✅ Found single task object');
        } else {
          // Try to extract tasks from object values
          const values = Object.values(data.data);
          tasks = values.filter(item => item && typeof item === 'object' && (item.job_id || item.id));
          console.log(`✅ Found ${tasks.length} tasks in object values`);
        }
      } else if (data.tookanData && Array.isArray(data.tookanData)) {
        tasks = data.tookanData;
        console.log(`✅ Found ${tasks.length} tasks in tookanData array`);
      }
      
      if (tasks.length === 0) {
        console.log('⚠️  No tasks found in response. Full response structure:');
        console.log(JSON.stringify(data, null, 2).substring(0, 1000));
        hasMore = false;
        break;
      }

      // Transform Tookan task data to our order format
      const transformedOrders = tasks.map((task) => {
        const jobId = task.job_id || task.id;
        const jobStatus = task.job_status || task.status || 0;
        const codAmount = parseFloat(task.cod || task.cod_amount || 0);
        const orderPayment = parseFloat(task.order_payment || task.order_fees || 0);
        const creationDate = task.creation_datetime || task.created_at || task.job_time || task.creation_date || new Date().toISOString();
        
        // Extract driver info - can be in fleet_name or job_details_by_fleet
        const driverName = task.fleet_name || task.driver_name || '';
        const driverId = task.fleet_id || task.driver_id || null;
        
        // Extract customer/merchant info with multiple fallbacks
        const customerName = task.customer_name || task.customer_username || task.job_pickup_name || '';
        const customerPhone = task.customer_phone || task.job_pickup_phone || '';
        const merchantName = task.merchant_name || task.vendor_name || '';
        const merchantId = task.vendor_id || task.merchant_id || null;
        
        return {
          id: jobId?.toString() || '',
          jobId: jobId?.toString() || '',
          date: creationDate,
          status: jobStatus,
          statusText: getStatusText(jobStatus),
          merchant: merchantName || customerName, // Use merchant name if available, else customer
          merchantId: merchantId || null,
          merchantNumber: task.merchant_phone || '',
          driver: driverName,
          driverId: driverId?.toString() || null,
          customer: customerName,
          customerId: task.customer_id?.toString() || null,
          customerNumber: customerPhone,
          cod: codAmount,
          codAmount: codAmount,
          tookanFees: 0, // Tookan fees may be in a different field
          fee: orderPayment,
          orderFees: orderPayment,
          pickupAddress: task.job_pickup_address || task.pickup_address || '',
          deliveryAddress: task.job_address || task.delivery_address || '',
          addresses: `${task.job_pickup_address || task.pickup_address || ''} → ${task.job_address || task.delivery_address || ''}`,
          notes: task.customer_comments || task.job_description || '',
          rawData: task
        };
      });

      allOrders.push(...transformedOrders);
      totalFetched += tasks.length;
      offset += batchLimit;

      // Stop if we got fewer than requested (last page)
      if (tasks.length < batchLimit) {
        hasMore = false;
      }
    }

    console.log(`✅ Fetched ${allOrders.length} orders from Tookan`);

    // Apply date filtering client-side (as additional filter, since API may not filter correctly)
    let filteredOrders = allOrders;
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      filteredOrders = filteredOrders.filter(order => {
        if (!order.date) return false;
        try {
          const orderDate = new Date(order.date);
          return orderDate >= start && orderDate <= end;
        } catch (e) {
          return false;
        }
      });
      
      console.log(`📅 Client-side filtered to ${filteredOrders.length} orders within date range`);
    }
    
    if (driverId) {
      filteredOrders = filteredOrders.filter(order => 
        order.driverId === driverId?.toString() || order.driverId === driverId
      );
    }
    
    if (customerId) {
      filteredOrders = filteredOrders.filter(order => 
        order.customerId === customerId?.toString() || order.merchantId === customerId?.toString()
      );
    }
    
    if (status) {
      filteredOrders = filteredOrders.filter(order => 
        order.status === parseInt(status) || order.statusText === status
      );
    }

    // Apply pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedOrders = filteredOrders.slice(startIndex, startIndex + limitNum);

    console.log(`✅ Returning ${paginatedOrders.length} orders (page ${pageNum}, total filtered: ${filteredOrders.length})`);
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
        filters: {
          dateFrom: startDate,
          dateTo: endDate,
          driverId: driverId || null,
          customerId: customerId || null,
          status: status || null
        }
      }
    });
  } catch (error) {
    console.error('❌ Get orders error:', error);
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

// GET Orders from Cache (webhook-based storage)
app.get('/api/tookan/orders/cached', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET CACHED ORDERS REQUEST ===');
    console.log('Query params:', JSON.stringify(req.query, null, 2));
    
    const { dateFrom, dateTo, driverId, customerId, status, search, limit = 100, page = 1 } = req.query;
    
    // Get all tasks from database or file fallback
    let tasks = [];
    let useDatabase = false;
    let totalCount = 0;
    
    if (isConfigured()) {
      try {
        const filters = {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          driverId: driverId || undefined,
          customerId: customerId || undefined,
          status: status ? parseInt(status) : undefined,
          search: search || undefined
          // Note: Don't pass limit/page here - we'll handle pagination after transformation
        };
        tasks = await taskModel.getAllTasks(filters);
        totalCount = tasks.length;
        useDatabase = true;
        console.log(`📦 Found ${tasks.length} tasks from database`);
      } catch (error) {
        console.warn('Database fetch failed, falling back to file storage:', error.message);
        // Fallback to file-based storage
        const tasksData = taskStorage.getAllTasks();
        tasks = Object.values(tasksData.tasks || {});
        totalCount = tasks.length;
        console.log(`📦 Found ${tasks.length} tasks from file cache`);
      }
    } else {
      // Fallback to file-based storage
      const tasksData = taskStorage.getAllTasks();
      tasks = Object.values(tasksData.tasks || {});
      totalCount = tasks.length;
      console.log(`📦 Found ${tasks.length} tasks from file cache`);
    }
    
    // Transform tasks to order format (matching Reports Panel format)
    const transformedOrders = tasks.map((task) => {
      const jobId = task.job_id || task.order_id;
      const jobStatus = task.status || task.job_status || 0;
      const codAmount = parseFloat(task.cod_amount || task.cod || 0);
      const orderPayment = parseFloat(task.order_fees || task.order_payment || 0);
      const creationDate = task.creation_datetime || task.job_time || task.created_at || task.webhook_received_at || new Date().toISOString();
      
      return {
        id: jobId?.toString() || '',
        jobId: jobId?.toString() || '',
        date: creationDate,
        status: jobStatus,
        statusText: getStatusText(jobStatus),
        merchant: task.customer_name || '', // May need adjustment based on actual data structure
        merchantId: task.vendor_id || null,
        merchantNumber: task.customer_phone || '',
        driver: task.fleet_name || '',
        driverId: task.fleet_id?.toString() || null,
        customer: task.customer_name || '',
        customerId: task.customer_id?.toString() || null,
        customerNumber: task.customer_phone || '',
        cod: codAmount,
        codAmount: codAmount,
        codCollected: task.cod_collected || false,
        tookanFees: 0,
        fee: orderPayment,
        orderFees: orderPayment,
        pickupAddress: task.pickup_address || '',
        deliveryAddress: task.delivery_address || '',
        addresses: `${task.pickup_address || ''} → ${task.delivery_address || ''}`,
        notes: task.notes || '',
        rawData: task
      };
    });
    
    // Apply filters (only if not using database, as database already filtered)
    let filteredOrders = transformedOrders;
    
    if (!useDatabase) {
      // Date filter
      if (dateFrom && dateTo) {
        const start = new Date(dateFrom);
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        
        filteredOrders = filteredOrders.filter(order => {
          if (!order.date) return false;
          try {
            const orderDate = new Date(order.date);
            return orderDate >= start && orderDate <= end;
          } catch (e) {
            return false;
          }
        });
      }
      
      // Driver filter
      if (driverId) {
        filteredOrders = filteredOrders.filter(order => 
          order.driverId === driverId?.toString() || order.driverId === driverId
        );
      }
      
      // Customer/Merchant filter
      if (customerId) {
        filteredOrders = filteredOrders.filter(order => 
          order.customerId === customerId?.toString() || order.merchantId === customerId?.toString()
        );
      }
      
      // Status filter
      if (status) {
        filteredOrders = filteredOrders.filter(order => 
          order.status === parseInt(status) || order.statusText === status
        );
      }
      
      // Search filter (orderId, customer, merchant, driver)
      if (search) {
        const searchLower = search.toLowerCase();
        filteredOrders = filteredOrders.filter(order => 
          order.id?.toLowerCase().includes(searchLower) ||
          order.customer?.toLowerCase().includes(searchLower) ||
          order.merchant?.toLowerCase().includes(searchLower) ||
          order.driver?.toLowerCase().includes(searchLower) ||
          order.customerNumber?.includes(search) ||
          order.merchantNumber?.includes(search)
        );
      }
    }
    
    // Sort by date (most recent first) - always needed for consistent ordering
    filteredOrders.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });
    
    // Apply pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedOrders = filteredOrders.slice(startIndex, startIndex + limitNum);
    
    console.log(`✅ Returning ${paginatedOrders.length} cached orders (page ${pageNum}, total filtered: ${filteredOrders.length})`);
    console.log('=== END REQUEST (SUCCESS) ===\n');
    
    res.json({
      status: 'success',
      action: 'fetch_orders_cached',
      entity: 'order',
      message: 'Cached orders fetched successfully',
      data: {
        orders: paginatedOrders,
        total: filteredOrders.length,
        totalCached: totalCount,
        page: pageNum,
        limit: limitNum,
        hasMore: filteredOrders.length > startIndex + limitNum,
        filters: {
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          driverId: driverId || null,
          customerId: customerId || null,
          status: status || null,
          search: search || null
        },
        source: useDatabase ? 'database' : 'cache'
      }
    });
  } catch (error) {
    console.error('❌ Get cached orders error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
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
      console.log('⚠️  Tookan API may not have get_all_fleets endpoint');
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
      console.log('⚠️  Tookan API returned error:', data.message);
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

    console.log('✅ Fleets (Drivers/Agents) fetched successfully:', fleets.length);
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
    console.error('❌ Get fleets error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
    });
  }
});

// GET All Customers/Merchants
// Note: In Tookan API, Merchants are called "Customers" (vendor_id)
app.get('/api/tookan/customers', authenticate, async (req, res) => {
  try {
    console.log('\n=== GET ALL CUSTOMERS (MERCHANTS) REQUEST ===');
    console.log('Request received at:', new Date().toISOString());
    
    const apiKey = getApiKey();

    console.log('Calling Tookan API: https://api.tookanapp.com/v2/get_all_customers');

    const response = await fetch('https://api.tookanapp.com/v2/get_all_customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });

    const data = await response.json();
    
    // Ensure customers is always an array
    const customers = Array.isArray(data.data) ? data.data : 
                      Array.isArray(data.customers) ? data.customers : 
                      Array.isArray(data) ? data : [];

    if (data.status === 200 || customers.length > 0) {
      console.log('✅ Customers (Merchants) fetched successfully:', customers.length);
      console.log('=== END REQUEST (SUCCESS) ===\n');
      
      res.json({
        status: 'success',
        action: 'fetch_customers',
        entity: 'customer',
        message: 'Customers fetched successfully',
        data: { customers: customers }
      });
    } else {
      console.log('❌ Failed to fetch customers:', data.message);
      console.log('=== END REQUEST (ERROR) ===\n');
      
      res.json({
        status: 'error',
        message: data.message || 'Failed to fetch customers',
        data: { customers: [] }
      });
    }
  } catch (error) {
    console.error('❌ Get customers error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: { customers: [] }
    });
  }
});

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

    // Fetch orders, drivers, and customers
    // Use localhost for internal API calls to avoid proxy/port issues
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    
    const authHeader = req.headers.authorization || '';

    const [ordersResult, driversResult, customersResult] = await Promise.all([
      fetch(`${baseUrl}/api/tookan/orders?dateFrom=${startDate}&dateTo=${endDate}&limit=10000`, {
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
      }),
      fetch(`${baseUrl}/api/tookan/customers`, {
        headers: authHeader ? { Authorization: authHeader } : {}
      }).then(r => r.json()).catch(err => {
        console.error('Error fetching customers for analytics:', err);
        return { status: 'error', data: { customers: [] } };
      })
    ]);

    const orders = ordersResult.status === 'success' ? (ordersResult.data?.orders || []) : [];
    const drivers = driversResult.status === 'success' ? (driversResult.data?.fleets || []) : [];
    const customers = customersResult.status === 'success' ? (customersResult.data?.customers || []) : [];

    console.log(`📊 Processing analytics for ${orders.length} orders, ${drivers.length} drivers, ${customers.length} customers`);
    
    // Log if orders are empty but we have drivers/customers (indicates API issue)
    if (orders.length === 0 && (drivers.length > 0 || customers.length > 0)) {
      console.log('⚠️  No orders found, but drivers/customers exist. This may indicate a Tookan API issue with order fetching.');
    }

    // Calculate KPIs
    const totalOrders = orders.length;
    const totalDrivers = drivers.length;
    const totalMerchants = customers.length;
    
    // Calculate COD metrics
    const pendingCOD = orders
      .filter(o => [0, 1, 2, 3, 4, 5].includes(parseInt(o.status))) // Ongoing orders
      .reduce((sum, o) => sum + (parseFloat(o.cod) || 0), 0);
    
    const collectedCOD = orders
      .filter(o => [6, 7, 8].includes(parseInt(o.status))) // Completed orders
      .reduce((sum, o) => sum + (parseFloat(o.cod) || 0), 0);
    
    const driversWithPending = new Set(
      orders
        .filter(o => [0, 1, 2, 3, 4, 5].includes(parseInt(o.status)) && parseFloat(o.cod) > 0)
        .map(o => o.driverId)
        .filter(id => id)
    ).size;
    
    const completedDeliveries = orders.filter(o => [6, 7, 8].includes(parseInt(o.status))).length;

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

    // Calculate Driver Performance (top 5 by delivery count)
    const driverPerformanceMap = new Map();
    orders.forEach(order => {
      if (order.driverId && [6, 7, 8].includes(parseInt(order.status))) {
        const driverId = order.driverId.toString();
        if (!driverPerformanceMap.has(driverId)) {
          const driver = drivers.find(d => d.id === driverId);
          driverPerformanceMap.set(driverId, {
            name: driver?.name || order.driver || 'Unknown Driver',
            deliveries: 0
          });
        }
        driverPerformanceMap.get(driverId).deliveries++;
      }
    });

    const driverPerformance = Array.from(driverPerformanceMap.values())
      .sort((a, b) => b.deliveries - a.deliveries)
      .slice(0, 5);

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

    console.log('✅ Analytics calculated successfully');
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
          driversWithPending: driversWithPending,
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
    console.error('❌ Get analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Network error occurred',
      data: {}
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
    
    let orders = [];
    let drivers = [];
    let customers = [];

    try {
      const ordersResponse = await fetch(`${baseUrl}/api/tookan/orders?dateFrom=${startDate}&dateTo=${endDate}&limit=10000`, {
        headers: authHeader ? { Authorization: authHeader } : {}
      });
      const ordersData = await ordersResponse.json();
      orders = ordersData.status === 'success' ? (ordersData.data?.orders || []) : [];
    } catch (err) {
      console.error('Error fetching orders for summary:', err);
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

    try {
      const customersResponse = await fetch(`${baseUrl}/api/tookan/customers`, {
        headers: authHeader ? { Authorization: authHeader } : {}
      });
      const customersData = await customersResponse.json();
      customers = customersData.status === 'success' ? (customersData.data?.customers || []) : [];
    } catch (err) {
      console.error('Error fetching customers for summary:', err);
    }

    // Calculate driver summaries
    const driverMap = new Map();
    orders.forEach(order => {
      if (order.driverId) {
        const driverId = order.driverId.toString();
        if (!driverMap.has(driverId)) {
          const driver = drivers.find(d => d.id === driverId);
          driverMap.set(driverId, {
            driverId: driverId,
            driverName: driver?.name || order.driver || 'Unknown Driver',
            orders: [],
            codTotal: 0,
            feesTotal: 0,
            deliveryTimes: []
          });
        }
        
        const driverData = driverMap.get(driverId);
        driverData.orders.push(order);
        driverData.codTotal += parseFloat(order.cod || 0);
        driverData.feesTotal += parseFloat(order.fee || order.orderFees || 0);
        
        // Calculate delivery time if available
        if (order.rawData?.completed_datetime && order.rawData?.creation_datetime) {
          const start = new Date(order.rawData.creation_datetime);
          const end = new Date(order.rawData.completed_datetime);
          const minutes = (end.getTime() - start.getTime()) / (1000 * 60);
          if (minutes > 0) driverData.deliveryTimes.push(minutes);
        }
      }
    });

    const driverSummaries = Array.from(driverMap.values()).map(driver => ({
      driverId: driver.driverId,
      driverName: driver.driverName,
      totalOrders: driver.orders.length,
      codTotal: driver.codTotal,
      feesTotal: driver.feesTotal,
      averageDeliveryTime: driver.deliveryTimes.length > 0
        ? Math.round(driver.deliveryTimes.reduce((a, b) => a + b, 0) / driver.deliveryTimes.length)
        : 0,
      completionRate: driver.orders.length > 0
        ? (driver.orders.filter(o => [6, 7, 8].includes(parseInt(o.status))).length / driver.orders.length * 100).toFixed(1)
        : '0'
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

    // Calculate totals
    const totals = {
      orders: orders.length,
      drivers: drivers.length,
      merchants: customers.length,
      deliveries: orders.filter(o => [6, 7, 8].includes(parseInt(o.status))).length
    };

    console.log('✅ Reports summary calculated successfully');
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'fetch_reports_summary',
      entity: 'report',
      message: 'Reports summary fetched successfully',
      data: {
        totals: totals,
        driverSummaries: driverSummaries,
        merchantSummaries: merchantSummaries,
        filters: {
          dateFrom: startDate,
          dateTo: endDate
        }
      }
    });
  } catch (error) {
    console.error('❌ Get reports summary error:', error);
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

    console.log('✅ Withdrawal request created:', withdrawalRequest.id);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'create_withdrawal_request',
      entity: 'withdrawal',
      message: 'Withdrawal request created successfully',
      data: { withdrawalRequest: transformedRequest }
    });
  } catch (error) {
    console.error('❌ Create withdrawal request error:', error);
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

    console.log('✅ Withdrawal request approved:', requestId);
    console.log('=== END REQUEST (SUCCESS) ===\n');

    res.json({
      status: 'success',
      action: 'approve_withdrawal',
      entity: 'withdrawal',
      message: 'Withdrawal request approved and wallet updated',
      data: { withdrawalRequest: transformedRequest }
    });
  } catch (error) {
    console.error('❌ Approve withdrawal error:', error);
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
        console.log('⚠️  get_all_agents failed, trying get_all_fleets...');
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
        console.log('⚠️  Could not parse fleet response');
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
              console.log('✅ Matched agent/fleet by ID:', fleetId);
              return true;
            }
          }
          
          // Match by email
          if (fleetEmail && fleetEmail === searchEmail) {
            console.log('✅ Matched agent/fleet by email:', fleetEmail);
            return true;
          }
          
          // Match by phone (exact or digits only)
          if (fleetPhone) {
            const phoneNormalized = fleetPhone.replace(/\D/g, '');
            const searchNormalized = email.replace(/\D/g, '');
            if (fleetPhone === email || (phoneNormalized && searchNormalized && phoneNormalized === searchNormalized)) {
              console.log('✅ Matched agent/fleet by phone:', fleetPhone);
              return true;
            }
          }
          
          return false;
        });

        if (tookanUser) {
          userType = 'driver';
          console.log('✅ Found user in Tookan Fleets (Driver/Agent)');
        } else {
          console.log('❌ No matching fleet found. Searched email/phone:', email);
          if (fleets.length > 0) {
            console.log('Sample fleet emails:', fleets.slice(0, 3).map(f => f.fleet_email || f.email).filter(Boolean));
          }
        }
      } else {
        console.log('⚠️  Fleet API returned error or unexpected format');
        console.log('Status:', fleetResponse.status);
        console.log('Response:', fleetTextResponse.substring(0, 500));
      }
    } catch (fleetError) {
      console.error('❌ Error fetching fleets:', fleetError.message);
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
          console.log('⚠️  Could not parse customer response');
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
                console.log('✅ Matched customer/merchant by ID:', vendorId);
                return true;
              }
            }
            
            // Match by email
            if (customerEmail && customerEmail === searchEmail) {
              console.log('✅ Matched customer/merchant by email:', customerEmail);
              return true;
            }
            
            // Match by phone (exact or digits only)
            if (customerPhone) {
              const phoneNormalized = customerPhone.replace(/\D/g, '');
              const searchNormalized = email.replace(/\D/g, '');
              if (customerPhone === email || (phoneNormalized && searchNormalized && phoneNormalized === searchNormalized)) {
                console.log('✅ Matched customer/merchant by phone:', customerPhone);
                return true;
              }
            }
            
            return false;
          });

          if (tookanUser) {
            userType = 'merchant';
            console.log('✅ Found user in Tookan Customers (Merchant)');
          } else {
            console.log('❌ No matching customer found. Searched email/phone:', email);
            if (customers.length > 0) {
              console.log('Sample customer emails:', customers.slice(0, 3).map(c => c.customer_email || c.email).filter(Boolean));
            }
          }
        } else {
          console.log('⚠️  Customer API returned error or unexpected format');
          console.log('Status:', customerResponse.status);
          console.log('Response:', customerTextResponse.substring(0, 500));
        }
      } catch (customerError) {
        console.error('❌ Error fetching customers:', customerError.message);
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
          
          console.log('✅ Found user in Supabase (Admin/Internal User)');
          
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
        console.log('⚠️  Supabase auth failed:', supabaseError.message);
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
                console.log('❌ Password verification failed for Tookan user');
                return res.status(401).json({
                  status: 'error',
                  message: 'Invalid password',
                  data: {}
                });
              }
              console.log('✅ Password verified for Tookan user');
            } catch (bcryptError) {
              console.log('⚠️  Bcrypt error, allowing login:', bcryptError.message);
              passwordValid = true;
            }
          } else {
            // First time login - store password hash for future logins
            console.log('⚠️  First login for Tookan user - storing password');
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
              console.log('✅ Password stored for future logins');
            } catch (createError) {
              console.log('⚠️  Could not store password, allowing login anyway:', createError.message);
              // Allow login even if storage fails
            }
          }
        } catch (dbError) {
          console.log('⚠️  Database error, allowing login:', dbError.message);
          // Allow login if DB check fails (for development)
        }
      } else {
        // No database configured, allow login (for development)
        console.log('⚠️  No database configured - allowing login without password verification');
      }

      // Generate a simple session token (in production, use JWT or similar)
      const sessionToken = Buffer.from(`${userId}:${Date.now()}:${userEmail}`).toString('base64');
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

      console.log('✅ Login successful for Tookan user');
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
    console.log('❌ User not found in Tookan or Supabase');
    console.log('=== END LOGIN (FAILED) ===\n');

    return res.status(401).json({
      status: 'error',
      message: 'Invalid email or password. User not found in Tookan system.',
      data: {}
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Login failed',
      data: {}
    });
  }
});

// POST Register (Admin only - creates user in Supabase Auth)
app.post('/api/auth/register', authenticate, requireRole('admin'), async (req, res) => {
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

    // Create user in Supabase Auth
    const { data, error } = await supabaseAnon.auth.admin.createUser({
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

// GET All Users (Admin only)
app.get('/api/users', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { role, search } = req.query;

    const filters = {};
    if (role) filters.role = role;
    if (search) filters.search = search;

    const users = await userModel.getAllUsers(filters);

    // Transform to expected format
    const transformedUsers = users.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name || user.email,
      role: user.role || 'user',
      permissions: user.permissions || {},
      status: 'Active', // TODO: Add status field to users table
      lastLogin: user.last_login || null,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    }));

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

// PUT Update User (Admin only)
app.put('/api/users/:id', authenticate, requireRole('admin'), async (req, res) => {
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

// PUT Update User Permissions (Admin only)
app.put('/api/users/:id/permissions', authenticate, requireRole('admin'), async (req, res) => {
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

// DELETE User (Admin only)
app.delete('/api/users/:id', authenticate, requireRole('admin'), async (req, res) => {
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

// PUT Update User Password (Admin or self)
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

// PUT Update User Role (Admin only)
app.put('/api/users/:id/role', authenticate, requireRole('admin'), async (req, res) => {
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API server is running' });
});

app.listen(PORT, () => {
  console.log(`🚀 Tookan API Proxy Server running on http://localhost:${PORT}`);
  console.log(`📡 Proxying requests to Tookan API`);
});

