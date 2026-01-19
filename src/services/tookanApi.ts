/// <reference types="vite/client" />
/**
 * Tookan API Service
 * Handles all Tookan API interactions
 */

// Default to same-origin API when no base URL is provided (production on Vercel)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Get authentication headers
 */
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Generic API Response type
 */
export interface TookanApiResponse<T = any> {
  status: 'success' | 'error';
  action?: string;
  entity?: string;
  message: string;
  data: T;
}

/**
 * Customer Wallet Response
 */
export interface CustomerWalletResponse {
  id: string;
  name: string;
  wallet_balance: number;
  credit_used: number;
}

/**
 * Analytics Data Type
 * Tookan terminology:
 * - Customers: delivery recipients (people who receive packages)
 * - Merchants: registered businesses with vendor_id
 * - Agents (totalDrivers): delivery personnel (from get_all_fleets)
 */
export interface AnalyticsData {
  kpis: {
    totalOrders: number;
    totalDrivers: number;  // Tookan calls these "Agents"
    totalMerchants: number;  // Only those with vendor_id
    totalCustomers?: number;  // All delivery recipients
    pendingCOD: number;
    driversWithPending: number;
    completedDeliveries: number;
  };
  trends: {
    orders: string;
    drivers: string;
    merchants: string;
    customers?: string;
    pendingCOD: string;
    driversPending: string;
    completed: string;
  };
  codStatus: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  orderVolume: Array<{
    day: string;
    orders: number;
  }>;
  driverPerformance: Array<{
    name: string;
    deliveries: number;
  }>;
  filters?: {
    dateFrom: string;
    dateTo: string;
  };
}

/**
 * COD Entry
 */
export interface CODEntry {
  id: string;
  driverId: string;
  driverName: string;
  orderId: string;
  amount: number;
  status: string;
  date: string;
}

/**
 * COD Confirmation
 */
export interface CODConfirmation {
  id: string;
  orderId: string;
  driverId: string;
  driverName?: string;
  merchant?: string;
  customer?: string;
  amount: number;
  confirmed: boolean;
  status: string;
  date: string;
  notes?: string;
}

/**
 * COD Calendar Entry
 */
export interface CODCalendarEntry {
  date: string;
  total: number;
  settled: number;
  pending: number;
}

/**
 * Customer Wallet
 */
export interface CustomerWallet {
  id: string;
  vendor_id?: number | string;
  name: string;
  phone?: string;
  balance?: number;
  pending?: number;
  wallet_balance?: number;
  credit_used?: number;
}

/**
 * Order Filters
 */
export interface OrderFilters {
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  page?: number;
  driverId?: string;
  customerId?: string;
  status?: string;
}

/**
 * Driver Summary
 */
export interface DriverSummary {
  driverId: string;
  driverName: string;
  driverEmail?: string;
  driverPhone?: string;
  orderCount: number;
  codTotal: number;
  orderFees: number;
  totalValue: number;
  avgDeliveryTime: number;
  // Fallback properties for compatibility
  totalOrders?: number;
  feesTotal?: number;
  averageDeliveryTime?: number;
}

export interface CustomerSummary {
  customerId: string;
  customerName: string;
  orderCount: number;
  codReceived: number;
  orderFees: number;
  revenue: number;
  // Fallback properties for compatibility
  totalOrders?: number;
  codTotal?: number;
  feesTotal?: number;
}

export interface MerchantSummary {
  merchantId: string;
  merchantName: string;
  orderCount: number;
  codReceived: number;
  orderFees: number;
  revenue: number;
  // Fallback properties for compatibility
  totalOrders?: number;
  codTotal?: number;
  feesTotal?: number;
}

/**
 * Order Data
 */
