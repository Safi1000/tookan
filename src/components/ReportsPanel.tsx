import { useState, useEffect, useMemo } from 'react';
import { Search, Download, Calendar, CheckCircle, XCircle, Settings2, X, RefreshCw, AlertCircle, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { fetchAllOrders, fetchAllDrivers, fetchAllCustomers, fetchReportsSummary, type OrderFilters, type DriverSummary, type CustomerSummary } from '../services/tookanApi';
import { usePermissions, PERMISSIONS, PermissionGate } from '../contexts/PermissionContext';

// Simplified column definitions as per requirements
const columnDefinitions = [
  { key: 'id', label: 'Order ID' },
  { key: 'dateDelivered', label: 'Date/Time Delivered' },
  { key: 'driverId', label: 'Driver ID' },
  { key: 'driverName', label: 'Driver Name' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'customerPhone', label: 'Customer Phone' },
  { key: 'pickupAddress', label: 'Pickup Address' },
  { key: 'deliveryAddress', label: 'Delivery Address' },
  { key: 'cod', label: 'COD' },
  { key: 'fee', label: 'Order Fees' },
];

export function ReportsPanel() {
  const { hasPermission } = usePermissions();
  const [orderIdSearch, setOrderIdSearch] = useState('');
  const [unifiedCustomerSearch, setUnifiedCustomerSearch] = useState('');
  const [unifiedDriverSearch, setUnifiedDriverSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'orders' | 'drivers' | 'customers'>('orders');
  const [showCompletedOnly, setShowCompletedOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  // Data state
  const [orders, setOrders] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [driverSummaries, setDriverSummaries] = useState<DriverSummary[]>([]);
  const [customerSummaries, setCustomerSummaries] = useState<CustomerSummary[]>([]);
  const [totals, setTotals] = useState({ orders: 0, drivers: 0, customers: 0, deliveries: 0 });
  
  // Loading and error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    columnDefinitions.reduce((acc, col) => ({ ...acc, [col.key]: true }), {})
  );
  const [showColumnManager, setShowColumnManager] = useState(false);

  const handleTabChange = (tab: 'orders' | 'drivers' | 'customers') => {
    setActiveTab(tab);
    setShowColumnManager(false);
  };

  // Combined search term for server-side filtering
  const combinedSearch = useMemo(() => {
    const searchTerms = [];
    if (orderIdSearch.trim()) searchTerms.push(orderIdSearch.trim());
    if (unifiedCustomerSearch.trim()) searchTerms.push(unifiedCustomerSearch.trim());
    if (unifiedDriverSearch.trim()) searchTerms.push(unifiedDriverSearch.trim());
    return searchTerms.join(' ') || undefined;
  }, [orderIdSearch, unifiedCustomerSearch, unifiedDriverSearch]);

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
        
        if (summaryResult.data.customerSummaries && summaryResult.data.customerSummaries.length > 0) {
          setCustomerSummaries(summaryResult.data.customerSummaries.map(c => ({
            customerId: c.customerId,
            customerName: c.customerName,
            orderCount: c.totalOrders,
            codReceived: c.codTotal,
            orderFees: c.feesTotal,
            revenue: c.codTotal + c.feesTotal
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
            customers: customersResult.status === 'success' ? (customersResult.data?.customers?.length || 0) : prev.customers,
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

    // Customer summaries (previously Merchant summaries)
    const customerMap = new Map<string, {
      customerId: string;
      customerName: string;
      orders: any[];
      codReceived: number;
      feesTotal: number;
    }>();

    orderData.forEach((order: any) => {
      const customerId = order.merchantId || order.merchant || 'unknown';
      const customerName = order.merchant || 'Unknown Customer';
      
      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, {
          customerId,
          customerName,
          orders: [],
          codReceived: 0,
          feesTotal: 0
        });
      }

      const customerData = customerMap.get(customerId)!;
      customerData.orders.push(order);
      
      const cod = parseFloat(order.cod?.replace('$', '') || order.codAmount || 0);
      const fee = parseFloat(order.fee?.replace('$', '') || order.orderFees || 0);
      
      customerData.codReceived += cod;
      customerData.feesTotal += fee;
    });

    const customerSummariesData: CustomerSummary[] = Array.from(customerMap.values()).map(customer => ({
      customerId: customer.customerId,
      customerName: customer.customerName,
      orderCount: customer.orders.length,
      codReceived: customer.codReceived,
      orderFees: customer.feesTotal,
      revenue: customer.codReceived + customer.feesTotal
    }));

    setCustomerSummaries(customerSummariesData);
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

    // Filter by customer (ID, name, or phone) - now includes what was merchant
    if (unifiedCustomerSearch.trim()) {
      const searchLower = unifiedCustomerSearch.toLowerCase();
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

    // Filter by completed deliveries only
    if (showCompletedOnly) {
      filtered = filtered.filter(order => 
        [6, 7, 8].includes(parseInt(order.status)) ||
        (order.status || '').toLowerCase() === 'delivered' ||
        (order.status || '').toLowerCase() === 'completed'
      );
    }

    return filtered;
  }, [orders, orderIdSearch, unifiedCustomerSearch, unifiedDriverSearch, showCompletedOnly]);

  // Filtered driver summaries (per tab filters)
  const filteredDriverSummaries = useMemo(() => {
    let filtered = driverSummaries;
    if (unifiedDriverSearch.trim()) {
      const searchLower = unifiedDriverSearch.toLowerCase();
      filtered = filtered.filter(driver =>
        (driver.driverName || '').toLowerCase().includes(searchLower) ||
        (driver.driverId || '').toLowerCase().includes(searchLower)
      );
    }
    return filtered;
  }, [driverSummaries, unifiedDriverSearch]);

  // Filtered customer summaries (per tab filters)
  const filteredCustomerSummaries = useMemo(() => {
    let filtered = customerSummaries;
    if (unifiedCustomerSearch.trim()) {
      const searchLower = unifiedCustomerSearch.toLowerCase();
      filtered = filtered.filter(customer =>
        (customer.customerName || '').toLowerCase().includes(searchLower) ||
        (customer.customerId || '').toLowerCase().includes(searchLower)
      );
    }
    return filtered;
  }, [customerSummaries, unifiedCustomerSearch]);

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
      case 'dateDelivered': return order.completedDatetime || order.date || order.orderDate || '';
      case 'driverId': return order.driverId || order.fleet_id || '';
      case 'driverName': return order.driver || order.driverName || '';
      case 'customerName': return order.merchant || order.merchantName || '';
      case 'customerPhone': return order.merchantNumber || order.merchantPhone || '';
      case 'pickupAddress': return order.pickup || order.pickupAddress || '';
      case 'deliveryAddress': return order.dropoff || order.deliveryAddress || '';
      case 'cod': return order.cod || `$${order.codAmount || 0}`;
      case 'fee': return order.fee || `$${order.orderFees || 0}`;
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
          {activeTab === 'orders' && (
            <>
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
                        filters: { orderIdSearch, unifiedCustomerSearch, unifiedDriverSearch, showCompletedOnly, dateFrom, dateTo },
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
                        filters: { orderIdSearch, unifiedCustomerSearch, unifiedDriverSearch, showCompletedOnly, dateFrom, dateTo },
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

      {/* Totals Summary - 4 cards: Orders, Drivers, Customers, Deliveries */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Total Orders</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.orders || filteredOrders.length}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Total Drivers</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.drivers || drivers.length}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Total Customers</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.customers || customers.length}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Completed Deliveries</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.deliveries || filteredOrders.filter((o: any) => (o.status || '').toLowerCase() === 'delivered').length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-2">
        {['orders','drivers','customers'].map(tab => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab as 'orders' | 'drivers' | 'customers')}
            className={`px-4 py-2 rounded-t-lg border border-border border-b-0 transition-all ${
              activeTab === tab
                ? 'bg-card text-heading dark:text-[#C1EEFA]'
                : 'bg-muted/30 dark:bg-[#1A2C53] text-muted-light'
            }`}
          >
            {tab === 'orders' ? 'Orders' : tab === 'drivers' ? 'Drivers' : 'Customers'}
          </button>
        ))}
      </div>

      {/* Driver Summaries (Drivers tab) */}
      {activeTab === 'drivers' && filteredDriverSummaries.length > 0 && (
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
                {filteredDriverSummaries.map((driver, index) => (
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

      {/* Customer Summaries (Customers tab) */}
      {activeTab === 'customers' && filteredCustomerSummaries.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
          <h3 className="text-foreground text-xl mb-4">Customer Summaries</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
                <tr>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Orders</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD Received</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order Fees</th>
                  <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomerSummaries.map((customer, index) => (
                  <tr key={customer.customerId} className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-medium">{customer.customerName}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{customer.orderCount || 0}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${(customer.codReceived || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${(customer.orderFees || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-semibold">${(customer.revenue || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Column Manager Modal (Orders tab only) */}
      {activeTab === 'orders' && showColumnManager && (
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

      {/* Search Filters (per tab) */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <h3 className="text-foreground mb-4">Search Filters</h3>
        
        {activeTab === 'orders' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-heading text-sm mb-2">Order ID</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#99BFD1]" />
                  <input
                    type="text"
                    placeholder="Enter Order ID..."
                    value={orderIdSearch}
                    onChange={(e) => setOrderIdSearch(e.target.value)}
                    className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(orderIdSearch)}`}
                  />
                </div>
              </div>
              <div>
                <label className="block text-heading text-sm mb-2">Customer (ID, Name, Phone)</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                  <input
                    type="text"
                    placeholder="Search customer..."
                    value={unifiedCustomerSearch}
                    onChange={(e) => setUnifiedCustomerSearch(e.target.value)}
                    className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(unifiedCustomerSearch)}`}
                  />
                </div>
              </div>
              <div>
                <label className="block text-heading text-sm mb-2">Driver (ID, Name)</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                  <input
                    type="text"
                    placeholder="Search driver..."
                    value={unifiedDriverSearch}
                    onChange={(e) => setUnifiedDriverSearch(e.target.value)}
                    className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(unifiedDriverSearch)}`}
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <div>
                <label className="block text-heading text-sm mb-2">Delivery Status</label>
                <button
                  onClick={() => setShowCompletedOnly(!showCompletedOnly)}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                    showCompletedOnly
                      ? 'bg-green-500/20 border-green-500/50 text-green-400'
                      : 'bg-input-bg dark:bg-[#1A2C53] border-input-border dark:border-[#2A3C63] text-heading dark:text-[#C1EEFA]'
                  }`}
                >
                  <Filter className="w-5 h-5" />
                  {showCompletedOnly ? 'Completed Only' : 'All Deliveries'}
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'drivers' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-heading text-sm mb-2">Driver (ID, Name)</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                <input
                  type="text"
                  placeholder="Search driver..."
                  value={unifiedDriverSearch}
                  onChange={(e) => setUnifiedDriverSearch(e.target.value)}
                  className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(unifiedDriverSearch)}`}
                />
              </div>
            </div>
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
        )}

        {activeTab === 'customers' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-heading text-sm mb-2">Customer (ID, Name, Phone)</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                <input
                  type="text"
                  placeholder="Search customer..."
                  value={unifiedCustomerSearch}
                  onChange={(e) => setUnifiedCustomerSearch(e.target.value)}
                  className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(unifiedCustomerSearch)}`}
                />
              </div>
            </div>
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
        )}
      </div>

      {activeTab === 'orders' && (
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
                    {visibleColumns.dateDelivered && (
                      <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Date/Time Delivered</th>
                    )}
                    {visibleColumns.driverId && (
                      <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver ID</th>
                    )}
                    {visibleColumns.driverName && (
                      <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver Name</th>
                    )}
                    {visibleColumns.customerName && (
                      <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer Name</th>
                    )}
                    {visibleColumns.customerPhone && (
                      <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer Phone</th>
                    )}
                    {visibleColumns.pickupAddress && (
                      <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Pickup Address</th>
                    )}
                    {visibleColumns.deliveryAddress && (
                      <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Delivery Address</th>
                    )}
                    {visibleColumns.cod && (
                      <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD</th>
                    )}
                    {visibleColumns.fee && (
                      <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order Fees</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order, index) => {
                    const orderValue = (key: string) => getOrderValue(order, key);
                    
                    return (
                      <tr key={order.id || order.orderId || index} className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                        {visibleColumns.id && (
                          <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-medium">{orderValue('id')}</td>
                        )}
                        {visibleColumns.dateDelivered && (
                          <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('dateDelivered')}</td>
                        )}
                        {visibleColumns.driverId && (
                          <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1]">{orderValue('driverId')}</td>
                        )}
                        {visibleColumns.driverName && (
                          <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('driverName')}</td>
                        )}
                        {visibleColumns.customerName && (
                          <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('customerName')}</td>
                        )}
                        {visibleColumns.customerPhone && (
                          <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1]">{orderValue('customerPhone')}</td>
                        )}
                        {visibleColumns.pickupAddress && (
                          <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1] text-sm max-w-xs truncate">{orderValue('pickupAddress')}</td>
                        )}
                        {visibleColumns.deliveryAddress && (
                          <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1] text-sm max-w-xs truncate">{orderValue('deliveryAddress')}</td>
                        )}
                        {visibleColumns.cod && (
                          <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('cod')}</td>
                        )}
                        {visibleColumns.fee && (
                          <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{orderValue('fee')}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
