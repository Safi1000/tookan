/**
 * Vercel Serverless API Entry Point
 * 
 * This file wraps the Express server for Vercel deployment.
 * All API routes are handled through this single serverless function.
 */

// Import the Express app from server
const path = require('path');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

// Initialize Supabase clients
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const isSupabaseConfigured = !!(
  supabaseUrl && 
  supabaseServiceKey && 
  supabaseUrl.startsWith('https://') &&
  !supabaseUrl.includes('YOUR_')
);

let supabase = null;
let supabaseAnon = null;

if (isSupabaseConfigured) {
  supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  supabaseAnon = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey);
}

// Create a simple serverless handler that proxies to Express
let app;

// Dynamically load the server
function getApp() {
  if (!app) {
    // Import the Express app from the server folder
    // We need to construct the app without starting the listen
    const express = require('express');
    const cors = require('cors');
    const fetch = require('node-fetch');
    const crypto = require('crypto');
    
    app = express();
    
    // Middleware
    app.use(cors());
    // Keep raw body for webhook signature verification
    app.use(express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    }));
    
    // Import all the route handlers from server/index.js
    // For Vercel, we'll include the essential routes inline
    
    const getApiKey = () => {
      const apiKey = process.env.TOOKAN_API_KEY;
      if (!apiKey) {
        throw new Error('TOOKAN_API_KEY not configured in environment variables');
      }
      return apiKey;
    };

    const getWebhookSecret = () => process.env.TOOKAN_WEBHOOK_SECRET || '';

    const normalizeTags = (tags) => {
      if (!tags) return [];
      if (Array.isArray(tags)) return tags;
      if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
      return [];
    };

    const transformFleetToAgent = (fleet) => ({
      fleet_id: parseInt(fleet.fleet_id || fleet.id),
      name: fleet.fleet_name || fleet.name || fleet.username || 'Unknown Agent',
      email: fleet.email || null,
      phone: fleet.phone || fleet.fleet_phone || null,
      username: fleet.username || null,
      status: parseInt(fleet.status) || 1,
      is_active: fleet.is_active !== false && fleet.status !== 0,
      team_id: fleet.team_id ? parseInt(fleet.team_id) : null,
      team_name: fleet.team_name || null,
      tags: normalizeTags(fleet.tags),
      latitude: fleet.latitude ? parseFloat(fleet.latitude) : null,
      longitude: fleet.longitude ? parseFloat(fleet.longitude) : null,
      battery_level: fleet.battery_level ? parseInt(fleet.battery_level) : null,
      registration_status: fleet.registration_status ? parseInt(fleet.registration_status) : null,
      transport_type: fleet.transport_type ? parseInt(fleet.transport_type) : null,
      transport_desc: fleet.transport_desc || null,
      license: fleet.license || null,
      color: fleet.color || null,
      raw_data: fleet,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // ============================================
    // PERMISSION CONSTANTS (per SRS)
    // ============================================
    const PERMISSIONS = {
      EDIT_ORDER_FINANCIALS: 'edit_order_financials',
      MANAGE_WALLETS: 'manage_wallets',
      PERFORM_REORDER: 'perform_reorder',
      PERFORM_RETURN: 'perform_return',
      DELETE_ONGOING_ORDERS: 'delete_ongoing_orders',
      EXPORT_REPORTS: 'export_reports',
      ADD_COD: 'add_cod',
      CONFIRM_COD_PAYMENTS: 'confirm_cod_payments',
      MANAGE_USERS: 'manage_users' // Admin only
    };

    // Authentication middleware
    const authenticate = async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ status: 'error', message: 'No authorization token provided' });
        }

        const token = authHeader.split(' ')[1];
        
        // For now, decode the token (in production, verify JWT signature)
        // The token contains user info from login
        try {
          const tokenData = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
          req.user = {
            id: tokenData.sub || tokenData.user_id || tokenData.id,
            email: tokenData.email,
            role: tokenData.role || 'user',
            permissions: tokenData.permissions || {}
          };
          
          // If user has admin role, grant all permissions
          if (req.user.role === 'admin') {
            req.user.permissions = Object.values(PERMISSIONS).reduce((acc, perm) => {
              acc[perm] = true;
              return acc;
            }, {});
          }
          
          next();
        } catch (e) {
          // If token parsing fails, try to look up user in database
          if (isSupabaseConfigured && supabase) {
            const { data: userData, error } = await supabase
              .from('tookan_users')
              .select('*')
              .or(`id.eq.${token},tookan_id.eq.${token}`)
              .single();
            
            if (userData) {
              req.user = {
                id: userData.id,
                email: userData.email,
                role: userData.role || 'user',
                permissions: userData.permissions || {}
              };
              return next();
            }
          }
          return res.status(401).json({ status: 'error', message: 'Invalid authorization token' });
        }
      } catch (error) {
        return res.status(401).json({ status: 'error', message: 'Authentication failed' });
      }
    };

    // Permission check middleware
    const requirePermission = (...requiredPermissions) => {
      return (req, res, next) => {
        if (!req.user) {
          return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }

        // Admins have all permissions
        if (req.user.role === 'admin') {
          return next();
        }

        // Check if user has at least one of the required permissions
        const hasPermission = requiredPermissions.some(perm => {
          return req.user.permissions && req.user.permissions[perm] === true;
        });

        if (!hasPermission) {
          return res.status(403).json({ 
            status: 'error', 
            message: `Permission denied. Required: ${requiredPermissions.join(' or ')}`,
            requiredPermissions 
          });
        }

        next();
      };
    };

    // Role check middleware (for backward compatibility)
    const requireRole = (...roles) => {
      return (req, res, next) => {
        if (!req.user) {
          return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }

        if (!roles.includes(req.user.role)) {
          return res.status(403).json({ status: 'error', message: 'Insufficient role permissions' });
        }

        next();
      };
    };

    // Health check
    app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'success', 
        message: 'Turbo Bahrain API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      });
    });

    // Tookan Webhook endpoint
    app.post('/api/tookan/webhook', async (req, res) => {
      try {
        // Optional signature verification when shared secret is set
        const webhookSecret = process.env.TOOKAN_WEBHOOK_SECRET;
        if (webhookSecret) {
          const receivedSig = req.headers['x-tookan-signature'] || req.headers['x-hook-signature'] || req.headers['x-webhook-signature'];
          if (!receivedSig) {
            return res.status(401).json({ status: 'error', message: 'Missing webhook signature' });
          }

          const payload = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
          const expectedSig = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');

          const expectedBuf = Buffer.from(expectedSig);
          const receivedBuf = Buffer.from(receivedSig);
          if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
            return res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
          }
        }

        console.log('Webhook received:', JSON.stringify(req.body, null, 2));
        
        const { 
          job_id, 
          event_type, 
          job_status,
          fleet_id,
          fleet_name,
          customer_id,
          customer_username,
          order_id,
          job_pickup_name,
          job_pickup_phone,
          job_pickup_address,
          customer_address,
          customer_phone,
          customer_name,
          total_amount,
          job_type,
          completed_datetime,
          acknowledged_datetime,
          started_datetime
        } = req.body;
        
        // Store webhook event in Supabase
        if (isSupabaseConfigured && supabase) {
          // 1. Log the webhook event
          await supabase.from('webhook_events').insert({
            event_type: event_type || 'unknown',
            job_id: job_id?.toString(),
            payload: req.body,
            status: 'processing'
          });

          // 2. Process based on event type
          let processedSuccessfully = true;
          let processingNotes = '';

          try {
            switch (event_type) {
              case 'task_completed':
              case 'successful':
                // Task completed - update COD tracking
                if (job_id && total_amount) {
                  processingNotes = `Task ${job_id} completed. COD: ${total_amount}`;
                  
                  // Log to audit
                  await supabase.from('audit_logs').insert({
                    action: 'TASK_COMPLETED',
                    entity_type: 'order',
                    entity_id: job_id?.toString(),
                    new_value: {
                      job_status: 'completed',
                      total_amount,
                      fleet_id,
                      completed_at: completed_datetime || new Date().toISOString()
                    },
                    notes: `Order ${job_id} marked as completed via webhook`
                  });
                }
                break;

              case 'task_started':
              case 'started':
                processingNotes = `Task ${job_id} started by driver ${fleet_id}`;
                await supabase.from('audit_logs').insert({
                  action: 'TASK_STARTED',
                  entity_type: 'order',
                  entity_id: job_id?.toString(),
                  new_value: {
                    job_status: 'started',
                    fleet_id,
                    started_at: started_datetime || new Date().toISOString()
                  },
                  notes: `Order ${job_id} started by driver ${fleet_name || fleet_id}`
                });
                break;

              case 'task_cancelled':
              case 'cancelled':
              case 'failed':
                processingNotes = `Task ${job_id} cancelled/failed`;
                await supabase.from('audit_logs').insert({
                  action: 'TASK_CANCELLED',
                  entity_type: 'order',
                  entity_id: job_id?.toString(),
                  new_value: {
                    job_status: event_type,
                    cancelled_at: new Date().toISOString()
                  },
                  notes: `Order ${job_id} was ${event_type}`
                });
                break;

              case 'task_assigned':
              case 'assigned':
                processingNotes = `Task ${job_id} assigned to driver ${fleet_id}`;
                await supabase.from('audit_logs').insert({
                  action: 'DRIVER_ASSIGNED',
                  entity_type: 'order',
                  entity_id: job_id?.toString(),
                  new_value: {
                    fleet_id,
                    fleet_name,
                    assigned_at: new Date().toISOString()
                  },
                  notes: `Order ${job_id} assigned to ${fleet_name || fleet_id}`
                });
                break;

              case 'task_updated':
              case 'updated':
                processingNotes = `Task ${job_id} updated`;
                await supabase.from('audit_logs').insert({
                  action: 'TASK_UPDATED',
                  entity_type: 'order',
                  entity_id: job_id?.toString(),
                  new_value: req.body,
                  notes: `Order ${job_id} updated via Tookan`
                });
                break;

              case 'acknowledged':
                processingNotes = `Task ${job_id} acknowledged by driver ${fleet_id}`;
                await supabase.from('audit_logs').insert({
                  action: 'TASK_ACKNOWLEDGED',
                  entity_type: 'order',
                  entity_id: job_id?.toString(),
                  new_value: {
                    fleet_id,
                    acknowledged_at: acknowledged_datetime || new Date().toISOString()
                  },
                  notes: `Order ${job_id} acknowledged by ${fleet_name || fleet_id}`
                });
                break;

              default:
                processingNotes = `Unknown event type: ${event_type}`;
            }
          } catch (processError) {
            processedSuccessfully = false;
            processingNotes = `Processing error: ${processError.message}`;
            console.error('Webhook processing error:', processError);
          }

          // 3. Update webhook event status
          await supabase
            .from('webhook_events')
            .update({
              status: processedSuccessfully ? 'processed' : 'failed',
              processed_at: new Date().toISOString(),
              error_message: processedSuccessfully ? null : processingNotes
            })
            .eq('job_id', job_id?.toString())
            .order('created_at', { ascending: false })
            .limit(1);
        }

        res.json({
          status: 'success',
          message: 'Webhook received and processed',
          data: { job_id, event_type }
        });
      } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message
        });
      }
    });

    // Tookan task webhook (body or header secret)
    app.post('/api/webhooks/tookan/task', async (req, res) => {
      try {
        const expected = getWebhookSecret();
        const secretHeader = req.headers['x-webhook-secret'];
        const bodySecret = (req.body && req.body.tookan_shared_secret) || null;
        if (expected && secretHeader !== expected && bodySecret !== expected) {
          return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const payload = req.body || {};
        const jobId = payload.job_id || payload.id || payload.task_id;
        if (!jobId) {
          return res.status(400).json({ status: 'error', message: 'job_id is required' });
        }

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
        }

        const record = {
          job_id: parseInt(jobId) || jobId,
          cod_amount: parseFloat(payload.cod_amount || payload.cod || 0),
          order_fees: parseFloat(payload.order_fees || payload.order_payment || 0),
          fleet_id: payload.fleet_id ? parseInt(payload.fleet_id) : null,
          fleet_name: payload.fleet_name || payload.driver_name || '',
          notes: payload.customer_comments || payload.notes || '',
          status: payload.status || payload.job_status || null,
          creation_datetime: payload.creation_datetime || payload.job_time || payload.created_at || payload.timestamp || new Date().toISOString(),
          raw_data: payload,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase
          .from('tasks')
          .upsert(record, { onConflict: 'job_id', ignoreDuplicates: false });

        if (error) {
          console.error('Supabase task upsert error:', error.message);
          return res.status(500).json({ status: 'error', message: error.message });
        }

        return res.status(200).json({ status: 'success', message: 'Task upserted' });
      } catch (error) {
        console.error('Webhook task error:', error);
        return res.status(500).json({ status: 'error', message: error.message || 'Internal error' });
      }
    });

    // Tookan agent webhook (body or header secret)
    app.post('/api/webhooks/tookan/agent', async (req, res) => {
      try {
        const expected = getWebhookSecret();
        const secretHeader = req.headers['x-webhook-secret'];
        const bodySecret = (req.body && req.body.tookan_shared_secret) || null;
        if (expected && secretHeader !== expected && bodySecret !== expected) {
          return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const payload = req.body || {};
        const fleetId = payload.fleet_id || payload.id;
        if (!fleetId) {
          return res.status(400).json({ status: 'error', message: 'fleet_id is required' });
        }

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
        }

        const agentRecord = transformFleetToAgent(payload);
        const { error } = await supabase
          .from('agents')
          .upsert(agentRecord, { onConflict: 'fleet_id', ignoreDuplicates: false });

        if (error) {
          console.error('Supabase agent upsert error:', error.message);
          return res.status(500).json({ status: 'error', message: error.message });
        }

        return res.status(200).json({ status: 'success', message: 'Agent upserted' });
      } catch (error) {
        console.error('Webhook agent error:', error);
        return res.status(500).json({ status: 'error', message: error.message || 'Internal error' });
      }
    });

    // GET Orders from Cache (database-first, paginated, minimal fields) - serverless
    app.get('/api/tookan/orders/cached', async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({
            status: 'error',
            message: 'Supabase not configured',
            data: { orders: [], total: 0, page: 1, limit: 50, hasMore: false }
          });
        }

        const { dateFrom, dateTo, driverId, customerId, status, search, limit = 50, page = 1 } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 50);
        const from = (pageNum - 1) * limitNum;
        const to = from + limitNum - 1;

        let query = supabase
          .from('tasks')
          .select('job_id,cod_amount,order_fees,fleet_id,fleet_name,notes,creation_datetime', { count: 'exact' });

        if (dateFrom) query = query.gte('creation_datetime', dateFrom);
        if (dateTo) query = query.lte('creation_datetime', dateTo);
        if (driverId) query = query.eq('fleet_id', driverId);
        if (customerId) query = query.eq('vendor_id', customerId);
        if (status !== undefined && status !== null && status !== '') {
          query = query.eq('status', parseInt(status));
        }
        if (search) {
          const term = String(search).trim().replace(/,/g, '');
          if (/^\\d+$/.test(term)) {
            // numeric prefix search via range
            const digits = term.length;
            const maxDigits = 12;
            const power = Math.pow(10, Math.max(0, maxDigits - digits));
            const lower = parseInt(term, 10) * power;
            const upper = (parseInt(term, 10) + 1) * power - 1;
            query = query.gte('job_id', lower).lte('job_id', upper);
          } else {
            const like = `%${term}%`;
            const ors = [
              `customer_name.ilike.${like}`,
              `fleet_name.ilike.${like}`
            ];
            query = query.or(ors.join(','));
          }
        }

        query = query.order('creation_datetime', { ascending: false }).range(from, to);

        const { data, error, count } = await query;
        if (error) {
          console.error('Get cached orders error:', error.message);
          return res.status(500).json({
            status: 'error',
            message: error.message,
            data: { orders: [], total: 0, page: pageNum, limit: limitNum, hasMore: false }
          });
        }

        const orders = (data || []).map(task => ({
          jobId: task.job_id?.toString() || '',
          codAmount: parseFloat(task.cod_amount || 0),
          orderFees: parseFloat(task.order_fees || 0),
          assignedDriver: task.fleet_id || null,
          assignedDriverName: task.fleet_name || '',
          notes: task.notes || '',
          date: task.creation_datetime || null
        }));

        const total = count || 0;
        const hasMore = (pageNum * limitNum) < total;

        return res.json({
          status: 'success',
          action: 'fetch_orders_cached',
          entity: 'order',
          message: 'Cached orders fetched successfully',
          data: {
            orders,
            total,
            page: pageNum,
            limit: limitNum,
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
        console.error('Get cached orders error:', error);
        return res.status(500).json({
          status: 'error',
          message: error.message || 'Network error occurred',
          data: { orders: [], total: 0, page: 1, limit: 50, hasMore: false }
        });
      }
    });

    // Get all fleets (drivers)
    app.get('/api/tookan/fleets', async (req, res) => {
      try {
        const apiKey = getApiKey();
        const response = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey })
        });
        const data = await response.json();
        
        // Ensure fleets is always an array
        const fleets = Array.isArray(data.data) ? data.data : 
                       Array.isArray(data.fleets) ? data.fleets : 
                       Array.isArray(data) ? data : [];
        
        if (data.status === 200 || fleets.length > 0) {
          res.json({
            status: 'success',
            message: 'Fleets fetched successfully',
            data: { fleets: fleets }
          });
        } else {
          res.json({
            status: 'error',
            message: data.message || 'Failed to fetch fleets',
            data: { fleets: [] }
          });
        }
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message,
          data: { fleets: [] }
        });
      }
    });

    // Get all customers (merchants)
    app.get('/api/tookan/customers', async (req, res) => {
      try {
        const apiKey = getApiKey();
        const response = await fetch('https://api.tookanapp.com/v2/get_all_customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey })
        });
        const data = await response.json();
        
        // Ensure customers is always an array
        const customers = Array.isArray(data.data) ? data.data : 
                          Array.isArray(data.customers) ? data.customers : 
                          Array.isArray(data) ? data : [];
        
        if (data.status === 200 || customers.length > 0) {
          res.json({
            status: 'success',
            message: 'Customers fetched successfully',
            data: { customers: customers }
          });
        } else {
          res.json({
            status: 'error',
            message: data.message || 'Failed to fetch customers',
            data: { customers: [] }
          });
        }
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message,
          data: { customers: [] }
        });
      }
    });

    // Get orders from Tookan (cache-first strategy with 6-month range)
    app.get('/api/tookan/orders', async (req, res) => {
      try {
        const { dateFrom, dateTo, limit = 100, page = 1, forceRefresh } = req.query;
        
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
        }
        
        let orders = [];
        let source = 'api';
        
        // Try cache first if Supabase is configured
        if (isSupabaseConfigured && supabase && !forceRefresh) {
          try {
            // Check if cache is fresh
            const { data: syncStatus } = await supabase
              .from('sync_status')
              .select('last_successful_sync')
              .eq('sync_type', 'orders')
              .single();
            
            let isFresh = false;
            if (syncStatus?.last_successful_sync) {
              const lastSync = new Date(syncStatus.last_successful_sync);
              const now = new Date();
              const hoursDiff = (now - lastSync) / (1000 * 60 * 60);
              isFresh = hoursDiff < 24;
            }
            
            if (isFresh) {
              // Fetch from cache
              const { data: cachedOrders, error: cacheError } = await supabase
                .from('tasks')
                .select('*')
                .gte('creation_datetime', startDate)
                .lte('creation_datetime', endDate + 'T23:59:59.999Z')
                .order('creation_datetime', { ascending: false })
                .limit(parseInt(limit));
              
              if (!cacheError && cachedOrders && cachedOrders.length > 0) {
                orders = cachedOrders.map(task => ({
                  id: task.job_id?.toString(),
                  job_id: task.job_id,
                  orderId: task.order_id || task.job_id?.toString(),
                  date: task.creation_datetime,
                  status: task.status,
                  job_type: task.job_type,
                  customer: task.customer_name || task.delivery_name,
                  driver: task.fleet_name,
                  driverId: task.fleet_id?.toString(),
                  cod: task.total_amount || task.cod_amount || 0,
                  orderFees: task.order_fees || 0,
                  pickup_address: task.pickup_address,
                  delivery_address: task.delivery_address
                }));
                source = 'cache';
              }
            }
          } catch (cacheErr) {
            console.log('Cache check failed, falling back to API:', cacheErr.message);
          }
        }
        
        // Fallback to Tookan API if cache miss
        if (orders.length === 0) {
          const apiKey = getApiKey();
          
          // Fetch with retry logic
          const fetchWithRetry = async (url, options, retries = 3) => {
            for (let attempt = 1; attempt <= retries; attempt++) {
              try {
                return await fetch(url, options);
              } catch (error) {
                if (error.message.includes('SSL') || error.message.includes('ECONNRESET')) {
                  if (attempt < retries) {
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                    continue;
                  }
                }
                throw error;
              }
            }
          };
          
          // Fetch all job types
          const jobTypes = [0, 1, 2, 3];
          const allTasks = [];
          
          for (const jobType of jobTypes) {
            try {
              const response = await fetchWithRetry('https://api.tookanapp.com/v2/get_all_tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  api_key: apiKey,
                  job_type: jobType,
                  job_status: '0,1,2,3,4,5,6,7,8,9',
                  start_date: startDate,
                  end_date: endDate,
                  limit: parseInt(limit),
                  custom_fields: 1
                })
              });
              
              const data = await response.json();
              if (data.status === 200 || data.status === 1) {
                const tasks = Array.isArray(data.data) ? data.data : [];
                allTasks.push(...tasks);
              }
            } catch (err) {
              console.error(`Error fetching job type ${jobType}:`, err.message);
            }
          }
          
          orders = allTasks.map(task => ({
            id: task.job_id?.toString(),
            job_id: task.job_id,
            orderId: task.order_id || task.job_id?.toString(),
            date: task.creation_datetime,
            status: task.job_status,
            job_type: task.job_type,
            customer: task.customer_name || task.customer_username,
            driver: task.fleet_name,
            driverId: task.fleet_id?.toString(),
            cod: parseFloat(task.total_amount || task.cod || 0),
            orderFees: parseFloat(task.order_payment || 0),
            pickup_address: task.job_pickup_address,
            delivery_address: task.job_address
          }));
          source = 'api';
        }
        
        res.json({
          status: 'success',
          message: 'Orders fetched successfully',
          data: { 
            orders: orders, 
            total: orders.length,
            source: source,
            filters: { dateFrom: startDate, dateTo: endDate }
          }
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message,
          data: { orders: [], total: 0 }
        });
      }
    });

    // Analytics endpoint
    app.get('/api/reports/analytics', async (req, res) => {
      try {
        const apiKey = getApiKey();
        
        // Fetch data from Tookan - always use get_all_customers for consistency
        const [fleetsRes, customersRes, tasksRes] = await Promise.all([
          fetch('https://api.tookanapp.com/v2/get_all_fleets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
          }),
          fetch('https://api.tookanapp.com/v2/get_all_customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
          }),
          fetch('https://api.tookanapp.com/v2/get_all_tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: apiKey,
              job_type: 1,
              job_status: '0,1,2,3,4,5,6,7,8,9',
              limit: 100,
              custom_fields: 1
            })
          })
        ]);
        
        const [fleetsData, customersData, tasksData] = await Promise.all([
          fleetsRes.json(),
          customersRes.json(),
          tasksRes.json()
        ]);
        
        // Ensure data is always an array
        const fleets = Array.isArray(fleetsData.data) ? fleetsData.data : 
                       Array.isArray(fleetsData.fleets) ? fleetsData.fleets : 
                       Array.isArray(fleetsData) ? fleetsData : [];
        const customers = Array.isArray(customersData.data) ? customersData.data : 
                          Array.isArray(customersData.customers) ? customersData.customers : 
                          Array.isArray(customersData) ? customersData : [];
        const tasks = Array.isArray(tasksData.data) ? tasksData.data : 
                      Array.isArray(tasksData.tasks) ? tasksData.tasks : 
                      Array.isArray(tasksData) ? tasksData : [];
        
        // Calculate analytics
        const completedTasks = tasks.filter(t => t.job_status === 2);
        const pendingCOD = tasks
          .filter(t => t.order_payment && t.job_status === 2)
          .reduce((sum, t) => sum + (parseFloat(t.order_payment) || 0), 0);
        
        // Tookan terminology:
        // - Customers: delivery recipients (all entries from get_all_customers)
        // - Merchants: registered businesses with vendor_id (subset of customers)
        // - Agents/Drivers: delivery personnel (from get_all_fleets)
        const totalCustomers = customers.length;
        const totalMerchants = customers.filter(c => c.vendor_id != null).length;
        
        res.json({
          status: 'success',
          message: 'Analytics fetched successfully',
          data: {
            kpis: {
              totalOrders: tasks.length,
              totalDrivers: fleets.length,  // Tookan calls these "Agents"
              totalMerchants: totalMerchants,  // Only those with vendor_id
              totalCustomers: totalCustomers,  // All delivery recipients
              pendingCOD: pendingCOD,
              driversWithPending: 0,
              completedDeliveries: completedTasks.length
            },
            trends: {
              orders: '+0%',
              drivers: '+0%',
              merchants: '+0%',
              customers: '+0%',
              pendingCOD: '+0%',
              driversPending: '+0%',
              completed: '+0%'
            },
            codStatus: [],
            orderVolume: [],
            driverPerformance: []
          }
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message,
          data: {
            kpis: { totalOrders: 0, totalDrivers: 0, totalMerchants: 0, totalCustomers: 0, pendingCOD: 0, driversWithPending: 0, completedDeliveries: 0 },
            trends: { orders: '+0%', drivers: '+0%', merchants: '+0%', customers: '+0%', pendingCOD: '+0%', driversPending: '+0%', completed: '+0%' },
            codStatus: [],
            orderVolume: [],
            driverPerformance: []
          }
        });
      }
    });

    // Customer wallet endpoint
    // Wallet management requires permission
    app.post('/api/tookan/customer-wallet/payment', authenticate, requirePermission(PERMISSIONS.MANAGE_WALLETS), async (req, res) => {
      try {
        const apiKey = getApiKey();
        const { vendor_id, amount, description } = req.body;
        
        const response = await fetch('https://api.tookanapp.com/v2/addCustomerPaymentViaDashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            vendor_id: vendor_id,
            amount: amount,
            description: description || 'Payment from dashboard'
          })
        });
        
        const data = await response.json();
        res.json({
          status: data.status === 200 ? 'success' : 'error',
          message: data.message || 'Payment processed',
          data: data
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message,
          data: {}
        });
      }
    });

    // Fetch customer wallets
    app.get('/api/customers/wallets', async (req, res) => {
      try {
        const apiKey = getApiKey();
        const { limit = 50, offset = 0 } = req.query;
        
        const response = await fetch('https://api.tookanapp.com/v2/fetch_customers_wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            is_pagination: 1,
            off_set: parseInt(offset),
            limit: parseInt(limit)
          })
        });
        
        const data = await response.json();
        res.json({
          status: data.status === 200 ? 'success' : 'error',
          message: data.message || 'Wallets fetched',
          data: { wallets: data.data || [] }
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message,
          data: { wallets: [] }
        });
      }
    });

    // Driver wallet transaction
    // Driver wallet management requires permission
    app.post('/api/tookan/driver-wallet/transaction', authenticate, requirePermission(PERMISSIONS.MANAGE_WALLETS), async (req, res) => {
      try {
        const apiKey = getApiKey();
        const { fleet_id, amount, description, transaction_type } = req.body;
        
        const tookanTransactionType = transaction_type === 'debit' ? 1 : 2;
        const finalAmount = transaction_type === 'debit' ? -Math.abs(amount) : Math.abs(amount);
        
        const response = await fetch('https://api.tookanapp.com/v2/fleet/wallet/create_transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            fleet_id: fleet_id,
            amount: finalAmount,
            description: description,
            transaction_type: tookanTransactionType,
            wallet_type: 1
          })
        });
        
        const data = await response.json();
        res.json({
          status: data.status === 200 ? 'success' : 'error',
          message: data.message || 'Transaction processed',
          data: data
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message,
          data: {}
        });
      }
    });

    // ============================================
    // USER AUTHENTICATION
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

        // Check if input is a numeric ID (Tookan fleet_id or vendor_id)
        const isNumericId = /^\d+$/.test(email);
        const searchId = isNumericId ? parseInt(email, 10) : null;

        // First, try to find user in Tookan Agents/Fleets (Drivers)
        try {
          const fleetPayload = { api_key: apiKey };

          let fleetResponse = await fetch('https://api.tookanapp.com/v2/get_all_agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fleetPayload),
          });

          if (!fleetResponse.ok) {
            fleetResponse = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fleetPayload),
            });
          }

          const fleetTextResponse = await fleetResponse.text();
          let fleetData;
          try {
            fleetData = JSON.parse(fleetTextResponse);
          } catch (parseError) {
            console.log('Could not parse fleet response');
          }

          if (fleetResponse.ok && fleetData) {
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

            tookanUser = fleets.find(fleet => {
              const fleetId = fleet.fleet_id || fleet.agent_id || fleet.id || fleet.fleetId || fleet.agentId;
              const fleetEmail = (fleet.fleet_email || fleet.agent_email || fleet.email || fleet.fleetEmail || fleet.agentEmail || '').toLowerCase();
              const fleetPhone = fleet.fleet_phone || fleet.agent_phone || fleet.phone || fleet.fleetPhone || fleet.agentPhone || '';
              const searchEmail = email.toLowerCase();

              if (searchId && fleetId) {
                const idMatch = parseInt(fleetId) === searchId || fleetId.toString() === email;
                if (idMatch) return true;
              }
              if (fleetEmail && fleetEmail === searchEmail) return true;
              if (fleetPhone) {
                const phoneNormalized = fleetPhone.replace(/\D/g, '');
                const searchNormalized = email.replace(/\D/g, '');
                if (fleetPhone === email || (phoneNormalized && searchNormalized && phoneNormalized === searchNormalized)) return true;
              }
              return false;
            });

            if (tookanUser) {
              userType = 'driver';
            }
          }
        } catch (fleetError) {
          console.error('Error fetching fleets:', fleetError.message);
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
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(customerPayload),
            });

            const customerTextResponse = await customerResponse.text();
            let customerData;
            try {
              customerData = JSON.parse(customerTextResponse);
            } catch (parseError) {
              console.log('Could not parse customer response');
            }

            if (customerResponse.ok && customerData) {
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

              tookanUser = customers.find(customer => {
                const vendorId = customer.vendor_id || customer.customer_id || customer.vendorId || customer.customerId || customer.id;
                const customerEmail = (customer.customer_email || customer.vendor_email || customer.email || customer.customerEmail || customer.vendorEmail || '').toLowerCase();
                const customerPhone = customer.customer_phone || customer.vendor_phone || customer.phone || customer.customerPhone || customer.vendorPhone || '';
                const searchEmail = email.toLowerCase();

                if (searchId && vendorId) {
                  const idMatch = parseInt(vendorId) === searchId || vendorId.toString() === email;
                  if (idMatch) return true;
                }
                if (customerEmail && customerEmail === searchEmail) return true;
                if (customerPhone) {
                  const phoneNormalized = customerPhone.replace(/\D/g, '');
                  const searchNormalized = email.replace(/\D/g, '');
                  if (customerPhone === email || (phoneNormalized && searchNormalized && phoneNormalized === searchNormalized)) return true;
                }
                return false;
              });

              if (tookanUser) {
                userType = 'merchant';
              }
            }
          } catch (customerError) {
            console.error('Error fetching customers:', customerError.message);
          }
        }

        // If user not found in Tookan, fall back to Supabase Auth (for admin users)
        if (!tookanUser && isSupabaseConfigured && supabaseAnon) {
          try {
            const { data, error } = await supabaseAnon.auth.signInWithPassword({
              email,
              password
            });

            if (!error && data && data.user) {
              // Get user profile from database
              let userProfile = null;
              if (supabase) {
                const { data: profileData } = await supabase
                  .from('users')
                  .select('*')
                  .eq('id', data.user.id)
                  .single();
                userProfile = profileData;
              }

              const userRole = userProfile?.role || 'admin';
              
              // Admin gets all permissions per SRS
              let userPermissions = userProfile?.permissions || {};
              if (userRole === 'admin') {
                userPermissions = {
                  edit_order_financials: true,
                  manage_wallets: true,
                  perform_reorder: true,
                  perform_return: true,
                  delete_ongoing_orders: true,
                  export_reports: true,
                  add_cod: true,
                  confirm_cod_payments: true,
                  manage_users: true
                };
              }

              return res.json({
                status: 'success',
                message: 'Login successful',
                data: {
                  user: {
                    id: data.user.id,
                    email: data.user.email,
                    name: userProfile?.name || data.user.email,
                    role: userRole,
                    permissions: userPermissions,
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
            console.log('Supabase auth failed:', supabaseError.message);
          }
        }

        // If user found in Tookan, verify password and create session
        if (tookanUser) {
          const userId = userType === 'driver'
            ? (tookanUser.fleet_id || tookanUser.agent_id || tookanUser.fleetId || tookanUser.agentId || tookanUser.id || '').toString()
            : (tookanUser.vendor_id || tookanUser.customer_id || tookanUser.vendorId || tookanUser.customerId || tookanUser.id || '').toString();

          const userName = userType === 'driver'
            ? (tookanUser.fleet_name || tookanUser.agent_name || tookanUser.fleetName || tookanUser.agentName || tookanUser.name || '')
            : (tookanUser.customer_name || tookanUser.vendor_name || tookanUser.customerName || tookanUser.vendorName || tookanUser.name || '');

          const userEmail = userType === 'driver'
            ? (tookanUser.fleet_email || tookanUser.agent_email || tookanUser.fleetEmail || tookanUser.agentEmail || tookanUser.email || email)
            : (tookanUser.customer_email || tookanUser.vendor_email || tookanUser.customerEmail || tookanUser.vendorEmail || tookanUser.email || email);

          // Verify password if stored in Supabase, otherwise allow first login
          let passwordValid = true;

          if (isSupabaseConfigured && supabase) {
            try {
              const { data: localUser } = await supabase
                .from('tookan_users')
                .select('*')
                .eq('tookan_id', userId)
                .eq('user_type', userType)
                .single();

              if (localUser && localUser.password_hash) {
                passwordValid = await bcrypt.compare(password, localUser.password_hash);
                if (!passwordValid) {
                  return res.status(401).json({
                    status: 'error',
                    message: 'Invalid password',
                    data: {}
                  });
                }
              } else {
                // First time login - store password hash
                try {
                  const passwordHash = await bcrypt.hash(password, 10);
                  await supabase.from('tookan_users').upsert({
                    tookan_id: userId,
                    email: userEmail,
                    name: userName,
                    user_type: userType,
                    password_hash: passwordHash,
                    role: userType === 'driver' ? 'driver' : 'merchant',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  }, { onConflict: 'tookan_id,user_type' });
                } catch (createError) {
                  console.log('Could not store password:', createError.message);
                }
              }
            } catch (dbError) {
              console.log('Database error:', dbError.message);
            }
          }

          // Get user permissions from database if available
          let userPermissions = {};
          let userRole = userType === 'driver' ? 'driver' : 'merchant';
          
          if (isSupabaseConfigured && supabase) {
            const { data: dbUser } = await supabase
              .from('tookan_users')
              .select('role, permissions')
              .eq('tookan_id', userId)
              .eq('user_type', userType)
              .single();
            
            if (dbUser) {
              userRole = dbUser.role || userRole;
              userPermissions = dbUser.permissions || {};
            }
          }

          // Staff default permissions per SRS: view reports, enter COD, add notes
          // Drivers/merchants have view-only access by default (can be modified by admin)
          if (Object.keys(userPermissions).length === 0 && userRole !== 'admin') {
            // Default permissions for staff (Tookan users)
            userPermissions = {
              export_reports: false,      // Staff can view but not export by default
              add_cod: false,             // Staff can enter COD only if granted
              confirm_cod_payments: false,
              edit_order_financials: false,
              manage_wallets: false,
              perform_reorder: false,
              perform_return: false,
              delete_ongoing_orders: false
            };
          }

          // Generate JWT-like session token with user data
          const tokenPayload = {
            sub: userId,
            email: userEmail,
            name: userName,
            role: userRole,
            permissions: userPermissions,
            user_type: userType,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
          };
          const sessionToken = 'eyJ' + Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
          const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

          return res.json({
            status: 'success',
            message: 'Login successful',
            data: {
              user: {
                id: userId,
                email: userEmail,
                name: userName,
                role: userRole,
                permissions: userPermissions,
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
        return res.status(401).json({
          status: 'error',
          message: 'Invalid email or password. User not found in Tookan system.',
          data: {}
        });

      } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Login failed',
          data: {}
        });
      }
    });

    // ============================================
    // USER MANAGEMENT ENDPOINTS
    // ============================================

    // GET all users (for admin panel)
    app.get('/api/users', async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({
            status: 'error',
            message: 'Database not configured',
            data: { users: [], total: 0 }
          });
        }

        const { role, search } = req.query;

        let query = supabase.from('users').select('*');

        if (role) {
          query = query.eq('role', role);
        }

        if (search) {
          query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
        }

        const { data: users, error } = await query.order('created_at', { ascending: false });

        if (error) {
          throw error;
        }

        // Also get tookan_users for a complete list
        const { data: tookanUsers } = await supabase
          .from('tookan_users')
          .select('*')
          .order('created_at', { ascending: false });

        // Combine and transform
        const allUsers = [
          ...(users || []).map(u => ({
            id: u.id,
            email: u.email,
            name: u.name || u.email,
            role: u.role || 'admin',
            permissions: u.permissions || {},
            status: 'Active',
            source: 'supabase',
            createdAt: u.created_at
          })),
          ...(tookanUsers || []).map(u => ({
            id: u.id,
            email: u.email,
            name: u.name || u.email,
            role: u.role || u.user_type,
            permissions: {},
            status: 'Active',
            source: 'tookan',
            tookanId: u.tookan_id,
            userType: u.user_type,
            createdAt: u.created_at
          }))
        ];

        res.json({
          status: 'success',
          message: 'Users fetched successfully',
          data: {
            users: allUsers,
            total: allUsers.length
          }
        });
      } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to fetch users',
          data: { users: [], total: 0 }
        });
      }
    });

    // ============================================
    // USER MANAGEMENT ENDPOINTS (Admin only per SRS)
    // ============================================

    // POST Create user - Admin only
    app.post('/api/users', authenticate, requirePermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { email, password, name, role, permissions } = req.body;

        if (!email || !password) {
          return res.status(400).json({ status: 'error', message: 'Email and password required' });
        }

        // Create user in Supabase Auth
        const { data: authData, error: authError } = await supabaseAnon.auth.signUp({
          email,
          password
        });

        if (authError) {
          return res.status(400).json({ status: 'error', message: authError.message });
        }

        // Create user profile
        const { data: userData, error: userError } = await supabase
          .from('users')
          .insert({
            id: authData.user.id,
            email,
            name: name || email,
            role: role || 'staff',
            permissions: permissions || {}
          })
          .select()
          .single();

        if (userError) {
          console.error('Error creating user profile:', userError);
        }

        // Log the action
        await supabase.from('audit_logs').insert({
          user_id: req.user.id,
          action: 'CREATE',
          entity_type: 'user',
          entity_id: authData.user.id,
          new_value: { email, name, role },
          notes: `User ${email} created by ${req.user.email}`
        });

        res.json({
          status: 'success',
          message: 'User created successfully',
          data: { user: userData || { id: authData.user.id, email, name, role } }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // PUT Update user permissions - Admin only
    app.put('/api/users/:userId/permissions', authenticate, requirePermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { userId } = req.params;
        const { permissions } = req.body;

        // Try updating in users table first
        const { data: userData, error: userError } = await supabase
          .from('users')
          .update({ permissions, updated_at: new Date().toISOString() })
          .eq('id', userId)
          .select()
          .single();

        if (userError && userError.code !== 'PGRST116') {
          // If not in users table, try tookan_users
          const { data: tookanData, error: tookanError } = await supabase
            .from('tookan_users')
            .update({ permissions, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .select()
            .single();

          if (tookanError) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
          }

          // Log the action
          await supabase.from('audit_logs').insert({
            user_id: req.user.id,
            action: 'UPDATE',
            entity_type: 'user_permissions',
            entity_id: userId,
            new_value: permissions,
            notes: `Permissions updated for user ${userId}`
          });

          return res.json({ status: 'success', data: { user: tookanData } });
        }

        // Log the action
        await supabase.from('audit_logs').insert({
          user_id: req.user.id,
          action: 'UPDATE',
          entity_type: 'user_permissions',
          entity_id: userId,
          new_value: permissions,
          notes: `Permissions updated for user ${userId}`
        });

        res.json({ status: 'success', data: { user: userData } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // PUT Update user role - Admin only
    app.put('/api/users/:userId/role', authenticate, requirePermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { userId } = req.params;
        const { role } = req.body;

        if (!['admin', 'staff', 'driver', 'merchant'].includes(role)) {
          return res.status(400).json({ status: 'error', message: 'Invalid role' });
        }

        // Try updating in users table first
        const { data: userData, error: userError } = await supabase
          .from('users')
          .update({ role, updated_at: new Date().toISOString() })
          .eq('id', userId)
          .select()
          .single();

        if (userError && userError.code !== 'PGRST116') {
          // If not in users table, try tookan_users
          const { data: tookanData, error: tookanError } = await supabase
            .from('tookan_users')
            .update({ role, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .select()
            .single();

          if (tookanError) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
          }

          return res.json({ status: 'success', data: { user: tookanData } });
        }

        res.json({ status: 'success', data: { user: userData } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // DELETE user - Admin only (SRS: enable/disable/ban users)
    app.delete('/api/users/:userId', authenticate, requirePermission(PERMISSIONS.MANAGE_USERS), async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { userId } = req.params;

        // Soft delete - mark as banned instead of deleting
        const { data: userData, error: userError } = await supabase
          .from('users')
          .update({ status: 'banned', updated_at: new Date().toISOString() })
          .eq('id', userId)
          .select()
          .single();

        if (userError && userError.code !== 'PGRST116') {
          // Try tookan_users
          const { error: tookanError } = await supabase
            .from('tookan_users')
            .delete()
            .eq('id', userId);

          if (tookanError) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
          }
        }

        // Log the action
        await supabase.from('audit_logs').insert({
          user_id: req.user.id,
          action: 'DELETE',
          entity_type: 'user',
          entity_id: userId,
          notes: `User ${userId} deleted/banned by ${req.user.email}`
        });

        res.json({ status: 'success', message: 'User deleted successfully' });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET current user info
    app.get('/api/auth/me', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({
            status: 'error',
            message: 'No authorization token provided',
            data: {}
          });
        }

        const token = authHeader.replace('Bearer ', '');
        
        // Try to decode the token (base64 for Tookan users)
        try {
          const decoded = Buffer.from(token, 'base64').toString('utf8');
          const [userId, timestamp, email] = decoded.split(':');
          
          if (userId && email) {
            // Look up user in tookan_users
            if (isSupabaseConfigured && supabase) {
              const { data: user } = await supabase
                .from('tookan_users')
                .select('*')
                .eq('tookan_id', userId)
                .single();

              if (user) {
                return res.json({
                  status: 'success',
                  data: {
                    user: {
                      id: user.tookan_id,
                      email: user.email,
                      name: user.name,
                      role: user.role || user.user_type,
                      permissions: {},
                      source: 'tookan'
                    }
                  }
                });
              }
            }

            // Return basic info from token
            return res.json({
              status: 'success',
              data: {
                user: {
                  id: userId,
                  email: email,
                  name: email,
                  role: 'user',
                  permissions: {},
                  source: 'token'
                }
              }
            });
          }
        } catch (decodeError) {
          // Not a base64 token, might be a Supabase JWT
        }

        // Try Supabase auth
        if (isSupabaseConfigured && supabaseAnon) {
          const { data: { user }, error } = await supabaseAnon.auth.getUser(token);
          if (!error && user) {
            const { data: profile } = await supabase
              .from('users')
              .select('*')
              .eq('id', user.id)
              .single();

            return res.json({
              status: 'success',
              data: {
                user: {
                  id: user.id,
                  email: user.email,
                  name: profile?.name || user.email,
                  role: profile?.role || 'admin',
                  permissions: profile?.permissions || {},
                  source: 'supabase'
                }
              }
            });
          }
        }

        res.status(401).json({
          status: 'error',
          message: 'Invalid or expired token',
          data: {}
        });
      } catch (error) {
        console.error('Auth me error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message,
          data: {}
        });
      }
    });

    // ============================================
    // REPORTS PANEL ENDPOINTS
    // ============================================

    // GET Reports Summary
    app.get('/api/reports/summary', async (req, res) => {
      try {
        const apiKey = getApiKey();
        const { dateFrom, dateTo } = req.query;

        // Fetch all data from Tookan
        const [fleetsRes, customersRes, tasksRes] = await Promise.all([
          fetch('https://api.tookanapp.com/v2/get_all_fleets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
          }),
          fetch('https://api.tookanapp.com/v2/get_all_customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
          }),
          fetch('https://api.tookanapp.com/v2/get_all_tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: apiKey,
              job_type: 1,
              job_status: '0,1,2,3,4,5,6,7,8,9',
              start_date: dateFrom || undefined,
              end_date: dateTo || undefined,
              limit: 1000,
              custom_fields: 1
            })
          })
        ]);

        const [fleetsData, customersData, tasksData] = await Promise.all([
          fleetsRes.json(),
          customersRes.json(),
          tasksRes.json()
        ]);

        const fleets = Array.isArray(fleetsData.data) ? fleetsData.data : [];
        const customers = Array.isArray(customersData.data) ? customersData.data : [];
        const tasks = Array.isArray(tasksData.data) ? tasksData.data : [];

        // Calculate summaries
        const completedTasks = tasks.filter(t => t.job_status === 2);
        const totalCOD = tasks.reduce((sum, t) => sum + (parseFloat(t.total_amount || t.order_payment || 0)), 0);

        // Driver summaries
        const driverSummaries = fleets.map(fleet => {
          const driverTasks = tasks.filter(t => t.fleet_id === fleet.fleet_id);
          const driverCompleted = driverTasks.filter(t => t.job_status === 2);
          const driverCOD = driverTasks.reduce((sum, t) => sum + (parseFloat(t.total_amount || t.order_payment || 0)), 0);
          return {
            id: fleet.fleet_id,
            name: fleet.name || fleet.username,
            phone: fleet.phone,
            totalOrders: driverTasks.length,
            completedOrders: driverCompleted.length,
            totalCOD: driverCOD,
            pendingCOD: driverCOD // Simplified - would need settlement data
          };
        });

        // Merchant summaries
        const merchantSummaries = customers.slice(0, 50).map(customer => {
          const merchantTasks = tasks.filter(t => 
            t.customer_id === customer.customer_id || 
            t.merchant_id === customer.vendor_id
          );
          const merchantCOD = merchantTasks.reduce((sum, t) => sum + (parseFloat(t.total_amount || t.order_payment || 0)), 0);
          return {
            id: customer.vendor_id || customer.customer_id,
            name: customer.customer_username || customer.Name,
            phone: customer.customer_phone,
            totalOrders: merchantTasks.length,
            totalCOD: merchantCOD
          };
        });

        res.json({
          status: 'success',
          message: 'Summary fetched successfully',
          data: {
            totals: {
              orders: tasks.length,
              drivers: fleets.length,
              merchants: customers.length,
              deliveries: completedTasks.length,
              totalCOD: totalCOD
            },
            driverSummaries,
            merchantSummaries
          }
        });
      } catch (error) {
        console.error('Reports summary error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message,
          data: { totals: {}, driverSummaries: [], merchantSummaries: [] }
        });
      }
    });

    // GET Daily Report
    app.get('/api/reports/daily', async (req, res) => {
      try {
        const apiKey = getApiKey();
        const today = new Date().toISOString().split('T')[0];

        const response = await fetch('https://api.tookanapp.com/v2/get_all_tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            job_type: 1,
            job_status: '0,1,2,3,4,5,6,7,8,9',
            start_date: today,
            end_date: today,
            limit: 500,
            custom_fields: 1
          })
        });

        const data = await response.json();
        const tasks = Array.isArray(data.data) ? data.data : [];

        res.json({
          status: 'success',
          message: 'Daily report fetched',
          data: {
            date: today,
            totalOrders: tasks.length,
            completed: tasks.filter(t => t.job_status === 2).length,
            pending: tasks.filter(t => t.job_status === 0 || t.job_status === 1).length,
            totalCOD: tasks.reduce((sum, t) => sum + (parseFloat(t.total_amount || 0)), 0),
            orders: tasks
          }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET Monthly Report
    app.get('/api/reports/monthly', async (req, res) => {
      try {
        const apiKey = getApiKey();
        const { month } = req.query;
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const startDate = `${targetMonth}-01`;
        const endDate = `${targetMonth}-31`;

        const response = await fetch('https://api.tookanapp.com/v2/get_all_tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            job_type: 1,
            job_status: '0,1,2,3,4,5,6,7,8,9',
            start_date: startDate,
            end_date: endDate,
            limit: 2000,
            custom_fields: 1
          })
        });

        const data = await response.json();
        const tasks = Array.isArray(data.data) ? data.data : [];

        res.json({
          status: 'success',
          message: 'Monthly report fetched',
          data: {
            month: targetMonth,
            totalOrders: tasks.length,
            completed: tasks.filter(t => t.job_status === 2).length,
            totalCOD: tasks.reduce((sum, t) => sum + (parseFloat(t.total_amount || 0)), 0),
            orders: tasks
          }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Export Orders Report
    // Export requires permission
    app.post('/api/reports/orders/export', authenticate, requirePermission(PERMISSIONS.EXPORT_REPORTS), async (req, res) => {
      try {
        const { dateFrom, dateTo, format } = req.body;
        const apiKey = getApiKey();

        const response = await fetch('https://api.tookanapp.com/v2/get_all_tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            job_type: 1,
            job_status: '0,1,2,3,4,5,6,7,8,9',
            start_date: dateFrom,
            end_date: dateTo,
            limit: 5000,
            custom_fields: 1
          })
        });

        const data = await response.json();
        const orders = Array.isArray(data.data) ? data.data : [];

        // Return data for client-side export
        res.json({
          status: 'success',
          message: 'Export data ready',
          data: { orders, format: format || 'csv' }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // COD / FINANCIAL PANEL ENDPOINTS
    // ============================================

    // GET COD Queue
    app.get('/api/cod/queue', async (req, res) => {
      try {
        const apiKey = getApiKey();

        // Get all fleets and their pending COD
        const fleetsRes = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey })
        });
        const fleetsData = await fleetsRes.json();
        const fleets = Array.isArray(fleetsData.data) ? fleetsData.data : [];

        // Get recent completed tasks with COD
        const tasksRes = await fetch('https://api.tookanapp.com/v2/get_all_tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            job_type: 1,
            job_status: '2', // Completed only
            limit: 500,
            custom_fields: 1
          })
        });
        const tasksData = await tasksRes.json();
        const tasks = Array.isArray(tasksData.data) ? tasksData.data : [];

        // Calculate COD per driver
        const codByDriver = {};
        tasks.forEach(task => {
          const fleetId = task.fleet_id;
          const cod = parseFloat(task.total_amount || task.order_payment || 0);
          if (fleetId && cod > 0) {
            if (!codByDriver[fleetId]) {
              codByDriver[fleetId] = { total: 0, orders: [] };
            }
            codByDriver[fleetId].total += cod;
            codByDriver[fleetId].orders.push({
              job_id: task.job_id,
              order_id: task.order_id,
              amount: cod,
              date: task.completed_datetime || task.creation_datetime
            });
          }
        });

        // Build queue with driver info
        const queue = fleets.map(fleet => ({
          driverId: fleet.fleet_id,
          driverName: fleet.name || fleet.username,
          phone: fleet.phone,
          totalCOD: codByDriver[fleet.fleet_id]?.total || 0,
          orderCount: codByDriver[fleet.fleet_id]?.orders?.length || 0,
          orders: codByDriver[fleet.fleet_id]?.orders || [],
          status: 'pending'
        })).filter(d => d.totalCOD > 0);

        res.json({
          status: 'success',
          data: {
            queue,
            totalPending: queue.reduce((sum, d) => sum + d.totalCOD, 0),
            driversWithPending: queue.length
          }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET COD Confirmations
    app.get('/api/cod/confirmations', async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.json({ status: 'success', data: { confirmations: [] } });
        }

        const { data: confirmations, error } = await supabase
          .from('audit_logs')
          .select('*')
          .eq('action', 'COD_SETTLED')
          .order('created_at', { ascending: false })
          .limit(100);

        res.json({
          status: 'success',
          data: { confirmations: confirmations || [] }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET COD Calendar
    app.get('/api/cod/calendar', async (req, res) => {
      try {
        const { dateFrom, dateTo } = req.query;
        
        if (!isSupabaseConfigured || !supabase) {
          return res.json({ status: 'success', data: [] });
        }

        const { data: entries, error } = await supabase
          .from('audit_logs')
          .select('*')
          .in('action', ['COD_SETTLED', 'COD_ADDED', 'COD_CONFIRMED'])
          .order('created_at', { ascending: false })
          .limit(200);

        res.json({
          status: 'success',
          data: entries || []
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Add COD to queue
    // Add COD requires permission
    app.post('/api/cod/queue/add', authenticate, requirePermission(PERMISSIONS.ADD_COD), async (req, res) => {
      try {
        const { driverId, amount, notes, orderId } = req.body;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        await supabase.from('audit_logs').insert({
          action: 'COD_ADDED',
          entity_type: 'cod',
          entity_id: driverId?.toString(),
          new_value: { driverId, amount, orderId },
          notes: notes || `COD ${amount} added for driver ${driverId}`
        });

        res.json({ status: 'success', message: 'COD added to queue' });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Settle COD
    // Settle COD requires permission
    app.post('/api/cod/queue/settle', authenticate, requirePermission(PERMISSIONS.CONFIRM_COD_PAYMENTS), async (req, res) => {
      try {
        const { driverId, amount, paymentMethod, notes } = req.body;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        await supabase.from('audit_logs').insert({
          action: 'COD_SETTLED',
          entity_type: 'cod',
          entity_id: driverId?.toString(),
          new_value: { driverId, amount, paymentMethod },
          notes: notes || `COD ${amount} settled via ${paymentMethod}`
        });

        res.json({ status: 'success', message: 'COD marked as settled' });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // PUT Settle specific COD entry
    // Confirm COD requires permission
    app.put('/api/cod/settle/:codId', authenticate, requirePermission(PERMISSIONS.CONFIRM_COD_PAYMENTS), async (req, res) => {
      try {
        const { codId } = req.params;
        const { paymentMethod, notes } = req.body;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        await supabase.from('audit_logs').insert({
          action: 'COD_CONFIRMED',
          entity_type: 'cod',
          entity_id: codId,
          new_value: { codId, paymentMethod, settledAt: new Date().toISOString() },
          notes: notes || `COD confirmed via ${paymentMethod}`
        });

        res.json({ status: 'success', message: 'COD confirmed' });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // ORDER EDITOR PANEL ENDPOINTS
    // ============================================

    // GET Single Order
    app.get('/api/tookan/order/:orderId', async (req, res) => {
      try {
        const { orderId } = req.params;
        const apiKey = getApiKey();

        const response = await fetch('https://api.tookanapp.com/v2/get_job_details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            job_id: orderId
          })
        });

        const data = await response.json();

        if (data.status === 200 && data.data) {
          res.json({
            status: 'success',
            data: { order: Array.isArray(data.data) ? data.data[0] : data.data }
          });
        } else {
          res.status(404).json({
            status: 'error',
            message: data.message || 'Order not found'
          });
        }
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // PUT Update Order
    // Edit order requires permission
    app.put('/api/tookan/order/:orderId', authenticate, requirePermission(PERMISSIONS.EDIT_ORDER_FINANCIALS), async (req, res) => {
      try {
        const { orderId } = req.params;
        const { total_amount, order_payment, fleet_id, custom_field, notes } = req.body;
        const apiKey = getApiKey();

        const updatePayload = {
          api_key: apiKey,
          job_id: orderId
        };

        if (total_amount !== undefined) updatePayload.total_amount = total_amount;
        if (order_payment !== undefined) updatePayload.order_payment = order_payment;
        if (fleet_id !== undefined) updatePayload.fleet_id = fleet_id;
        if (custom_field) updatePayload.custom_field = custom_field;

        const response = await fetch('https://api.tookanapp.com/v2/edit_task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload)
        });

        const data = await response.json();

        // Log the update
        if (isSupabaseConfigured && supabase) {
          await supabase.from('audit_logs').insert({
            action: 'ORDER_UPDATED',
            entity_type: 'order',
            entity_id: orderId,
            new_value: req.body,
            notes: notes || `Order ${orderId} updated`
          });
        }

        res.json({
          status: data.status === 200 ? 'success' : 'error',
          message: data.message || 'Order updated',
          data: data
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // DELETE Order
    // Delete order requires permission (SRS: only ongoing orders can be deleted)
    app.delete('/api/tookan/order/:orderId', authenticate, requirePermission(PERMISSIONS.DELETE_ONGOING_ORDERS), async (req, res) => {
      try {
        const { orderId } = req.params;
        const apiKey = getApiKey();

        const response = await fetch('https://api.tookanapp.com/v2/delete_task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            job_id: orderId
          })
        });

        const data = await response.json();

        // Log the deletion
        if (isSupabaseConfigured && supabase) {
          await supabase.from('audit_logs').insert({
            action: 'ORDER_DELETED',
            entity_type: 'order',
            entity_id: orderId,
            notes: `Order ${orderId} deleted`
          });
        }

        res.json({
          status: data.status === 200 ? 'success' : 'error',
          message: data.message || 'Order deleted'
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Reorder
    // Reorder requires permission
    app.post('/api/tookan/order/reorder', authenticate, requirePermission(PERMISSIONS.PERFORM_REORDER), async (req, res) => {
      try {
        const { originalOrderId, ...orderDetails } = req.body;
        const apiKey = getApiKey();

        // First get original order details
        const getResponse = await fetch('https://api.tookanapp.com/v2/get_job_details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, job_id: originalOrderId })
        });
        const originalData = await getResponse.json();

        if (originalData.status !== 200) {
          return res.status(404).json({ status: 'error', message: 'Original order not found' });
        }

        const original = Array.isArray(originalData.data) ? originalData.data[0] : originalData.data;

        // Create new task with same details
        const createPayload = {
          api_key: apiKey,
          order_id: `REORDER-${Date.now()}`,
          job_pickup_name: original.job_pickup_name,
          job_pickup_phone: original.job_pickup_phone,
          job_pickup_address: original.job_pickup_address,
          customer_username: original.customer_username,
          customer_phone: original.customer_phone,
          customer_address: original.customer_address,
          total_amount: orderDetails.total_amount || original.total_amount,
          ...orderDetails
        };

        const response = await fetch('https://api.tookanapp.com/v2/create_task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload)
        });

        const data = await response.json();

        // Log the reorder
        if (isSupabaseConfigured && supabase) {
          await supabase.from('audit_logs').insert({
            action: 'ORDER_REORDERED',
            entity_type: 'order',
            entity_id: originalOrderId,
            new_value: { newOrderId: data.data?.job_id },
            notes: `Reorder created from ${originalOrderId}`
          });
        }

        res.json({
          status: data.status === 200 ? 'success' : 'error',
          message: data.message || 'Reorder created',
          data: data
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Return Order
    // Return order requires permission
    app.post('/api/tookan/order/return', authenticate, requirePermission(PERMISSIONS.PERFORM_RETURN), async (req, res) => {
      try {
        const { originalOrderId } = req.body;
        const apiKey = getApiKey();

        // Get original order
        const getResponse = await fetch('https://api.tookanapp.com/v2/get_job_details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, job_id: originalOrderId })
        });
        const originalData = await getResponse.json();

        if (originalData.status !== 200) {
          return res.status(404).json({ status: 'error', message: 'Original order not found' });
        }

        const original = Array.isArray(originalData.data) ? originalData.data[0] : originalData.data;

        // Create return task (pickup/delivery reversed, no COD)
        const returnPayload = {
          api_key: apiKey,
          order_id: `RETURN-${Date.now()}`,
          job_pickup_name: original.customer_username,
          job_pickup_phone: original.customer_phone,
          job_pickup_address: original.customer_address,
          customer_username: original.job_pickup_name,
          customer_phone: original.job_pickup_phone,
          customer_address: original.job_pickup_address,
          total_amount: 0 // No COD for returns
        };

        const response = await fetch('https://api.tookanapp.com/v2/create_task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(returnPayload)
        });

        const data = await response.json();

        // Log the return
        if (isSupabaseConfigured && supabase) {
          await supabase.from('audit_logs').insert({
            action: 'ORDER_RETURNED',
            entity_type: 'order',
            entity_id: originalOrderId,
            new_value: { returnOrderId: data.data?.job_id },
            notes: `Return created from ${originalOrderId}`
          });
        }

        res.json({
          status: data.status === 200 ? 'success' : 'error',
          message: data.message || 'Return order created',
          data: data
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // WITHDRAWAL REQUESTS ENDPOINTS
    // ============================================

    // GET All Withdrawal Requests
    app.get('/api/withdrawal/requests', async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.json({ status: 'success', data: { requests: [] } });
        }

        const { status: filterStatus } = req.query;

        let query = supabase.from('withdrawal_requests').select('*');
        if (filterStatus) {
          query = query.eq('status', filterStatus);
        }
        query = query.order('requested_at', { ascending: false });

        const { data: requests, error } = await query;

        res.json({
          status: 'success',
          data: { requests: requests || [] }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Create Withdrawal Request
    app.post('/api/withdrawal/request', async (req, res) => {
      try {
        const { type, merchantId, driverId, amount, iban, phone, name } = req.body;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { data, error } = await supabase.from('withdrawal_requests').insert({
          request_type: type,
          merchant_id: merchantId,
          driver_id: driverId,
          amount: amount,
          status: 'pending'
        }).select().single();

        if (error) throw error;

        res.json({
          status: 'success',
          message: 'Withdrawal request created',
          data: { request: data }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // PUT Approve Withdrawal
    // Approve withdrawal requires wallet management permission
    app.put('/api/withdrawal/request/:id/approve', authenticate, requirePermission(PERMISSIONS.MANAGE_WALLETS), async (req, res) => {
      try {
        const { id } = req.params;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { data, error } = await supabase
          .from('withdrawal_requests')
          .update({
            status: 'approved',
            approved_at: new Date().toISOString()
          })
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;

        // Log approval
        await supabase.from('audit_logs').insert({
          action: 'WITHDRAWAL_APPROVED',
          entity_type: 'withdrawal',
          entity_id: id,
          notes: `Withdrawal request ${id} approved`
        });

        res.json({ status: 'success', data: { request: data } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // PUT Reject Withdrawal
    // Reject withdrawal requires wallet management permission
    app.put('/api/withdrawal/request/:id/reject', authenticate, requirePermission(PERMISSIONS.MANAGE_WALLETS), async (req, res) => {
      try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { data, error } = await supabase
          .from('withdrawal_requests')
          .update({
            status: 'rejected',
            rejected_at: new Date().toISOString(),
            rejection_reason: reason || 'No reason provided'
          })
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;

        // Log rejection
        await supabase.from('audit_logs').insert({
          action: 'WITHDRAWAL_REJECTED',
          entity_type: 'withdrawal',
          entity_id: id,
          notes: `Withdrawal request ${id} rejected: ${reason}`
        });

        res.json({ status: 'success', data: { request: data } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // MERCHANT PLANS ENDPOINTS
    // ============================================

    // GET All Merchant Plans
    app.get('/api/merchant-plans', async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.json({
            status: 'success',
            data: {
              plans: [
                { id: 'default', name: 'Standard Plan', price_per_order: 0.5, is_active: true },
                { id: 'premium', name: 'Premium Plan', price_per_order: 0.3, is_active: true }
              ]
            }
          });
        }

        const { data: plans, error } = await supabase
          .from('merchant_plans')
          .select('*')
          .order('created_at', { ascending: false });

        res.json({
          status: 'success',
          data: { plans: plans || [] }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Create Merchant Plan
    app.post('/api/merchant-plans', async (req, res) => {
      try {
        const { name, description, price_per_order, monthly_fee, features } = req.body;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { data, error } = await supabase.from('merchant_plans').insert({
          name,
          description,
          price_per_order: price_per_order || 0,
          monthly_fee: monthly_fee || 0,
          features: features || [],
          is_active: true
        }).select().single();

        if (error) throw error;

        res.json({ status: 'success', data: { plan: data } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Assign Merchant to Plan
    app.post('/api/merchant-plans/assign', async (req, res) => {
      try {
        const { merchantId, planId } = req.body;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { data, error } = await supabase
          .from('merchant_plan_assignments')
          .upsert({
            merchant_id: merchantId,
            plan_id: planId,
            assigned_at: new Date().toISOString()
          }, { onConflict: 'merchant_id' })
          .select()
          .single();

        if (error) throw error;

        // Log assignment
        await supabase.from('audit_logs').insert({
          action: 'MERCHANT_PLAN_ASSIGNED',
          entity_type: 'merchant',
          entity_id: merchantId,
          new_value: { planId },
          notes: `Merchant ${merchantId} assigned to plan ${planId}`
        });

        res.json({ status: 'success', data: { assignment: data } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // SYSTEM LOGS / AUDIT ENDPOINTS
    // ============================================

    // GET Audit Logs
    app.get('/api/audit-logs', async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.json({ status: 'success', data: { logs: [] } });
        }

        const { action, entityType, limit = 100 } = req.query;

        let query = supabase.from('audit_logs').select('*');
        
        if (action) query = query.eq('action', action);
        if (entityType) query = query.eq('entity_type', entityType);
        
        query = query.order('created_at', { ascending: false }).limit(parseInt(limit));

        const { data: logs, error } = await query;

        res.json({
          status: 'success',
          data: { logs: logs || [] }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET Audit Logs for specific entity
    app.get('/api/audit-logs/:entityType/:entityId', async (req, res) => {
      try {
        const { entityType, entityId } = req.params;

        if (!isSupabaseConfigured || !supabase) {
          return res.json({ status: 'success', data: { logs: [] } });
        }

        const { data: logs, error } = await supabase
          .from('audit_logs')
          .select('*')
          .eq('entity_type', entityType)
          .eq('entity_id', entityId)
          .order('created_at', { ascending: false });

        res.json({
          status: 'success',
          data: { logs: logs || [] }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // ADMIN SYNC ENDPOINTS (Limited in Serverless)
    // ============================================

    // GET Sync Status
    app.get('/api/admin/sync/status', async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.json({
            status: 'success',
            data: {
              syncStatus: { status: 'not_configured' },
              cachedOrderCount: 0,
              isCacheFresh: false,
              supabaseConfigured: false
            }
          });
        }

        // Get sync status
        const { data: syncStatus } = await supabase
          .from('sync_status')
          .select('*')
          .eq('sync_type', 'orders')
          .single();

        // Get cached order count
        const { count: cachedCount } = await supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true });

        // Check if cache is fresh (within 24 hours)
        let isFresh = false;
        if (syncStatus?.last_successful_sync) {
          const lastSync = new Date(syncStatus.last_successful_sync);
          const now = new Date();
          const hoursDiff = (now - lastSync) / (1000 * 60 * 60);
          isFresh = hoursDiff < 24;
        }

        res.json({
          status: 'success',
          data: {
            syncStatus: syncStatus || { status: 'never_synced' },
            cachedOrderCount: cachedCount || 0,
            isCacheFresh: isFresh,
            supabaseConfigured: true
          }
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to get sync status'
        });
      }
    });

    // POST Trigger Sync (Note: Full sync not supported in serverless due to timeout limits)
    app.post('/api/admin/sync/orders', authenticate, async (req, res) => {
      try {
        // Check admin role
        if (req.user?.role !== 'admin') {
          return res.status(403).json({
            status: 'error',
            message: 'Admin role required'
          });
        }

        if (!isSupabaseConfigured || !supabase) {
          return res.status(400).json({
            status: 'error',
            message: 'Supabase not configured. Cannot run sync without database.'
          });
        }

        // In serverless mode, we can only do a limited incremental sync
        // Full sync should be run via the local server or a scheduled job
        res.json({
          status: 'warning',
          message: 'Full sync is not available in serverless mode due to timeout limits. Please run sync from the local server using: node -e "require(\'./server/services/orderSyncService\').syncOrders().then(console.log)"',
          data: {
            suggestion: 'Run locally: cd server && node -e "require(\'./services/orderSyncService\').syncOrders().then(console.log)"'
          }
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to trigger sync'
        });
      }
    });

    // Catch-all for other API routes
    app.all('/api/*', (req, res) => {
      res.status(404).json({
        status: 'error',
        message: `API endpoint ${req.method} ${req.path} not found in serverless mode. For full functionality, run the server locally.`
      });
    });
  }
  
  return app;
}

// Export for Vercel
module.exports = (req, res) => {
  const expressApp = getApp();
  return expressApp(req, res);
};