export interface OrderData {
  id?: string;
  job_id?: string;
  orderId?: string;
  date?: string;
  merchant?: string;
  merchantId?: string;
  merchantNumber?: string;
  driver?: string;
  driverId?: string;
  customer?: string;
  customerId?: string;
  customerNumber?: string;
  cod?: string | number;
  codAmount?: number;
  codCollected?: boolean;
  cod_collected?: boolean;
  cod_amount?: number;
  tookanFees?: number;
  fee?: string | number;
  orderFees?: number;
  order_payment?: number;
  status?: string | number;
  job_status?: string | number;
  addresses?: string;
  [key: string]: any;
}

/**
 * Order Updates
 */
export interface OrderUpdates {
  codAmount?: number;
  orderFees?: number;
  assignedDriver?: string;
  notes?: string;
  cod_amount?: number;
  cod_collected?: boolean;
  [key: string]: any;
}

/**
 * Tag Configuration
 */
export interface TagConfig {
  [key: string]: any;
}

/**
 * Withdrawal Request (Customer withdrawals per SRS)
 */
export interface WithdrawalRequest {
  id: number;
  type: 'customer';
  customerId?: string;
  customerName?: string;
  phone: string;
  iban: string;
  withdrawalAmount: number;
  walletAmount: number;
  date: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt?: string;
  updatedAt?: string;
  rejectedReason?: string;
}

/**
 * Fetch analytics data
 */
export async function fetchAnalytics(
  dateFrom?: string,
  dateTo?: string
): Promise<TookanApiResponse<AnalyticsData>> {
  try {
    let url = `${API_BASE_URL}/api/reports/analytics`;
    const params = new URLSearchParams();

    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_analytics',
        entity: 'analytics',
        message: data.message || 'Failed to fetch analytics',
        data: {
          kpis: {
            totalOrders: 0,
            totalDrivers: 0,
            totalMerchants: 0,
            pendingCOD: 0,
            driversWithPending: 0,
            completedDeliveries: 0,
          },
          trends: {
            orders: '+0%',
            drivers: '+0%',
            merchants: '+0%',
            pendingCOD: '+0%',
            driversPending: '+0%',
            completed: '+0%',
          },
          codStatus: [],
          orderVolume: [],
          driverPerformance: [],
        },
      };
    }

    return {
      status: 'success',
      action: 'fetch_analytics',
      entity: 'analytics',
      message: data.message || 'Analytics fetched successfully',
      data: data.data || {
        kpis: {
          totalOrders: 0,
          totalDrivers: 0,
          totalMerchants: 0,
          pendingCOD: 0,
          driversWithPending: 0,
          completedDeliveries: 0,
        },
        trends: {
          orders: '+0%',
          drivers: '+0%',
          merchants: '+0%',
          pendingCOD: '+0%',
          driversPending: '+0%',
          completed: '+0%',
        },
        codStatus: [],
        orderVolume: [],
        driverPerformance: [],
      },
    };
  } catch (error) {
    console.error('Fetch analytics error:', error);
    return {
      status: 'error',
      action: 'fetch_analytics',
      entity: 'analytics',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {
        kpis: {
          totalOrders: 0,
          totalDrivers: 0,
          totalMerchants: 0,
          pendingCOD: 0,
          driversWithPending: 0,
          completedDeliveries: 0,
        },
        trends: {
          orders: '+0%',
          drivers: '+0%',
          merchants: '+0%',
          pendingCOD: '+0%',
          driversPending: '+0%',
          completed: '+0%',
        },
        codStatus: [],
        orderVolume: [],
        driverPerformance: [],
      },
    };
  }
}

/**
 * Fetch customer wallet
 */
