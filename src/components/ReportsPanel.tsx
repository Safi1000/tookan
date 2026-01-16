import { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, Search, Filter, Download, ArrowUpDown, ChevronDown, CheckCircle, XCircle, RefreshCw, AlertCircle, Settings2, X } from 'lucide-react';
import { DatePicker } from './ui/date-picker';
import { toast } from 'sonner';
import { fetchAllOrders, fetchAllDrivers, fetchAllCustomers, fetchReportsSummary, fetchDriverPerformance, type OrderFilters } from '../services/tookanApi';
import * as XLSX from 'xlsx';

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
];

export function ReportsPanel() {
  const [orderIdSearch, setOrderIdSearch] = useState('');
  const [unifiedCustomerSearch, setUnifiedCustomerSearch] = useState('');
  const [unifiedDriverSearch, setUnifiedDriverSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Data state
  const [orders, setOrders] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [totals, setTotals] = useState({ orders: 0, drivers: 0, merchants: 0, deliveries: 0 });
  const [driverPerformanceData, setDriverPerformanceData] = useState<any[]>([]);

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
    return !!(combinedSearch || dateFrom || dateTo || statusFilter);
  }, [combinedSearch, dateFrom, dateTo, statusFilter]);


  // Fetch data on mount and when filters change
  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, combinedSearch, statusFilter]); // Reload when date filters, search, or status change

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
          status: statusFilter || undefined,
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

      // Customers are now fetched from database via reports summary endpoint
      // No need to call Tookan API for customer count
      // const customersResult = await fetchAllCustomers();
      // if (customersResult.status === 'success' && customersResult.data) {
      //   setCustomers(customersResult.data.customers || []);
      // }

      // Fetch Driver Performance if search is active
      if (unifiedDriverSearch.trim()) {
        const perfResult = await fetchDriverPerformance(
          unifiedDriverSearch.trim(),
          dateFrom || undefined,
          dateTo || undefined
        );
        if (perfResult.status === 'success') {
          setDriverPerformanceData(perfResult.data);
        }
      } else {
        setDriverPerformanceData([]);
      }

      // Fetch reports summary (returns counts from database)
      const summaryResult = await fetchReportsSummary({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined
      });
      if (summaryResult.status === 'success' && summaryResult.data) {
        console.log('🚀 [FRONTEND] Reports Summary Result:', summaryResult.data);
        if (summaryResult.data.totals) {
          console.log('🚀 [FRONTEND] Customer Count from Summary:', summaryResult.data.totals.customers);
          // Use database customer count, but API for drivers (as requested)
          setTotals({
            ...summaryResult.data.totals,
            drivers: driversResult.status === 'success' ? (driversResult.data?.fleets?.length || 0) : 0,
            merchants: summaryResult.data.totals.customers // Map customers from DB to merchants for display
          });
        }
      }

      // Update totals from actual fetched data - REMOVED TO PREVENT OVERWRITING RPC DATA
      // if (fetchedOrders.length > 0) { ... }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load data';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const mapStatus = (status: number | string | null | undefined) => {
    if (status === null || status === undefined) return 'N/A';
    const s = Number(status);
    switch (s) {
      case 0: return 'Assigned';
      case 1: return 'Started';
      case 2: return 'Successful';
      case 3: return 'Failed';
      case 4: return 'InProgress/Arrived';
      case 6: return 'Unassigned';
      case 7: return 'Accepted/Acknowledged';
      case 8: return 'Decline';
      case 9: return 'Cancel';
      case 10: return 'Deleted';
      default: return `Status ${s}`;
    }
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


    // Filter by driver (ID, name, or phone) - Normalized search
    if (unifiedDriverSearch.trim()) {
      const searchTerm = unifiedDriverSearch.trim();
      // Normalize search: trim, collapse spaces, lowercase (same as normalized_name column)
      const normalizedSearchName = searchTerm.replace(/\s+/g, ' ').toLowerCase();
      const normalizedSearchPhone = searchTerm.replace(/\D/g, '');

      filtered = filtered.filter(order => {
        // Normalize the order's driver name the same way
        const orderDriverName = (order.driver || order.driverName || order.fleet_name || '')
          .toString().trim().replace(/\s+/g, ' ').toLowerCase();
        const orderDriverId = String(order.driverId || order.fleet_id || '').trim();
        const orderDriverPhone = String(order.driverPhone || order.driver_phone || '').replace(/\D/g, '');

        // Match if normalized name contains search, or exact ID match, or exact phone match
        return orderDriverName.includes(normalizedSearchName) ||
          orderDriverId === searchTerm ||
          (normalizedSearchPhone && orderDriverPhone === normalizedSearchPhone);
      });
    }

    return filtered;
  }, [orders, orderIdSearch, unifiedCustomerSearch, unifiedDriverSearch]);

  // Dynamic export: exports only visible data (Driver Summary + Orders)
  const handleExport = useCallback((format: 'excel' | 'csv') => {
    try {
      const workbook = XLSX.utils.book_new();
      const dateStr = new Date().toISOString().split('T')[0];

      // 1. Driver Summary sheet (if visible)
      if (driverPerformanceData.length > 0) {
        const driverData = driverPerformanceData.map((perf: any) => ({
          'Driver ID': perf.fleet_id || '',
          'Name': perf.name || '',
          'Number of Orders': perf.total_orders || 0,
          'COD Totals': '—',
          'Order Fees': '—',
          'Total Order Value': '—',
          'Avg Delivery Time': perf.avg_delivery_time > 0 ? `${perf.avg_delivery_time.toFixed(1)} mins` : 'N/A'
        }));
        const driverSheet = XLSX.utils.json_to_sheet(driverData);
        XLSX.utils.book_append_sheet(workbook, driverSheet, 'Driver Summary');
      }

      // 2. Order List sheet (if there are filtered orders)
      if (filteredOrders.length > 0) {
        const ordersData = filteredOrders.map((order: any) => ({
          'Task ID': order.jobId || order.job_id || '',
          'Date/Time Delivered': order.completed_datetime || '',
          'Driver ID': order.fleet_id || order.assignedDriver || '',
          'Driver Name': order.fleet_name || order.assignedDriverName || '',
          'Driver Phone': order.driver_phone || order.driverPhone || '',
          'Customer Name': order.customer_name || order.customerName || '',
          'Customer Phone': order.customer_phone || order.customerPhone || '',
          'Pickup Address': order.pickup_address || order.pickupAddress || '',
          'Delivery Address': order.delivery_address || order.deliveryAddress || '',
          'COD': typeof (order.cod_amount || order.codAmount) === 'number' ? (order.cod_amount || order.codAmount).toFixed(2) : '0.00',
          'Order Fees': typeof (order.order_fees || order.orderFees) === 'number' ? (order.order_fees || order.orderFees).toFixed(2) : '0.00',
          'Status': mapStatus(order.status),
          'Tags': order.tags || order.tag || ''
        }));
        const ordersSheet = XLSX.utils.json_to_sheet(ordersData);
        XLSX.utils.book_append_sheet(workbook, ordersSheet, 'Order List');
      }

      // Check if any data exists
      if (workbook.SheetNames.length === 0) {
        toast.error('No data to export');
        return;
      }

      // Export
      if (format === 'excel') {
        XLSX.writeFile(workbook, `reports-export-${dateStr}.xlsx`);
      } else {
        // For CSV: combine sheets with section headers
        let csvContent = '';
        workbook.SheetNames.forEach((sheetName, idx) => {
          if (idx > 0) csvContent += '\n\n';
          // Add section header (using '---' to avoid Google Sheets interpreting '=' as formula)
          csvContent += `--- ${sheetName} ---\n`;
          csvContent += XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        });
        // Add Byte Order Mark (BOM) for UTF-8 to support Arabic characters in Excel
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reports-export-${dateStr}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }

      toast.success(`Export successful (${workbook.SheetNames.join(' + ')})`);
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data');
    }
  }, [driverPerformanceData, filteredOrders, mapStatus]);

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
            onClick={() => handleExport('csv')}
            className="flex items-center gap-2 px-6 py-3 bg-[#C1EEFA] text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all"
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


        {/* Status Filter */}
        <div className="mb-6">
          <label className="block text-heading text-sm mb-2">Filter by Status</label>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#99BFD1]" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] focus:outline-none transition-all appearance-none cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="0">Assigned</option>
              <option value="1">Started</option>
              <option value="2">Successful</option>
              <option value="3">Failed</option>
              <option value="4">InProgress/Arrived</option>
              <option value="6">Unassigned</option>
              <option value="7">Accepted/Acknowledged</option>
              <option value="8">Declined</option>
              <option value="9">Cancelled</option>
              <option value="10">Deleted</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#99BFD1] pointer-events-none" />
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

      {/* Driver Performance Table */}
      {
        driverPerformanceData.length > 0 && (
          <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm transition-colors duration-300">
            <div className="px-6 py-4 border-b border-border dark:border-[#2A3C63] bg-muted/10 dark:bg-[#1A2C53]/30">
              <h3 className="text-heading dark:text-[#C1EEFA] font-semibold">Driver Summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
                  <tr>
                    <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver ID</th>
                    <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Name</th>
                    <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Number of Orders</th>
                    <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD Totals</th>
                    <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order Fees</th>
                    <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Total Order Value</th>
                    <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Avg Delivery Time</th>
                  </tr>
                </thead>
                <tbody>
                  {driverPerformanceData.map((perf, idx) => (
                    <tr key={perf.fleet_id || idx} className="border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors">
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm font-mono">{perf.fleet_id}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm">{perf.name}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm font-medium">{perf.total_orders}</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm">—</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm">—</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm">—</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm font-medium">
                        {perf.avg_delivery_time > 0 ? `${perf.avg_delivery_time.toFixed(1)} mins` : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }

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
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver Phone</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer Name</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer Phone</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Pickup Address</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Delivery Address</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order Fees</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Status</th>
                  <th className="text-left px-4 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Tags</th>


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

                  const isPickup = pickupAddress.trim().toLowerCase() === deliveryAddress.trim().toLowerCase();

                  return (
                    <tr key={taskId || index} className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm font-mono">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold shrink-0 shadow-sm border border-black/5 dark:border-white/10"
                            style={{
                              backgroundColor: isPickup ? '#FFEDD5' : '#DBEAFE', // orange-100 : blue-100
                              color: isPickup ? '#C2410C' : '#1D4ED8', // orange-700 : blue-700
                            }}
                            title={isPickup ? "Pickup Task" : "Delivery Task"}
                          >
                            {isPickup ? 'P' : 'D'}
                          </span>
                          <span>{taskId}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm whitespace-nowrap">
                        {dateDelivered ? (
                          dateDelivered.replace('T', ' ').split(' ').map((part: string, i: number) => (
                            <div key={i}>{part.replace('Z', '')}</div>
                          ))
                        ) : ''}
                      </td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm">{driverId}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm">{driverName}</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm">{order.driver_phone || order.driverPhone || ''}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm">{customerName}</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm">{customerPhone}</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm max-w-xs truncate" title={pickupAddress}>{pickupAddress}</td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm max-w-xs truncate" title={deliveryAddress}>{deliveryAddress}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm font-medium">{typeof cod === 'number' ? cod.toFixed(2) : cod}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm">{typeof orderFees === 'number' ? orderFees.toFixed(2) : orderFees}</td>
                      <td className="px-4 py-4 text-heading dark:text-[#C1EEFA] text-sm font-medium">
                        <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${order.status === 2 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          order.status === 3 || order.status === 9 || order.status === 8 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}>
                          {mapStatus(order.status)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-muted-light dark:text-[#99BFD1] text-sm italic">{order.tags || order.tag || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div >
  );
}
