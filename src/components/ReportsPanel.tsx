/// <reference types="vite/client" />
import React from 'react';
import { useState, useEffect } from 'react';
import { Search, RefreshCw, AlertCircle, Package, Users, Truck } from 'lucide-react';
import { fetchReportsTotals } from '../services/tookanApi';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const getAuthHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

export function ReportsPanel() {
  // Search states
  const [orderSearch, setOrderSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');

  // Results states
  const [orderResult, setOrderResult] = useState<any | null>(null);
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [driverResults, setDriverResults] = useState<any[]>([]);

  // Loading states
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [loadingDriver, setLoadingDriver] = useState(false);

  // Totals state
  const [totals, setTotals] = useState({ orders: 0, drivers: 0, customers: 0, deliveries: 0 });

  // Error states
  const [orderError, setOrderError] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [driverError, setDriverError] = useState<string | null>(null);

  // Load totals on mount
  useEffect(() => {
    loadTotals();
  }, []);

  const loadTotals = async () => {
    try {
      const result = await fetchReportsTotals();
      if (result.status === 'success' && result.data?.totals) {
        setTotals(result.data.totals);
      }
    } catch (err) {
      console.error('Failed to load totals:', err);
    }
  };

  // Search Order by job_id via backend API
  const searchOrder = async () => {
    if (!orderSearch.trim()) {
      setOrderResult(null);
      setOrderError(null);
      return;
    }

    setLoadingOrder(true);
    setOrderError(null);
    setOrderResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/search/order/${orderSearch.trim()}`, {
        headers: getAuthHeaders()
      });
      const result = await response.json();

      if (result.status === 'success') {
        if (result.data) {
          setOrderResult(result.data);
        } else {
          setOrderError('Order not found');
        }
      } else {
        setOrderError(result.message || 'Search failed');
      }
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoadingOrder(false);
    }
  };

  // Search Customers via backend API
  const searchCustomer = async () => {
    if (!customerSearch.trim()) {
      setCustomerResults([]);
      setCustomerError(null);
      return;
    }

    setLoadingCustomer(true);
    setCustomerError(null);
    setCustomerResults([]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/search/customers?q=${encodeURIComponent(customerSearch.trim())}`, {
        headers: getAuthHeaders()
      });
      const result = await response.json();

      if (result.status === 'success') {
        setCustomerResults(result.data || []);
      } else {
        setCustomerError(result.message || 'Search failed');
      }
    } catch (err) {
      setCustomerError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoadingCustomer(false);
    }
  };

  // Search Drivers via backend API
  const searchDriver = async () => {
    if (!driverSearch.trim()) {
      setDriverResults([]);
      setDriverError(null);
      return;
    }

    setLoadingDriver(true);
    setDriverError(null);
    setDriverResults([]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/search/drivers?q=${encodeURIComponent(driverSearch.trim())}`, {
        headers: getAuthHeaders()
      });
      const result = await response.json();

      if (result.status === 'success') {
        setDriverResults(result.data || []);
      } else {
        setDriverError(result.message || 'Search failed');
      }
    } catch (err) {
      setDriverError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoadingDriver(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent, searchFn: () => void) => {
    if (e.key === 'Enter') {
      searchFn();
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading text-3xl mb-2">Reports Panel</h1>
          <p className="text-subheading dark:text-[#99BFD1]">Search orders, customers, and drivers</p>
        </div>
        <button
          onClick={loadTotals}
          className="flex items-center gap-2 px-6 py-3 bg-card border border-border rounded-xl hover:bg-hover-bg-light dark:hover:bg-[#223560] transition-all text-heading dark:text-[#C1EEFA]"
        >
          <RefreshCw className="w-5 h-5" />
          Refresh Totals
        </button>
      </div>

      {/* Totals Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Total Orders</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.orders.toLocaleString()}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Total Drivers</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.drivers.toLocaleString()}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Total Customers</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.customers.toLocaleString()}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Completed Deliveries</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.deliveries.toLocaleString()}</div>
        </div>
      </div>

      {/* Three Search Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Order Search */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-primary" />
            <h3 className="text-heading dark:text-[#C1EEFA] text-lg font-semibold">Search Order</h3>
          </div>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              onKeyPress={(e) => handleKeyPress(e, searchOrder)}
              placeholder="Enter Job ID..."
              className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-heading dark:text-[#C1EEFA] placeholder:text-muted-light focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              onClick={searchOrder}
              disabled={loadingOrder}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {loadingOrder ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            </button>
          </div>

          {orderError && (
            <div className="flex items-center gap-2 text-destructive text-sm mb-2">
              <AlertCircle className="w-4 h-4" />
              {orderError}
            </div>
          )}

          {orderResult && (
            <div className="text-center py-4 text-green-500 text-sm font-medium">
              Order found! See details below.
            </div>
          )}

          {!orderResult && !orderError && !loadingOrder && (
            <div className="text-center py-4 text-muted-light text-sm">
              Enter a Job ID to search
            </div>
          )}

          {!orderResult && !orderError && !loadingOrder && (
            <div className="text-center py-4 text-muted-light text-sm">
              Enter a Job ID to search for an order
            </div>
          )}
        </div>

        {/* Customer Search */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-primary" />
            <h3 className="text-heading dark:text-[#C1EEFA] text-lg font-semibold">Search Customer</h3>
          </div>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              onKeyPress={(e) => handleKeyPress(e, searchCustomer)}
              placeholder="ID, Name, or Phone..."
              className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-heading dark:text-[#C1EEFA] placeholder:text-muted-light focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              onClick={searchCustomer}
              disabled={loadingCustomer}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {loadingCustomer ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            </button>
          </div>

          {customerError && (
            <div className="flex items-center gap-2 text-destructive text-sm mb-2">
              <AlertCircle className="w-4 h-4" />
              {customerError}
            </div>
          )}

          {customerResults.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {customerResults.map((customer, idx) => (
                <div key={idx} className="border border-border rounded-lg p-3 text-sm">
                  <div className="font-medium text-heading dark:text-[#C1EEFA]">{customer.name || 'Unknown'}</div>
                  <div className="text-muted-light">ID: {customer.id || '—'}</div>
                  <div className="text-muted-light">Phone: {customer.phone || '—'}</div>
                </div>
              ))}
            </div>
          )}

          {customerResults.length === 0 && !customerError && !loadingCustomer && (
            <div className="text-center py-4 text-muted-light text-sm">
              Search by ID, name, or phone number
            </div>
          )}
        </div>

        {/* Driver Search */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Truck className="w-5 h-5 text-primary" />
            <h3 className="text-heading dark:text-[#C1EEFA] text-lg font-semibold">Search Driver</h3>
          </div>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={driverSearch}
              onChange={(e) => setDriverSearch(e.target.value)}
              onKeyPress={(e) => handleKeyPress(e, searchDriver)}
              placeholder="ID or Name..."
              className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-heading dark:text-[#C1EEFA] placeholder:text-muted-light focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              onClick={searchDriver}
              disabled={loadingDriver}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {loadingDriver ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            </button>
          </div>

          {driverError && (
            <div className="flex items-center gap-2 text-destructive text-sm mb-2">
              <AlertCircle className="w-4 h-4" />
              {driverError}
            </div>
          )}

          {driverResults.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {driverResults.map((driver, idx) => (
                <div key={idx} className="border border-border rounded-lg p-3 text-sm">
                  <div className="font-medium text-heading dark:text-[#C1EEFA]">{driver.name || 'Unknown'}</div>
                  <div className="text-muted-light">Fleet ID: {driver.fleet_id || '—'}</div>
                  <div className="text-muted-light">Phone: {driver.phone || '—'}</div>
                  <div className="text-muted-light">Email: {driver.email || '—'}</div>
                  <div className={`text-xs mt-1 ${driver.is_active ? 'text-green-500' : 'text-red-500'}`}>
                    {driver.is_active ? 'Active' : 'Inactive'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {driverResults.length === 0 && !driverError && !loadingDriver && (
            <div className="text-center py-4 text-muted-light text-sm">
              Search by Driver ID or name
            </div>
          )}
        </div>
      </div>

      {/* Order Search Results Table */}
      {orderResult && (
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <h3 className="text-heading dark:text-[#C1EEFA] text-lg font-semibold mb-4">Order Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/30 dark:bg-[#1A2C53]">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Order ID</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Date/Time Delivered</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Driver ID</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Driver Name</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Customer Name</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Customer Phone</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Pickup Address</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Delivery Address</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">COD</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Order Fees</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-heading dark:text-[#C1EEFA]">Order ID</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border hover:bg-muted/10 dark:hover:bg-[#1A2C53]/50">
                  <td className="px-4 py-3 text-heading dark:text-[#C1EEFA] font-medium">{orderResult.job_id || orderResult.order_id || '—'}</td>
                  <td className="px-4 py-3 text-muted-light dark:text-[#99BFD1]">
                    {(() => {
                      const dateStr = orderResult.completed_datetime || orderResult.job_delivery_datetime;
                      if (!dateStr) return '—';
                      // Handle ISO string with 'T' or space
                      const parts = dateStr.split(/[T ]/);
                      return (
                        <div className="flex flex-col">
                          <span>{parts[0]}</span>
                          {parts[1] && <span className="opacity-70">{parts[1]}</span>}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-muted-light dark:text-[#99BFD1]">{orderResult.fleet_id || '—'}</td>
                  <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{orderResult.fleet_name || '—'}</td>
                  <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{orderResult.customer_name || '—'}</td>
                  <td className="px-4 py-3 text-muted-light dark:text-[#99BFD1]">{orderResult.customer_phone || '—'}</td>
                  <td className="px-4 py-3 text-muted-light dark:text-[#99BFD1] max-w-[200px] truncate" title={orderResult.pickup_address}>
                    {orderResult.pickup_address || '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-light dark:text-[#99BFD1] max-w-[200px] truncate" title={orderResult.delivery_address}>
                    {orderResult.delivery_address || '—'}
                  </td>
                  <td className="px-4 py-3 text-heading dark:text-[#C1EEFA] font-medium">
                    ${parseFloat(orderResult.total_amount || orderResult.cod || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">
                    ${parseFloat(orderResult.order_fees || orderResult.delivery_charge || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-heading dark:text-[#C1EEFA] font-medium">{orderResult.order_id || '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