export async function fetchCustomerWallet(
  customerId: number | string,
  includeHistory: number = 0,
  offset: number = 0,
  limit: number = 50
): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/customer-wallet/details`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ customer_id: customerId }),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_wallet',
        entity: 'customer',
        message: data.message || 'Failed to fetch customer wallet',
        data: {
          id: '',
          name: '',
          wallet_balance: 0,
          credit_used: 0,
        },
      };
    }

    return {
      status: 'success',
      action: 'fetch_wallet',
      entity: 'customer',
      message: 'Customer wallet fetched successfully',
      data: data.data || {
        id: '',
        name: '',
        wallet_balance: 0,
        credit_used: 0,
      },
    };
  } catch (error) {
    console.error('Fetch customer wallet error:', error);
    return {
      status: 'error',
      action: 'fetch_wallet',
      entity: 'customer',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {
        id: '',
        name: '',
        wallet_balance: 0,
        credit_used: 0,
      },
    };
  }
}

/**
 * Fetch all customer wallets
 */
export async function fetchCustomerWallets(): Promise<TookanApiResponse<Array<{ id: string; name: string; wallet_balance: number; credit_used: number }>>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/customers/wallets`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_wallet',
        entity: 'customer',
        message: data.message || 'Failed to fetch customer wallets',
        data: []
      };
    }

    return {
      status: 'success',
      action: 'fetch_wallet',
      entity: 'customer',
      message: 'Customer wallets fetched successfully',
      data: data.data?.wallets || []
    };
  } catch (error) {
    console.error('Fetch customer wallets error:', error);
    return {
      status: 'error',
      action: 'fetch_wallet',
      entity: 'customer',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: []
    };
  }
}

// Additional functions that may be imported by other components
export async function createFleetWalletTransaction(
  fleetId: string | number,
  amount: number,
  description?: string,
  transactionType: 'credit' | 'debit' = 'credit'
): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/driver-wallet/transaction`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        fleet_id: fleetId,
        amount,
        description,
        transaction_type: transactionType,
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

export async function fetchFleetWalletBalance(fleetId: string | number): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/driver-wallet/balance`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ fleet_id: fleetId }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

export async function addCustomerWalletPayment(
  customerId: string | number,
  amount: number,
  description?: string
): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/customer-wallet/payment`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        customer_id: customerId,
        amount,
        description,
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

export async function fetchDriverCODQueue(driverId?: string): Promise<TookanApiResponse<CODEntry[]>> {
  try {
    let url = `${API_BASE_URL}/api/tookan/cod-queue`;
    if (driverId) {
      url += `?driverId=${driverId}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: [],
    };
  }
}

export async function getOldestPendingCOD(): Promise<TookanApiResponse<CODEntry | null>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/cod-queue/oldest`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: null,
    };
  }
}

export async function settleCODTransaction(
  entryId: string,
  amount: number | string,
  paymentMethod?: string,
  userId?: string
): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/cod-queue/settle`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        entry_id: entryId,
        amount,
        payment_method: paymentMethod,
        user_id: userId
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

