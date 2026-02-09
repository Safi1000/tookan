import { useState, useEffect } from 'react';
import { Check, X, Search, Calendar, CheckCircle, XCircle, RefreshCw, DollarSign, Link, Unlink, Users } from 'lucide-react';
import { toast } from 'sonner';
import { fetchWithdrawalRequests, approveWithdrawalRequest, rejectWithdrawalRequest, type WithdrawalRequest } from '../services/tookanApi';

// Keep mock data as fallback - Customer withdrawals only (per SRS)
const mockWithdrawals = [
  {
    id: 1,
    type: 'customer',
    customerId: 'CUST-001',
    customerName: 'Restaurant A',
    phone: '+973 1234 5678',
    iban: 'BH67 BMAG 0000 1299 1234 56',
    withdrawalAmount: 450.00,
    walletAmount: 1250.00,
    date: '2025-11-28',
    status: 'Pending'
  },
  {
    id: 2,
    type: 'customer',
    customerId: 'CUST-003',
    customerName: 'Cafe C',
    phone: '+973 5555 1234',
    iban: 'BH12 ABCD 0000 9876 5432 10',
    withdrawalAmount: 580.75,
    walletAmount: 2100.00,
    date: '2025-11-26',
    status: 'Approved'
  },
  {
    id: 3,
    type: 'customer',
    customerId: 'CUST-002',
    customerName: 'Shop B',
    phone: '+973 9876 5432',
    iban: 'BH45 IJKL 0000 2222 3333 44',
    withdrawalAmount: 280.00,
    walletAmount: 890.00,
    date: '2025-11-24',
    status: 'Pending'
  },
  {
    id: 4,
    type: 'customer',
    customerId: 'CUST-004',
    customerName: 'Store D',
    phone: '+973 3333 4444',
    iban: 'BH56 MNOP 0000 3333 4444 55',
    withdrawalAmount: 320.00,
    walletAmount: 1450.00,
    date: '2025-11-23',
    status: 'Rejected'
  },
];

