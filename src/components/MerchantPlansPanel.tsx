import { useState, useEffect } from 'react';
import { Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import {
  Plus,
  Edit2,
  Trash2,
  X,
  CheckCircle,
  XCircle,
  Package,
  Users,
  DollarSign,
  Percent,
  UserPlus,
  UserMinus,
  Link,
  Search
} from 'lucide-react';
import { fetchAllCustomers, fetchReportsSummary } from '../services/tookanApi';
import { toast } from 'sonner';



interface Plan {
  id: string;
  name: string;
  feeType: 'fixed' | 'percentage';
  feeAmount: number;
  feePercentage: number;
  description: string;
  merchantCount: number;
  createdBy: string;
  lastUpdated: string;
}

interface Merchant {
  id: string;
  vendorId: string;
  name: string;
  phone: string;
  planId: string | null;
}

export function MerchantPlansPanel() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [isLoadingMerchants, setIsLoadingMerchants] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [selectedPlanForAssign, setSelectedPlanForAssign] = useState<Plan | null>(null);
  const [totalCustomers, setTotalCustomers] = useState(0);

  // Quick Link State
  const [searchVendorId, setSearchVendorId] = useState<string>('');
  const [selectedPlanForLink, setSelectedPlanForLink] = useState<string>('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchedCustomer, setSearchedCustomer] = useState<{ id: string; vendorId: string; name: string; phone: string; planId: string | null } | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Search customer from database when vendor_id changes
  useEffect(() => {
    const searchCustomer = async () => {
      const vendorId = searchVendorId.trim();
      if (!vendorId) {
        setSearchedCustomer(null);
        return;
      }

      setIsSearching(true);
      try {
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${API_BASE_URL}/api/customers/search?vendor_id=${encodeURIComponent(vendorId)}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });

        const data = await response.json();
        if (response.ok && data.status === 'success' && data.data?.customer) {
          const c = data.data.customer;
          setSearchedCustomer({
            id: c.id?.toString() || '',
            vendorId: c.vendor_id?.toString() || '',
            name: c.customer_name || 'Unknown Merchant',
            phone: c.customer_phone || '',
            planId: c.plan_id || null
          });
        } else {
          setSearchedCustomer(null);
        }
      } catch (error) {
        console.error('Search customer error:', error);
        setSearchedCustomer(null);
      } finally {
        setIsSearching(false);
      }
    };

    // Debounce search
    const timeoutId = setTimeout(searchCustomer, 300);
    return () => clearTimeout(timeoutId);
  }, [searchVendorId]);

  // Fetch merchant plans on mount
  useEffect(() => {
    const loadPlans = async () => {
      setIsLoadingPlans(true);
      try {
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${API_BASE_URL}/api/merchant-plans`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });

        const data = await response.json();
        if (response.ok && data.status === 'success' && data.data?.plans) {
          const mappedPlans: Plan[] = data.data.plans.map((p: any) => ({
            id: p.id,
            name: p.name,
            feeType: p.type as 'fixed' | 'percentage',
            feeAmount: p.type === 'fixed' ? Number(p.amount) : 0,
            feePercentage: p.type === 'percentage' ? Number(p.amount) : 0,
            description: p.description || '',
            merchantCount: 0, // Count will be updated separately or left as 0 for now
            createdBy: 'Admin',
            lastUpdated: p.updated_at ? new Date(p.updated_at).toISOString().split('T')[0] :
              (p.created_at ? new Date(p.created_at).toISOString().split('T')[0] : '-')
          }));
          setPlans(mappedPlans);
        } else {
          setPlans([]);
        }
      } catch (error) {
        console.error('Error loading plans:', error);
        setPlans([]);
      } finally {
        setIsLoadingPlans(false);
      }
    };
    loadPlans();
  }, [refreshTrigger]);

  // Fetch merchants on mount
  useEffect(() => {
    const loadMerchants = async () => {
      setIsLoadingMerchants(true);
      try {
        const response = await fetchAllCustomers();
        if (response.status === 'success' && response.data?.customers) {
          const customersList = response.data.customers;
          const merchantsData: Merchant[] = customersList.map((customer: any) => ({
            id: customer.id?.toString() || customer.vendor_id?.toString() || '',
            vendorId: customer.vendor_id?.toString() || customer.id?.toString() || '', // Explicitly map vendor_id
            name: customer.customer_name || customer.name || 'Unknown Merchant',
            phone: customer.customer_phone || customer.phone || '',
            planId: customer.plan_id || customer.planId || null
          }));
          setMerchants(merchantsData);
        } else {
          toast.error(response.message || 'Failed to load merchants');
        }
      } catch (error) {
        console.error('Error loading merchants:', error);
        toast.error('Failed to load merchants');
      } finally {
        setIsLoadingMerchants(false);
      }
    };
    loadMerchants();
  }, []);

  // Fetch total customer count
  useEffect(() => {
    const loadCustomerCount = async () => {
      try {
        const result = await fetchReportsSummary({});
        if (result.status === 'success' && result.data?.totals?.customers) {
          setTotalCustomers(result.data.totals.customers);
        }
      } catch (error) {
        console.error('Error loading customer count:', error);
      }
    };
    loadCustomerCount();
  }, []);

  // Plan form state
  const [planForm, setPlanForm] = useState({
    name: '',
    feeType: 'fixed' as 'fixed' | 'percentage',
    feeAmount: 0,
    feePercentage: 0,
    description: '',
  });

  // Get fee rule summary
  const getFeeRuleSummary = (plan: Plan) => {
    switch (plan.feeType) {
      case 'fixed':
        return `$${(plan.feeAmount || 0).toFixed(2)} per order`;
      case 'percentage':
        return `${plan.feePercentage}% of order value`;

      default:
        return '-';
    }
  };

  // Handle plan submission
  const handleSavePlan = async () => {
    if (!planForm.name) {
      toast.error('Plan name is required');
      return;
    }

    try {
      const payload = {
        name: planForm.name,
        description: planForm.description,
        type: planForm.feeType,
        amount: planForm.feeType === 'fixed' ? Number(planForm.feeAmount) : Number(planForm.feePercentage)
      };

      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const token = localStorage.getItem('auth_token');
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };

      let response;
      if (editingPlan) {
        response = await fetch(`${API_BASE_URL}/api/merchant-plans/${editingPlan.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload)
        });
      } else {
        response = await fetch(`${API_BASE_URL}/api/merchant-plans`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      const data = await response.json();
      if (data.status === 'success') {
        toast.success(editingPlan ? 'Plan updated successfully' : 'Plan created successfully');
        setRefreshTrigger(prev => prev + 1);
        resetPlanForm();
      } else {
        toast.error(data.message || 'Failed to save plan');
      }
    } catch (error) {
      console.error('Error saving plan:', error);
      toast.error('Failed to save plan');
    }
  };

  // Reset plan form
  const resetPlanForm = () => {
    setPlanForm({
      name: '',
      feeType: 'fixed',
      feeAmount: 0,
      feePercentage: 0,
      description: '',
    });
    setEditingPlan(null);
    setShowPlanForm(false);
  };

  // Handle edit plan
  const handleEditPlan = (plan: Plan) => {
    setEditingPlan(plan);
    setPlanForm({
      name: plan.name,
      feeType: plan.feeType,
      feeAmount: plan.feeAmount,
      feePercentage: plan.feePercentage,
      description: plan.description,
    });
    setShowPlanForm(true);
  };

  // Handle delete plan
  const handleDeletePlan = async (planId: string) => {
    if (confirm('Are you sure you want to delete this plan?')) {
      try {
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
        const token = localStorage.getItem('auth_token');

        const response = await fetch(`${API_BASE_URL}/api/merchant-plans/${planId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });

        const data = await response.json();
        if (data.status === 'success') {
          toast.success('Plan deleted successfully');
          setRefreshTrigger(prev => prev + 1);
        } else {
          toast.error(data.message || 'Failed to delete plan');
        }
      } catch (error) {
        console.error('Error deleting plan:', error);
        toast.error('Failed to delete plan');
      }
    }
  };

  // Handle merchant assignment
  const handleAssignMerchant = (merchantId: string) => {
    if (!selectedPlanForAssign) return;
    setMerchants(merchants.map(m =>
      m.id === merchantId ? { ...m, planId: selectedPlanForAssign.id } : m
    ));
  };

  // Handle merchant unassignment
  const handleUnassignMerchant = (merchantId: string) => {
    setMerchants(merchants.map(m =>
      m.id === merchantId ? { ...m, planId: null } : m
    ));
  };

  // Handle Quick Link (persists to database)
  const handleQuickLink = async () => {
    if (!searchedCustomer || !selectedPlanForLink) {
      toast.error('Please find a merchant and select a plan');
      return;
    }

    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_BASE_URL}/api/customers/${searchedCustomer.id}/plan`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ plan_id: selectedPlanForLink })
      });

      const data = await response.json();
      if (response.ok && data.status === 'success') {
        toast.success('Plan linked to merchant successfully');
        // Update local state
        setMerchants(merchants.map(m =>
          m.id === searchedCustomer.id
            ? { ...m, planId: selectedPlanForLink }
            : m
        ));
        // Reset selection
        setSearchVendorId('');
        setSelectedPlanForLink('');
        setSearchedCustomer(null);
      } else {
        toast.error(data.message || 'Failed to link plan');
      }
    } catch (error) {
      console.error('Link plan error:', error);
      toast.error('Failed to link plan to merchant');
    }
  };



  // Open new plan form
  const openNewPlanForm = () => {
    resetPlanForm();
    setShowPlanForm(true);
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading text-3xl mb-2 font-bold">Merchant Plans</h1>
          <p className="text-subheading dark:text-[#99BFD1] text-muted-light">Manage pricing plans and assign merchants</p>
        </div>
        <button
          onClick={openNewPlanForm}
          className="flex items-center gap-2 px-6 py-3 bg-destructive dark:bg-[#C1EEFA] text-white dark:text-[#1A2C53] rounded-xl hover:shadow-lg transition-all font-semibold"
        >
          <Plus className="w-5 h-5" />
          New Plan
        </button>
      </div>

      {/* Inline Plan Form Section */}
      {showPlanForm && (
        <div className="bg-card rounded-2xl border border-border p-8 shadow-lg transition-all duration-300 animate-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-heading dark:text-[#C1EEFA] text-2xl font-bold mb-1">
                {editingPlan ? 'Edit Plan' : 'Create New Plan'}
              </h2>
              <p className="text-muted-light dark:text-[#99BFD1] text-sm">
                {editingPlan ? 'Update plan details and fee structure' : 'Set up a new pricing plan for merchants'}
              </p>
            </div>
            <button
              onClick={resetPlanForm}
              className="p-2.5 hover:bg-muted dark:hover:bg-[#2A3C63] rounded-xl transition-all hover:scale-110"
            >
              <X className="w-5 h-5 text-muted-light dark:text-[#99BFD1]" />
            </button>
          </div>

          <div className="space-y-6">
            {/* Plan Name */}
            <div>
              <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2.5 font-semibold">
                Plan Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={planForm.name}
                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                placeholder="e.g., Standard Plan, Premium Plan..."
                className="w-full bg-input-bg dark:bg-[#223560] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-base text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
                autoFocus
              />
            </div>

            {/* Fee Structure */}
            <div>
              <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-3 font-semibold">
                Fee Structure <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPlanForm({ ...planForm, feeType: 'fixed' })}
                  className={`flex-1 p-4 rounded-xl border-2 transition-all transform hover:scale-105 ${planForm.feeType === 'fixed'
                    ? 'bg-primary/10 dark:bg-[#C1EEFA]/10 border-primary dark:border-[#C1EEFA] text-primary dark:text-[#C1EEFA] shadow-lg'
                    : 'border-border dark:border-[#2A3C63] hover:border-primary/50 dark:hover:border-[#C1EEFA]/50 text-muted-light dark:text-[#99BFD1] hover:bg-muted/30 dark:hover:bg-[#223560]/50'
                    }`}
                >
                  <DollarSign className="w-6 h-6 mx-auto mb-2" />
                  <span className="text-sm font-semibold block">Fixed</span>
                  <span className="text-xs text-muted-light dark:text-[#99BFD1] mt-1 block">Flat rate</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPlanForm({ ...planForm, feeType: 'percentage' })}
                  className={`flex-1 p-4 rounded-xl border-2 transition-all transform hover:scale-105 ${planForm.feeType === 'percentage'
                    ? 'bg-primary/10 dark:bg-[#C1EEFA]/10 border-primary dark:border-[#C1EEFA] text-primary dark:text-[#C1EEFA] shadow-lg'
                    : 'border-border dark:border-[#2A3C63] hover:border-primary/50 dark:hover:border-[#C1EEFA]/50 text-muted-light dark:text-[#99BFD1] hover:bg-muted/30 dark:hover:bg-[#223560]/50'
                    }`}
                >
                  <Percent className="w-6 h-6 mx-auto mb-2" />
                  <span className="text-sm font-semibold block">Percentage</span>
                  <span className="text-xs text-muted-light dark:text-[#99BFD1] mt-1 block">% of order</span>
                </button>

              </div>
            </div>

            {/* Fee Amount (Fixed) */}
            {planForm.feeType === 'fixed' && (
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2.5 font-semibold">
                  Fee Amount
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-heading dark:text-[#C1EEFA] font-medium">BHD</span>
                  <input
                    type="number"
                    step="0.01"
                    value={planForm.feeAmount}
                    onChange={(e) => setPlanForm({ ...planForm, feeAmount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="w-full bg-input-bg dark:bg-[#223560] border border-input-border dark:border-[#2A3C63] rounded-xl pl-16 pr-4 py-3 text-base text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
                  />
                </div>
              </div>
            )}

            {/* Fee Percentage */}
            {planForm.feeType === 'percentage' && (
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2.5 font-semibold">
                  Fee Percentage
                </label>
                <div className="relative">
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-heading dark:text-[#C1EEFA] font-medium">%</span>
                  <input
                    type="number"
                    step="0.1"
                    value={planForm.feePercentage}
                    onChange={(e) => setPlanForm({ ...planForm, feePercentage: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                    className="w-full bg-input-bg dark:bg-[#223560] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 pr-12 py-3 text-base text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
                  />
                </div>
              </div>
            )}



            {/* Description */}
            <div>
              <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2.5 font-semibold">
                Description <span className="text-muted-light dark:text-[#99BFD1] text-xs font-normal">(Optional)</span>
              </label>
              <textarea
                value={planForm.description}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                placeholder="Enter a brief description of this plan..."
                rows={3}
                className="w-full bg-input-bg dark:bg-[#223560] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-sm text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-6 border-t border-border dark:border-[#2A3C63]">
              <button
                type="button"
                onClick={resetPlanForm}
                className="px-6 py-3 bg-muted dark:bg-[#2A3C63] hover:bg-muted/80 dark:hover:bg-[#2A3C63]/80 text-heading dark:text-[#C1EEFA] rounded-xl transition-all text-sm font-semibold hover:scale-105"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePlan}
                disabled={!planForm.name}
                className="px-6 py-3 bg-primary dark:bg-[#C1EEFA] text-white dark:text-[#1A2C53] rounded-xl hover:shadow-lg transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 disabled:hover:scale-100"
              >
                {editingPlan ? 'Save Changes' : 'Create Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plan Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-[#C1EEFA]/20 flex items-center justify-center">
              <Package className="w-6 h-6 text-primary dark:text-[#C1EEFA]" />
            </div>
            <div>
              <p className="text-muted-light dark:text-[#99BFD1] text-sm">Total Plans</p>
              <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{plans.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#10B981]/10 dark:bg-[#10B981]/20 flex items-center justify-center">
              <Users className="w-6 h-6 text-[#10B981]" />
            </div>
            <div>
              <p className="text-muted-light dark:text-[#99BFD1] text-sm">Assigned Merchants</p>
              <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">
                {(merchants || []).filter(m => m.planId).length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#F59E0B]/10 dark:bg-[#F59E0B]/20 flex items-center justify-center">
              <Users className="w-6 h-6 text-[#F59E0B]" />
            </div>
            <div>
              <p className="text-muted-light dark:text-[#99BFD1] text-sm">Unassigned Merchants</p>
              <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">
                {totalCustomers}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Link Section */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Link className="w-5 h-5 text-primary dark:text-[#C1EEFA]" />
          <h3 className="text-heading dark:text-[#C1EEFA] font-semibold text-lg">Link Plan to Merchant</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          {/* Merchant Dropdown */}
          <div className="flex-1">
            {/* Merchant Search - Vendor ID Input */}
            <div className="flex-1 space-y-3">
              <div className="relative">
                <InputLabel className="text-heading dark:text-[#C1EEFA] mb-1.5" style={{ color: 'white' }}>Search by Vendor ID</InputLabel>
                <div className="relative">
                  <input
                    type="text"
                    value={searchVendorId}
                    onChange={(e) => setSearchVendorId(e.target.value)}
                    placeholder="Enter Vendor ID (e.g., 12345)"
                    className="w-full bg-input-bg dark:bg-[#223560] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-base text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
                  />
                </div>
              </div>

              {/* Exact Match Details Card */}
              {isSearching ? (
                <div className="bg-muted/30 dark:bg-[#223560]/50 border border-border dark:border-[#2A3C63] rounded-xl p-3 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted/50 dark:bg-[#2A3C63]" />
                    <div className="space-y-2">
                      <div className="h-4 w-32 bg-muted/50 dark:bg-[#2A3C63] rounded" />
                      <div className="h-3 w-24 bg-muted/50 dark:bg-[#2A3C63] rounded" />
                    </div>
                  </div>
                </div>
              ) : searchedCustomer ? (
                <div className="bg-[#10B981]/10 dark:bg-[#10B981]/20 border border-[#10B981]/30 rounded-xl p-3 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#10B981]/20 flex items-center justify-center shrink-0">
                      <CheckCircle className="w-4 h-4 text-[#10B981]" />
                    </div>
                    <div>
                      <p className="text-heading dark:text-[#C1EEFA] text-sm font-bold leading-tight">{searchedCustomer.name}</p>
                      <p className="text-muted-light dark:text-[#99BFD1] text-xs mt-0.5">{searchedCustomer.phone}</p>
                    </div>
                  </div>
                </div>
              ) : searchVendorId.trim() !== '' && (
                <div className="bg-destructive/10 dark:bg-destructive/20 border border-destructive/30 rounded-xl p-3 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
                      <XCircle className="w-4 h-4 text-destructive" />
                    </div>
                    <div>
                      <p className="text-destructive font-semibold text-sm">No merchant found</p>
                      <p className="text-destructive/80 text-xs mt-0.5">Check the Vendor ID</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Plan Dropdown */}
          <div className="flex-1">
            <FormControl fullWidth variant="outlined" size="small" className="bg-input-bg dark:bg-[#223560] rounded-xl">
              <InputLabel id="plan-select-label" className="text-heading dark:text-[#C1EEFA]" style={{ color: 'white' }}>Select Plan</InputLabel>
              <Select
                labelId="plan-select-label"
                value={selectedPlanForLink}
                label="Select Plan"
                onChange={(e) => setSelectedPlanForLink(e.target.value)}
                className="text-heading dark:text-[#C1EEFA]"
                style={{ color: 'white' }}
                inputProps={{
                  className: "text-heading dark:text-[#C1EEFA]",
                  style: { color: 'white' }
                }}
                sx={{
                  '.MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--primary)' },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--primary)' },
                  '.MuiSvgIcon-root': { color: 'var(--muted-foreground)' }
                }}
                MenuProps={{
                  PaperProps: {
                    className: "bg-surface dark:bg-[#1A2C53] text-heading dark:text-[#C1EEFA] border border-border dark:border-[#2A3C63]",
                    sx: {
                      '& .MuiMenuItem-root': {
                        '&:hover': { backgroundColor: 'rgba(var(--primary-rgb), 0.1)' },
                        '&.Mui-selected': { backgroundColor: 'rgba(var(--primary-rgb), 0.2)' },
                        '&.Mui-selected:hover': { backgroundColor: 'rgba(var(--primary-rgb), 0.3)' }
                      }
                    }
                  }
                }}
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {plans.map(plan => (
                  <MenuItem key={plan.id} value={plan.id}>
                    {plan.name} ({getFeeRuleSummary(plan)})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>

          {/* Link Button */}
          <button
            onClick={handleQuickLink}
            disabled={!searchedCustomer || !selectedPlanForLink}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-primary dark:bg-[#C1EEFA] text-white dark:text-[#1A2C53] rounded-xl hover:shadow-lg transition-all font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 disabled:hover:scale-100 h-[40px]"
          >
            <Link className="w-4 h-4" />
            Link Plan
          </button>
        </div>
      </div>

      {/* Plans Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
        <div className="p-6 border-b border-border">
          <h3 className="text-heading dark:text-[#C1EEFA] font-semibold">Plan Overview</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="table-header-bg dark:bg-[#1A2C53]">
              <tr>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Plan Name</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Merchants Assigned</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Fee Rule</th>

                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan, index) => (
                <tr key={plan.id} className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-heading dark:text-[#C1EEFA] font-medium">{plan.name}</p>
                      <p className="text-muted-light dark:text-[#99BFD1] text-sm">{plan.id}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 dark:bg-[#C1EEFA]/10 text-primary dark:text-[#C1EEFA] rounded-lg text-sm font-medium">
                      <Users className="w-4 h-4" />
                      {(merchants || []).filter(m => m.planId === plan.id).length}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {plan.feeType === 'fixed' && <DollarSign className="w-4 h-4 text-[#10B981]" />}
                      {plan.feeType === 'percentage' && <Percent className="w-4 h-4 text-[#3B82F6]" />}

                      <span className="text-heading dark:text-[#C1EEFA] text-sm">{getFeeRuleSummary(plan)}</span>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">

                      <button
                        onClick={() => handleEditPlan(plan)}
                        className="p-2 hover:bg-[#3B82F6]/10 rounded-lg transition-colors"
                        title="Edit Plan"
                      >
                        <Edit2 className="w-4 h-4 text-[#3B82F6]" />
                      </button>
                      <button
                        onClick={() => handleDeletePlan(plan.id)}
                        className="p-2 hover:bg-destructive/10 rounded-lg transition-colors"
                        title="Delete Plan"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assign Merchants Modal - Modern and Sleek */}
      {showAssignModal && selectedPlanForAssign && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setShowAssignModal(false);
              setSelectedPlanForAssign(null);
            }}
          />
          <div
            className="relative bg-card dark:bg-[#1A2C53] rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200 border border-border dark:border-[#2A3C63]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-border dark:border-[#2A3C63]">
              <div>
                <h2 className="text-xl font-bold text-heading dark:text-[#C1EEFA]">Assign Merchants</h2>
                <p className="text-sm text-muted-light dark:text-[#99BFD1] mt-1">
                  {selectedPlanForAssign.name}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedPlanForAssign(null);
                }}
                className="p-2 rounded-xl hover:bg-muted dark:hover:bg-[#2A3C63] transition-all hover:scale-110"
              >
                <X className="w-5 h-5 text-muted-light dark:text-[#99BFD1]" />
              </button>
            </div>

            {/* Merchant List */}
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-4">
              <div className="space-y-2">
                {merchants.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-light dark:text-[#99BFD1] text-sm">No merchants found</p>
                  </div>
                ) : (
                  merchants.map((merchant) => {
                    const isAssigned = merchant.planId === selectedPlanForAssign.id;
                    return (
                      <div
                        key={merchant.id}
                        className={`p-4 rounded-xl border-2 transition-all hover:scale-[1.02] ${isAssigned
                          ? 'bg-[#10B981]/10 dark:bg-[#10B981]/20 border-[#10B981]/30 shadow-sm'
                          : 'bg-muted/20 dark:bg-[#223560]/50 border-border dark:border-[#2A3C63] hover:border-primary/50 dark:hover:border-[#C1EEFA]/50'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-heading dark:text-[#C1EEFA] text-sm font-semibold truncate">{merchant.name}</p>
                            <p className="text-muted-light dark:text-[#99BFD1] text-xs truncate mt-0.5">{merchant.id} • {merchant.phone}</p>
                          </div>
                          {isAssigned ? (
                            <button
                              onClick={() => handleUnassignMerchant(merchant.id)}
                              className="px-4 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-xl text-xs font-semibold transition-all hover:scale-105 whitespace-nowrap"
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAssignMerchant(merchant.id)}
                              className="px-4 py-2 bg-primary/10 dark:bg-[#C1EEFA]/10 hover:bg-primary/20 dark:hover:bg-[#C1EEFA]/20 text-primary dark:text-[#C1EEFA] rounded-xl text-xs font-semibold transition-all hover:scale-105 whitespace-nowrap"
                            >
                              Assign
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-5 border-t border-border dark:border-[#2A3C63]">
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedPlanForAssign(null);
                }}
                className="px-6 py-3 bg-primary dark:bg-[#C1EEFA] text-white dark:text-[#1A2C53] rounded-xl hover:shadow-lg transition-all text-sm font-semibold hover:scale-105"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