export async function fetchCODConfirmations(): Promise<TookanApiResponse<CODConfirmation[]>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/cod-queue/confirmations`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: [],
    };
  }
}

export async function fetchCODCalendar(
  startDate?: string,
  endDate?: string
): Promise<TookanApiResponse<CODCalendarEntry[]>> {
  try {
    let url = `${API_BASE_URL}/api/tookan/cod-queue/calendar`;
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: [],
    };
  }
}

export async function fetchCODQueue(): Promise<TookanApiResponse<CODEntry[]>> {
  return fetchDriverCODQueue();
}

export async function settleCOD(
  entryId: string,
  amount: number | string,
  paymentMethod?: string,
  userId?: string
): Promise<TookanApiResponse<any>> {
  return settleCODTransaction(entryId, amount, paymentMethod, userId);
}

/**
 * Fetch all orders
 */
export async function fetchAllOrders(
  filters?: OrderFilters
): Promise<TookanApiResponse<{ orders: OrderData[]; total?: number }>> {
  try {
    let url = `${API_BASE_URL}/api/tookan/orders/cached`;
    const params = new URLSearchParams();

    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.driverId) params.append('driverId', filters.driverId);
    if (filters?.customerId) params.append('customerId', filters.customerId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.limit) params.append('limit', (filters.limit || 50).toString());
    if (filters?.page) params.append('page', (filters.page || 1).toString());
    if (filters?.search) params.append('search', filters.search || '');

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_orders',
        entity: 'order',
        message: data.message || 'Failed to fetch orders',
        data: { orders: [], total: 0 },
      };
    }

    return {
      status: 'success',
      action: 'fetch_orders',
      entity: 'order',
      message: data.message || 'Orders fetched successfully',
      data: data.data || { orders: [], total: 0 },
    };
  } catch (error) {
    console.error('Fetch orders error:', error);
    return {
      status: 'error',
      action: 'fetch_orders',
      entity: 'order',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { orders: [], total: 0 },
    };
  }
}

/**
 * Fetch order details
 */
export async function fetchOrderDetails(
  orderId: string
): Promise<TookanApiResponse<OrderData>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/order/${orderId}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_order',
        entity: 'order',
        message: data.message || 'Failed to fetch order details',
        data: {} as OrderData,
      };
    }

    return {
      status: 'success',
      action: 'fetch_order',
      entity: 'order',
      message: data.message || 'Order details fetched successfully',
      data: data.data || ({} as OrderData),
    };
  } catch (error) {
    console.error('Fetch order details error:', error);
    return {
      status: 'error',
      action: 'fetch_order',
      entity: 'order',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {} as OrderData,
    };
  }
}

/**
 * Update order
 */
export async function updateOrder(
  orderId: string,
  updates: OrderUpdates
): Promise<TookanApiResponse<OrderData>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/order/${orderId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'update_order',
        entity: 'order',
        message: data.message || 'Failed to update order',
        data: {} as OrderData,
      };
    }

    return {
      status: 'success',
      action: 'update_order',
      entity: 'order',
      message: data.message || 'Order updated successfully',
      data: data.data || ({} as OrderData),
    };
  } catch (error) {
    console.error('Update order error:', error);
    return {
      status: 'error',
      action: 'update_order',
      entity: 'order',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {} as OrderData,
    };
  }
}

/**
 * Reorder an order
 */
export async function reorderOrder(
  orderId: string,
  data: any
): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/order/reorder`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ orderId, ...data }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

/**
 * Return an order
 */
export async function returnOrder(
  orderId: string,
  data: any
): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/order/return`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ orderId, ...data }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

/**
 * Delete an order
 */
export async function deleteOrder(
  orderId: string
): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/order/${orderId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

/**
 * Check order conflicts
 */
export async function checkOrderConflicts(
  orderId: string
): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/order/${orderId}/conflicts`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

/**
 * Update task COD
 */
export async function updateTaskCOD(
  orderId: string,
  codData: { cod_amount?: number; cod_collected?: boolean }
): Promise<TookanApiResponse<any>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/task/${orderId}/cod`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(codData),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

/**
 * Fetch all drivers (fleets)
 */
export async function fetchAllDrivers(): Promise<TookanApiResponse<{ fleets: any[] }>> {
  try {
    // Use the agents endpoint which fetches from DB (faster than Tookan API)
    const response = await fetch(`${API_BASE_URL}/api/agents`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_drivers',
        entity: 'driver',
        message: data.message || 'Failed to fetch drivers',
        data: { fleets: [] },
      };
    }

    return {
      status: 'success',
      action: 'fetch_drivers',
      entity: 'driver',
      message: data.message || 'Drivers fetched successfully',
      // Map 'agents' to 'fleets' for backward compatibility
      data: { fleets: data.data?.agents || [] },
    };
  } catch (error) {
    console.error('Fetch drivers error:', error);
    return {
      status: 'error',
      action: 'fetch_drivers',
      entity: 'driver',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { fleets: [] },
    };
  }
}

/**
 * Fetch all customers
 */
export async function fetchAllCustomers(): Promise<TookanApiResponse<{ customers: any[] }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/customers`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_customers',
        entity: 'customer',
        message: data.message || 'Failed to fetch customers',
        data: { customers: [] },
      };
    }

    return {
      status: 'success',
      action: 'fetch_customers',
      entity: 'customer',
      message: data.message || 'Customers fetched successfully',
      data: data.data || { customers: [] },
    };
  } catch (error) {
    console.error('Fetch customers error:', error);
    return {
      status: 'error',
      action: 'fetch_customers',
      entity: 'customer',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { customers: [] },
    };
  }
}

