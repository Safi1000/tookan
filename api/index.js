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
    
    app = express();
    
    // Middleware
    app.use(cors());
    app.use(express.json());
    
    // Import all the route handlers from server/index.js
    // For Vercel, we'll include the essential routes inline
    
    const getApiKey = () => {
      const apiKey = process.env.TOOKAN_API_KEY;
      if (!apiKey) {
        throw new Error('TOOKAN_API_KEY not configured in environment variables');
      }
      return apiKey;
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
        console.log('Webhook received:', JSON.stringify(req.body, null, 2));
        
        const { job_id, event_type, job_status, template_fields } = req.body;
        
        // For Vercel, we'll store webhook data in Supabase
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        
        if (supabaseUrl && supabaseKey) {
          await fetch(`${supabaseUrl}/rest/v1/webhook_events`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify({
              event_type: event_type || 'unknown',
              job_id: job_id,
              payload: req.body,
              status: 'pending'
            })
          });
        }

        res.json({
          status: 'success',
          message: 'Webhook received',
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

    // Get orders from Tookan
    app.get('/api/tookan/orders', async (req, res) => {
      try {
        const apiKey = getApiKey();
        const { dateFrom, dateTo, limit = 100 } = req.query;
        
        const response = await fetch('https://api.tookanapp.com/v2/get_all_tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            job_status: '0,1,2,3,4,5,6,7,8,9',
            start_date: dateFrom || undefined,
            end_date: dateTo || undefined,
            limit: parseInt(limit)
          })
        });
        const data = await response.json();
        
        // Ensure orders is always an array
        const orders = Array.isArray(data.data) ? data.data : 
                       Array.isArray(data.tasks) ? data.tasks : 
                       Array.isArray(data) ? data : [];
        
        if (data.status === 200 || orders.length > 0) {
          res.json({
            status: 'success',
            message: 'Orders fetched successfully',
            data: { orders: orders, total: orders.length }
          });
        } else {
          res.json({
            status: 'error',
            message: data.message || 'Failed to fetch orders',
            data: { orders: [], total: 0 }
          });
        }
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
        
        // Fetch data from Tookan
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
              job_status: '0,1,2,3,4,5,6,7,8,9',
              limit: 100
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
        
        res.json({
          status: 'success',
          message: 'Analytics fetched successfully',
          data: {
            kpis: {
              totalOrders: tasks.length,
              totalDrivers: fleets.length,
              totalMerchants: customers.length,
              pendingCOD: pendingCOD,
              driversWithPending: 0,
              completedDeliveries: completedTasks.length
            },
            trends: {
              orders: '+0%',
              drivers: '+0%',
              merchants: '+0%',
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
            kpis: { totalOrders: 0, totalDrivers: 0, totalMerchants: 0, pendingCOD: 0, driversWithPending: 0, completedDeliveries: 0 },
            trends: { orders: '+0%', drivers: '+0%', merchants: '+0%', pendingCOD: '+0%', driversPending: '+0%', completed: '+0%' },
            codStatus: [],
            orderVolume: [],
            driverPerformance: []
          }
        });
      }
    });

    // Customer wallet endpoint
    app.post('/api/tookan/customer-wallet/payment', async (req, res) => {
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
    app.post('/api/tookan/driver-wallet/transaction', async (req, res) => {
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

          // Generate session token
          const sessionToken = Buffer.from(`${userId}:${Date.now()}:${userEmail}`).toString('base64');
          const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

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

