import { useState, useEffect, useMemo } from 'react';
import { Search, Download, Calendar, CheckCircle, XCircle, Settings2, X, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { fetchAllOrders, fetchAllDrivers, fetchAllCustomers, fetchReportsSummary, type OrderFilters, type DriverSummary, type MerchantSummary } from '../services/tookanApi';
import { usePermissions, PERMISSIONS, PermissionGate } from '../contexts/PermissionContext';

const columnDefinitions = [
  { key: 'id', label: 'Order ID' },
  { key: 'date', label: 'Date' },
  { key: 'merchant', label: 'Merchant' },
  { key: 'merchantNumber', label: 'Merchant Number' },
  { key: 'driver', label: 'Driver' },
  { key: 'customer', label: 'Customer' },
  { key: 'customerNumber', label: 'Customer Number' },
  { key: 'cod', label: 'COD' },
  { key: 'codCollected', label: 'COD Collected' },
  { key: 'tookanFees', label: 'Tookan Fees' },
  { key: 'fee', label: 'Order Fee' },
  { key: 'status', label: 'Status' },
  { key: 'addresses', label: 'Addresses' },
];

export function ReportsPanel() {
  const { hasPermission } = usePermissions();
  const [orderIdSearch, setOrderIdSearch] = useState('');
  const [unifiedCustomerSearch, setUnifiedCustomerSearch] = useState('');
  const [unifiedMerchantSearch, setUnifiedMerchantSearch] = useState('');
  const [unifiedDriverSearch, setUnifiedDriverSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  // Data state
  const [orders, setOrders] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [driverSummaries, setDriverSummaries] = useState<DriverSummary[]>([]);
  const [merchantSummaries, setMerchantSummaries] = useState<MerchantSummary[]>([]);
  const [totals, setTotals] = useState({ orders: 0, drivers: 0, merchants: 0, deliveries: 0 });
  
  // Loading and error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    columnDefinitions.reduce((acc, col) => ({ ...acc, [col.key]: true }), {})
  );
  const [showColumnManager, setShowColumnManager] = useState(false);

  // Combined search term for server-side filtering
  const combinedSearch = useMemo(() => {
    const searchTerms = [];
    if (orderIdSearch.trim()) searchTerms.push(orderIdSearch.trim());
    if (unifiedCustomerSearch.trim()) searchTerms.push(unifiedCustomerSearch.trim());
    if (unifiedMerchantSearch.trim()) searchTerms.push(unifiedMerchantSearch.trim());
    if (unifiedDriverSearch.trim()) searchTerms.push(unifiedDriverSearch.trim());
    return searchTerms.join(' ') || undefined;
  }, [orderIdSearch, unifiedCustomerSearch, unifiedMerchantSearch, unifiedDriverSearch]);

  // Fetch data on mount and when filters change
  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, combinedSearch]); // Reload when date filters or search change

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Build filters (include search for server-side filtering)
      const filters: OrderFilters = {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: combinedSearch,
        limit: 1000,
        page: 1
      };

      // Fetch orders
      const ordersResult = await fetchAllOrders(filters);
      if (ordersResult.status === 'success' && ordersResult.data) {
        setOrders(ordersResult.data.orders || []);
      }

      // Fetch drivers
      const driversResult = await fetchAllDrivers();
      if (driversResult.status === 'success' && driversResult.data) {
        setDrivers(driversResult.data.fleets || []);
      }

      // Fetch customers
      const customersResult = await fetchAllCustomers();
      if (customersResult.status === 'success' && customersResult.data) {
        setCustomers(customersResult.data.customers || []);
      }

      // Fetch reports summary (now returns real data from backend)
      const summaryResult = await fetchReportsSummary({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined
      });
      if (summaryResult.status === 'success' && summaryResult.data) {
        // Use API summaries if available
        if (summaryResult.data.driverSummaries && summaryResult.data.driverSummaries.length > 0) {
          setDriverSummaries(summaryResult.data.driverSummaries.map(d => ({
            driverId: d.driverId,
            driverName: d.driverName,
            orderCount: d.totalOrders,
            codTotal: d.codTotal,
            orderFees: d.feesTotal,
            totalValue: d.codTotal + d.feesTotal,
            avgDeliveryTime: d.averageDeliveryTime
          })));
        }
        
        if (summaryResult.data.merchantSummaries && summaryResult.data.merchantSummaries.length > 0) {
          setMerchantSummaries(summaryResult.data.merchantSummaries.map(m => ({
            merchantId: m.merchantId,
            merchantName: m.merchantName,
            orderCount: m.totalOrders,
            codReceived: m.codTotal,
            orderFees: m.feesTotal,
            revenue: m.codTotal + m.feesTotal
          })));
        }
        
        if (summaryResult.data.totals) {
          setTotals(summaryResult.data.totals);
        }
      }

      // Also calculate summaries from orders as fallback/enhancement
      const fetchedOrders = ordersResult.status === 'success' && ordersResult.data ? ordersResult.data.orders || [] : [];
      if (fetchedOrders.length > 0) {
        // Only calculate if API didn't provide summaries, or enhance existing data
        if (!summaryResult.data?.driverSummaries || summaryResult.data.driverSummaries.length === 0) {
          calculateSummaries(fetchedOrders);
        }
        
        // Update totals from actual fetched data
        if (fetchedOrders.length > 0) {
          setTotals(prev => ({
            orders: fetchedOrders.length,
            drivers: driversResult.status === 'success' ? (driversResult.data?.fleets?.length || 0) : prev.drivers,
            merchants: customersResult.status === 'success' ? (customersResult.data?.customers?.length || 0) : prev.merchants,
            deliveries: fetchedOrders.filter((o: any) => [6, 7, 8].includes(parseInt(o.status))).length
          }));
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load data';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate driver and merchant summaries from order data
  const calculateSummaries = (orderData: any[]) => {
    // Driver summaries
    const driverMap = new Map<string, {
      driverId: string;
      driverName: string;
      orders: any[];
      codTotal: number;
      feesTotal: number;
      deliveryTimes: number[];
    }>();

    orderData.forEach((order: any) => {
      const driverId = order.driverId || order.fleet_id || 'unknown';
      const driverName = order.driver || order.driverName || 'Unknown Driver';
      
      if (!driverMap.has(driverId)) {
        driverMap.set(driverId, {
          driverId,
          driverName,
          orders: [],
          codTotal: 0,
          feesTotal: 0,
          deliveryTimes: []
        });
      }

      const driverData = driverMap.get(driverId)!;
      driverData.orders.push(order);
      
      const cod = parseFloat(order.cod?.replace('$', '') || order.codAmount || 0);
      const fee = parseFloat(order.fee?.replace('$', '') || order.orderFees || 0);
      
      driverData.codTotal += cod;
      driverData.feesTotal += fee;
      
      if (order.deliveryTime && order.deliveryTime !== '-') {
        const timeMatch = order.deliveryTime.match(/(\d+)/);
        if (timeMatch) {
          driverData.deliveryTimes.push(parseInt(timeMatch[1]));
        }
      }
    });

    const driverSummariesData: DriverSummary[] = Array.from(driverMap.values()).map(driver => ({
      driverId: driver.driverId,
      driverName: driver.driverName,
      orderCount: driver.orders.length,
      codTotal: driver.codTotal,
      orderFees: driver.feesTotal,
      totalValue: driver.codTotal + driver.feesTotal,
      avgDeliveryTime: driver.deliveryTimes.length > 0
        ? driver.deliveryTimes.reduce((a, b) => a + b, 0) / driver.deliveryTimes.length
        : 0
    }));

    setDriverSummaries(driverSummariesData);

    // Merchant summaries
    const merchantMap = new Map<string, {
      merchantId: string;
      merchantName: string;
      orders: any[];
      codReceived: number;
      feesTotal: number;
    }>();

    orderData.forEach((order: any) => {
      const merchantId = order.merchantId || order.merchant || 'unknown';
      const merchantName = order.merchant || 'Unknown Merchant';
      
      if (!merchantMap.has(merchantId)) {
        merchantMap.set(merchantId, {
          merchantId,
          merchantName,
          orders: [],
          codReceived: 0,
          feesTotal: 0
        });
      }

      const merchantData = merchantMap.get(merchantId)!;
      merchantData.orders.push(order);
      
      const cod = parseFloat(order.cod?.replace('$', '') || order.codAmount || 0);
      const fee = parseFloat(order.fee?.replace('$', '') || order.orderFees || 0);
      
      merchantData.codReceived += cod;
      merchantData.feesTotal += fee;
    });

    const merchantSummariesData: MerchantSummary[] = Array.from(merchantMap.values()).map(merchant => ({
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName,
      orderCount: merchant.orders.length,
      codReceived: merchant.codReceived,
      orderFees: merchant.feesTotal,
      revenue: merchant.codReceived + merchant.feesTotal
    }));

    setMerchantSummaries(merchantSummariesData);
  };

  // Filter orders based on search criteria
  const filteredOrders = useMemo(() => {
    let filtered = orders;

    // Filter by order ID
    if (orderIdSearch.trim()) {
      filtered = filtered.filter(order => 
        (order.id || order.orderId || '').toLowerCase().includes(orderIdSearch.toLowerCase())
      );
    }

    // Filter by customer (ID, name, or phone)
    if (unifiedCustomerSearch.trim()) {
      const searchLower = unifiedCustomerSearch.toLowerCase();
      filtered = filtered.filter(order => 
        (order.customer || order.customerName || '').toLowerCase().includes(searchLower) ||
        (order.customerNumber || order.customerPhone || '').toLowerCase().includes(searchLower) ||
        (order.customerId || '').toLowerCase().includes(searchLower)
      );
    }

    // Filter by merchant (ID, name, or phone)
    if (unifiedMerchantSearch.trim()) {
      const searchLower = unifiedMerchantSearch.toLowerCase();
      filtered = filtered.filter(order => 
        (order.merchant || order.merchantName || '').toLowerCase().includes(searchLower) ||
        (order.merchantNumber || order.merchantPhone || '').toLowerCase().includes(searchLower) ||
        (order.merchantId || '').toLowerCase().includes(searchLower)
      );
    }

    // Filter by driver (ID, name, or phone)
    if (unifiedDriverSearch.trim()) {
      const searchLower = unifiedDriverSearch.toLowerCase();
      filtered = filtered.filter(order => 
        (order.driver || order.driverName || '').toLowerCase().includes(searchLower) ||
        (order.driverId || order.fleet_id || '').toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  }, [orders, orderIdSearch, unifiedCustomerSearch, unifiedMerchantSearch, unifiedDriverSearch]);

  // Mock validation states for auto-suggest
  const getValidationColor = (value: string) => {
    if (!value) return 'border-[#2A3C63] dark:border-[#2A3C63]';
    return value.length > 3 
      ? 'border-[#C1EEFA] shadow-[0_0_8px_rgba(193,238,250,0.3)]' 
      : 'border-[#DE3544] shadow-[0_0_8px_rgba(222,53,68,0.3)]';
  };

  const toggleColumn = (key: string) => {
    setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getOrderValue = (order: any, key: string) => {
    switch (key) {
      case 'id': return order.id || order.orderId || '';
      case 'date': return order.date || order.orderDate || '';
      case 'merchant': return order.merchant || order.merchantName || '';
      case 'merchantNumber': return order.merchantNumber || order.merchantPhone || '';
      case 'driver': return order.driver || order.driverName || '';
      case 'customer': return order.customer || order.customerName || '';
      case 'customerNumber': return order.customerNumber || order.customerPhone || '';
      case 'cod': return order.cod || `$${order.codAmount || 0}`;
      case 'codCollected': return order.codCollected === true ? 'Yes' : order.codCollected === false ? 'No' : 'N/A';
      case 'tookanFees': return order.tookanFees || '$0.00';
      case 'fee': return order.fee || `$${order.orderFees || 0}`;
      case 'status': return order.status || 'Unknown';
      case 'addresses': return { pickup: order.pickup || order.pickupAddress || '', dropoff: order.dropoff || order.deliveryAddress || '' };
      default: return '';
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading text-3xl mb-2">Reports Panel</h1>
          <p className="text-subheading dark:text-[#99BFD1]">Generate reports collectively or individually</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={loadData}
            disabled={isLoading}
            className="flex items-center gap-2 px-6 py-3 bg-card border border-border rounded-xl hover:bg-hover-bg-light dark:hover:bg-[#223560] transition-all text-heading dark:text-[#C1EEFA] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button 
            onClick={() => setShowColumnManager(!showColumnManager)}
            className="flex items-center gap-2 px-6 py-3 bg-card border border-border rounded-xl hover:bg-hover-bg-light dark:hover:bg-[#223560] transition-all text-heading dark:text-[#C1EEFA]"
          >
            <Settings2 className="w-5 h-5" />
            Manage Columns
          </button>
          {/* Export buttons - Only shown if user has export_reports permission */}
          {hasPermission(PERMISSIONS.EXPORT_REPORTS) && (
            <>
              <button 
                onClick={async () => {
                  try {
                    const token = localStorage.getItem('auth_token');
                    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/reports/orders/export`, {
                      method: 'POST',
                      headers: { 
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                      },
                      body: JSON.stringify({
                        format: 'excel',
                        filters: { orderIdSearch, unifiedCustomerSearch, unifiedMerchantSearch, unifiedDriverSearch, dateFrom, dateTo },
                        columns: Object.keys(visibleColumns).filter(key => visibleColumns[key])
                      })
                    });
                    if (!response.ok) throw new Error('Export failed');
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `orders-export-${new Date().toISOString().split('T')[0]}.xlsx`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                    toast.success('Export successful');
                  } catch (error) {
                    console.error('Export error:', error);
                    toast.error('Failed to export orders');
                  }
                }}
                className="flex items-center gap-2 px-6 py-3 bg-[#C1EEFA] text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all"
              >
                <Download className="w-5 h-5" />
                Export Excel
              </button>
              <button 
                onClick={async () => {
                  try {
                    const token = localStorage.getItem('auth_token');
                    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/reports/orders/export`, {
                      method: 'POST',
                      headers: { 
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                      },
                      body: JSON.stringify({
                        format: 'csv',
                        filters: { orderIdSearch, unifiedCustomerSearch, unifiedMerchantSearch, unifiedDriverSearch, dateFrom, dateTo },
                        columns: Object.keys(visibleColumns).filter(key => visibleColumns[key])
                      })
                    });
                    if (!response.ok) throw new Error('Export failed');
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `orders-export-${new Date().toISOString().split('T')[0]}.csv`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                    toast.success('Export successful');
                  } catch (error) {
                    console.error('Export error:', error);
                    toast.error('Failed to export orders');
                  }
                }}
                className="flex items-center gap-2 px-6 py-3 bg-[#C1EEFA]/80 text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all"
              >
                <Download className="w-5 h-5" />
                Export CSV
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-destructive font-semibold mb-1">Error Loading Data</h4>
            <p className="text-sm text-heading dark:text-[#C1EEFA]">{error}</p>
          </div>
        </div>
      )}

      {/* Totals Summary - Tookan terminology: Customers = recipients, Merchants = businesses with vendor_id, Agents = drivers */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Total Orders</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.orders || filteredOrders.length}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Agents (Drivers)</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.drivers || drivers.length}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Customers</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{customers.length}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Merchants</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{(customers || []).filter((c: any) => c.vendor_id != null).length}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Completed Deliveries</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.deliveries || filteredOrders.filter((o: any) => (o.status || '').toLowerCase() === 'delivered').length}</div>
        </div>
      </div>

      {/* Driver Summaries */}
      {driverSummaries.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
          <h3 className="text-foreground text-xl mb-4">Driver Summaries</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
                <tr>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Orders</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD Total</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order Fees</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Total Value</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Avg Delivery Time</th>
                </tr>
              </thead>
              <tbody>
                {driverSummaries.map((driver, index) => (
                  <tr key={driver.driverId} className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-medium">{driver.driverName}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{driver.orderCount || 0}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${(driver.codTotal || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${(driver.orderFees || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-semibold">${(driver.totalValue || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{(driver.avgDeliveryTime || 0) > 0 ? `${(driver.avgDeliveryTime || 0).toFixed(1)} min` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Merchant Summaries */}
      {merchantSummaries.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
          <h3 className="text-foreground text-xl mb-4">Merchant Summaries</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
                <tr>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Merchant</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Orders</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD Received</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order Fees</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {merchantSummaries.map((merchant, index) => (
                  <tr key={merchant.merchantId} className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-medium">{merchant.merchantName}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{merchant.orderCount || 0}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${(merchant.codReceived || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${(merchant.orderFees || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-semibold">${(merchant.revenue || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Column Manager Modal */}
      {showColumnManager && (
        <div className="bg-card rounded-2xl border border-border p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-heading text-xl">Manage Columns</h3>
            <button
              onClick={() => setShowColumnManager(false)}
              className="p-2 hover:bg-hover-bg-light dark:hover:bg-[#223560] rounded-lg transition-all"
            >
              <X className="w-5 h-5 text-heading dark:text-[#C1EEFA]" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {columnDefinitions.map((col) => (
              <label key={col.key} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-hover-bg-light dark:hover:bg-[#223560] transition-all">
                <input
                  type="checkbox"
                  checked={visibleColumns[col.key]}
                  onChange={() => toggleColumn(col.key)}
                  className="w-4 h-4 rounded accent-[#DE3544]"
                />
                <span className="text-heading dark:text-[#C1EEFA] text-sm">{col.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Dynamic Search Filters */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <h3 className="text-foreground mb-4">Dynamic Search Filters</h3>
        
        {/* Order ID Search */}
        <div className="mb-6">
          <label className="block text-heading text-sm mb-2">Order ID Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#99BFD1]" />
            <input
              type="text"
              placeholder="Enter Order ID..."
              value={orderIdSearch}
              onChange={(e) => setOrderIdSearch(e.target.value)}
              className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(orderIdSearch)}`}
            />
            {orderIdSearch && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {orderIdSearch.length > 3 ? (
                  <CheckCircle className="w-5 h-5 text-[#10B981] dark:text-[#C1EEFA]" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#DE3544]" />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Unified Customer Search */}
        <div className="mb-6 p-4 bg-muted/30 dark:bg-[#223560]/50 rounded-xl">
          <h4 className="text-heading dark:text-[#C1EEFA] mb-3">Customer Search</h4>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
            <input
              type="text"
              placeholder="Search by Customer ID, Name, or Phone Number..."
              value={unifiedCustomerSearch}
              onChange={(e) => setUnifiedCustomerSearch(e.target.value)}
              className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-10 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(unifiedCustomerSearch)}`}
            />
            {unifiedCustomerSearch && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {unifiedCustomerSearch.length > 3 ? (
                  <CheckCircle className="w-5 h-5 text-[#10B981] dark:text-[#C1EEFA]" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#DE3544]" />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Unified Merchant Search */}
        <div className="mb-6 p-4 bg-muted/30 dark:bg-[#223560]/50 rounded-xl">
          <h4 className="text-heading dark:text-[#C1EEFA] mb-3">Merchant Search</h4>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
            <input
              type="text"
              placeholder="Search by Merchant ID, Name, or Phone Number..."
              value={unifiedMerchantSearch}
              onChange={(e) => setUnifiedMerchantSearch(e.target.value)}
              className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-10 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(unifiedMerchantSearch)}`}
            />
            {unifiedMerchantSearch && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {unifiedMerchantSearch.length > 3 ? (
                  <CheckCircle className="w-5 h-5 text-[#10B981] dark:text-[#C1EEFA]" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#DE3544]" />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Unified Driver Search */}
        <div className="mb-6 p-4 bg-muted/30 dark:bg-[#223560]/50 rounded-xl">
          <h4 className="text-heading dark:text-[#C1EEFA] mb-3">Driver Search</h4>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
            <input
              type="text"
              placeholder="Search by Driver ID, Name, or Phone Number..."
              value={unifiedDriverSearch}
              onChange={(e) => setUnifiedDriverSearch(e.target.value)}
              className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-10 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(unifiedDriverSearch)}`}
            />
            {unifiedDriverSearch && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {unifiedDriverSearch.length > 3 ? (
                  <CheckCircle className="w-5 h-5 text-[#10B981] dark:text-[#C1EEFA]" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#DE3544]" />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-heading text-sm mb-2">Date From</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#99BFD1]" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
              />
            </div>
          </div>
          <div>
            <label className="block text-heading text-sm mb-2">Date To</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#99BFD1]" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm transition-colors duration-300">
        {isLoading ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-[#C1EEFA]" />
            <p className="text-heading dark:text-[#C1EEFA]">Loading orders...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-heading dark:text-[#C1EEFA]">No orders found</p>
            <p className="text-muted-light dark:text-[#99BFD1] text-sm mt-2">
              {orders.length === 0 ? 'No orders available. Try adjusting your filters or refresh the data.' : 'No orders match your search criteria.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
                <tr>
                  {visibleColumns.id && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order ID</th>
                  )}
                  {visibleColumns.date && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Date</th>
                  )}
                  {visibleColumns.merchant && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Merchant</th>
                  )}
                  {visibleColumns.merchantNumber && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Merchant Number</th>
                  )}
                  {visibleColumns.driver && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver</th>
                  )}
                  {visibleColumns.customer && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer</th>
                  )}
                  {visibleColumns.customerNumber && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer Number</th>
                  )}
                  {visibleColumns.cod && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD</th>
                  )}
                  {visibleColumns.codCollected && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD Collected</th>
                  )}
                  {visibleColumns.tookanFees && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Tookan Fees</th>
                  )}
                  {visibleColumns.fee && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order Fee</th>
                  )}
                  {visibleColumns.status && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Status</th>
                  )}
                  {visibleColumns.addresses && (
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Addresses</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order, index) => {
                  const orderValue = (key: string) => getOrderValue(order, key);
                  const addresses = orderValue('addresses') as { pickup: string; dropoff: string };
                  
                  return (
                    <tr key={order.id || order.orderId || index} className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                      {visibleColumns.id && (
                        <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('id')}</td>
                      )}
                      {visibleColumns.date && (
                        <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('date')}</td>
                      )}
                      {visibleColumns.merchant && (
                        <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('merchant')}</td>
                      )}
                      {visibleColumns.merchantNumber && (
                        <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1]">{orderValue('merchantNumber')}</td>
                      )}
                      {visibleColumns.driver && (
                        <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('driver')}</td>
                      )}
                      {visibleColumns.customer && (
                        <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1]">{orderValue('customer')}</td>
                      )}
                      {visibleColumns.customerNumber && (
                        <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1]">{orderValue('customerNumber')}</td>
                      )}
                      {visibleColumns.cod && (
                        <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('cod')}</td>
                      )}
                      {visibleColumns.codCollected && (
                        <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            orderValue('codCollected') === 'Yes' 
                              ? 'bg-green-500/20 text-green-600 dark:text-green-400' 
                              : orderValue('codCollected') === 'No'
                              ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                              : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                          }`}>
                            {orderValue('codCollected')}
                          </span>
                        </td>
                      )}
                      {visibleColumns.tookanFees && (
                        <td className="px-6 py-4 text-[#DE3544]">{orderValue('tookanFees')}</td>
                      )}
                      {visibleColumns.fee && (
                        <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('fee')}</td>
                      )}
                      {visibleColumns.status && (
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-lg text-xs ${
                            (orderValue('status') as string).toLowerCase() === 'delivered' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                            (orderValue('status') as string).toLowerCase() === 'ongoing' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                            'bg-red-500/20 text-red-400 border border-red-500/30'
                          }`}>
                            {orderValue('status')}
                          </span>
                        </td>
                      )}
                      {visibleColumns.addresses && (
                        <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1] text-sm max-w-xs">
                          <div className="truncate">{addresses?.pickup || ''}</div>
                          <div className="truncate text-xs mt-1">{addresses?.dropoff || ''}</div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