/**
 * Fetch reports totals (FAST - only counts)
 */
export async function fetchReportsTotals(): Promise<TookanApiResponse<{
  totals: {
    orders: number;
    drivers: number;
    customers: number;
    deliveries: number;
  };
}>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/reports/totals`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_reports_totals',
        entity: 'report',
        message: data.message || 'Failed to fetch totals',
        data: {
          totals: { orders: 0, drivers: 0, customers: 0, deliveries: 0 },
        },
      };
    }

    return {
      status: 'success',
      action: 'fetch_reports_totals',
      entity: 'report',
      message: 'Totals fetched successfully',
      data: data.data || { totals: { orders: 0, drivers: 0, customers: 0, deliveries: 0 } },
    };
  } catch (error) {
    console.error('Fetch reports totals error:', error);
    return {
      status: 'error',
      action: 'fetch_reports_totals',
      entity: 'report',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {
        totals: { orders: 0, drivers: 0, customers: 0, deliveries: 0 },
      },
    };
  }
}

/**
 * Fetch reports summary
 */
export async function fetchReportsSummary(
  params?: { dateFrom?: string; dateTo?: string }
): Promise<TookanApiResponse<{
  orders: any[];
  drivers: any[];
  customers: any[];
  driverSummaries: DriverSummary[];
  merchantSummaries: MerchantSummary[];
  totals: {
    orders: number;
    drivers: number;
    customers: number;
    deliveries: number;
  };
}>> {
  try {
    let url = `${API_BASE_URL}/api/reports/summary`;
    const queryParams = new URLSearchParams();

    if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
    if (params?.dateTo) queryParams.append('dateTo', params.dateTo);

    if (queryParams.toString()) {
      url += `?${queryParams.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_reports_summary',
        entity: 'report',
        message: data.message || 'Failed to fetch reports summary',
        data: {
          orders: [],
          drivers: [],
          customers: [],
          driverSummaries: [],
          merchantSummaries: [],
          totals: {
            orders: 0,
            drivers: 0,
            customers: 0,
            deliveries: 0,
          },
        },
      };
    }

    return {
      status: 'success',
      action: 'fetch_reports_summary',
      entity: 'report',
      message: data.message || 'Reports summary fetched successfully',
      data: data.data || {
        orders: [],
        drivers: [],
        customers: [],
        driverSummaries: [],
        merchantSummaries: [],
        totals: {
          orders: 0,
          drivers: 0,
          customers: 0,
          deliveries: 0,
        },
      },
    };
  } catch (error) {
    console.error('Fetch reports summary error:', error);
    return {
      status: 'error',
      action: 'fetch_reports_summary',
      entity: 'report',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {
        orders: [],
        drivers: [],
        customers: [],
        driverSummaries: [],
        merchantSummaries: [],
        totals: {
          orders: 0,
          drivers: 0,
          customers: 0,
          deliveries: 0,
        },
      },
    };
  }
}

/**
 * Get tag configuration
 */
export async function getTagConfig(): Promise<TookanApiResponse<TagConfig>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/tags/config`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'get_tag_config',
        entity: 'tag',
        message: data.message || 'Failed to get tag configuration',
        data: {},
      };
    }

    return {
      status: 'success',
      action: 'get_tag_config',
      entity: 'tag',
      message: data.message || 'Tag configuration retrieved successfully',
      data: data.data || {},
    };
  } catch (error) {
    console.error('Get tag config error:', error);
    return {
      status: 'error',
      action: 'get_tag_config',
      entity: 'tag',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

/**
 * Update tag configuration
 */
export async function updateTagConfig(
  config: TagConfig
): Promise<TookanApiResponse<TagConfig>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/tags/config`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(config),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'update_tag_config',
        entity: 'tag',
        message: data.message || 'Failed to update tag configuration',
        data: {},
      };
    }

    return {
      status: 'success',
      action: 'update_tag_config',
      entity: 'tag',
      message: data.message || 'Tag configuration updated successfully',
      data: data.data || {},
    };
  } catch (error) {
    console.error('Update tag config error:', error);
    return {
      status: 'error',
      action: 'update_tag_config',
      entity: 'tag',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {},
    };
  }
}