export function WithdrawalRequestsPanel() {
  const [customerSearch, setCustomerSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Withdrawal Fees Modal State
  const [showFeesModal, setShowFeesModal] = useState(false);
  const [feesTab, setFeesTab] = useState<'link' | 'unlink'>('link');
  const [withdrawalFee, setWithdrawalFee] = useState('');
  const [linkVendorId, setLinkVendorId] = useState('');
  const [linkedCustomers, setLinkedCustomers] = useState<Array<{ vendorId: string; name: string; phone: string; withdrawFees: number }>>([]);
  const [isLoadingFees, setIsLoadingFees] = useState(false);
  const [currentFee, setCurrentFee] = useState<number | null>(null);

  // Load withdrawal requests
  useEffect(() => {
    loadWithdrawals();
  }, [dateFrom, dateTo]);

  // Fetch linked customers when modal opens
  useEffect(() => {
    if (showFeesModal) {
      loadLinkedCustomers();
      loadCurrentFee();
    }
  }, [showFeesModal]);

  const loadWithdrawals = async () => {
    setIsLoading(true);
    try {
      const result = await fetchWithdrawalRequests();
      if (result.status === 'success' && result.data) {
        setWithdrawals(result.data || []);
      } else {
        // Fallback to mock data if API fails
        setWithdrawals(mockWithdrawals as WithdrawalRequest[]);
      }
    } catch (error) {
      console.error('Failed to load withdrawals:', error);
      setWithdrawals(mockWithdrawals as WithdrawalRequest[]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCurrentFee = async () => {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_BASE_URL}/api/withdrawal-fees/current`, {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        setCurrentFee(data.data.fee);
        setWithdrawalFee(data.data.fee?.toString() || '');
      }
    } catch (error) {
      console.error('Failed to load current fee:', error);
    }
  };

  const loadLinkedCustomers = async () => {
    setIsLoadingFees(true);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_BASE_URL}/api/withdrawal-fees/customers`, {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        setLinkedCustomers(data.data.customers || []);
      }
    } catch (error) {
      console.error('Failed to load linked customers:', error);
    } finally {
      setIsLoadingFees(false);
    }
  };

  const handleSetFee = async () => {
    const feeValue = parseFloat(withdrawalFee);
    if (isNaN(feeValue) || feeValue < 0) {
      toast.error('Please enter a valid fee amount');
      return;
    }

    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_BASE_URL}/api/withdrawal-fees/set`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ fee: feeValue })
      });

      const data = await response.json();
      if (response.ok && data.status === 'success') {
        toast.success(`Withdrawal fee set to $${feeValue.toFixed(2)} for all linked customers`);
        setCurrentFee(feeValue);
        loadLinkedCustomers();
      } else {
        toast.error(data.message || 'Failed to set fee');
      }
    } catch (error) {
      console.error('Failed to set fee:', error);
      toast.error('Failed to set withdrawal fee');
    }
  };

  const handleLinkCustomer = async () => {
    if (!linkVendorId.trim()) {
      toast.error('Please enter a Vendor ID');
      return;
    }

    if (currentFee === null) {
      toast.error('Please set a withdrawal fee first');
      return;
    }

    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_BASE_URL}/api/withdrawal-fees/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ vendor_id: linkVendorId.trim(), fee: currentFee })
      });

      const data = await response.json();
      if (response.ok && data.status === 'success') {
        toast.success('Customer linked to withdrawal fee');
        setLinkVendorId('');
        loadLinkedCustomers();
      } else {
        toast.error(data.message || 'Failed to link customer');
      }
    } catch (error) {
      console.error('Failed to link customer:', error);
      toast.error('Failed to link customer');
    }
  };

  const handleUnlinkCustomer = async (vendorId: string) => {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_BASE_URL}/api/withdrawal-fees/unlink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ vendor_id: vendorId })
      });

      const data = await response.json();
      if (response.ok && data.status === 'success') {
        toast.success('Customer unlinked from withdrawal fee');
        loadLinkedCustomers();
      } else {
        toast.error(data.message || 'Failed to unlink customer');
      }
    } catch (error) {
      console.error('Failed to unlink customer:', error);
      toast.error('Failed to unlink customer');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      const result = await approveWithdrawalRequest(id.toString());
      if (result.status === 'success') {
        toast.success('Withdrawal request approved');
        loadWithdrawals();
      } else {
        toast.error(result.message || 'Failed to approve withdrawal');
      }
    } catch (error) {
      toast.error('Failed to approve withdrawal request');
    }
  };

  const handleReject = async (id: number) => {
    const reason = prompt('Enter rejection reason (optional):');
    try {
      const result = await rejectWithdrawalRequest(id.toString(), reason || undefined);
      if (result.status === 'success') {
        toast.success('Withdrawal request rejected');
        loadWithdrawals();
      } else {
        toast.error(result.message || 'Failed to reject withdrawal');
      }
    } catch (error) {
      toast.error('Failed to reject withdrawal request');
    }
  };


  const getValidationColor = (value: string) => {
    if (!value) return 'border-[#2A3C63] dark:border-[#2A3C63]';
    return value.length > 3
      ? 'border-[#C1EEFA] shadow-[0_0_8px_rgba(193,238,250,0.3)]'
      : 'border-[#DE3544] shadow-[0_0_8px_rgba(222,53,68,0.3)]';
  };

  // Auto-detect search type (ID, Name, or Phone)
  const detectSearchType = (search: string) => {
    if (!search) return 'all';
    if (/^(CUST-)/.test(search) || /^\d+$/.test(search)) return 'id';
    if (/^\+?\d/.test(search)) return 'phone';
    return 'name';
  };

  // Filter withdrawals based on search and date range (customers only per SRS)
  const filteredWithdrawals = (withdrawals || []).filter(withdrawal => {
    // Only show customer withdrawals per SRS
    if (withdrawal.type !== 'customer') return false;

    // Search filter
    if (customerSearch) {
      const searchLower = customerSearch.toLowerCase();
      const searchType = detectSearchType(customerSearch);

      let matchesSearch = false;
      if (searchType === 'id') {
        matchesSearch = withdrawal.customerId?.toLowerCase().includes(searchLower) || false;
      } else if (searchType === 'phone') {
        matchesSearch = withdrawal.phone.includes(customerSearch);
      } else {
        matchesSearch = withdrawal.customerName?.toLowerCase().includes(searchLower) || false;
      }
      if (!matchesSearch) return false;
    }

    // Date range filter
    if (dateFrom && withdrawal.date < dateFrom) return false;
    if (dateTo && withdrawal.date > dateTo) return false;

    return true;
  });

  // Calculate total withdrawal amount for non-confirmed (Pending) requests for each customer
  const getTotalPendingWithdrawal = (withdrawal: WithdrawalRequest) => {
    const identifier = withdrawal.customerId;
    return (withdrawals || [])
      .filter(w => w.customerId === identifier && w.status === 'Pending')
      .reduce((sum, w) => sum + w.withdrawalAmount, 0);
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading text-3xl mb-2">Withdrawal Requests</h1>
          <p className="text-subheading">Review and manage customer withdrawal requests</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowFeesModal(true)}
            className="flex items-center gap-2 px-6 py-3 bg-[#10B981]/10 border border-[#10B981]/30 rounded-xl hover:bg-[#10B981]/20 transition-all text-[#10B981]"
          >
            <DollarSign className="w-5 h-5" />
            Withdrawal Fees
          </button>
          <button
            onClick={loadWithdrawals}
            disabled={isLoading}
            className="flex items-center gap-2 px-6 py-3 bg-card border border-border rounded-xl hover:bg-hover-bg-light dark:hover:bg-[#223560] transition-all text-heading dark:text-[#C1EEFA] disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Customer Search Filters */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <h3 className="text-foreground mb-4">Search Customer Requests</h3>

        <div className="mb-4">
          <label className="block text-heading text-sm mb-2">Search by Customer ID, Name, or Phone Number</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
            <input
              type="text"
              placeholder="Enter Customer ID, Name, or Phone Number..."
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className={`w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-border rounded-xl pl-10 pr-10 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all ${getValidationColor(customerSearch)}`}
            />
            {customerSearch && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {customerSearch.length > 3 ? (
                  <CheckCircle className="w-5 h-5 text-green-500 dark:text-[#C1EEFA]" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#DE3544]" />
                )}
              </div>
            )}
          </div>
          {customerSearch && (
            <p className="text-xs text-muted-light dark:text-[#99BFD1] mt-2">
              Searching by: {detectSearchType(customerSearch) === 'id' ? 'Customer ID' : detectSearchType(customerSearch) === 'phone' ? 'Phone' : 'Name'}
            </p>
          )}
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-heading text-sm mb-2">From Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
              />
            </div>
          </div>
          <div>
            <label className="block text-heading text-sm mb-2">To Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
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

      {/* Customer Withdrawals Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm transition-colors duration-300">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
              <tr>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Customer ID</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Customer Name</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Phone Number</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">IBAN Number</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Requested Amount</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Total Pending</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Wallet Balance</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Date</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Status</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredWithdrawals.map((withdrawal, index) => (
                <tr key={withdrawal.id} className={`border-b border-border dark:border-[#2A3C63] hover:bg-hover-bg-light dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                  <td className="px-6 py-4 text-subheading">{withdrawal.customerId}</td>
                  <td className="px-6 py-4 text-heading">{withdrawal.customerName}</td>
                  <td className="px-6 py-4 text-subheading">{withdrawal.phone}</td>
                  <td className="px-6 py-4 text-subheading font-mono text-sm">{withdrawal.iban}</td>
                  <td className="px-6 py-4 text-[#DE3544] font-semibold">${withdrawal.withdrawalAmount.toFixed(2)}</td>
                  <td className="px-6 py-4 text-[#DE3544] font-semibold">${getTotalPendingWithdrawal(withdrawal).toFixed(2)}</td>
                  <td className="px-6 py-4 text-heading">${withdrawal.walletAmount.toFixed(2)}</td>
                  <td className="px-6 py-4 text-subheading text-sm">{withdrawal.date}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-lg text-xs ${withdrawal.status === 'Pending'
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                      : withdrawal.status === 'Approved'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}>
                      {withdrawal.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {withdrawal.status === 'Pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(withdrawal.id)}
                          className="p-2 bg-[#C1EEFA]/10 border border-[#C1EEFA]/30 rounded-lg hover:bg-[#C1EEFA]/20 transition-all group"
                          title="Approve"
                        >
                          <Check className="w-4 h-4 text-[#C1EEFA] group-hover:scale-110 transition-transform" />
                        </button>
                        <button
                          onClick={() => handleReject(withdrawal.id)}
                          className="p-2 bg-[#DE3544]/10 border border-[#DE3544]/30 rounded-lg hover:bg-[#DE3544]/20 transition-all group"
                          title="Reject"
                        >
                          <X className="w-4 h-4 text-[#DE3544] group-hover:scale-110 transition-transform" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Withdrawal Fees Modal */}
      {showFeesModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center" style={{ padding: '16px' }}>
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-2xl" style={{ width: '100%', maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            {/* Modal Header */}
            <div className="border-b border-border flex items-center justify-between" style={{ padding: '16px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="rounded-xl bg-[#10B981]/10 flex items-center justify-center" style={{ width: '40px', height: '40px', minWidth: '40px' }}>
                  <DollarSign className="w-5 h-5 text-[#10B981]" />
                </div>
                <div>
                  <h2 className="text-heading font-semibold" style={{ fontSize: '18px' }}>Withdrawal Fees</h2>
                  <p className="text-muted-light" style={{ fontSize: '13px' }}>Set fees and manage linked customers</p>
                </div>
              </div>
              <button
                onClick={() => setShowFeesModal(false)}
                className="hover:bg-muted/20 rounded-lg transition-colors"
                style={{ padding: '8px' }}
              >
                <X className="w-5 h-5 text-muted-light" />
              </button>
            </div>

            {/* Fee Setting Section */}
            <div className="border-b border-border" style={{ padding: '16px', flexShrink: 0 }}>
              <label className="block text-heading" style={{ fontSize: '14px', marginBottom: '8px' }}>Fixed Withdrawal Fee</label>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 200px', minWidth: '150px' }}>
                  <DollarSign className="text-[#10B981]" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '20px', height: '20px' }} />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={withdrawalFee}
                    onChange={(e) => setWithdrawalFee(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#10B981] transition-all"
                    style={{ paddingLeft: '40px', paddingRight: '16px', paddingTop: '12px', paddingBottom: '12px' }}
                  />
                </div>
                <button
                  onClick={handleSetFee}
                  className="bg-[#10B981] text-white rounded-xl hover:bg-[#10B981]/90 transition-all font-medium"
                  style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}
                >
                  Set
                </button>
              </div>
              {currentFee !== null && (
                <p className="text-muted-light" style={{ fontSize: '12px', marginTop: '8px' }}>
                  Current fee: <span className="text-[#10B981] font-medium">${currentFee.toFixed(2)}</span> — applied to {linkedCustomers.length} customer(s)
                </p>
              )}
            </div>

            {/* Tabs */}
            <div className="border-b border-border" style={{ padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
              <button
                onClick={() => setFeesTab('link')}
                className={`flex items-center rounded-lg font-medium transition-all ${feesTab === 'link'
                  ? 'bg-[#10B981] text-white'
                  : 'text-muted-light hover:bg-muted/20'
                  }`}
                style={{ padding: '8px 16px', gap: '8px', fontSize: '14px' }}
              >
                <Link style={{ width: '16px', height: '16px' }} />
                <span>Link</span>
              </button>
              <button
                onClick={() => setFeesTab('unlink')}
                className={`flex items-center rounded-lg font-medium transition-all ${feesTab === 'unlink'
                  ? 'bg-[#DE3544] text-white'
                  : 'text-muted-light hover:bg-muted/20'
                  }`}
                style={{ padding: '8px 16px', gap: '8px', fontSize: '14px' }}
              >
                <Unlink style={{ width: '16px', height: '16px' }} />
                <span>Unlink ({linkedCustomers.length})</span>
              </button>
            </div>

            {/* Tab Content */}
            <div style={{ padding: '16px', overflowY: 'auto', flex: '1 1 auto', minHeight: '150px' }}>
              {feesTab === 'link' && (
                <div>
                  <label className="block text-heading" style={{ fontSize: '14px', marginBottom: '8px' }}>Link Customer by Vendor ID</label>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={linkVendorId}
                      onChange={(e) => setLinkVendorId(e.target.value)}
                      placeholder="Enter Vendor ID (e.g., 12345)"
                      className="bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl text-heading dark:text-[#C1EEFA] placeholder-[#5B7894] focus:outline-none focus:border-[#10B981] transition-all"
                      style={{ flex: '1 1 200px', minWidth: '150px', padding: '12px 16px' }}
                    />
                    <button
                      onClick={handleLinkCustomer}
                      disabled={!linkVendorId.trim() || currentFee === null}
                      className="bg-[#10B981] text-white rounded-xl hover:bg-[#10B981]/90 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}
                    >
                      Link
                    </button>
                  </div>
                  {currentFee === null && (
                    <p className="text-[#DE3544]" style={{ fontSize: '12px', marginTop: '8px' }}>⚠️ Set a withdrawal fee first before linking customers</p>
                  )}
                </div>
              )}

              {feesTab === 'unlink' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {isLoadingFees ? (
                    <div className="text-muted-light" style={{ textAlign: 'center', padding: '32px 0' }}>Loading linked customers...</div>
                  ) : linkedCustomers.length === 0 ? (
                    <div className="text-muted-light" style={{ textAlign: 'center', padding: '32px 0' }}>
                      <Users style={{ width: '48px', height: '48px', margin: '0 auto 8px', opacity: 0.5 }} />
                      <p>No customers linked to withdrawal fees</p>
                    </div>
                  ) : (
                    linkedCustomers.map((customer) => (
                      <div
                        key={customer.vendorId}
                        className="bg-muted/10 rounded-xl border border-border"
                        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: '12px' }}
                      >
                        <div style={{ flex: '1 1 200px', minWidth: '0' }}>
                          <p className="text-heading font-medium" style={{ fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.name}</p>
                          <p className="text-muted-light" style={{ fontSize: '12px' }}>
                            ID: {customer.vendorId} • ${customer.withdrawFees?.toFixed(2) || '0.00'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleUnlinkCustomer(customer.vendorId)}
                          className="flex items-center bg-[#DE3544]/10 text-[#DE3544] rounded-lg hover:bg-[#DE3544]/20 transition-colors"
                          style={{ padding: '8px 12px', gap: '6px', fontSize: '13px', whiteSpace: 'nowrap' }}
                        >
                          <Unlink style={{ width: '14px', height: '14px' }} />
                          Unlink
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
