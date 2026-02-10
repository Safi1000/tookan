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
    // Note: merchantPlans legacy model removed in favor of plansModel
    const plansModel = require('../server/db/models/plans');

    // ===== INLINE USER MANAGEMENT HELPERS (avoid module import conflicts on Vercel) =====

    const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'ahmedhassan123.ah83@gmail.com';

    // Verify Buffer availability
    const { Buffer } = require('buffer');

    // Inline authenticate middleware
    const authenticate = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ status: 'error', message: 'Authentication required: No header', data: {} });
      }

      const token = authHeader.split(' ').length === 2 ? authHeader.split(' ')[1] : authHeader.split(' ')[0];
      if (!token || token === 'null' || token === 'undefined') {
        return res.status(401).json({ status: 'error', message: 'Authentication required: Invalid token format', data: {} });
      }

      if (!isSupabaseConfigured || !supabaseAnon) {
        req.user = { id: 'local-dev', email: 'local@dev', role: 'admin', permissions: {}, source: 'local' };
        req.userId = 'local-dev';
        return next();
      }

      let user = null;
      let debugErrors = [];

      // Method 1: Try Supabase JWT via getUser API
      try {
        const { data: { user: supaUser }, error } = await supabaseAnon.auth.getUser(token);
        if (!error && supaUser) {
          user = supaUser;
        } else if (error) {
          debugErrors.push(`Supabase getUser error: ${error.message}`);
        }
      } catch (e) {
        debugErrors.push(`Supabase getUser exception: ${e.message}`);
      }

      // Method 2: Try direct JWT payload decoding (works for any standard JWT)
      if (!user) {
        try {
          // Check if it looks like a JWT (x.y.z)
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = parts[1];
            // Fix base64 padding if needed
            const padded = payload.padEnd(payload.length + (4 - payload.length % 4) % 4, '=');
            const tokenData = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));

            user = {
              id: tokenData.sub || tokenData.user_id || tokenData.id,
              email: tokenData.email,
              role: tokenData.role || tokenData.app_metadata?.role || 'user',
              permissions: tokenData.permissions || {}
            };
          } else {
            debugErrors.push('Token does not look like a JWT (not 3 parts)');
          }
        } catch (e) {
          debugErrors.push(`JWT decode exception: ${e.message}`);
        }
      }

      // Method 3: Try Tookan session token (base64 encoded userId:timestamp:email)
      if (!user) {
        try {
          const decoded = Buffer.from(token, 'base64').toString('utf-8');
          const parts = decoded.split(':');
          if (parts.length >= 3) {
            const userId = parts[0];
            const timestamp = parseInt(parts[1]);
            const email = parts.slice(2).join(':');
            if (Date.now() < timestamp + (24 * 60 * 60 * 1000)) {
              user = { id: userId, email, source: 'tookan' };
            } else {
              debugErrors.push('Tookan token expired');
            }
          }
        } catch (e) {
          debugErrors.push(`Tookan decode exception: ${e.message}`);
        }
      }

      if (!user) {
        console.error('Authentication failed:', debugErrors);
        return res.status(401).json({
          status: 'error',
          message: 'Invalid or expired token',
          data: {},
          debug_info: process.env.NODE_ENV === 'development' ? debugErrors : undefined
        });
      }

      // Get full profile from DB for non-tookan users
      if (user.source !== 'tookan' && isSupabaseConfigured && supabase) {
        try {
          const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
          if (profile) {
            req.user = { ...user, role: profile.role, permissions: profile.permissions || {} };
          } else {
            req.user = user;
          }
        } catch (e) {
          req.user = user;
        }
      } else {
        req.user = { ...user, role: user.role || 'user', permissions: user.permissions || {} };
      }

      req.userId = user.id;
      next();
    };

    // Inline requireSuperadmin middleware
    const requireSuperadmin = () => {
      return async (req, res, next) => {
        if (!req.user || !req.userId) {
          return res.status(401).json({ status: 'error', message: 'Authentication required', data: {} });
        }
        if (req.user.email !== SUPERADMIN_EMAIL) {
          return res.status(403).json({ status: 'error', message: 'Access denied. Only the superadmin can perform this action.', data: {} });
        }
        next();
      };
    };

    // Inline userModel helpers
    const userModel = {
      getUserById: async (id) => {
        if (!isSupabaseConfigured || !supabase) throw new Error('DB not configured');
        const { data, error } = await supabase.from('users').select('*').eq('id', id).single();
        if (error && error.code !== 'PGRST116') throw error;
        return data || null;
      },
      getAllUsers: async (filters = {}) => {
        if (!isSupabaseConfigured || !supabase) throw new Error('DB not configured');
        let query = supabase.from('users').select('*');
        if (filters.role) query = query.eq('role', filters.role);
        if (filters.search) {
          const s = `%${filters.search}%`;
          query = query.or(`email.ilike.${s},name.ilike.${s}`);
        }
        query = query.order('created_at', { ascending: false });
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      },
      updateUser: async (id, userData) => {
        if (!isSupabaseConfigured || !supabase) throw new Error('DB not configured');
        const updateData = { updated_at: new Date().toISOString() };
        if (userData.name !== undefined) updateData.name = userData.name;
        if (userData.email !== undefined) updateData.email = userData.email;
        if (userData.role !== undefined) updateData.role = userData.role;
        if (userData.permissions !== undefined) updateData.permissions = userData.permissions;
        const { data, error } = await supabase.from('users').update(updateData).eq('id', id).select().single();
        if (error) throw error;
        return data;
      },
      updateUserPermissions: async (id, permissions) => {
        if (!isSupabaseConfigured || !supabase) throw new Error('DB not configured');
        const { data, error } = await supabase.from('users').update({ permissions: permissions || {}, updated_at: new Date().toISOString() }).eq('id', id).select().single();
        if (error) throw error;
        return data;
      },
      updateUserRole: async (id, role) => {
        if (!isSupabaseConfigured || !supabase) throw new Error('DB not configured');
        const { data, error } = await supabase.from('users').update({ role, updated_at: new Date().toISOString() }).eq('id', id).select().single();
        if (error) throw error;
        return data;
      },
      updateUserStatus: async (id, status) => {
        if (!isSupabaseConfigured || !supabase) throw new Error('DB not configured');
        const validStatuses = ['active', 'disabled', 'banned'];
        if (!validStatuses.includes(status.toLowerCase())) throw new Error(`Invalid status`);
        const { data, error } = await supabase.from('users').update({ status: status.toLowerCase(), updated_at: new Date().toISOString() }).eq('id', id).select().single();
        if (error) throw error;
        return data;
      }
    };

    // Inline auditLogger (non-blocking)
    const auditLogger = {
      createAuditLog: async (req, action, entityType, entityId, oldValue = null, newValue = null) => {
        if (!isSupabaseConfigured || !supabase) return null;
        try {
          const logData = {
            user_id: req.userId || req.user?.id || null,
            action, entity_type: entityType,
            entity_id: entityId ? String(entityId) : null,
            old_value: oldValue ? (typeof oldValue === 'object' ? oldValue : { value: oldValue }) : null,
            new_value: newValue ? (typeof newValue === 'object' ? newValue : { value: newValue }) : null,
            ip_address: req.ip || req.headers['x-forwarded-for']?.split(',')[0] || null,
            user_agent: req.headers['user-agent'] || null
          };
          await supabase.from('audit_logs').insert(logData);
        } catch (e) {
          console.error('Audit log error:', e);
        }
        return null;
      }
    };

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

    const normalizeName = (name) => {
      if (!name) return '';
      return name.toString().trim().replace(/\s+/g, ' ').toLowerCase();
    };

    const transformFleetToAgent = (fleet) => {
      const originalName = fleet.fleet_name || fleet.name || fleet.username || 'Unknown Agent';
      return {
        fleet_id: parseInt(fleet.fleet_id || fleet.id),
        name: originalName,
        normalized_name: normalizeName(originalName),
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
      };
    };

    const fetchFleetsFromTookan = async () => {
      const apiKey = getApiKey();
      const response = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey })
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('Failed to parse Tookan fleets response');
      }
      if (!response.ok || (data.status !== 200 && data.status !== 1)) {
        throw new Error(data.message || 'Failed to fetch fleets');
      }
      return data.data || [];
    };

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
      MANAGE_USERS: 'manage_users' // Superadmin only
    };




    // Permission check middleware
    const requirePermission = (...requiredPermissions) => {
      return (req, res, next) => {
        if (!req.user) {
          return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }

        // Bypass permissions for whitelisted test email (if configured)
        const bypassEmail = process.env.TEST_EMAIL;
        if (bypassEmail && req.user.email === bypassEmail) {
          return next();
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

    // Merchant Plans APIs
    app.get('/api/merchant-plans', authenticate, async (req, res) => {
      try {
        const plans = await plansModel.getAllPlans();
        res.json({
          status: 'success',
          data: { plans }
        });
      } catch (error) {
        console.error('Get plans error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to get plans'
        });
      }
    });

    app.post('/api/merchant-plans', authenticate, async (req, res) => {
      try {
        const plan = await plansModel.createPlan(req.body);
        res.json({
          status: 'success',
          data: { plan }
        });
      } catch (error) {
        console.error('Create plan error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to create plan'
        });
      }
    });

    app.put('/api/merchant-plans/:id', authenticate, async (req, res) => {
      try {
        const plan = await plansModel.updatePlan(req.params.id, req.body);
        res.json({
          status: 'success',
          data: { plan }
        });
      } catch (error) {
        console.error('Update plan error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to update plan'
        });
      }
    });

    app.delete('/api/merchant-plans/:id', authenticate, async (req, res) => {
      try {
        const success = await plansModel.deletePlan(req.params.id);
        if (!success) {
          return res.status(404).json({
            status: 'error',
            message: 'Plan not found or failed to delete'
          });
        }
        res.json({
          status: 'success',
          message: 'Plan deleted successfully'
        });
      } catch (error) {
        console.error('Delete plan error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to delete plan'
        });
      }
    });

    // GET Customers from Supabase (for Merchant Linking)
    app.get('/api/tookan/customers', authenticate, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({
            status: 'error',
            message: 'Supabase not configured',
            data: { customers: [] }
          });
        }

        const { data: customers, error } = await supabase
          .from('customers')
          .select('vendor_id, customer_name, customer_phone, plan_id')
          .order('customer_name', { ascending: true });

        if (error) {
          console.error('Fetch customers error:', error);
          return res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to fetch customers',
            data: { customers: [] }
          });
        }

        res.json({
          status: 'success',
          message: 'Customers fetched successfully',
          data: { customers: customers || [] }
        });
      } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to get customers',
          data: { customers: [] }
        });
      }
    });

    // Get customer counts per plan
    app.get('/api/plans/customer-counts', authenticate, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.json({
            status: 'success',
            data: { counts: {}, totalAssigned: 0 }
          });
        }

        const { data: customers, error } = await supabase
          .from('customers')
          .select('plan_id')
          .not('plan_id', 'is', null);

        if (error) {
          console.error('Get customer counts error:', error);
          return res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get customer counts'
          });
        }

        const counts = {};
        (customers || []).forEach(c => {
          if (c.plan_id) {
            counts[c.plan_id] = (counts[c.plan_id] || 0) + 1;
          }
        });

        res.json({
          status: 'success',
          data: {
            counts,
            totalAssigned: customers?.length || 0
          }
        });
      } catch (error) {
        console.error('Get customer counts error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to get customer counts'
        });
      }
    });

    // Get assigned customers with plan details
    app.get('/api/customers/assigned', authenticate, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.json({
            status: 'success',
            data: { customers: [] }
          });
        }

        const { data: customers, error } = await supabase
          .from('customers')
          .select('vendor_id, customer_name, customer_phone, plan_id')
          .not('plan_id', 'is', null);

        if (error) {
          console.error('Get assigned customers error:', error);
          return res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get assigned customers'
          });
        }

        const { data: plansData } = await supabase
          .from('plans')
          .select('id, name');

        const plansMap = (plansData || []).reduce((acc, p) => {
          acc[p.id] = p.name;
          return acc;
        }, {});

        const result = (customers || []).map(c => ({
          vendorId: c.vendor_id,
          name: c.customer_name || 'Unknown',
          phone: c.customer_phone || '',
          planId: c.plan_id,
          planName: plansMap[c.plan_id] || 'Unknown Plan'
        }));

        res.json({
          status: 'success',
          data: { customers: result }
        });
      } catch (error) {
        console.error('Get assigned customers error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to get assigned customers'
        });
      }
    });

    // GET customers with plans including plan details (for Reports Panel)
    app.get('/api/customers/with-plans', authenticate, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { data: customers, error } = await supabase
          .from('customers')
          .select('vendor_id, customer_name, customer_phone, plan_id')
          .not('plan_id', 'is', null);

        if (error) {
          return res.status(500).json({ status: 'error', message: error.message });
        }

        if (!customers || customers.length === 0) {
          return res.json({ status: 'success', data: [] });
        }

        const planIds = [...new Set(customers.map(c => c.plan_id).filter(Boolean))];
        const { data: plans } = await supabase
          .from('plans')
          .select('id, name, description, type, amount')
          .in('id', planIds);

        const plansMap = (plans || []).reduce((acc, p) => {
          acc[p.id] = { name: p.name, description: p.description, type: p.type, amount: p.amount };
          return acc;
        }, {});

        const result = customers.map(c => ({
          vendor_id: c.vendor_id,
          customer_name: c.customer_name,
          customer_phone: c.customer_phone,
          plan_id: c.plan_id,
          plan: plansMap[c.plan_id] || null
        }));

        res.json({ status: 'success', data: result });
      } catch (error) {
        console.error('Get customers with plans error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
      }
    });

    // API Key validation middleware for external APIs
    const validateApiKey = (req, res, next) => {
      const apiKey = req.headers['x-api-key'];
      const validApiKey = process.env.EXTERNAL_API_KEY;

      if (!apiKey) {
        return res.status(401).json({
          status: 'error',
          message: 'Missing API key. Provide x-api-key header.'
        });
      }

      if (!validApiKey || apiKey !== validApiKey) {
        return res.status(401).json({
          status: 'error',
          message: 'Invalid API key'
        });
      }

      next();
    };

    // GET all customers with plans (external API with API key auth)
    app.get('/api/get_all_customers_with_plans', validateApiKey, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({
            status: 'error',
            message: 'Database not configured'
          });
        }

        const { start_date, end_date } = req.query;

        // Build query for customers with plan_id NOT NULL
        let query = supabase
          .from('customers')
          .select('vendor_id, customer_name, customer_phone, plan_id, created_at')
          .not('plan_id', 'is', null);

        // Apply date range filter if provided
        if (start_date) {
          query = query.gte('created_at', start_date);
        }
        if (end_date) {
          query = query.lte('created_at', end_date);
        }

        const { data: customers, error: customersError } = await query;

        if (customersError) {
          console.error('Get customers with plans error:', customersError);
          return res.status(500).json({
            status: 'error',
            message: customersError.message || 'Failed to fetch customers'
          });
        }

        if (!customers || customers.length === 0) {
          return res.json({
            status: 'success',
            count: 0,
            data: []
          });
        }

        // Get unique plan IDs
        const planIds = [...new Set(customers.map(c => c.plan_id).filter(Boolean))];

        // Fetch plan details
        const { data: plans, error: plansError } = await supabase
          .from('plans')
          .select('id, name, description, type, amount')
          .in('id', planIds);

        if (plansError) {
          console.error('Get plans error:', plansError);
          return res.status(500).json({
            status: 'error',
            message: plansError.message || 'Failed to fetch plan details'
          });
        }

        // Create plans lookup map
        const plansMap = (plans || []).reduce((acc, plan) => {
          acc[plan.id] = {
            name: plan.name,
            description: plan.description,
            type: plan.type,
            amount: plan.amount
          };
          return acc;
        }, {});

        // Build response with nested plan details
        const result = customers.map(customer => ({
          vendor_id: customer.vendor_id,
          customer_name: customer.customer_name,
          customer_phone: customer.customer_phone,
          plan_id: customer.plan_id,
          plan: plansMap[customer.plan_id] || null
        }));

        res.json({
          status: 'success',
          count: result.length,
          data: result
        });

      } catch (error) {
        console.error('Get all customers with plans error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Internal server error'
        });
      }
    });

    // GET single customer plan by vendor_id (external API with API key auth)
    app.get('/api/get_customer_plan/:vendor_id', validateApiKey, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { vendor_id } = req.params;

        if (!vendor_id) {
          return res.status(400).json({ status: 'error', message: 'vendor_id is required' });
        }

        const { data: customer, error } = await supabase
          .from('customers')
          .select('vendor_id, customer_name, customer_phone, plan_id')
          .eq('vendor_id', parseInt(vendor_id))
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
          }
          return res.status(500).json({ status: 'error', message: error.message });
        }

        if (!customer.plan_id) {
          return res.json({
            status: 'success',
            data: {
              vendor_id: customer.vendor_id,
              customer_name: customer.customer_name,
              customer_phone: customer.customer_phone,
              plan_id: null,
              plan: null
            }
          });
        }

        const { data: plan } = await supabase
          .from('plans')
          .select('id, name, description, type, amount')
          .eq('id', customer.plan_id)
          .single();

        res.json({
          status: 'success',
          data: {
            vendor_id: customer.vendor_id,
            customer_name: customer.customer_name,
            customer_phone: customer.customer_phone,
            plan_id: customer.plan_id,
            plan: plan ? { name: plan.name, description: plan.description, type: plan.type, amount: plan.amount } : null
          }
        });

      } catch (error) {
        console.error('Get customer plan error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
      }
    });

    // GET all customers with withdraw fees (external API with API key auth)
    app.get('/api/get_all_customers_with_withdraw_fees', validateApiKey, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { data: customers, error } = await supabase
          .from('customers')
          .select('vendor_id, customer_name, customer_phone, withdraw_fees')
          .not('withdraw_fees', 'is', null)
          .order('customer_name', { ascending: true });

        if (error) {
          return res.status(500).json({ status: 'error', message: error.message || 'Failed to fetch customers' });
        }

        const result = (customers || []).map(c => ({
          vendor_id: c.vendor_id,
          customer_name: c.customer_name,
          customer_phone: c.customer_phone,
          withdraw_fees: c.withdraw_fees
        }));

        res.json({ status: 'success', count: result.length, data: result });
      } catch (error) {
        console.error('Get all customers with withdraw fees error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
      }
    });

    // GET single customer withdraw fees by vendor_id (external API with API key auth)
    app.get('/api/get_customer_withdraw_fees/:vendor_id', validateApiKey, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { vendor_id } = req.params;

        if (!vendor_id) {
          return res.status(400).json({ status: 'error', message: 'vendor_id is required' });
        }

        const { data: customer, error } = await supabase
          .from('customers')
          .select('vendor_id, customer_name, customer_phone, withdraw_fees')
          .eq('vendor_id', parseInt(vendor_id))
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            return res.status(404).json({ status: 'error', message: 'Customer not found' });
          }
          return res.status(500).json({ status: 'error', message: error.message });
        }

        res.json({
          status: 'success',
          data: {
            vendor_id: customer.vendor_id,
            customer_name: customer.customer_name,
            customer_phone: customer.customer_phone,
            withdraw_fees: customer.withdraw_fees
          }
        });

      } catch (error) {
        console.error('Get customer withdraw fees error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
      }
    });

    // ========== WITHDRAWAL REQUEST RECEIVER API ==========

    const validateIban = (iban) => {
      if (!iban || typeof iban !== 'string') return false;
      const cleanIban = iban.replace(/\s/g, '').toUpperCase();
      return /^[A-Z0-9]{15,34}$/.test(cleanIban);
    };

    const validatePartnerApiKey = (req, res, next) => {
      const authHeader = req.headers['authorization'];
      const validApiKey = process.env.EXTERNAL_API_KEY;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error('[WITHDRAWAL] Unauthorized: Missing or invalid Authorization header');
        return res.status(401).send();
      }

      const token = authHeader.substring(7);

      if (!validApiKey || token !== validApiKey) {
        console.error('[WITHDRAWAL] Unauthorized: Invalid API key');
        return res.status(401).send();
      }

      next();
    };

    app.post('/api/withdrawal/request', validatePartnerApiKey, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          console.error('[WITHDRAWAL] Database not configured');
          return res.status(500).send();
        }

        const { id, email, type, requested_amount, tax_applied, final_amount, iban_number } = req.body;

        // Validation: Required fields
        const missingFields = [];
        if (id === undefined || id === null) missingFields.push('id');
        if (!email) missingFields.push('email');
        if (type === undefined || type === null) missingFields.push('type');
        if (requested_amount === undefined || requested_amount === null) missingFields.push('requested_amount');
        if (final_amount === undefined || final_amount === null) missingFields.push('final_amount');
        if (!iban_number) missingFields.push('iban_number');

        if (missingFields.length > 0) {
          console.error(`[WITHDRAWAL] Validation failed: Missing fields: ${missingFields.join(', ')}`, { body: req.body });
          return res.status(400).send();
        }

        const typeNum = Number(type);
        if (typeNum !== 1 && typeNum !== 2) {
          console.error(`[WITHDRAWAL] Validation failed: Invalid type ${type}`, { body: req.body });
          return res.status(400).send();
        }

        const reqAmount = Number(requested_amount);
        if (isNaN(reqAmount) || reqAmount <= 0) {
          console.error(`[WITHDRAWAL] Validation failed: requested_amount must be > 0`, { body: req.body });
          return res.status(400).send();
        }

        const finAmount = Number(final_amount);
        if (isNaN(finAmount) || finAmount < 0) {
          console.error(`[WITHDRAWAL] Validation failed: final_amount must be >= 0`, { body: req.body });
          return res.status(400).send();
        }

        if (!validateIban(iban_number)) {
          console.error(`[WITHDRAWAL] Validation failed: Invalid IBAN`, { body: req.body });
          return res.status(400).send();
        }

        const fleetId = typeNum === 1 ? Number(id) : null;
        const vendorId = typeNum === 2 ? Number(id) : null;

        const withdrawalRecord = {
          fleet_id: fleetId,
          vendor_id: vendorId,
          email: email.trim(),
          requested_amount: reqAmount,
          tax_applied: Number(tax_applied) || 0,
          final_amount: finAmount,
          iban: iban_number.replace(/\s/g, '').toUpperCase(),
          status: 'pending'
        };

        const { data, error } = await supabase
          .from('withdrawals')
          .insert(withdrawalRecord)
          .select('id')
          .single();

        if (error) {
          console.error('[WITHDRAWAL] Database insert error:', error);
          return res.status(500).send();
        }

        console.log(`[WITHDRAWAL] Success: Created withdrawal ${data.id} for ${typeNum === 1 ? 'fleet' : 'vendor'} ${id}`);
        return res.status(200).send();

      } catch (error) {
        console.error('[WITHDRAWAL] Unexpected error:', error);
        return res.status(500).send();
      }
    });

    // ========== WITHDRAWAL FEES ENDPOINTS ==========
    let globalWithdrawalFee = null;

    app.get('/api/withdrawal-fees/current', authenticate, async (req, res) => {
      try {
        res.json({ status: 'success', data: { fee: globalWithdrawalFee } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to get current fee' });
      }
    });

    app.post('/api/withdrawal-fees/set', authenticate, async (req, res) => {
      try {
        const { fee } = req.body;
        if (typeof fee !== 'number' || fee < 0) {
          return res.status(400).json({ status: 'error', message: 'Invalid fee amount' });
        }
        globalWithdrawalFee = fee;
        if (isSupabaseConfigured && supabase) {
          await supabase.from('customers').update({ withdraw_fees: fee }).not('withdraw_fees', 'is', null);
        }
        res.json({ status: 'success', message: 'Withdrawal fee updated', data: { fee } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to set fee' });
      }
    });

    app.get('/api/withdrawal-fees/customers', authenticate, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.json({ status: 'success', data: { customers: [] } });
        }
        const { data: customers, error } = await supabase
          .from('customers')
          .select('vendor_id, customer_name, customer_phone, withdraw_fees')
          .not('withdraw_fees', 'is', null);
        if (error) return res.status(500).json({ status: 'error', message: error.message });
        const result = (customers || []).map(c => ({
          vendorId: c.vendor_id, name: c.customer_name || 'Unknown', phone: c.customer_phone || '', withdrawFees: c.withdraw_fees
        }));
        res.json({ status: 'success', data: { customers: result } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to get linked customers' });
      }
    });

    app.post('/api/withdrawal-fees/link', authenticate, async (req, res) => {
      try {
        const { vendor_id, fee } = req.body;
        if (!vendor_id) return res.status(400).json({ status: 'error', message: 'Vendor ID is required' });
        if (!isSupabaseConfigured || !supabase) return res.status(500).json({ status: 'error', message: 'Database not configured' });
        const { data: existing } = await supabase.from('customers').select('vendor_id').eq('vendor_id', vendor_id.toString()).single();
        if (!existing) return res.status(404).json({ status: 'error', message: 'Customer not found' });
        const { error } = await supabase.from('customers').update({ withdraw_fees: fee }).eq('vendor_id', vendor_id.toString());
        if (error) return res.status(500).json({ status: 'error', message: error.message });
        res.json({ status: 'success', message: 'Customer linked to withdrawal fee' });
      } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to link customer' });
      }
    });

    app.post('/api/withdrawal-fees/unlink', authenticate, async (req, res) => {
      try {
        const { vendor_id } = req.body;
        if (!vendor_id) return res.status(400).json({ status: 'error', message: 'Vendor ID is required' });
        if (!isSupabaseConfigured || !supabase) return res.status(500).json({ status: 'error', message: 'Database not configured' });
        const { error } = await supabase.from('customers').update({ withdraw_fees: null }).eq('vendor_id', vendor_id.toString());
        if (error) return res.status(500).json({ status: 'error', message: error.message });
        res.json({ status: 'success', message: 'Customer unlinked from withdrawal fee' });
      } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to unlink customer' });
      }
    });

    // Search Customer by Vendor ID (exact match)
    app.get('/api/customers/search', authenticate, async (req, res) => {
      try {
        const { vendor_id } = req.query;

        if (!vendor_id) {
          return res.json({
            status: 'success',
            data: { customer: null }
          });
        }

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({
            status: 'error',
            message: 'Supabase not configured'
          });
        }

        const { data: customer, error } = await supabase
          .from('customers')
          .select('vendor_id, customer_name, customer_phone, plan_id')
          .eq('vendor_id', vendor_id.trim())
          .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
          console.error('Search customer error:', error);
          return res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to search customer'
          });
        }

        res.json({
          status: 'success',
          data: { customer: customer || null }
        });
      } catch (error) {
        console.error('Search customer error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to search customer'
        });
      }
    });

    // Link Customer to Plan (update plan_id)
    app.put('/api/customers/:vendor_id/plan', authenticate, async (req, res) => {
      try {
        const { vendor_id } = req.params;
        const { plan_id } = req.body;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({
            status: 'error',
            message: 'Supabase not configured'
          });
        }

        const { data: customer, error } = await supabase
          .from('customers')
          .update({ plan_id: plan_id || null })
          .eq('vendor_id', vendor_id)
          .select()
          .single();

        if (error) {
          console.error('Link customer to plan error:', error);
          return res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to link customer to plan'
          });
        }

        res.json({
          status: 'success',
          message: 'Customer linked to plan successfully',
          data: { customer }
        });
      } catch (error) {
        console.error('Link customer to plan error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to link customer to plan'
        });
      }
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

    // Tookan customer webhook
    app.post('/api/webhooks/tookan/customer', async (req, res) => {
      try {
        console.log('\n=== CUSTOMER WEBHOOK RECEIVED (VERCEL) ===');
        console.log('Body:', JSON.stringify(req.body, null, 2));

        const payload = req.body || {};

        // Tookan sends the shared secret in the body as tookan_shared_secret
        const expected = getWebhookSecret();
        const bodySecret = payload.tookan_shared_secret || null;
        if (expected && bodySecret !== expected) {
          console.log('❌ Webhook secret mismatch. Expected:', expected, 'Got:', bodySecret);
          return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // Tookan uses customer_id, we map it to vendor_id in our database
        const customerId = payload.customer_id || payload.vendor_id || payload.id || payload.user_id;

        console.log('Extracted customer ID:', customerId);

        if (!customerId) {
          console.log('❌ No customer ID found in payload');
          return res.status(400).json({ status: 'error', message: 'vendor_id is required' });
        }

        if (!isSupabaseConfigured || !supabase) {
          console.log('❌ Supabase not configured');
          return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
        }

        const record = {
          vendor_id: parseInt(customerId),
          customer_name: payload.customer_name || payload.name || payload.first_name || '',
          customer_phone: payload.customer_phone || payload.phone || '',
          customer_address: payload.customer_address || payload.address || '',
          customer_email: payload.customer_email || payload.email || ''
        };

        console.log('Upserting record:', JSON.stringify(record, null, 2));

        const { error } = await supabase
          .from('customers')
          .upsert(record, { onConflict: 'vendor_id' });

        if (error) {
          console.error('Supabase upsert error:', error);
          throw error;
        }

        console.log(`✅ Customer ${customerId} synced via webhook (Vercel)`);
        res.json({ status: 'success', message: 'Customer synced', customer_id: customerId });
      } catch (error) {
        console.error('Customer webhook error (Vercel):', error);
        res.status(500).json({ status: 'error', message: error.message });
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

        // Check if agent is deleted
        const isDeleted = payload.is_deleted === 1 || payload.is_deleted === '1' || payload.is_deleted === true;

        if (isDeleted) {
          // Remove agent from Supabase if deleted
          console.log('Webhook: Agent deleted in Tookan, removing from DB:', fleetId);
          const { error: deleteError } = await supabase
            .from('agents')
            .delete()
            .eq('fleet_id', fleetId);

          if (deleteError) {
            console.error('Supabase agent delete error:', deleteError.message);
          }
          return res.status(200).json({ status: 'success', message: 'Agent deleted from DB' });
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

    // GET Agents from database (serverless) - UPDATED TO PROXY TOOKAN API
    app.get('/api/agents', authenticate, async (req, res) => {
      try {
        const apiKey = getApiKey();
        if (!apiKey) {
          return res.status(500).json({ status: 'error', message: 'Tookan API Key not configured' });
        }

        const response = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey
          })
        });

        const result = await response.json();

        if (result.status !== 200) {
          return res.status(result.status === 401 ? 401 : 500).json({
            status: 'error',
            message: result.message || 'Tookan API Error',
            data: { agents: [], total: 0 }
          });
        }

        const fleets = result.data || [];

        // Apply basic filtering if requested (isActive, teamId, search)
        let filteredFleets = fleets;
        const { isActive, teamId, search } = req.query;

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
          data: { agents: filteredFleets, total: filteredFleets.length }
        });
      } catch (error) {
        console.error('Get agents error:', error);
        return res.status(500).json({ status: 'error', message: error.message || 'Internal error', data: { agents: [], total: 0 } });
      }
    });

    // POST Sync agents from Tookan (serverless)
    app.post('/api/agents/sync', async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
        }

        const fleets = await fetchFleetsFromTookan();
        if (!fleets.length) {
          return res.json({ status: 'success', message: 'No fleets to sync', data: { synced: 0, errors: 0 } });
        }

        const now = new Date().toISOString();
        const records = fleets.map(f => {
          const a = transformFleetToAgent(f);
          return { ...a, last_synced_at: now, updated_at: now };
        });

        const CHUNK_SIZE = 50;
        let inserted = 0;
        let errors = 0;

        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
          const chunk = records.slice(i, i + CHUNK_SIZE);
          const { error } = await supabase.from('agents').upsert(chunk, { onConflict: 'fleet_id', ignoreDuplicates: false });
          if (error) {
            console.error('Bulk upsert agents error:', error.message);
            errors += chunk.length;
          } else {
            inserted += chunk.length;
          }
        }

        return res.json({
          status: 'success',
          message: 'Agents synced successfully',
          data: { synced: inserted, errors }
        });
      } catch (error) {
        console.error('Sync agents error:', error);
        return res.status(500).json({ status: 'error', message: error.message || 'Internal error', data: { synced: 0, errors: 0 } });
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

        // Fetch all agents once to resolve driver phones efficiently
        const { data: allAgents } = await supabase.from('agents').select('fleet_id, name, normalized_name, phone');
        const agentMap = {};
        if (allAgents) {
          allAgents.forEach(a => {
            agentMap[String(a.fleet_id)] = a.phone || a.fleet_phone || '';
          });
        }

        // Initialize optional filters for later use
        const orConditions = [];

        if (search) {
          const searchTerm = String(search).trim();
          // Normalize search: trim, collapse spaces, lowercase (same as normalized_name column)
          const normalizedSearchName = searchTerm.replace(/\s+/g, ' ').toLowerCase();
          const normalizedSearchPhone = searchTerm.replace(/\D/g, '');

          // Also fetch customers for matching
          const { data: allCustomers } = await supabase.from('customers').select('vendor_id, customer_name, customer_phone');

          const resolvedDriverIds = new Set();
          const resolvedCustomerIds = new Set();

          // Match agents
          if (allAgents && allAgents.length > 0) {
            for (const agent of allAgents) {
              const agentPhoneDigits = String(agent.phone || '').replace(/\D/g, '');
              // Use normalized_name for matching (or fallback to normalizing name)
              const agentNormalizedName = agent.normalized_name ||
                String(agent.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
              const agentIdStr = String(agent.fleet_id);

              // Match by name, id, or normalized phone
              if (agentNormalizedName === normalizedSearchName ||
                agentIdStr === searchTerm ||
                (normalizedSearchPhone && agentPhoneDigits === normalizedSearchPhone)) {
                resolvedDriverIds.add(agent.fleet_id);
              }
            }
          }

          // Match customers
          if (allCustomers && allCustomers.length > 0) {
            for (const customer of allCustomers) {
              const customerPhoneDigits = String(customer.customer_phone || '').replace(/\D/g, '');
              const customerNormalizedName = String(customer.customer_name || '').trim().replace(/\s+/g, ' ').toLowerCase();
              const customerIdStr = String(customer.vendor_id);

              if (customerNormalizedName === normalizedSearchName ||
                customerIdStr === searchTerm ||
                (normalizedSearchPhone && customerPhoneDigits === normalizedSearchPhone)) {
                resolvedCustomerIds.add(customer.vendor_id);
              }
            }
          }

          // Build OR conditions based on matches
          // orConditions matches are pushed to the outer array defined above

          if (resolvedDriverIds.size > 0) {
            const idList = Array.from(resolvedDriverIds).join(',');
            orConditions.push(`fleet_id.in.(${idList})`);
          }

          if (resolvedCustomerIds.size > 0) {
            const idList = Array.from(resolvedCustomerIds).join(',');
            orConditions.push(`vendor_id.in.(${idList})`);
          }

          // If no matches found, try fallback searches
          if (orConditions.length === 0) {
            if (/^\d+$/.test(searchTerm)) {
              const numericVal = parseInt(searchTerm, 10);
              orConditions.push(`job_id.eq.${numericVal}`, `fleet_id.eq.${numericVal}`, `vendor_id.eq.${numericVal}`);
            } else {
              orConditions.push(`fleet_name.ilike.${searchTerm}`, `customer_name.ilike.${searchTerm}`);
            }
          }

          // orConditions will be applied to lightQuery below
        }

        // 1. Light fetch: Get ALL matching tasks with minimal fields to filter and paginate correctly
        let lightQuery = supabase
          .from('tasks')
          .select('job_id, pickup_address, delivery_address, creation_datetime');

        // Apply filters to lightQuery
        const { includePickups } = req.query;
        // By default, filter strictly for Deliveries (job_type=1) unless includePickups is requested (string "true")
        if (includePickups !== 'true') {
          lightQuery = lightQuery.eq('job_type', 1);
        }

        // Apply filters to lightQuery
        if (dateFrom) lightQuery = lightQuery.gte('creation_datetime', dateFrom);
        if (dateTo) lightQuery = lightQuery.lte('creation_datetime', dateTo);
        if (driverId) lightQuery = lightQuery.eq('fleet_id', driverId);
        if (customerId) lightQuery = lightQuery.eq('vendor_id', customerId);
        if (status !== undefined && status !== null && status !== '') {
          lightQuery = lightQuery.eq('status', parseInt(status));
        }

        // Apply search filters
        if (orConditions.length > 0) {
          lightQuery = lightQuery.or(orConditions.join(','));
        }

        // Order by creation
        lightQuery = lightQuery.order('creation_datetime', { ascending: false });

        // EXECUTE LIGHT QUERY WITH LOOP (Fetch ALL matching rows in batches)
        let allLightData = [];
        let fetchPage = 0;
        const fetchSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const batchFrom = fetchPage * fetchSize;
          const batchTo = batchFrom + fetchSize - 1;

          const { data: batchData, error: batchError } = await lightQuery.range(batchFrom, batchTo);

          if (batchError) {
            console.error('Get cached orders light fetch error:', batchError.message);
            // Instead of throwing, we might want to return partial data or error
            throw batchError;
          }

          if (batchData && batchData.length > 0) {
            allLightData = allLightData.concat(batchData);

            if (batchData.length < fetchSize) {
              hasMore = false;
            } else {
              fetchPage++;
              // Safety Break (20k rows)
              if (fetchPage > 20) {
                hasMore = false;
              }
            }
          } else {
            hasMore = false;
          }
        }

        // 2. Filter in Memory

        const validTasks = allLightData.filter(task => {
          const pickup = task.pickup_address;
          const delivery = task.delivery_address;
          if (!pickup && !delivery) return false;
          if (!pickup || !delivery) return true;
          // If includePickups is true (from req.query), allow same address
          if (includePickups === 'true') return true;
          return pickup !== delivery;
        });

        const total = validTasks.length;
        console.log(`🔍 DEBUG API: Filtered Total: ${total} (Raw: ${allLightData?.length}). Page: ${pageNum}`);

        // 3. Slice for Pagination
        const pageIds = validTasks
          .slice(from, to + 1)
          .map(t => t.job_id);

        let orders = [];

        if (pageIds.length > 0) {
          // 4. Fetch Full Details
          const { data: fullData, error: fullError } = await supabase
            .from('tasks')
            .select('job_id,job_type,order_id,cod_amount,order_fees,fleet_id,fleet_name,vendor_id,notes,creation_datetime,completed_datetime,customer_name,customer_phone,customer_email,pickup_address,delivery_address,status,tags,raw_data')
            .in('job_id', pageIds)
            .order('creation_datetime', { ascending: false });

          if (fullError) {
            console.error('Get cached orders full fetch error:', fullError.message);
            throw fullError;
          }

          // Sort to match pageIds order
          const sortedTasks = pageIds.map(id => fullData.find(t => t.job_id === id)).filter(Boolean);

          orders = sortedTasks.map(task => {
            const codAmount = parseFloat(task.cod_amount || 0);
            const orderFees = parseFloat(task.order_fees || 0);
            const fleetIdStr = task.fleet_id ? String(task.fleet_id) : '';
            return {
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
              vendor_id: task.vendor_id || null,
              driver_phone: agentMap[fleetIdStr] || task.raw_data?.fleet_phone || '',
              driverPhone: agentMap[fleetIdStr] || task.raw_data?.fleet_phone || '',
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
              tags: task.tags || '',
              raw_data: task.raw_data || {}
            };
          });
        }


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
            hasMore: (pageNum * limitNum) < total,
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

    // Get all customers (merchants) from Supabase
    app.get('/api/tookan/customers', async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          throw new Error('Database not configured');
        }
        const { data: customers, error } = await supabase
          .from('customers')
          .select('*')
          .order('customer_name', { ascending: true });

        if (error) throw error;

        res.json({
          status: 'success',
          message: 'Customers fetched successfully',
          data: { customers: customers || [] }
        });
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
        // NOTE: We use small task limits here because RPC provides accurate totals
        // Tasks are only used for charts/trends which only need recent data
        // Fetch data from Tookan - only fleets and tasks
        // NOTE: Customers now come from Supabase
        const [fleetsRes, tasksRes] = await Promise.all([
          fetch('https://api.tookanapp.com/v2/get_all_fleets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
          }),
          fetch('https://api.tookanapp.com/v2/get_all_tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: apiKey,
              job_type: 1, // Delivery only for charts
              job_status: '0,1,2,3,4,5,6,7,8,9',
              limit: 100, // Small limit - RPC provides accurate totals
              custom_fields: 1
            })
          })
        ]);

        const [fleetsData, tasksData] = await Promise.all([
          fleetsRes.json(),
          tasksRes.json()
        ]);

        // Ensure data is always an array
        const fleets = Array.isArray(fleetsData.data) ? fleetsData.data :
          Array.isArray(fleetsData.fleets) ? fleetsData.fleets :
            Array.isArray(fleetsData) ? fleetsData : [];

        const tasks = Array.isArray(tasksData.data) ? tasksData.data :
          Array.isArray(tasksData.tasks) ? tasksData.tasks :
            Array.isArray(tasksData) ? tasksData : [];

        // Shared totals from Supabase if configured (for faster/more accurate counts)
        let rpcTotals = null;
        if (isSupabaseConfigured && supabase) {
          try {
            const { data: stats } = await supabase.rpc('get_order_stats');
            if (stats && stats.length > 0) {
              rpcTotals = stats[0];
            }
          } catch (e) {
            console.log('RPC check failed in analytics:', e.message);
          }
        }

        // Get top drivers from RPC (last 7 days)
        let driverPerformance = [];
        if (isSupabaseConfigured && supabase) {
          try {
            // Get order counts per fleet
            const { data: fleetCounts } = await supabase.rpc('get_fleet_order_counts_last_7_days');

            if (fleetCounts && fleetCounts.length > 0) {
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

        // Calculate analytics
        const completedTasks = tasks.filter(t => parseInt(t.job_status) === 2);
        const pendingCOD = tasks
          .filter(t => (t.order_payment || t.total_amount) && parseInt(t.job_status) === 2)
          .reduce((sum, t) => sum + (parseFloat(t.order_payment || t.total_amount) || 0), 0);

        // Get customer count from Supabase
        let dbCustomerCount = 0;
        if (isSupabaseConfigured && supabase) {
          try {
            const { count } = await supabase
              .from('customers')
              .select('*', { count: 'exact', head: true });
            dbCustomerCount = count || 0;
          } catch (e) {
            console.log('Customer count check failed in analytics:', e.message);
          }
        }

        const totalCustomers = dbCustomerCount;
        const totalMerchants = dbCustomerCount; // Per user request, match Reports Panel which uses all customers

        console.log(`🚀 [VERCEL-BACKEND] Analytics: totalCustomers=${totalCustomers}, totalMerchants=${totalMerchants}`);

        res.json({
          status: 'success',
          message: 'Analytics fetched successfully',
          data: {
            kpis: {
              totalOrders: rpcTotals?.total_orders || tasks.length,
              totalDrivers: fleets.length,  // Tookan calls these "Agents"
              totalMerchants: totalMerchants,  // Only those with vendor_id
              totalCustomers: totalCustomers,  // All delivery recipients
              pendingCOD: pendingCOD,
              driversWithPending: 0,
              completedDeliveries: rpcTotals?.completed_deliveries || completedTasks.length
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
            driverPerformance: driverPerformance
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

              // Check if user is disabled or banned
              if (userProfile && userProfile.status === 'disabled') {
                return res.status(403).json({
                  status: 'error',
                  message: 'Your account has been disabled. Please contact the administrator.',
                  data: {}
                });
              }

              if (userProfile && userProfile.status === 'banned') {
                return res.status(403).json({
                  status: 'error',
                  message: 'Your account has been banned. Please contact the administrator.',
                  data: {}
                });
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

          // Check if user is disabled or banned (check users table by email)
          if (isSupabaseConfigured && supabase) {
            try {
              const { data: userProfile } = await supabase
                .from('users')
                .select('status')
                .eq('email', userEmail)
                .single();

              if (userProfile && userProfile.status === 'disabled') {
                return res.status(403).json({
                  status: 'error',
                  message: 'Your account has been disabled. Please contact the administrator.',
                  data: {}
                });
              }
              if (userProfile && userProfile.status === 'banned') {
                return res.status(403).json({
                  status: 'error',
                  message: 'Your account has been banned. Please contact the administrator.',
                  data: {}
                });
              }
            } catch (statusError) {
              // Continue with login if status check fails
              console.log('Could not check user status:', statusError.message);
            }
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
          ...(users || []).map(u => {
            const rawStatus = (u.status || 'active').toString().toLowerCase();
            return {
              id: u.id,
              email: u.email,
              name: u.name || u.email,
              role: u.role || 'admin',
              permissions: u.permissions || {},
              status: rawStatus, // keep raw; front-end maps labels
              source: 'supabase',
              createdAt: u.created_at
            };
          }),
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

    // POST Create user - Superadmin only
    app.post('/api/users', authenticate, requireSuperadmin(), async (req, res) => {
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

    // PUT Update user permissions - Superadmin only
    app.put('/api/users/:userId/permissions', authenticate, requireSuperadmin(), async (req, res) => {
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

    // PUT Update user role - Superadmin only
    app.put('/api/users/:userId/role', authenticate, requireSuperadmin(), async (req, res) => {
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

    // DELETE user - Superadmin only (SRS: enable/disable/ban users)
    app.delete('/api/users/:userId', authenticate, requireSuperadmin(), async (req, res) => {
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

    // PUT Update user status - Superadmin only (enable/disable/ban users)
    app.put('/api/users/:userId/status', authenticate, requireSuperadmin(), async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { userId } = req.params;
        const { status } = req.body;

        if (!status) {
          return res.status(400).json({
            status: 'error',
            message: 'Status is required. Valid values: active, disabled, banned'
          });
        }

        const validStatuses = ['active', 'disabled', 'banned'];
        if (!validStatuses.includes(status.toLowerCase())) {
          return res.status(400).json({
            status: 'error',
            message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
          });
        }

        // Prevent modifying own status
        if (req.user.id === userId) {
          return res.status(400).json({
            status: 'error',
            message: 'You cannot change your own status'
          });
        }

        // Update user status
        const { data: userData, error: userError } = await supabase
          .from('users')
          .update({ status: status.toLowerCase(), updated_at: new Date().toISOString() })
          .eq('id', userId)
          .select()
          .single();

        if (userError) {
          return res.status(500).json({ status: 'error', message: 'Failed to update user status' });
        }

        // Log the action
        await supabase.from('audit_logs').insert({
          user_id: req.user.id,
          action: 'UPDATE_STATUS',
          entity_type: 'user',
          entity_id: userId,
          notes: `User ${userId} status changed to ${status} by ${req.user.email}`
        });

        res.json({
          status: 'success',
          message: `User ${status === 'active' ? 'enabled' : status === 'banned' ? 'banned' : 'disabled'} successfully`,
          data: {
            id: userData.id,
            email: userData.email,
            status: userData.status
          }
        });
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

    // PUT Update Order (Custom Fields, Description, etc.)
    app.put('/api/tookan/order/:orderId', authenticate, requirePermission(PERMISSIONS.EDIT_ORDER_FINANCIALS), async (req, res) => {
      try {
        const { orderId } = req.params;
        const numericOrderId = parseInt(orderId);
        const { codAmount, orderFees, assignedDriver, notes } = req.body;
        const apiKey = getApiKey();

        if (!orderId) {
          return res.status(400).json({ status: 'error', message: 'Order ID is required' });
        }

        // Build Tookan payload
        const updatePayload = {
          api_key: apiKey,
          job_id: numericOrderId,
          custom_field_template: 'Same_day'
        };

        const metaData = [];
        if (codAmount !== undefined) metaData.push({ label: 'COD_Amount', data: String(codAmount) });
        if (metaData.length > 0) updatePayload.meta_data = metaData;
        if (notes !== undefined) updatePayload.job_description = notes;
        if (assignedDriver) updatePayload.fleet_id = assignedDriver;

        const response = await fetch('https://api.tookanapp.com/v2/edit_task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        });
        const data = await response.json();

        if (!response.ok || data.status !== 200) {
          return res.status(500).json({ status: 'error', message: data.message || 'Failed to update order' });
        }

        // Fetch updated data to sync FULL state
        const getResponse = await fetch('https://api.tookanapp.com/v2/get_job_details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, job_ids: [numericOrderId], include_task_history: 0 })
        });
        const getData = await getResponse.json();
        const updatedTaskData = (getData.data && Array.isArray(getData.data)) ? getData.data[0] : (getData.data || {});

        // Upsert to Supabase
        if (isSupabaseConfigured && updatedTaskData.job_id) {
          await supabase.from('tasks').upsert({
            job_id: updatedTaskData.job_id,
            status: parseInt(updatedTaskData.job_status) || 0,
            job_description: updatedTaskData.job_description,
            customer_name: updatedTaskData.customer_username || updatedTaskData.customer_name || updatedTaskData.job_pickup_name,
            customer_phone: updatedTaskData.customer_phone || updatedTaskData.job_pickup_phone,
            customer_email: updatedTaskData.customer_email || updatedTaskData.job_pickup_email,
            pickup_address: updatedTaskData.job_pickup_address || updatedTaskData.pickup_address,
            delivery_address: updatedTaskData.customer_address || updatedTaskData.delivery_address,
            cod_amount: parseFloat(updatedTaskData.cod || 0),
            order_fees: parseFloat(updatedTaskData.order_payment || 0),
            notes: updatedTaskData.customer_comments || updatedTaskData.job_description,
            fleet_id: updatedTaskData.fleet_id ? parseInt(updatedTaskData.fleet_id) : null,
            creation_datetime: updatedTaskData.creation_datetime,
            last_synced_at: new Date().toISOString(),
            raw_data: updatedTaskData
          }, { onConflict: 'job_id' });
        }



        // Trigger Single Job Sync (Order & COD)
        try {
          const { syncTask } = require('../server/services/orderSyncService');
          const { syncCodAmounts } = require('../sync-cod-amounts');
          console.log(`🔄 Triggering Single Job Sync for ${numericOrderId} (Order & COD)...`);

          Promise.allSettled([
            syncTask(numericOrderId),
            syncCodAmounts({ jobId: numericOrderId })
          ]).then(results => {
            results.forEach((res, idx) => {
              const type = idx === 0 ? 'Order' : 'COD';
              if (res.status === 'fulfilled') console.log(`✅ Post-update ${type} sync complete for ${numericOrderId}`);
              else console.error(`❌ Post-update ${type} sync failed for ${numericOrderId}:`, res.reason);
            });
          });
        } catch (moduleError) {
          console.warn('⚠️ Could not load sync services:', moduleError.message);
        }

        res.json({ status: 'success', message: 'Order updated', data: updatedTaskData });

      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });







    // POST Reorder
    // Reorder requires permission
    app.post('/api/tookan/order/reorder', authenticate, requirePermission(PERMISSIONS.PERFORM_REORDER), async (req, res) => {
      try {
        const { orderId, originalOrderId, customerName, customerPhone, customerEmail, pickupAddress, deliveryAddress, codAmount, orderFees, assignedDriver, notes } = req.body;
        const orderIdToUse = orderId || originalOrderId;
        const apiKey = getApiKey();

        if (!orderIdToUse) {
          return res.status(400).json({ status: 'error', message: 'Original order ID is required' });
        }

        if (!isSupabaseConfigured) {
          return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
        }

        // Fetch original task from Supabase
        const { data: dbTasks, error: dbError } = await supabase
          .from('tasks')
          .select('*')
          .eq('job_id', orderIdToUse);

        if (dbError || !dbTasks || dbTasks.length === 0) {
          console.error('Failed to fetch original task from DB:', dbError);
          return res.status(404).json({ status: 'error', message: 'Original order not found in database' });
        }

        const original = dbTasks[0];
        const rawData = original.raw_data || {};

        let originalPickup = original;
        let originalDelivery = original;

        // Check relationships in raw_data
        const relationshipId = rawData.pickup_delivery_relationship;

        if (relationshipId) {
          try {
            const { data: relatedTasks, error: relatedError } = await supabase
              .from('tasks')
              .select('*')
              .eq('raw_data->>pickup_delivery_relationship', relationshipId);

            if (!relatedError && relatedTasks && relatedTasks.length > 0) {
              const foundPickup = relatedTasks.find(t => {
                const rd = t.raw_data || {};
                return rd.job_type === 0 || (rd.has_pickup === 1 && rd.has_delivery === 0);
              });
              const foundDelivery = relatedTasks.find(t => {
                const rd = t.raw_data || {};
                return rd.job_type === 1 || (rd.has_pickup === 0 && rd.has_delivery === 1);
              });

              if (foundPickup) originalPickup = foundPickup;
              if (foundDelivery) originalDelivery = foundDelivery;

              console.log('Fetched related tasks from DB:', {
                pickupId: foundPickup?.job_id,
                deliveryId: foundDelivery?.job_id
              });
            }
          } catch (err) {
            console.error('Failed to fetch related tasks from DB:', err.message);
          }
        }

        // Use original notes if new notes not provided
        const originalNotes = original.notes || rawData.customer_comments || rawData.job_description || '';
        // User requested empty notes by default unless entered
        const effectiveNotes = (notes && notes.trim()) ? notes.trim() : '';

        // Build order data with fallbacks using DB columns and raw_data
        const orderData = {
          customerName: customerName || original.customer_name || rawData.customer_username || rawData.job_pickup_name || 'Customer',
          customerPhone: customerPhone || original.customer_phone || rawData.customer_phone || rawData.job_pickup_phone || '+97300000000',
          customerEmail: customerEmail || original.customer_email || rawData.customer_email || rawData.job_pickup_email || '',
          pickupAddress: pickupAddress || original.pickup_address || rawData.job_pickup_address || rawData.pickup_address || '',
          deliveryAddress: deliveryAddress || original.delivery_address || rawData.customer_address || rawData.job_address || rawData.delivery_address || '',
          codAmount: codAmount !== undefined ? parseFloat(codAmount) : 0, // Default to 0 for reorder
          orderFees: orderFees !== undefined ? parseFloat(orderFees) : (parseFloat(original.order_fees || rawData.order_payment) || 0),
          assignedDriver: assignedDriver !== undefined ? assignedDriver : null, // Default unassigned
          notes: effectiveNotes
        };

        // Task times
        const now = new Date();
        const pickupTime = new Date(now.getTime() + 1 * 60 * 60 * 1000); // +1 hour for pickup
        const deliveryTime = new Date(now.getTime() + 3 * 60 * 60 * 1000); // +3 hours for delivery
        const formatDateTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

        // ========== SINGLE API CALL: Combined Pickup + Delivery ==========
        // Using Tookan's create_task API with has_pickup=1 and has_delivery=1
        // This creates both tasks atomically in a single request
        const combinedPayload = {
          api_key: apiKey,
          // Pickup fields (from merchant/warehouse)
          job_pickup_name: orderData.customerName,
          job_pickup_phone: orderData.customerPhone,
          job_pickup_email: orderData.customerEmail,
          job_pickup_address: orderData.pickupAddress,
          job_pickup_datetime: formatDateTime(pickupTime),
          pickup_custom_field_template: 'Same_day',
          pickup_meta_data: [
            {
              label: 'COD_Amount',
              data: String(orderData.codAmount)
            }
          ],
          // Delivery fields (to customer)
          customer_username: orderData.customerName,
          customer_phone: orderData.customerPhone,
          customer_email: orderData.customerEmail,
          customer_address: orderData.deliveryAddress,
          job_delivery_datetime: formatDateTime(deliveryTime),
          custom_field_template: 'Same_day',
          meta_data: [
            {
              label: 'COD_Amount',
              data: String(orderData.codAmount)
            }
          ],
          // Common fields
          has_pickup: 1,
          has_delivery: 1,
          layout_type: 0,
          timezone: '-180',
          auto_assignment: 0,
          job_description: orderData.notes,
          tracking_link: 1,
          notify: 1,
          geofence: 0
        };

        if (orderData.assignedDriver) {
          combinedPayload.fleet_id = orderData.assignedDriver;
        }

        console.log('Creating combined PICKUP + DELIVERY task for reorder (single API call)...');
        const createResponse = await fetch('https://api.tookanapp.com/v2/create_task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(combinedPayload)
        });

        const createData = await createResponse.json();

        if (createData.status !== 200) {
          return res.status(500).json({
            status: 'error',
            message: createData.message || 'Failed to create reorder task'
          });
        }

        // Extract both job IDs from response
        const responseData = createData.data || {};
        const pickupOrderId = responseData.pickup_job_id || responseData.job_id || null;
        const deliveryOrderId = responseData.delivery_job_id || responseData.job_id || null;
        const pickupData = { data: responseData };
        const deliveryData = { data: responseData };

        console.log('✅ Combined task created - Pickup:', pickupOrderId, 'Delivery:', deliveryOrderId);
        console.log('✅ Reorder complete (single API call) - Pickup:', pickupOrderId, 'Delivery:', deliveryOrderId);

        // Save BOTH tasks to Supabase
        if (isSupabaseConfigured && supabase) {
          try {
            // Save PICKUP task
            if (pickupOrderId) {
              const pickupResponseData = pickupData.data || {};
              await supabase.from('tasks').upsert({
                job_id: pickupOrderId,
                customer_name: customerName || originalPickup.customer_name || (originalPickup.raw_data && (originalPickup.raw_data.customer_username || originalPickup.raw_data.job_pickup_name)) || 'Customer',
                customer_phone: customerPhone || originalPickup.customer_phone || (originalPickup.raw_data && (originalPickup.raw_data.customer_phone || originalPickup.raw_data.job_pickup_phone)) || '+97300000000',
                customer_email: customerEmail || originalPickup.customer_email || (originalPickup.raw_data && (originalPickup.raw_data.customer_email || originalPickup.raw_data.job_pickup_email)) || '',
                pickup_address: orderData.pickupAddress,
                delivery_address: orderData.pickupAddress, // Same as pickup for pickup tasks
                cod_amount: orderData.codAmount,
                order_fees: orderData.orderFees,
                notes: orderData.notes,
                fleet_id: orderData.assignedDriver,
                status: 0,
                creation_datetime: new Date().toISOString(),
                source: 'reorder_pickup',
                last_synced_at: new Date().toISOString(),
                job_hash: pickupResponseData.job_hash || null,
                job_token: pickupResponseData.job_token || null,
                tracking_link: pickupResponseData.tracking_link || null,
                vendor_id: pickupResponseData.customer_id || originalPickup.vendor_id || (originalPickup.raw_data && (originalPickup.raw_data.customer_id || originalPickup.raw_data.vendor_id || originalPickup.raw_data.user_id)) || null,
                tags: originalPickup.tags || normalizeTags(originalPickup.raw_data?.tags),
                raw_data: { ...combinedPayload, ...pickupResponseData, job_status: 0 }
              }, { onConflict: 'job_id' });
              console.log('✅ Pickup task saved to Supabase:', pickupOrderId);
            }

            // Save DELIVERY task
            if (deliveryOrderId) {
              const deliveryResponseData = deliveryData.data || {};
              await supabase.from('tasks').upsert({
                job_id: deliveryOrderId,
                customer_name: customerName || originalDelivery.customer_name || (originalDelivery.raw_data && (originalDelivery.raw_data.customer_username || originalDelivery.raw_data.job_pickup_name)) || 'Customer',
                customer_phone: customerPhone || originalDelivery.customer_phone || (originalDelivery.raw_data && (originalDelivery.raw_data.customer_phone || originalDelivery.raw_data.job_pickup_phone)) || '+97300000000',
                customer_email: customerEmail || originalDelivery.customer_email || (originalDelivery.raw_data && (originalDelivery.raw_data.customer_email || originalDelivery.raw_data.job_pickup_email)) || '',
                pickup_address: orderData.pickupAddress,
                delivery_address: orderData.deliveryAddress,
                cod_amount: orderData.codAmount,
                order_fees: orderData.orderFees,
                notes: orderData.notes,
                fleet_id: orderData.assignedDriver,
                status: 0,
                creation_datetime: new Date().toISOString(),
                source: 'reorder_delivery',
                last_synced_at: new Date().toISOString(),
                job_hash: deliveryResponseData.job_hash || null,
                job_token: deliveryResponseData.job_token || null,
                tracking_link: deliveryResponseData.tracking_link || null,
                vendor_id: deliveryResponseData.customer_id || originalDelivery.vendor_id || (originalDelivery.raw_data && (originalDelivery.raw_data.customer_id || originalDelivery.raw_data.vendor_id || originalDelivery.raw_data.user_id)) || null,
                tags: originalDelivery.tags || normalizeTags(originalDelivery.raw_data?.tags),
                raw_data: { ...combinedPayload, ...deliveryResponseData, job_status: 0 }
              }, { onConflict: 'job_id' });
              console.log('✅ Delivery task saved to Supabase:', deliveryOrderId);
            }
          } catch (dbErr) {
            console.error('Failed to save reorder tasks to Supabase:', dbErr.message);
          }
        }

        // Trigger GitHub Action for sync (async, no timeout issues)
        const today = new Date().toISOString().split('T')[0];
        try {
          const githubToken = process.env.GITHUB_PAT;
          const githubRepo = process.env.GITHUB_REPO || 'Safi1000/tookan';

          if (githubToken) {
            console.log(`🚀 Triggering GitHub Action sync for ${today}...`);
            await fetch(`https://api.github.com/repos/${githubRepo}/dispatches`, {
              method: 'POST',
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                event_type: 'sync-orders',
                client_payload: { date_from: today, date_to: today }
              })
            });
            console.log('✅ GitHub Action triggered successfully');
          } else {
            console.warn('⚠️ GITHUB_PAT not set, skipping sync trigger');
          }
        } catch (syncError) {
          console.error('Failed to trigger GitHub Action:', syncError.message);
        }

        // Send response immediately (sync runs async in GitHub)
        res.json({
          status: 'success',
          message: 'Re-order created successfully (2 tasks: Pickup + Delivery)',
          data: {
            pickupOrderId,
            deliveryOrderId,
            originalOrderId: orderIdToUse,
            tasksCreated: 2
          }
        });

      } catch (error) {
        console.error('Reorder error:', error);
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Return Order
    // Return order requires permission
    app.post('/api/tookan/order/return', authenticate, requirePermission(PERMISSIONS.PERFORM_REORDER), async (req, res) => {
      try {
        const { orderId, originalOrderId, customerName, customerPhone, customerEmail, pickupAddress, deliveryAddress, notes } = req.body;
        const orderIdToUse = orderId || originalOrderId;
        const apiKey = getApiKey();

        if (!orderIdToUse) {
          return res.status(400).json({ status: 'error', message: 'Order ID is required' });
        }

        // Use data from request body if provided
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
          const getResponse = await fetch('https://api.tookanapp.com/v2/get_task_details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, job_id: orderIdToUse })
          });
          const originalData = await getResponse.json();

          if (originalData.status !== 200) {
            return res.status(404).json({ status: 'error', message: 'Original order not found' });
          }

          const original = originalData.data || {};
          orderData.customerName = orderData.customerName || original.customer_name || original.customer_username || 'Customer';
          orderData.customerPhone = orderData.customerPhone || original.customer_phone || '';
          orderData.customerEmail = orderData.customerEmail || original.customer_email || '';
          orderData.pickupAddress = orderData.pickupAddress || original.job_pickup_address || original.pickup_address || '';
          orderData.deliveryAddress = orderData.deliveryAddress || original.customer_address || original.job_address || original.delivery_address || '';
          orderData.notes = orderData.notes || original.customer_comments || '';
        }

        // Get original addresses
        const originalPickupAddr = (orderData.pickupAddress || '').trim();
        const originalDeliveryAddr = (orderData.deliveryAddress || '').trim();

        // Determine task type:
        // - Pickup tasks have SAME pickup and delivery address
        // - Delivery tasks have DIFFERENT pickup and delivery address
        const isPickupTask = originalPickupAddr === originalDeliveryAddr;

        // Return Order is ONLY available for delivery tasks
        if (isPickupTask || !originalDeliveryAddr) {
          return res.status(400).json({
            status: 'error',
            message: 'Return Order is not available for pickup tasks. Pickup tasks already involve collecting items from the customer location - there is nothing to return. Return Order is only available for delivery tasks where items were delivered to a customer and need to be picked up back.'
          });
        }

        // Task time
        const now = new Date();
        const pickupTime = new Date(now.getTime() + 1 * 60 * 60 * 1000); // +1 hour for pickup
        const deliveryTime = new Date(now.getTime() + 3 * 60 * 60 * 1000); // +3 hours for delivery
        const formatDateTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

        // For return:
        // - PICKUP from customer location (original delivery address)
        // - DELIVERY to merchant location (original pickup address)
        const returnPickupAddr = originalDeliveryAddr;
        const returnDeliveryAddr = originalPickupAddr;

        // Get assigned driver
        const assignedDriver = orderData.assignedDriver || null;

        // ========== SINGLE API CALL: Combined Pickup + Delivery ==========
        // Using Tookan's create_task API with has_pickup=1 and has_delivery=1
        // For return order: pickup from customer, deliver to merchant
        const combinedPayload = {
          api_key: apiKey,
          // Pickup fields (from customer location - original delivery address)
          job_pickup_name: orderData.customerName || 'Customer',
          job_pickup_phone: orderData.customerPhone || '',
          job_pickup_email: orderData.customerEmail || '',
          job_pickup_address: returnPickupAddr,
          job_pickup_datetime: formatDateTime(pickupTime),
          // Delivery fields (to merchant location - original pickup address)
          customer_username: orderData.customerName || 'Customer',
          customer_phone: orderData.customerPhone || '',
          customer_email: orderData.customerEmail || '',
          customer_address: returnDeliveryAddr,
          job_delivery_datetime: formatDateTime(deliveryTime),
          // Common fields
          has_pickup: 1,
          has_delivery: 1,
          layout_type: 0,
          timezone: '-180',
          auto_assignment: 0,
          job_description: orderData.notes || '',
          tracking_link: 1,
          notify: 1,
          geofence: 0
        };

        if (assignedDriver) {
          combinedPayload.fleet_id = assignedDriver;
        }

        console.log('Creating combined PICKUP + DELIVERY task for return order (single API call)...');

        const createResponse = await fetch('https://api.tookanapp.com/v2/create_task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(combinedPayload)
        });

        const createData = await createResponse.json();

        if (createData.status !== 200) {
          return res.status(500).json({
            status: 'error',
            message: createData.message || 'Failed to create return order task'
          });
        }

        // Extract both job IDs from response
        const responseData = createData.data || {};
        const pickupOrderId = responseData.pickup_job_id || responseData.job_id || null;
        const deliveryOrderId = responseData.delivery_job_id || responseData.job_id || null;

        console.log('✅ Combined task created - Pickup:', pickupOrderId, 'Delivery:', deliveryOrderId);
        console.log('✅ Return order complete (single API call) - Pickup:', pickupOrderId, 'Delivery:', deliveryOrderId);

        // Save BOTH return tasks to Supabase
        if (isSupabaseConfigured && supabase) {
          try {
            // Save PICKUP task - pickup_address = delivery_address (same location for pickup tasks)
            if (pickupOrderId) {
              await supabase.from('tasks').upsert({
                job_id: pickupOrderId,
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
                last_synced_at: new Date().toISOString()
              }, { onConflict: 'job_id' });
              console.log('✅ Pickup task saved to Supabase:', pickupOrderId);
            }

            // Save DELIVERY task
            if (deliveryOrderId) {
              await supabase.from('tasks').upsert({
                job_id: deliveryOrderId,
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
                last_synced_at: new Date().toISOString()
              }, { onConflict: 'job_id' });
              console.log('✅ Delivery task saved to Supabase:', deliveryOrderId);
            }
          } catch (dbErr) {
            console.error('Failed to save return tasks to Supabase:', dbErr.message);
          }
        }

        // Trigger GitHub Action for sync (async, no timeout issues)
        const today = new Date().toISOString().split('T')[0];
        try {
          const githubToken = process.env.GITHUB_PAT;
          const githubRepo = process.env.GITHUB_REPO || 'Safi1000/tookan';

          if (githubToken) {
            console.log(`🚀 Triggering GitHub Action sync for ${today}...`);
            await fetch(`https://api.github.com/repos/${githubRepo}/dispatches`, {
              method: 'POST',
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                event_type: 'sync-orders',
                client_payload: { date_from: today, date_to: today }
              })
            });
            console.log('✅ GitHub Action triggered successfully');
          } else {
            console.warn('⚠️ GITHUB_PAT not set, skipping sync trigger');
          }
        } catch (syncError) {
          console.error('Failed to trigger GitHub Action:', syncError.message);
        }

        // Send response immediately (sync runs async in GitHub)
        res.json({
          status: 'success',
          message: 'Return order created successfully (Pickup + Delivery tasks)',
          data: {
            pickupOrderId,
            deliveryOrderId,
            originalOrderId: orderIdToUse,
            assignedDriver
          }
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

    // ============================================
    // REPORTS & SEARCH ENDPOINTS
    // ============================================

    // GET Reports Summary (Aggregated Data)
    app.get('/api/reports/summary', authenticate, async (req, res) => {
      try {
        // 1. Get Totals via RPC
        const { data: orderStats } = (isSupabaseConfigured && supabase)
          ? await supabase.rpc('get_order_stats')
          : { data: null };

        // 2. Get Drivers via API
        const fleetsRes = await fetch('https://api.tookanapp.com/v2/get_all_fleets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: getApiKey() })
        }).then(r => r.json()).catch(() => ({ data: [] }));
        const fleets = fleetsRes.data || [];

        // 3. Get Customers count from Supabase
        let dbCustomerCount = 0;
        if (isSupabaseConfigured && supabase) {
          const { count } = await supabase
            .from('customers')
            .select('*', { count: 'exact', head: true });
          dbCustomerCount = count || 0;
        }

        const totals = {
          orders: orderStats?.[0]?.total_orders || 0,
          drivers: fleets.length,
          customers: dbCustomerCount,
          merchants: dbCustomerCount,
          deliveries: orderStats?.[0]?.completed_deliveries || 0
        };

        console.log(`🚀 [VERCEL-BACKEND] Summary: customers=${totals.customers}`);

        res.json({
          status: 'success',
          data: {
            orders: [],
            drivers: [],
            customers: [],
            driverSummaries: [],
            merchantSummaries: [],
            totals: totals
          }
        });
      } catch (error) {
        console.error('Reports summary error:', error);
        res.status(500).json({ status: 'error', message: error.message });
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
        if (isSupabaseConfigured && supabase) {
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

        // 3. Supabase for customers count
        if (isSupabaseConfigured && supabase) {
          promises.push(supabase.from('customers').select('*', { count: 'exact', head: true }));
        } else {
          promises.push(Promise.resolve({ count: 0 }));
        }

        const [orderStats, driversResp, customersCountResp] = await Promise.all(promises);

        // Extract totals
        const totals = {
          orders: 0,
          drivers: 0,
          customers: 0,
          deliveries: 0
        };

        // From Supabase RPC
        if (orderStats.data && orderStats.data.length > 0) {
          totals.orders = orderStats.data[0].total_orders || 0;
          totals.deliveries = orderStats.data[0].completed_deliveries || 0;
        }

        // From Tookan API and Supabase
        totals.drivers = driversResp.data?.length || 0;
        totals.customers = customersCountResp.count || 0;

        const elapsed = Date.now() - startTime;
        console.log(`📊 Totals fetched in ${elapsed}ms: orders=${totals.orders}, drivers=${totals.drivers}, customers=${totals.customers}, deliveries=${totals.deliveries}`);

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

    // GET Driver Performance statistics via RPC
    // GET Driver Performance statistics via RPC
    app.get('/api/reports/driver-performance', authenticate, async (req, res) => {
      try {
        const { search, dateFrom, dateTo, status } = req.query;
        console.log('\n=== GET DRIVER PERFORMANCE ===');
        console.log('Search:', search, 'From:', dateFrom, 'To:', dateTo, 'Status:', status);

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

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

        console.log('🔍 Driver IDs found:', JSON.stringify(driverIds));

        // Use RPC function for optimized stats calculation
        const results = await Promise.all(driverIds.map(async (driver) => {
          // Get order stats from get_driver_statistics_v2
          const { data, error } = await supabase.rpc('get_driver_statistics_v2', {
            p_fleet_id: driver.id,
            p_date_from: dateFrom || null,
            p_date_to: dateTo ? dateTo + 'T23:59:59' : null,
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
              avg_delivery_time: 0,
              paid_total: 0,
              balance_total: 0
            };
          }

          console.log(`🔍 RPC response for driver ${driver.id}:`, JSON.stringify(data));
          const stats = data && data[0] ? data[0] : { total_orders: 0, cod_total: 0, order_fees: 0, avg_delivery_time_minutes: 0 };

          // Get payment stats using the new RPC function
          const { data: paymentData, error: paymentError } = await supabase.rpc('get_driver_payment_stats', {
            p_fleet_id: driver.id,
            p_date_from: dateFrom ? dateFrom : null,
            p_date_to: dateTo ? dateTo + 'T23:59:59' : null
          });

          let paidTotal = 0;
          let balanceTotal = 0;

          if (!paymentError && paymentData && paymentData[0]) {
            paidTotal = parseFloat(paymentData[0].paid_total || 0);
            balanceTotal = parseFloat(paymentData[0].balance_total || 0);
          }

          return {
            fleet_id: driver.id,
            name: driver.name,
            total_orders: parseInt(stats.total_orders || 0),
            cod_total: parseFloat(stats.cod_total || 0),
            order_fees: parseFloat(stats.order_fees || 0),
            avg_delivery_time: parseFloat(stats.avg_delivery_time_minutes || 0),
            paid_total: paidTotal,
            balance_total: balanceTotal
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

        if (!isSupabaseConfigured || !supabase) {
          return res.json({ status: 'success', data: { feeRate: 0.05 } });
        }

        const { data, error } = await supabase
          .from('tag_config')
          .select('config')
          .eq('id', 1)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching tookan fee:', error);
        }

        const feeRate = data?.config?.tookanFeeRate ?? 0.05;
        res.json({ status: 'success', data: { feeRate } });
      } catch (error) {
        console.error('Get tookan fee error:', error);
        res.json({ status: 'success', data: { feeRate: 0.05 } });
      }
    });

    // PUT Tookan Fee Rate setting
    app.put('/api/settings/tookan-fee', authenticate, async (req, res) => {
      try {
        const { feeRate } = req.body;
        console.log('\n=== UPDATE TOOKAN FEE SETTING ===');

        if (typeof feeRate !== 'number' || feeRate < 0) {
          return res.status(400).json({ status: 'error', message: 'Fee rate must be a positive number' });
        }

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }

        const { data: existingData } = await supabase
          .from('tag_config')
          .select('config')
          .eq('id', 1)
          .single();

        const existingConfig = existingData?.config || {};
        const newConfig = { ...existingConfig, tookanFeeRate: feeRate };

        const { error } = await supabase
          .from('tag_config')
          .upsert({ id: 1, config: newConfig }, { onConflict: 'id' });

        if (error) {
          return res.status(500).json({ status: 'error', message: error.message });
        }

        res.json({ status: 'success', data: { feeRate } });
      } catch (error) {
        console.error('Update tookan fee error:', error);
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET Related Delivery Address for Pickup Tasks (Return Orders)
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
          return res.json({ status: 'error', message: 'Job details not found' });
        }

        const jobData = jobDetailsData.data[0];
        const pickupDeliveryRelationship = jobData.pickup_delivery_relationship;

        if (!pickupDeliveryRelationship) {
          return res.json({ status: 'success', data: { hasRelatedTask: false } });
        }

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
          return res.json({ status: 'success', data: { hasRelatedTask: false } });
        }

        const relatedTasks = relatedTasksData.data;
        const deliveryTask = relatedTasks.find(task =>
          String(task.job_id) !== String(jobId) && task.job_type === 1
        ) || relatedTasks.find(task => String(task.job_id) !== String(jobId));

        if (deliveryTask) {
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

        return res.json({ status: 'success', data: { hasRelatedTask: false } });
      } catch (error) {
        console.error('Get related address error:', error);
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET/Sync COD Amount for a single order
    // Fetches COD from Tookan's get_job_details API (COD_Amount in job_additional_info)
    app.get('/api/orders/:jobId/sync-cod', authenticate, async (req, res) => {
      try {
        const { jobId } = req.params;
        console.log('\n=== SYNC COD AMOUNT ===');
        console.log('Job ID:', jobId);

        const apiKey = await getApiKey();

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
            field.label === 'COD_Amount' ||
            field.display_name === 'CASH NEEDS TO BE COLLECTED'
          );

          if (codField && codField.data) {
            const codValue = parseFloat(codField.data);
            codAmount = isNaN(codValue) ? null : codValue;
          }
        }

        console.log('Found COD amount:', codAmount);

        // Update Supabase if configured
        if (isSupabaseConfigured && supabase && codAmount !== null) {
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
            console.log('✅ COD updated in Supabase');
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
        console.log('\n=== GET CUSTOMER PERFORMANCE ===');
        console.log('Search:', search, 'From:', dateFrom, 'To:', dateTo, 'Status:', status);

        if (!isSupabaseConfigured || !supabase) {
          return res.status(400).json({ status: 'error', message: 'Database not configured' });
        }

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

        console.log('🔍 Search params:', { p_customer_name, p_vendor_id, p_customer_phone });

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

        console.log('🔍 RPC results:', data?.length || 0);

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
          avg_delivery_time: parseFloat(stats.avg_delivery_time_minutes || 0)
        }));

        console.log('🔍 Final results:', results.length);

        res.json({ status: 'success', data: results });
      } catch (error) {
        console.error('Customer performance error:', error);
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET Search Order by job_id (from Supabase, bypasses RLS)
    app.get('/api/search/order/:jobId', authenticate, async (req, res) => {
      try {
        const { jobId } = req.params;
        console.log('\n=== SEARCH ORDER BY JOB_ID ===');
        console.log('Job ID:', jobId);

        if (!isSupabaseConfigured || !supabase) {
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

        if (!isSupabaseConfigured || !supabase) {
          return res.status(400).json({ status: 'error', message: 'Database not configured' });
        }

        const searchTerm = q.toString().trim();
        const isNumeric = /^\d+$/.test(searchTerm);

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

        if (!isSupabaseConfigured || !supabase) {
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
    // POST Tookan Task Webhook (for production stability)
    app.post('/api/webhooks/tookan/task', async (req, res) => {
      try {
        const secretHeader = req.headers['x-webhook-secret'];
        const expected = getWebhookSecret();
        const payload = req.body || {};
        const bodySecret = payload.tookan_shared_secret;

        if (!expected || (secretHeader !== expected && bodySecret !== expected)) {
          console.warn('⚠️  Vercel Webhook: Unauthorized attempt');
          return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const jobId = payload.job_id || payload.id || payload.task_id;
        if (!jobId) return res.status(400).json({ status: 'error', message: 'job_id is required' });

        if (!isSupabaseConfigured || !supabase) {
          return res.status(503).json({ status: 'error', message: 'Database not configured' });
        }

        // Check if task is deleted
        const isDeleted = payload.is_deleted === 1 || payload.is_deleted === '1' || payload.is_deleted === true;
        if (isDeleted) {
          await supabase.from('tasks').delete().eq('job_id', parseInt(jobId));
          console.log('✅ Vercel Webhook: Deleted task removed:', jobId);
          return res.status(200).json({ status: 'success', message: 'Task deleted' });
        }

        // Debug: Log payload keys to identify completed_datetime field name
        console.log('📥 Vercel Webhook payload keys:', Object.keys(payload));
        console.log('📅 completed_datetime candidates:', {
          completed_datetime: payload.completed_datetime,
          job_delivered_datetime: payload.job_delivered_datetime,
          acknowledged_datetime: payload.acknowledged_datetime,
          completed_date_time: payload.completed_date_time,
          delivery_datetime: payload.delivery_datetime,
          job_status: payload.job_status || payload.status
        });

        // Wait 10 seconds for Tookan to propagate data
        console.log('⏳ Vercel Webhook: Waiting 10s for data propagation...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        let freshTask = null;
        try {
          console.log(`🔄 Vercel Webhook: Fetching fresh details for Job ID: ${jobId}`);
          const apiKey = getApiKey();
          const getTaskPayload = {
            api_key: apiKey,
            job_id: jobId
          };

          const getResponse = await fetch('https://api.tookanapp.com/v2/get_task_details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getTaskPayload),
          });

          if (getResponse.ok) {
            const getData = await getResponse.json();
            if (getData.status === 200 && getData.data) {
              freshTask = getData.data;
              console.log('✅ Vercel Webhook: Fresh task details fetched');
            }
          }
        } catch (fetchError) {
          console.error('⚠️ Vercel Webhook: Failed to fetch fresh details:', fetchError.message);
        }

        // Fetch COD amount from get_job_details with job_additional_info
        let codAmountFromApi = null;
        let tagsFromApi = null;
        try {
          console.log(`💰 Vercel Webhook: Fetching COD amount for Job ID: ${jobId}`);
          const apiKey = getApiKey();

          const codResponse = await fetch('https://api.tookanapp.com/v2/get_job_details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: apiKey,
              job_ids: [parseInt(jobId)],
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
                  field.label === 'COD_Amount' ||
                  field.display_name === 'CASH NEEDS TO BE COLLECTED'
                );

                if (codField && codField.data) {
                  const codValue = parseFloat(codField.data);
                  if (!isNaN(codValue)) {
                    codAmountFromApi = codValue;
                    console.log('✅ Vercel Webhook: COD amount found:', codValue);
                  }
                }
              }

              // Also get tags if available
              if (jobData.tags) {
                tagsFromApi = jobData.tags;
              }
            }
          }
        } catch (codFetchError) {
          console.error('⚠️ Vercel Webhook: Failed to fetch COD amount:', codFetchError.message);
        }

        // Use fresh data if available, otherwise fallback to payload
        const sourceData = freshTask || payload;

        // Map Tookan's varied date fields
        const completedTime = sourceData.job_completed_datetime ||
          sourceData.completed_datetime ||
          sourceData.job_delivered_datetime ||
          sourceData.acknowledged_datetime ||
          sourceData.completed_date_time ||
          sourceData.delivery_datetime ||
          payload.completed_datetime || // Fallback to payload even if freshTask exists but is missing date
          null;

        // Map the payload to our schema (using the fixed logic from server/index.js)
        const record = {
          job_id: parseInt(jobId) || jobId,
          order_id: sourceData.order_id || sourceData.job_pickup_name || payload.order_id || '',
          cod_amount: codAmountFromApi !== null ? codAmountFromApi : parseFloat(sourceData.cod_amount || sourceData.cod || payload.cod_amount || 0),
          order_fees: parseFloat(sourceData.order_fees || sourceData.order_payment || payload.order_fees || 0),
          fleet_id: sourceData.fleet_id ? parseInt(sourceData.fleet_id) : (payload.fleet_id ? parseInt(payload.fleet_id) : null),
          fleet_name: sourceData.fleet_name || sourceData.driver_name || sourceData.username || payload.fleet_name || '',
          notes: sourceData.customer_comments || sourceData.customer_comment || sourceData.notes || payload.customer_comments || '',
          status: sourceData.job_status || sourceData.status || payload.job_status || null,
          customer_name: sourceData.customer_name || sourceData.customer_username || payload.customer_name || '',
          customer_phone: sourceData.customer_phone || payload.customer_phone || '',
          customer_email: sourceData.customer_email || payload.customer_email || '',
          pickup_address: sourceData.job_pickup_address || sourceData.pickup_address || payload.job_pickup_address || '',
          delivery_address: sourceData.customer_address || sourceData.job_address || sourceData.delivery_address || payload.delivery_address || '',
          creation_datetime: sourceData.creation_datetime || sourceData.job_time || sourceData.created_at || sourceData.timestamp || payload.creation_datetime || new Date().toISOString(),
          // Expanded completed_datetime lookup - check all possible Tookan field names
          completed_datetime: completedTime,
          tags: tagsFromApi || sourceData.tags || sourceData.job_tags || payload.tags || '',
          raw_data: { ...payload, ...(freshTask || {}) },
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        console.log('📝 Vercel Record completed_datetime value:', record.completed_datetime);

        const { error } = await supabase.from('tasks').upsert(record, { onConflict: 'job_id' });
        if (error) throw error;

        console.log('✅ Vercel Webhook: Task upserted successfully:', jobId);
        res.json({ status: 'success', message: 'Task upserted' });
      } catch (err) {
        console.error('❌ Vercel Webhook error:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
      }
    });


    // GET All Customers (via Supabase)
    app.get('/api/tookan/customers', authenticate, async (req, res) => {
      try {
        if (!isSupabaseConfigured || !supabase) {
          throw new Error('Database not configured');
        }
        const { data: customers, error } = await supabase
          .from('customers')
          .select('*')
          .order('customer_name', { ascending: true });

        if (error) throw error;
        res.json({ status: 'success', data: { customers: customers || [] } });
      } catch (error) {
        console.error('Fetch all customers error:', error);
        res.status(500).json({ status: 'error', message: error.message, data: { customers: [] } });
      }
    });

    // PUT Update Order (COD, Notes, Fees) - Called by OrderEditorPanel
    app.put('/api/tookan/order/:orderId', authenticate, requirePermission('edit_order_financials'), async (req, res) => {
      // DEBUG LOG COLLECTOR
      const debutLogs = [];
      const log = (msg, data) => {
        const line = `${new Date().toISOString()} - ${msg} ${data ? JSON.stringify(data) : ''}`;
        console.log(line);
        debutLogs.push(line);
      };

      try {
        log('=== UPDATE ORDER REQUEST (Vercel) ===');
        const { orderId } = req.params;
        const { codAmount, orderFees, notes } = req.body;
        log('Order ID:', orderId);
        log('Request body:', req.body);

        if (!orderId) {
          return res.status(400).json({
            status: 'error',
            message: 'Order ID is required',
            data: { debug_logs: debutLogs }
          });
        }

        let apiKey;
        try {
          apiKey = getApiKey();
          log('API Key retrieved:', '***HIDDEN***');
        } catch (e) {
          log('API Key error:', e.message);
          throw e;
        }

        const numericJobId = parseInt(orderId, 10);
        if (isNaN(numericJobId)) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid Order ID - must be a number',
            data: { debug_logs: debutLogs }
          });
        }

        // Build the meta_data array for COD custom field
        const metaData = [];
        if (codAmount !== undefined) {
          metaData.push({
            label: 'COD_Amount',
            data: String(codAmount)
          });
        }

        // Build Tookan payload with custom_field_template
        const tookanPayload = {
          api_key: apiKey,
          job_id: numericJobId,
          custom_field_template: 'Same_day'
        };

        // Add meta_data if we have COD to update
        if (metaData.length > 0) {
          tookanPayload.meta_data = metaData;
        }

        // Add job_description (notes) if provided
        if (notes !== undefined) {
          tookanPayload.job_description = notes;
        }

        log('Calling Tookan API: https://api.tookanapp.com/v2/edit_task');
        log('Template:', tookanPayload.custom_field_template);
        log('Meta Data:', metaData);

        let response;
        let textResponse;
        try {
          response = await fetch('https://api.tookanapp.com/v2/edit_task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tookanPayload),
          });
          textResponse = await response.text();
          log('Tookan Response Status:', response.status);
          log('Tookan Response Body:', textResponse.substring(0, 500));
        } catch (fetchError) {
          log('Tookan fetch error:', fetchError.message);
          textResponse = JSON.stringify({ status: 0, message: fetchError.message });
        }

        let tookanData;
        try {
          tookanData = JSON.parse(textResponse);
        } catch (parseError) {
          log('Failed to parse Tookan response:', parseError.message);
          tookanData = { status: 0, message: 'Non-JSON response: ' + textResponse.substring(0, 100) };
        }

        const tookanSuccess = response && response.ok && tookanData.status === 200;
        if (tookanSuccess) {
          log('✅ Tookan API update successful');
        } else {
          log('⚠️ Tookan update failed:', tookanData.message || textResponse);
        }

        // Update Supabase database
        let dbUpdated = false;

        // RE-CHECK SUPABASE CONFIGURATION AT RUNTIME
        // In serverless, env vars might not be available at module load time
        if (!supabase) {
          const sbUrl = process.env.SUPABASE_URL;
          const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
          log('Runtime Supabase Check - URL:', sbUrl ? 'Present' : 'Missing');
          log('Runtime Supabase Check - Key:', sbKey ? 'Present' : 'Missing');

          if (sbUrl && sbKey && sbUrl.startsWith('https://') && !sbUrl.includes('YOUR_')) {
            log('Re-initializing Supabase client at runtime...');
            try {
              supabase = createClient(sbUrl, sbKey, {
                auth: { autoRefreshToken: false, persistSession: false }
              });
            } catch (initError) {
              log('Supabase runtime init failed:', initError.message);
            }
          }
        }

        log('Supabase client active:', !!supabase);

        if (supabase) {
          try {
            const updateData = { updated_at: new Date().toISOString() };
            if (codAmount !== undefined) updateData.cod_amount = parseFloat(codAmount);
            if (orderFees !== undefined) updateData.order_fees = parseFloat(orderFees);
            if (notes !== undefined) updateData.notes = notes;

            log('Updating Supabase task:', numericJobId);
            const { error } = await supabase
              .from('tasks')
              .update(updateData)
              .eq('job_id', numericJobId);

            if (error) {
              throw error;
            }
            dbUpdated = true;
            log('✅ Database updated');
          } catch (dbError) {
            log('⚠️ Database update failed:', dbError.message);
          }
        } else {
          log('⚠️ Skipping database update: Client not available');
        }

        log('=== END REQUEST (SUCCESS) ===');

        res.json({
          status: 'success',
          message: tookanSuccess
            ? 'Order updated in Tookan and database'
            : 'Order updated in database only. Tookan update may have failed.',
          data: {
            orderId,
            tookan_synced: tookanSuccess,
            database_synced: dbUpdated,
            tookan_response: tookanData,
            debug_logs: debutLogs // RETURN LOGS IN RESPONSE
          }
        });
      } catch (error) {
        console.error('❌ Update order error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to update order',
          data: {
            debug_logs: (typeof debutLogs !== 'undefined' ? debutLogs : [error.message])
          }
        });
      }
    });

    // GET Analytics (KPIs, Charts, Performance Data) - Vercel version
    app.get('/api/reports/analytics', authenticate, async (req, res) => {
      try {
        console.log('\n=== GET ANALYTICS REQUEST (Vercel) ===');
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

        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({
            status: 'error',
            message: 'Database not configured',
            data: {}
          });
        }

        // Fetch data directly from Supabase
        const [tasksResult, agentsResult, customersResult] = await Promise.all([
          supabase
            .from('tasks')
            .select('job_id, status, cod_amount, creation_datetime, fleet_id')
            .gte('creation_datetime', startDate)
            .lte('creation_datetime', endDate),
          supabase.from('agents').select('fleet_id, name'),
          supabase.from('customers').select('vendor_id', { count: 'exact', head: true })
        ]);

        const tasks = tasksResult.data || [];
        const agents = agentsResult.data || [];
        const totalCustomers = customersResult.count || 0;

        // Calculate KPIs
        const totalOrders = tasks.length;
        const totalDrivers = agents.length;
        const completedDeliveries = tasks.filter(t => t.status === 2).length;
        const pendingCOD = tasks
          .filter(t => [0, 1, 3, 4, 6, 7].includes(t.status))
          .reduce((sum, t) => sum + (parseFloat(t.cod_amount) || 0), 0);
        const collectedCOD = tasks
          .filter(t => t.status === 2)
          .reduce((sum, t) => sum + (parseFloat(t.cod_amount) || 0), 0);

        // COD Status for pie chart
        const codStatus = [
          { name: 'COD Collected', value: collectedCOD, color: '#DE3544' },
          { name: 'Settled', value: 0, color: '#10B981' },
          { name: 'Pending', value: pendingCOD, color: '#F59E0B' }
        ];

        // Order Volume (last 7 days)
        const orderVolume = [];
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];
          const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
          const dayOrders = tasks.filter(t => {
            if (!t.creation_datetime) return false;
            return t.creation_datetime.split('T')[0] === dateStr;
          });
          orderVolume.push({ day: dayName, orders: dayOrders.length });
        }

        // Driver Performance (top 5)
        const agentMap = new Map();
        agents.forEach(a => agentMap.set(String(a.fleet_id), a.name));

        const fleetCounts = {};
        tasks.forEach(t => {
          if (t.fleet_id) {
            fleetCounts[t.fleet_id] = (fleetCounts[t.fleet_id] || 0) + 1;
          }
        });

        const driverPerformance = Object.entries(fleetCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([fleetId, count]) => ({
            name: agentMap.get(String(fleetId)) || `Driver ${fleetId}`,
            deliveries: count
          }));

        console.log('✅ Analytics calculated successfully');

        res.json({
          status: 'success',
          message: 'Analytics fetched successfully',
          data: {
            kpis: {
              totalOrders,
              totalDrivers,
              totalMerchants: totalCustomers,
              pendingCOD,
              driversWithPending: 0,
              completedDeliveries
            },
            codStatus,
            orderVolume,
            driverPerformance,
            trends: { orders: '+0%', drivers: '+0%', merchants: '+0%' },
            filters: { dateFrom: startDate, dateTo: endDate }
          }
        });
      } catch (error) {
        console.error('❌ Analytics error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to fetch analytics',
          data: {}
        });
      }
    });

    // ============================================
    // ADMIN SYNC ENDPOINTS
    // ============================================

    // POST Trigger Incremental Sync (Admin only)
    app.post('/api/admin/sync/incremental', authenticate, requireRole('admin'), async (req, res) => {
      try {
        console.log('\n=== TRIGGER INCREMENTAL SYNC (Vercel) ===');
        if (!isSupabaseConfigured || !supabase) {
          return res.status(400).json({ status: 'error', message: 'Database not configured' });
        }
        // In Vercel serverless, we can't run background tasks effectively
        // Just return that the operation would need to be run locally
        res.json({
          status: 'success',
          message: 'Incremental sync must be triggered from local server due to serverless limitations',
          data: { serverless: true }
        });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // DELETE Clear Order Cache (Admin only)
    app.delete('/api/admin/sync/cache', authenticate, requireRole('admin'), async (req, res) => {
      try {
        console.log('\n=== CLEAR ORDER CACHE (Vercel) ===');
        if (!isSupabaseConfigured || !supabase) {
          return res.status(400).json({ status: 'error', message: 'Database not configured' });
        }
        // Delete all cached tasks
        const { error } = await supabase.from('tasks').delete().neq('job_id', 0);
        if (error) throw error;
        res.json({ status: 'success', message: 'Order cache cleared successfully' });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // AUTH ENDPOINT ADDITIONS
    // ============================================

    // POST Register User
    app.post('/api/auth/register', async (req, res) => {
      try {
        console.log('\n=== REGISTER USER (Vercel) ===');
        const { email, password, name, role } = req.body;
        if (!email || !password) {
          return res.status(400).json({ status: 'error', message: 'Email and password required' });
        }
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }
        // Check if user exists
        const { data: existing } = await supabase.from('users').select('id').eq('email', email).single();
        if (existing) {
          return res.status(400).json({ status: 'error', message: 'User already exists' });
        }
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        // Create user
        const { data: newUser, error } = await supabase.from('users').insert({
          email,
          password_hash: hashedPassword,
          name: name || email.split('@')[0],
          role: role || 'viewer',
          status: 'active'
        }).select().single();
        if (error) throw error;
        res.json({ status: 'success', message: 'User registered', data: { id: newUser.id, email: newUser.email } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // ORDER ASSIGNMENT
    // ============================================

    // PUT Assign Driver to Order
    app.put('/api/orders/:jobId/assign', authenticate, requirePermission('edit_order_financials'), async (req, res) => {
      try {
        console.log('\n=== ASSIGN DRIVER (Vercel) ===');
        const { jobId } = req.params;
        const { fleet_id, notes } = req.body;
        const apiKey = getApiKey();

        // Update in Tookan
        const tookanPayload = {
          api_key: apiKey,
          job_id: parseInt(jobId),
          fleet_id: fleet_id ? parseInt(fleet_id) : null
        };
        if (notes !== undefined) tookanPayload.job_description = notes;

        const response = await fetch('https://api.tookanapp.com/v2/edit_task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tookanPayload)
        });
        const data = await response.json();

        if (data.status !== 200) {
          return res.status(500).json({ status: 'error', message: data.message });
        }

        // Update database
        if (isSupabaseConfigured && supabase) {
          await supabase.from('tasks').update({ fleet_id: parseInt(fleet_id), updated_at: new Date().toISOString() }).eq('job_id', parseInt(jobId));
        }

        res.json({ status: 'success', message: 'Driver assigned', data: { jobId, fleet_id } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // CUSTOMER/FLEET ADD ENDPOINTS
    // ============================================

    // POST Add Customer
    app.post('/api/tookan/customer/add', authenticate, requireRole('admin'), async (req, res) => {
      try {
        console.log('\n=== ADD CUSTOMER (Vercel) ===');
        const apiKey = getApiKey();
        const { name, phone } = req.body;
        if (!name || !phone) {
          return res.status(400).json({ status: 'error', message: 'Name and phone required' });
        }
        const response = await fetch('https://api.tookanapp.com/v2/customer/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, user_type: 0, name, phone })
        });
        const data = await response.json();
        if (data.status !== 200) {
          return res.status(500).json({ status: 'error', message: data.message });
        }
        res.json({ status: 'success', message: 'Customer added', data: data.data });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // POST Add Fleet/Driver
    app.post('/api/tookan/fleet/add', authenticate, requireRole('admin'), async (req, res) => {
      try {
        console.log('\n=== ADD FLEET (Vercel) ===');
        const apiKey = getApiKey();
        const { name, email, phone, password, username, transport_type } = req.body;
        if (!name || !phone) {
          return res.status(400).json({ status: 'error', message: 'Name and phone required' });
        }
        const response = await fetch('https://api.tookanapp.com/v2/add_agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            fleet_name: name,
            email: email || '',
            phone,
            password: password || phone,
            username: username || name.toLowerCase().replace(/\s/g, '_'),
            transport_type: transport_type || 0
          })
        });
        const data = await response.json();
        if (data.status !== 200) {
          return res.status(500).json({ status: 'error', message: data.message });
        }
        res.json({ status: 'success', message: 'Fleet added', data: data.data });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // WALLET ENDPOINTS
    // ============================================

    // POST Driver Wallet Balance
    app.post('/api/tookan/driver-wallet/balance', authenticate, async (req, res) => {
      try {
        const apiKey = getApiKey();
        const { fleet_id } = req.body;
        if (!fleet_id) {
          return res.status(400).json({ status: 'error', message: 'fleet_id required' });
        }
        const response = await fetch('https://api.tookanapp.com/v2/get_fleet_wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, fleet_id })
        });
        const data = await response.json();
        res.json({ status: 'success', data });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message, data: { balance: 0 } });
      }
    });

    // GET Customer Wallet Details
    app.get('/api/tookan/customer-wallet/details', authenticate, async (req, res) => {
      try {
        const apiKey = getApiKey();
        const { vendor_id } = req.query;
        if (!vendor_id) {
          return res.status(400).json({ status: 'error', message: 'vendor_id required' });
        }
        const response = await fetch('https://api.tookanapp.com/v2/get_customer_wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, vendor_id })
        });
        const data = await response.json();
        res.json({ status: 'success', data });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // TASK ENDPOINTS
    // ============================================

    // GET Task Details
    app.get('/api/tookan/task/:jobId', authenticate, async (req, res) => {
      try {
        const { jobId } = req.params;
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }
        const { data: task, error } = await supabase.from('tasks').select('*').eq('job_id', parseInt(jobId)).single();
        if (error || !task) {
          return res.status(404).json({ status: 'error', message: 'Task not found' });
        }
        res.json({ status: 'success', data: task });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // PUT Update Task COD
    app.put('/api/tookan/task/:jobId/cod', authenticate, requirePermission('edit_order_financials'), async (req, res) => {
      try {
        console.log('\n=== UPDATE TASK COD (Vercel) ===');
        const { jobId } = req.params;
        const { cod_amount, cod_collected } = req.body;
        const apiKey = getApiKey();
        const numericJobId = parseInt(jobId);

        // Build meta_data for Tookan
        const metaData = [];
        if (cod_amount !== undefined) {
          metaData.push({ label: 'COD_Amount', data: String(cod_amount) });
        }

        const tookanPayload = {
          api_key: apiKey,
          job_id: numericJobId,
          custom_field_template: 'Same_day'
        };
        if (metaData.length > 0) tookanPayload.meta_data = metaData;

        const response = await fetch('https://api.tookanapp.com/v2/edit_task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tookanPayload)
        });
        const data = await response.json();

        // Update database
        if (isSupabaseConfigured && supabase) {
          const updateData = { updated_at: new Date().toISOString() };
          if (cod_amount !== undefined) updateData.cod_amount = parseFloat(cod_amount);
          if (cod_collected !== undefined) updateData.cod_collected = cod_collected;
          await supabase.from('tasks').update(updateData).eq('job_id', numericJobId);
        }

        res.json({ status: 'success', message: 'COD updated', data: { jobId, tookan_status: data.status } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET Task History
    app.get('/api/tookan/task/:jobId/history', authenticate, async (req, res) => {
      try {
        const { jobId } = req.params;
        // In Vercel, we don't have task history storage - return empty
        res.json({ status: 'success', data: [] });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // COD QUEUE ENDPOINTS
    // ============================================

    // GET Driver COD Queue
    app.get('/api/cod/queue/:driverId', authenticate, async (req, res) => {
      try {
        const { driverId } = req.params;
        // Return empty queue for Vercel - COD queue is managed locally
        res.json({ status: 'success', data: { queue: [], total: 0 } });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // GET Pending COD for Driver
    app.get('/api/cod/queue/pending/:driverId', authenticate, async (req, res) => {
      try {
        // Return null for Vercel
        res.json({ status: 'success', data: null });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ============================================
    // USER PASSWORD ENDPOINT
    // ============================================

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
        console.log(`🗑️ Deleting tasks: ${connectedJobIds.join(', ')}`);

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

        // 4. Update status to 10 (Deleted) in Supabase (instead of deleting)
        const { error: updateError } = await supabase
          .from('tasks')
          .update({ status: 10, last_synced_at: new Date().toISOString() })
          .in('job_id', connectedJobIds);

        if (updateError) {
          console.error('Failed to update status in Supabase:', updateError);
        } else {
          console.log(`✅ Status set to 10 (Deleted) for tasks: ${connectedJobIds.join(', ')}`);
        }

        console.log('✅ Delete operation completed');
        console.log('=== END REQUEST (SUCCESS) ===\n');

        res.json({
          status: 'success',
          message: 'Tasks deleted successfully',
          data: { deletedIds: connectedJobIds, results }
        });

      } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // PUT Update User Password
    app.put('/api/users/:id/password', authenticate, async (req, res) => {
      try {
        const { id } = req.params;
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
          return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
        }
        if (!isSupabaseConfigured || !supabase) {
          return res.status(500).json({ status: 'error', message: 'Database not configured' });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const { error } = await supabase.from('users').update({ password_hash: hashedPassword }).eq('id', id);
        if (error) throw error;
        res.json({ status: 'success', message: 'Password updated' });
      } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    // ========== AGENT PAYMENT ENDPOINTS ==========

    // Record agent payment
    app.post('/api/agents/payment', authenticate, requirePermission('manage_wallets'), async (req, res) => {
      try {
        const { fleet_id, payment_amount } = req.body;
        // Note: cod_total from frontend is IGNORED - we calculate lifetime COD from database

        if (!fleet_id || payment_amount === undefined) {
          return res.status(400).json({
            status: 'error',
            message: 'Missing required fields: fleet_id and payment_amount'
          });
        }

        if (!isSupabaseConfigured || !supabase) {
          return res.status(503).json({
            status: 'error',
            message: 'Database not configured'
          });
        }

        const numericFleetId = parseInt(fleet_id);

        // Get current agent data
        const { data: agent, error: fetchError } = await supabase
          .from('agents')
          .select('fleet_id, name, total_paid, balance')
          .eq('fleet_id', numericFleetId)
          .single();

        if (fetchError || !agent) {
          return res.status(404).json({
            status: 'error',
            message: `Agent with fleet_id ${fleet_id} not found`
          });
        }

        // Calculate LIFETIME COD total from tasks table (completed deliveries only)
        // This ensures balance is always correct regardless of UI date filters
        const { data: codResult, error: codError } = await supabase
          .from('tasks')
          .select('cod_amount, pickup_address, delivery_address')
          .eq('fleet_id', numericFleetId)
          .eq('status', 2); // Completed status

        if (codError) {
          console.error('Error fetching COD total:', codError);
          throw codError;
        }

        // Sum COD amounts, filtering out pickup==delivery tasks (returns/pickups)
        const lifetimeCodTotal = (codResult || [])
          .filter(task => task.pickup_address !== task.delivery_address && parseFloat(task.cod_amount || 0) > 0)
          .reduce((sum, task) => sum + parseFloat(task.cod_amount || 0), 0);

        console.log(`📊 Agent ${numericFleetId} lifetime COD: ${lifetimeCodTotal}`);

        const currentPaid = parseFloat(agent.total_paid || 0);
        const newTotalPaid = currentPaid + parseFloat(payment_amount);

        // Calculate balance using LIFETIME COD total
        const newBalance = lifetimeCodTotal - newTotalPaid;

        const { data: updatedAgent, error: updateError } = await supabase
          .from('agents')
          .update({
            total_paid: newTotalPaid,
            balance: newBalance,
            updated_at: new Date().toISOString()
          })
          .eq('fleet_id', numericFleetId)
          .select()
          .single();

        if (updateError) throw updateError;

        res.json({
          status: 'success',
          message: 'Payment recorded successfully',
          data: {
            fleet_id: updatedAgent.fleet_id,
            name: updatedAgent.name,
            payment_amount: parseFloat(payment_amount),
            total_paid: updatedAgent.total_paid,
            balance: updatedAgent.balance,
            lifetime_cod_total: lifetimeCodTotal
          }
        });
      } catch (error) {
        console.error('Record agent payment error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to record payment'
        });
      }
    });

    // Update agent balance
    app.put('/api/agents/:fleetId/balance', authenticate, requirePermission('manage_wallets'), async (req, res) => {
      try {
        const { fleetId } = req.params;
        const { cod_total } = req.body;

        if (cod_total === undefined) {
          return res.status(400).json({
            status: 'error',
            message: 'Missing required field: cod_total'
          });
        }

        if (!isSupabaseConfigured || !supabase) {
          return res.status(503).json({
            status: 'error',
            message: 'Database not configured'
          });
        }

        const { data: agent, error: fetchError } = await supabase
          .from('agents')
          .select('fleet_id, name, total_paid, balance')
          .eq('fleet_id', parseInt(fleetId))
          .single();

        if (fetchError || !agent) {
          return res.status(404).json({
            status: 'error',
            message: `Agent with fleet_id ${fleetId} not found`
          });
        }

        const totalPaid = parseFloat(agent.total_paid || 0);
        const newBalance = parseFloat(cod_total) - totalPaid;

        const { data: updatedAgent, error: updateError } = await supabase
          .from('agents')
          .update({
            balance: newBalance,
            updated_at: new Date().toISOString()
          })
          .eq('fleet_id', parseInt(fleetId))
          .select()
          .single();

        if (updateError) throw updateError;

        res.json({
          status: 'success',
          message: 'Balance updated successfully',
          data: {
            fleet_id: updatedAgent.fleet_id,
            name: updatedAgent.name,
            total_paid: updatedAgent.total_paid,
            balance: updatedAgent.balance
          }
        });
      } catch (error) {
        console.error('Update agent balance error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to update balance'
        });
      }
    });

    // Get agent payment summary
    app.get('/api/agents/:fleetId/payment-summary', authenticate, async (req, res) => {
      try {
        const { fleetId } = req.params;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(503).json({
            status: 'error',
            message: 'Database not configured'
          });
        }

        const { data: agent, error } = await supabase
          .from('agents')
          .select('fleet_id, name, total_paid, balance')
          .eq('fleet_id', parseInt(fleetId))
          .single();

        if (error || !agent) {
          return res.status(404).json({
            status: 'error',
            message: `Agent with fleet_id ${fleetId} not found`
          });
        }

        res.json({
          status: 'success',
          data: agent
        });
      } catch (error) {
        console.error('Get agent payment summary error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to get payment summary'
        });
      }
    });

    // Get daily COD totals for a driver
    app.get('/api/agents/:fleetId/daily-cod', authenticate, async (req, res) => {
      try {
        const { fleetId } = req.params;
        const { dateFrom, dateTo } = req.query;

        if (!isSupabaseConfigured || !supabase) {
          return res.status(503).json({
            status: 'error',
            message: 'Database not configured'
          });
        }

        let query = supabase
          .from('tasks')
          .select('creation_datetime, cod_amount, status, pickup_address, delivery_address, paid, balance')
          .eq('fleet_id', parseInt(fleetId))
          .eq('status', 2);  // Completed deliveries only

        if (dateFrom) {
          query = query.gte('creation_datetime', dateFrom);
        }
        if (dateTo) {
          query = query.lte('creation_datetime', dateTo + 'T23:59:59');
        }

        const { data: tasks, error } = await query;

        if (error) throw error;

        // Group by date and sum COD, paid, balance, filtering pickup != delivery
        const dailyTotals = {};
        (tasks || []).forEach(task => {
          if (task.creation_datetime &&
            task.pickup_address !== task.delivery_address &&
            task.cod_amount && parseFloat(task.cod_amount) > 0) {
            const date = task.creation_datetime.split('T')[0];
            if (!dailyTotals[date]) {
              dailyTotals[date] = { date, codReceived: 0, paidTotal: 0, balanceTotal: 0, orderCount: 0 };
            }
            dailyTotals[date].codReceived += parseFloat(task.cod_amount);
            dailyTotals[date].paidTotal += parseFloat(task.paid || 0);
            dailyTotals[date].balanceTotal += parseFloat(task.balance || 0);
            dailyTotals[date].orderCount++;
          }
        });

        const sortedDays = Object.values(dailyTotals).sort((a, b) => a.date.localeCompare(b.date));

        res.json({
          status: 'success',
          data: sortedDays
        });
      } catch (error) {
        console.error('Get daily COD error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to get daily COD'
        });
      }
    });

    // Update task payment (paid amount and cod_collected status)
    app.put('/api/tasks/:jobId/payment', authenticate, requirePermission('manage_wallets'), async (req, res) => {
      try {
        const { jobId } = req.params;
        const { paid, cod_collected } = req.body;

        if (paid === undefined) {
          return res.status(400).json({
            status: 'error',
            message: 'Missing required field: paid'
          });
        }

        if (!isSupabaseConfigured || !supabase) {
          return res.status(503).json({
            status: 'error',
            message: 'Database not configured'
          });
        }

        const numericJobId = parseInt(jobId);
        const numericPaid = parseFloat(paid);

        // Build update object with paid and optionally cod_collected
        const updateData = {
          paid: numericPaid,
          updated_at: new Date().toISOString()
        };

        // Only include cod_collected if explicitly provided
        if (cod_collected !== undefined) {
          updateData.cod_collected = Boolean(cod_collected);
        }

        // Update the task's paid column and cod_collected - balance is auto-calculated by Supabase
        const { data: updatedTask, error } = await supabase
          .from('tasks')
          .update(updateData)
          .eq('job_id', numericJobId)
          .select('job_id, cod_amount, paid, balance, cod_collected')
          .single();

        if (error) {
          console.error('Update task payment error:', error);
          throw error;
        }

        if (!updatedTask) {
          return res.status(404).json({
            status: 'error',
            message: `Task with job_id ${jobId} not found`
          });
        }

        console.log(`💰 Updated task ${numericJobId}: paid=${numericPaid}, balance=${updatedTask.balance}, cod_collected=${updatedTask.cod_collected}`);

        res.json({
          status: 'success',
          message: 'Task payment updated',
          data: updatedTask
        });
      } catch (error) {
        console.error('Update task payment error:', error);
        res.status(500).json({
          status: 'error',
          message: error.message || 'Failed to update task payment'
        });
      }
    });

    // ========== USER MANAGEMENT ENDPOINTS ==========

    // GET all users (Superadmin only)
    app.get('/api/users', authenticate, requireSuperadmin(), async (req, res) => {
      try {
        const { role, search } = req.query;
        const filters = {};
        if (role) filters.role = role;
        if (search) filters.search = search;

        const users = await userModel.getAllUsers(filters);

        const transformedUsers = users.map(user => {
          const rawStatus = (user.status || 'active').toString().toLowerCase();
          return {
            id: user.id,
            email: user.email,
            name: user.name || user.email,
            role: user.role || 'user',
            permissions: user.permissions || {},
            status: rawStatus,
            lastLogin: user.last_login || null,
            createdAt: user.created_at,
            updatedAt: user.updated_at
          };
        });

        res.json({
          status: 'success',
          message: 'Users fetched successfully',
          data: { users: transformedUsers, total: transformedUsers.length }
        });
      } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Failed to fetch users', data: {} });
      }
    });

    // PUT Update User (Superadmin only)
    app.put('/api/users/:id', authenticate, requireSuperadmin(), async (req, res) => {
      try {
        const { id } = req.params;
        const { name, email, role, permissions } = req.body;

        const oldUser = await userModel.getUserById(id);

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email;
        if (role !== undefined) updateData.role = role;
        if (permissions !== undefined) updateData.permissions = permissions;

        const updatedUser = await userModel.updateUser(id, updateData);

        await auditLogger.createAuditLog(
          req, 'user_update', 'user', id,
          oldUser ? { name: oldUser.name, email: oldUser.email, role: oldUser.role, permissions: oldUser.permissions } : null,
          { name: updatedUser.name, email: updatedUser.email, role: updatedUser.role, permissions: updatedUser.permissions }
        );

        res.json({
          status: 'success',
          message: 'User updated successfully',
          data: { user: { id: updatedUser.id, email: updatedUser.email, name: updatedUser.name, role: updatedUser.role, permissions: updatedUser.permissions || {} } }
        });
      } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Failed to update user', data: {} });
      }
    });

    // PUT Update User Permissions (Superadmin only)
    app.put('/api/users/:id/permissions', authenticate, requireSuperadmin(), async (req, res) => {
      try {
        const { id } = req.params;
        const { permissions } = req.body;

        if (!permissions || typeof permissions !== 'object') {
          return res.status(400).json({ status: 'error', message: 'Permissions object is required', data: {} });
        }

        const oldUser = await userModel.getUserById(id);
        const updatedUser = await userModel.updateUserPermissions(id, permissions);

        await auditLogger.createAuditLog(
          req, 'user_permissions_update', 'user', id,
          oldUser ? { permissions: oldUser.permissions || {} } : null,
          { permissions: updatedUser.permissions || {} }
        );

        res.json({
          status: 'success',
          message: 'User permissions updated successfully',
          data: { user: { id: updatedUser.id, email: updatedUser.email, permissions: updatedUser.permissions || {} } }
        });
      } catch (error) {
        console.error('Update permissions error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Failed to update permissions', data: {} });
      }
    });

    // PUT Update User Role (Superadmin only)
    app.put('/api/users/:id/role', authenticate, requireSuperadmin(), async (req, res) => {
      try {
        const { id } = req.params;
        const { role } = req.body;

        if (!role) {
          return res.status(400).json({ status: 'error', message: 'Role is required', data: {} });
        }

        const validRoles = ['admin', 'user', 'finance', 'staff'];
        if (!validRoles.includes(role)) {
          return res.status(400).json({ status: 'error', message: `Invalid role. Must be one of: ${validRoles.join(', ')}`, data: {} });
        }

        const oldUser = await userModel.getUserById(id);
        const updatedUser = await userModel.updateUserRole(id, role);

        await auditLogger.createAuditLog(
          req, 'user_role_update', 'user', id,
          oldUser ? { role: oldUser.role } : null,
          { role: updatedUser.role }
        );

        res.json({
          status: 'success',
          message: 'User role updated successfully',
          data: { user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role } }
        });
      } catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Failed to update role', data: {} });
      }
    });

    // PUT Update User Status (Superadmin only)
    app.put('/api/users/:id/status', authenticate, requireSuperadmin(), async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
          return res.status(400).json({ status: 'error', message: 'Status is required. Valid values: active, disabled, banned', data: {} });
        }

        if (req.userId === id) {
          return res.status(400).json({ status: 'error', message: 'You cannot change your own status', data: {} });
        }

        const user = await userModel.getUserById(id);
        if (!user) {
          return res.status(404).json({ status: 'error', message: 'User not found', data: {} });
        }

        const updatedUser = await userModel.updateUserStatus(id, status);

        await auditLogger.createAuditLog(
          req, 'user_status_update', 'user', id,
          { status: user.status || 'active' },
          { status: status }
        );

        res.json({
          status: 'success',
          action: 'update_user_status',
          entity: 'user',
          message: `User ${status === 'active' ? 'enabled' : status === 'banned' ? 'banned' : 'disabled'} successfully`,
          data: { id: updatedUser.id, email: updatedUser.email, status: updatedUser.status }
        });
      } catch (error) {
        console.error('Update user status error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Failed to update user status', data: {} });
      }
    });

    // PUT Update User Password (Superadmin or self)
    app.put('/api/users/:id/password', authenticate, async (req, res) => {
      try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
          return res.status(400).json({ status: 'error', message: 'Password is required and must be at least 6 characters', data: {} });
        }

        const currentUser = await userModel.getUserById(req.userId);
        if (!currentUser) {
          return res.status(401).json({ status: 'error', message: 'Unauthorized', data: {} });
        }

        if (currentUser.role !== 'admin' && id !== req.userId) {
          return res.status(403).json({ status: 'error', message: 'You can only change your own password, unless you are an admin', data: {} });
        }

        if (!isSupabaseConfigured || !supabaseAnon) {
          return res.status(503).json({ status: 'error', message: 'Database not configured', data: {} });
        }

        const { error: updateError } = await supabaseAnon.auth.admin.updateUserById(id, { password: newPassword });

        if (updateError) {
          return res.status(500).json({ status: 'error', message: updateError.message || 'Failed to update password', data: {} });
        }

        await auditLogger.createAuditLog(req, 'user_password_change', 'user', id, null, { changed: true });

        res.json({ status: 'success', message: 'Password updated successfully', data: { userId: id } });
      } catch (error) {
        console.error('Update password error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Failed to update password', data: {} });
      }
    });

    // DELETE User (Superadmin only)
    app.delete('/api/users/:id', authenticate, requireSuperadmin(), async (req, res) => {
      try {
        const { id } = req.params;

        if (id === req.userId) {
          return res.status(400).json({ status: 'error', message: 'You cannot delete your own account', data: {} });
        }

        const user = await userModel.getUserById(id);
        if (!user) {
          return res.status(404).json({ status: 'error', message: 'User not found', data: {} });
        }

        if (user.role === 'admin') {
          return res.status(400).json({ status: 'error', message: 'Admin users cannot be deleted', data: {} });
        }

        if (!isSupabaseConfigured || !supabaseAnon) {
          return res.status(503).json({ status: 'error', message: 'Database not configured', data: {} });
        }

        const { error: deleteError } = await supabaseAnon.auth.admin.deleteUser(id);

        if (deleteError) {
          return res.status(500).json({ status: 'error', message: deleteError.message || 'Failed to delete user', data: {} });
        }

        await auditLogger.createAuditLog(req, 'user_delete', 'user', id, { email: user.email, name: user.name, role: user.role }, null);

        res.json({ status: 'success', message: 'User deleted successfully', data: { deletedUserId: id } });
      } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Failed to delete user', data: {} });
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