/**
 * Suggest tags
 */
export async function suggestTags(
  data: any
): Promise<TookanApiResponse<{ tags: string[] }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tookan/tags/suggest`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!response.ok || result.status !== 'success') {
      return {
        status: 'error',
        action: 'suggest_tags',
        entity: 'tag',
        message: result.message || 'Failed to suggest tags',
        data: { tags: [] },
      };
    }

    return {
      status: 'success',
      action: 'suggest_tags',
      entity: 'tag',
      message: result.message || 'Tags suggested successfully',
      data: result.data || { tags: [] },
    };
  } catch (error) {
    console.error('Suggest tags error:', error);
    return {
      status: 'error',
      action: 'suggest_tags',
      entity: 'tag',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { tags: [] },
    };
  }
}

/**
 * Fetch withdrawal requests
 */
export async function fetchWithdrawalRequests(): Promise<TookanApiResponse<WithdrawalRequest[]>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/withdrawal/requests`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_withdrawal_requests',
        entity: 'withdrawal',
        message: data.message || 'Failed to fetch withdrawal requests',
        data: [],
      };
    }

    return {
      status: 'success',
      action: 'fetch_withdrawal_requests',
      entity: 'withdrawal',
      message: data.message || 'Withdrawal requests fetched successfully',
      data: data.data?.requests || data.data || [],
    };
  } catch (error) {
    console.error('Fetch withdrawal requests error:', error);
    return {
      status: 'error',
      action: 'fetch_withdrawal_requests',
      entity: 'withdrawal',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: [],
    };
  }
}

/**
 * Approve withdrawal request
 */
export async function approveWithdrawalRequest(
  id: string
): Promise<TookanApiResponse<WithdrawalRequest>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/withdrawal/request/${id}/approve`, {
      method: 'PUT',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'approve_withdrawal',
        entity: 'withdrawal',
        message: data.message || 'Failed to approve withdrawal request',
        data: {} as WithdrawalRequest,
      };
    }

    return {
      status: 'success',
      action: 'approve_withdrawal',
      entity: 'withdrawal',
      message: data.message || 'Withdrawal request approved successfully',
      data: data.data || ({} as WithdrawalRequest),
    };
  } catch (error) {
    console.error('Approve withdrawal request error:', error);
    return {
      status: 'error',
      action: 'approve_withdrawal',
      entity: 'withdrawal',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {} as WithdrawalRequest,
    };
  }
}

/**
 * Reject withdrawal request
 */
export async function rejectWithdrawalRequest(
  id: string,
  reason?: string
): Promise<TookanApiResponse<WithdrawalRequest>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/withdrawal/request/${id}/reject`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'reject_withdrawal',
        entity: 'withdrawal',
        message: data.message || 'Failed to reject withdrawal request',
        data: {} as WithdrawalRequest,
      };
    }

    return {
      status: 'success',
      action: 'reject_withdrawal',
      entity: 'withdrawal',
      message: data.message || 'Withdrawal request rejected successfully',
      data: data.data || ({} as WithdrawalRequest),
    };
  } catch (error) {
    console.error('Reject withdrawal request error:', error);
    return {
      status: 'error',
      action: 'reject_withdrawal',
      entity: 'withdrawal',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: {} as WithdrawalRequest,
    };
  }
}

// ============================================================
// CACHED ORDERS & AGENTS ENDPOINTS
// ============================================================

/**
 * Agent data type
 */
