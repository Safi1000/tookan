import { useState, useEffect } from 'react';
import { Check, X, Search, Calendar, CheckCircle, XCircle, RefreshCw, DollarSign } from 'lucide-react';
import { DatePicker } from './ui/date-picker';
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
  const [withdrawalFee, setWithdrawalFee] = useState('');
  const [currentFee, setCurrentFee] = useState<number | null>(null);

  // Load withdrawal requests
  useEffect(() => {
    loadWithdrawals();
  }, [dateFrom, dateTo]);

  // Fetch current fee when modal opens
  useEffect(() => {
    if (showFeesModal) {
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
        toast.success(`Global withdrawal fee set to BHD${feeValue.toFixed(2)} for all merchants`);
        setCurrentFee(feeValue);
      } else {
        toast.error(data.message || 'Failed to set fee');
      }
    } catch (error) {
      console.error('Failed to set fee:', error);
      toast.error('Failed to set withdrawal fee');
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

  // Auto-detect search type (ID, Email, or IBAN)
  const detectSearchType = (search: string) => {
    if (!search) return 'all';
    if (/^\d+$/.test(search)) return 'id';
    if (search.includes('@')) return 'email';
    return 'iban';
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
      const idStr = (withdrawal.vendor_id || withdrawal.customerId || '').toString().toLowerCase();

      if (searchType === 'id') {
        matchesSearch = idStr.includes(searchLower);
      } else if (searchType === 'email') {
        matchesSearch = (withdrawal.email || '').toLowerCase().includes(searchLower);
      } else {
        matchesSearch = (withdrawal.iban || '').toLowerCase().includes(searchLower);
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
          <p className="text-subheading">Review and manage merchant withdrawal requests</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowFeesModal(true)}
            className="flex items-center gap-2 px-6 py-3 bg-[#10B981]/10 border border-[#10B981]/30 rounded-xl hover:bg-[#10B981]/20 transition-all text-[#10B981]"
          >
            <span className="font-bold text-sm">BHD</span>
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
        <h3 className="text-foreground mb-4">Search Merchant Requests</h3>

        <div className="mb-4">
          <label className="block text-heading text-sm mb-2">Search by Merchant ID, Email, or IBAN</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
            <input
              type="text"
              placeholder="Enter Merchant ID or IBAN..."
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
              Searching by: {detectSearchType(customerSearch) === 'id' ? 'Merchant ID' : detectSearchType(customerSearch) === 'email' ? 'Email' : 'IBAN'}
            </p>
          )}
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-heading text-sm mb-2">From Date</label>
            <DatePicker
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="(YYYY-MM-DD)"
            />
          </div>
          <div>
            <label className="block text-heading text-sm mb-2">To Date</label>
            <DatePicker
              value={dateTo}
              onChange={setDateTo}
              placeholder="(YYYY-MM-DD)"
            />
          </div>
        </div>
      </div>

      {/* Withdrawals Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm transition-colors duration-300">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
              <tr>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Merchant ID</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Merchant Email</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Withdraw Amount</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Tax</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Final Amount</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">IBAN</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-heading text-sm font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredWithdrawals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-light dark:text-[#99BFD1]">
                    No withdrawal requests found
                  </td>
                </tr>
              ) : (
                filteredWithdrawals.map((withdrawal, index) => {
                  const statusLower = (withdrawal.status || '').toLowerCase();
                  return (
                    <tr key={withdrawal.id} className={`border-b border-border dark:border-[#2A3C63] hover:bg-hover-bg-light dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                      <td className="px-6 py-4 text-heading">{withdrawal.vendor_id || withdrawal.customerId || '—'}</td>
                      <td className="px-6 py-4 text-subheading">{withdrawal.email || '—'}</td>
                      <td className="px-6 py-4 text-heading font-semibold">BHD {(withdrawal.requested_amount || withdrawal.withdrawalAmount || 0).toFixed(2)}</td>
                      <td className="px-6 py-4 text-subheading">BHD {(withdrawal.tax_applied || 0).toFixed(2)}</td>
                      <td className="px-6 py-4 text-green-500 font-semibold">BHD {(withdrawal.final_amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-4 text-subheading font-mono text-sm">{withdrawal.iban || '—'}</td>
                      <td className="px-6 py-4">
                        {statusLower === 'pending' ? (
                          <div className="flex items-center gap-2">
                            <span className="px-3 py-1 rounded-lg text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                              Pending
                            </span>
                            <button
                              onClick={() => handleApprove(withdrawal.id)}
                              className="p-1.5 bg-green-500/10 border border-green-500/30 rounded-lg hover:bg-green-500/20 transition-all group"
                              title="Approve"
                            >
                              <Check className="w-4 h-4 text-green-400 group-hover:scale-110 transition-transform" />
                            </button>
                            <button
                              onClick={() => handleReject(withdrawal.id)}
                              className="p-1.5 bg-[#DE3544]/10 border border-[#DE3544]/30 rounded-lg hover:bg-[#DE3544]/20 transition-all group"
                              title="Reject"
                            >
                              <X className="w-4 h-4 text-[#DE3544] group-hover:scale-110 transition-transform" />
                            </button>
                          </div>
                        ) : statusLower === 'approved' ? (
                          <span className="px-3 py-1 rounded-lg text-xs bg-green-500/20 text-green-400 border border-green-500/30">
                            Approved
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-lg text-xs bg-red-500/20 text-red-400 border border-red-500/30">
                            Rejected
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Global Withdrawal Fee Modal */}
      {showFeesModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center" style={{ padding: '16px' }}>
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-2xl" style={{ width: '100%', maxWidth: '480px' }}>
            {/* Modal Header */}
            <div className="border-b border-border flex items-center justify-between" style={{ padding: '16px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="rounded-xl bg-[#10B981]/10 flex items-center justify-center p-2" style={{ width: 'auto', minWidth: '40px', height: '40px' }}>
                  <span className="font-bold text-[#10B981] text-sm">BHD</span>
                </div>
                <div>
                  <h2 className="text-heading font-semibold" style={{ fontSize: '18px' }}>Global Withdrawal Fee</h2>
                  <p className="text-muted-light" style={{ fontSize: '13px' }}>Set a fee applied to all Merchant</p>
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
            <div style={{ padding: '24px 16px' }}>
              <label className="block text-heading" style={{ fontSize: '14px', marginBottom: '8px' }}>Fixed Withdrawal Fee</label>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 200px', minWidth: '150px' }}>
                  <span className="text-[#10B981] font-bold" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px' }}>BHD</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={withdrawalFee}
                    onChange={(e) => setWithdrawalFee(e.target.value)}
                    placeholder="0.000"
                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#10B981] transition-all"
                    style={{ paddingLeft: '48px', paddingRight: '16px', paddingTop: '12px', paddingBottom: '12px' }}
                  />
                </div>
                <button
                  onClick={handleSetFee}
                  className="bg-[#10B981] text-white rounded-xl hover:bg-[#10B981]/90 transition-all font-medium"
                  style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}
                >
                  Set Fee
                </button>
              </div>
              {currentFee !== null ? (
                <p className="text-muted-light" style={{ fontSize: '12px', marginTop: '12px' }}>
                  Current fee: <span className="text-[#10B981] font-semibold">BHD{currentFee.toFixed(2)}</span> — applies to <span className="text-heading font-medium">all merchants</span>
                </p>
              ) : (
                <p className="text-muted-light" style={{ fontSize: '12px', marginTop: '12px' }}>
                  No fee set yet. Enter a value and click "Set Fee" to apply globally.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
