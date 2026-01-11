import { useState, useEffect, useMemo } from 'react';
import { Calendar, Search, Filter, Download, ArrowUpDown, ChevronDown, CheckCircle, XCircle, RefreshCw, AlertCircle, Settings2, X } from 'lucide-react';
import { DatePicker } from './ui/date-picker';
import { toast } from 'sonner';
import { fetchAllOrders, fetchAllDrivers, fetchAllCustomers, fetchReportsSummary, type OrderFilters, type DriverSummary, type MerchantSummary } from '../services/tookanApi';

const columnDefinitions = [
  { key: 'taskId', label: 'Task ID' },
  { key: 'dateDelivered', label: 'Date/Time Delivered' },
  { key: 'driverId', label: 'Driver ID' },
  { key: 'driverName', label: 'Driver Name' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'customerPhone', label: 'Customer Phone' },
  { key: 'pickupAddress', label: 'Pickup Address' },
  { key: 'deliveryAddress', label: 'Delivery Address' },
  { key: 'cod', label: 'COD' },
  { key: 'fee', label: 'Order Fees' },
  { key: 'orderId', label: 'Order ID' },
];

export function ReportsPanel() {
  const [orderIdSearch, setOrderIdSearch] = useState('');
  const [unifiedCustomerSearch, setUnifiedCustomerSearch] = useState('');
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
  // Combined search term for server-side filtering
  const combinedSearch = useMemo(() => {
    // For Order ID search, use ONLY that value (exact match required)
    if (orderIdSearch.trim()) {
      return orderIdSearch.trim();
    }
    // For other searches, combine them
    const searchTerms = [];
    if (unifiedCustomerSearch.trim()) searchTerms.push(unifiedCustomerSearch.trim());
    if (unifiedDriverSearch.trim()) searchTerms.push(unifiedDriverSearch.trim());
    return searchTerms.join(' ') || undefined;
  }, [orderIdSearch, unifiedCustomerSearch, unifiedDriverSearch]);

  const hasActiveSearch = useMemo(() => {
    return !!(combinedSearch || dateFrom || dateTo);
  }, [combinedSearch, dateFrom, dateTo]);

  // Fetch data on mount and when filters change
  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, combinedSearch]); // Reload when date filters or search change

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Build filters (include search for server-side filtering)
      // Fetch orders (only if search is active)
      let ordersResult = { status: 'success', data: { orders: [] } };

      if (hasActiveSearch) {
        // Build filters
        const filters: OrderFilters = {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          search: combinedSearch,
          limit: 100, // Search results limit
          page: 1
        };
        // @ts-ignore
        ordersResult = await fetchAllOrders(filters);
      } else {
        // No search active - clear orders
        setOrders([]);
      }

      if (ordersResult.status === 'success' && ordersResult.data) {
        console.log('📦 Orders received from API:', ordersResult.data.orders?.length || 0, ordersResult.data.orders);
        setOrders(ordersResult.data.orders || []);
      }

      // Fetch drivers
      const driversResult = await fetchAllDrivers();
      if (driversResult.status === 'success' && driversResult.data) {
        // Fix for different potential property names (fleets vs agents)
        // @ts-ignore
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
            orderCount: d.orderCount || d.totalOrders || 0, // Handle property mismatch
            codTotal: d.codTotal,
            orderFees: d.orderFees || d.feesTotal || 0,
            totalValue: (d.codTotal || 0) + (d.orderFees || d.feesTotal || 0),
            avgDeliveryTime: d.avgDeliveryTime || d.averageDeliveryTime || 0
          })));
        }

        if (summaryResult.data.merchantSummaries && summaryResult.data.merchantSummaries.length > 0) {
          setMerchantSummaries(summaryResult.data.merchantSummaries.map(m => ({
            merchantId: m.merchantId,
            merchantName: m.merchantName,
            orderCount: m.orderCount || m.totalOrders || 0,
            codReceived: m.codReceived || m.codTotal || 0,
            orderFees: m.orderFees || m.feesTotal || 0,
            revenue: (m.codReceived || m.codTotal || 0) + (m.orderFees || m.feesTotal || 0)
          })));
        }

        if (summaryResult.data.totals) {
          setTotals({
            ...summaryResult.data.totals,
            drivers: driversResult.status === 'success' ? (driversResult.data?.fleets?.length || 0) : 0,
            merchants: customersResult.status === 'success' ? (customersResult.data?.customers?.length || 0) : 0
          });
        }
      }

      // Also calculate summaries from orders as fallback/enhancement
      const fetchedOrders = ordersResult.status === 'success' && ordersResult.data ? ordersResult.data.orders || [] : [];
      if (fetchedOrders.length > 0) {
        // Only calculate if API didn't provide summaries, or enhance existing data
        if (!summaryResult.data?.driverSummaries || summaryResult.data.driverSummaries.length === 0) {
          calculateSummaries(fetchedOrders);
        }


        // Update totals from actual fetched data - REMOVED TO PREVENT OVERWRITING RPC DATA
        // if (fetchedOrders.length > 0) { ... }
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

    // Filter by order ID (jobId from backend)
    if (orderIdSearch.trim()) {
      filtered = filtered.filter(order => {
        const orderId = String(order.jobId || order.job_id || order.id || order.orderId || '');
        return orderId.toLowerCase().includes(orderIdSearch.toLowerCase());
      });
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


    // Filter by driver (ID, name, or phone)
    if (unifiedDriverSearch.trim()) {
      const searchLower = unifiedDriverSearch.toLowerCase();
      filtered = filtered.filter(order =>
        (order.driver || order.driverName || '').toLowerCase().includes(searchLower) ||
        (order.driverId || order.fleet_id || '').toLowerCase().includes(searchLower)
      );
    }

    return filtered;
    return filtered;
  }, [orders, orderIdSearch, unifiedCustomerSearch, unifiedDriverSearch]);

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

  const getStatusClass = (status: any) => {
    const s = String(status || '').toLowerCase();
    // Tookan status 2 = Successful/Delivered
    if (s === 'delivered' || s === 'successful' || s === '2') {
      return 'bg-green-500/20 text-green-400 border border-green-500/30';
    }
    // Other active statuses
    if (s === 'ongoing' || ['0', '1', '3', '4', '6', '7'].includes(s)) {
      return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    }
    // Failed/Canceled (8, 9, etc) or Unknown
    return 'bg-red-500/20 text-red-400 border border-red-500/30';
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
          <button
            onClick={async () => {
              try {
                const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/reports/orders/export`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    format: 'excel',
                    filters: { orderIdSearch, unifiedCustomerSearch, unifiedDriverSearch, dateFrom, dateTo },
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
                const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/reports/orders/export`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    format: 'csv',
                    filters: { orderIdSearch, unifiedCustomerSearch, unifiedDriverSearch, dateFrom, dateTo },
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

      {/* Totals Summary */}
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
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.merchants || customers.length}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Completed Deliveries</div>
          <div className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{totals.deliveries || filteredOrders.filter((o: any) => {
            const s = String(o.status || '').toLowerCase();
            return s === 'delivered' || s === 'successful' || s === '2';
          }).length}</div>
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
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{driver.orderCount}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${driver.codTotal.toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${driver.orderFees.toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-semibold">${driver.totalValue.toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{driver.avgDeliveryTime > 0 ? `${driver.avgDeliveryTime.toFixed(1)} min` : '-'}</td>
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
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{merchant.orderCount}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${merchant.codReceived.toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">${merchant.orderFees.toFixed(2)}</td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-semibold">${merchant.revenue.toFixed(2)}</td>
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
            <DatePicker
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="(YYYY-MM-DD)"
            />
          </div>
          <div>
            <label className="block text-heading text-sm mb-2">Date To</label>
            <DatePicker
              value={dateTo}
              onChange={setDateTo}
              placeholder="(YYYY-MM-DD)"
            />
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
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Task ID</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Date/Time Delivered</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver ID</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver Name</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer Name</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer Phone</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Pickup Address</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Delivery Address</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order Fees</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order ID</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order, index) => {
                  // Extract values from tasks table columns
                  const taskId = order.jobId || order.job_id || '';
                  const dateDelivered = order.completed_datetime || '';
                  const driverId = order.fleet_id || order.assignedDriver || '';
                  const driverName = order.fleet_name || order.assignedDriverName || '';
                  const customerName = order.customer_name || order.customerName || '';
                  const customerPhone = order.customer_phone || order.customerPhone || '';
                  const pickupAddress = order.pickup_address || order.pickupAddress || '';
                  const deliveryAddress = order.delivery_address || order.deliveryAddress || '';
                  const cod = order.cod_amount || order.codAmount || 0;
                  const orderFees = order.order_fees || order.orderFees || 0;
                  const orderId = order.order_id || '';

                  return (
                    <tr key={taskId || index} className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm font-mono">{taskId}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm whitespace-nowrap">
                        {dateDelivered ? (
                          dateDelivered.replace('T', ' ').split(' ').map((part: string, i: number) => (
                            <div key={i}>{part.replace('Z', '')}</div>
                          ))
                        ) : ''}
                      </td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm">{driverId}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm">{driverName}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm">{customerName}</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm">{customerPhone}</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm max-w-xs truncate" title={pickupAddress}>{pickupAddress}</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm max-w-xs truncate" title={deliveryAddress}>{deliveryAddress}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm font-medium">{typeof cod === 'number' ? cod.toFixed(2) : cod}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm">{typeof orderFees === 'number' ? orderFees.toFixed(2) : orderFees}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm font-mono">{orderId}</td>
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