export interface AgentData {
  fleet_id: number;
  name: string;
  email?: string;
  phone?: string;
  username?: string;
  status?: number;
  is_active: boolean;
  team_id?: number;
  team_name?: string;
  last_synced_at?: string;
}

/**
 * Cached order filters
 */
export interface CachedOrderFilters {
  dateFrom?: string;
  dateTo?: string;
  driverId?: string;
  customerId?: string;
  status?: string;
  search?: string;
  limit?: number;
  page?: number;
}

/**
 * Fetch cached orders from database
 */
export async function fetchCachedOrders(
  filters?: CachedOrderFilters
): Promise<TookanApiResponse<{ orders: OrderData[]; total: number; page: number; limit: number; hasMore: boolean }>> {
  try {
    let url = `${API_BASE_URL}/api/tookan/orders/cached`;
    const params = new URLSearchParams();

    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.driverId) params.append('driverId', filters.driverId);
    if (filters?.customerId) params.append('customerId', filters.customerId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.page) params.append('page', filters.page.toString());

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_cached_orders',
        entity: 'order',
        message: data.message || 'Failed to fetch cached orders',
        data: { orders: [], total: 0, page: 1, limit: 50, hasMore: false },
      };
    }

    return {
      status: 'success',
      action: 'fetch_cached_orders',
      entity: 'order',
      message: data.message || 'Cached orders fetched successfully',
      data: data.data || { orders: [], total: 0, page: 1, limit: 50, hasMore: false },
    };
  } catch (error) {
    console.error('Fetch cached orders error:', error);
    return {
      status: 'error',
      action: 'fetch_cached_orders',
      entity: 'order',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { orders: [], total: 0, page: 1, limit: 50, hasMore: false },
    };
  }
}

/**
 * Fetch agents from database
 */
export async function fetchAgentsFromDB(
  filters?: { isActive?: boolean; teamId?: string; search?: string }
): Promise<TookanApiResponse<{ agents: AgentData[]; total: number }>> {
  try {
    let url = `${API_BASE_URL}/api/agents`;
    const params = new URLSearchParams();

    if (filters?.isActive !== undefined) params.append('isActive', filters.isActive.toString());
    if (filters?.teamId) params.append('teamId', filters.teamId);
    if (filters?.search) params.append('search', filters.search);

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_agents',
        entity: 'agent',
        message: data.message || 'Failed to fetch agents',
        data: { agents: [], total: 0 },
      };
    }

    return {
      status: 'success',
      action: 'fetch_agents',
      entity: 'agent',
      message: data.message || 'Agents fetched successfully',
      data: data.data || { agents: [], total: 0 },
    };
  } catch (error) {
    console.error('Fetch agents error:', error);
    return {
      status: 'error',
      action: 'fetch_agents',
      entity: 'agent',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { agents: [], total: 0 },
    };
  }
}

/**
 * Assign driver to order
 * Updates both Tookan API and Supabase database
 */
export async function assignDriverToOrder(
  jobId: string | number,
  fleetId: string | number | null,
  notes?: string
): Promise<TookanApiResponse<{ jobId: string; fleet_id: number | null; fleet_name: string | null; tookan_synced: boolean; database_synced: boolean }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/orders/${jobId}/assign`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        fleet_id: fleetId,
        notes: notes
      }),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'assign_driver',
        entity: 'order',
        message: data.message || 'Failed to assign driver',
        data: { jobId: jobId.toString(), fleet_id: null, fleet_name: null, tookan_synced: false, database_synced: false },
      };
    }

    return {
      status: 'success',
      action: 'assign_driver',
      entity: 'order',
      message: data.message || 'Driver assigned successfully',
      data: data.data || { jobId: jobId.toString(), fleet_id: fleetId, fleet_name: null, tookan_synced: true, database_synced: true },
    };
  } catch (error) {
    console.error('Assign driver error:', error);
    return {
      status: 'error',
      action: 'assign_driver',
      entity: 'order',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { jobId: jobId.toString(), fleet_id: null, fleet_name: null, tookan_synced: false, database_synced: false },
    };
  }
}

/**
 * Sync agents manually
 */
export async function syncAgents(): Promise<TookanApiResponse<{ synced: number; errors: number }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/agents/sync`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'sync_agents',
        entity: 'agent',
        message: data.message || 'Failed to sync agents',
        data: { synced: 0, errors: 0 },
      };
    }

    return {
      status: 'success',
      action: 'sync_agents',
      entity: 'agent',
      message: data.message || 'Agents synced successfully',
      data: data.data || { synced: 0, errors: 0 },
    };
  } catch (error) {
    console.error('Sync agents error:', error);
    return {
      status: 'error',
      action: 'sync_agents',
      entity: 'agent',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: { synced: 0, errors: 0 },
    };
  }
}

/**
 * Fetch driver performance statistics via RPC
 */
export async function fetchDriverPerformance(
  search: string,
  dateFrom?: string,
  dateTo?: string
): Promise<TookanApiResponse<Array<{ fleet_id: number; name: string; total_orders: number; avg_delivery_time: number }>>> {
  try {
    const params = new URLSearchParams();
    params.append('search', search);
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);

    const response = await fetch(`${API_BASE_URL}/api/reports/driver-performance?${params.toString()}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_driver_performance',
        entity: 'report',
        message: data.message || 'Failed to fetch driver performance',
        data: [],
      };
    }

    return {
      status: 'success',
      action: 'fetch_driver_performance',
      entity: 'report',
      message: 'Driver performance fetched successfully',
      data: data.data || [],
    };
  } catch (error) {
    console.error('Fetch driver performance error:', error);
    return {
      status: 'error',
      action: 'fetch_driver_performance',
      entity: 'report',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: [],
    };
  }
}


/**
 * Fetch customer performance statistics via API
 */
export async function fetchCustomerPerformance(
  search: string,
  dateFrom?: string,
  dateTo?: string
): Promise<TookanApiResponse<Array<{ vendor_id: number; customer_name: string; total_orders: number; cod_received: number; order_fees: number; revenue_distribution: number }>>> {
  try {
    const params = new URLSearchParams();
    params.append('search', search);
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);

    const response = await fetch(`${API_BASE_URL}/api/reports/customer-performance?${params.toString()}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return {
        status: 'error',
        action: 'fetch_customer_performance',
        entity: 'report',
        message: data.message || 'Failed to fetch customer performance',
        data: [],
      };
    }

    return {
      status: 'success',
      action: 'fetch_customer_performance',
      entity: 'report',
      message: 'Customer performance fetched successfully',
      data: data.data || [],
    };
  } catch (error) {
    console.error('Fetch customer performance error:', error);
    return {
      status: 'error',
      action: 'fetch_customer_performance',
      entity: 'report',
      message: error instanceof Error ? error.message : 'Network error occurred',
      data: [],
    };
  }
}

// Fetch Tookan Fee Rate
export async function fetchTookanFeeRate(): Promise<{ status: string; feeRate: number }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/settings/tookan-fee`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return {
      status: data.status || 'success',
      feeRate: data.data?.feeRate ?? 0.05,
    };
  } catch (error) {
    console.error('Fetch Tookan fee rate error:', error);
    return { status: 'error', feeRate: 0.05 };
  }
}

// Update Tookan Fee Rate
export async function updateTookanFeeRate(feeRate: number): Promise<{ status: string; feeRate: number; message?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/settings/tookan-fee`, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ feeRate }),
    });

    const data = await response.json();

    if (data.status !== 'success') {
      return {
        status: 'error',
        feeRate: feeRate,
        message: data.message || 'Failed to update fee rate',
      };
    }

    return {
      status: 'success',
      feeRate: data.data?.feeRate ?? feeRate,
    };
  } catch (error) {
    console.error('Update Tookan fee rate error:', error);
    return {
      status: 'error',
      feeRate: feeRate,
      message: error instanceof Error ? error.message : 'Network error occurred',
    };
  }
}