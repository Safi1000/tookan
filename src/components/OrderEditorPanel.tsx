import React, { useEffect, useState } from 'react';
import { Search, RefreshCw, RotateCcw, CornerDownLeft, Save, X, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchCachedOrders,
  reorderOrder,
  returnOrder,
  updateOrder,
  fetchAllDrivers,
  fetchRelatedDeliveryAddress,
} from '../services/tookanApi';

type OrderDetails = {
  jobId: string;
  codAmount: number;
  orderFees: number;
  assignedDriverName: string;
  assignedDriver: number | null;
  notes: string;
  date?: string | null;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  pickupAddress?: string;
  deliveryAddress?: string;
  status?: number | null; // 0=Assigned, 1=Started, 2=Successful, 3=Failed, etc.
};

// Helper to determine if order is successful (completed)
function isOrderSuccessful(status: number | null | undefined): boolean {
  // Status 2 = Successful/Completed in Tookan
  return status === 2;
}

// Helper to determine if order is ongoing (can be deleted)
function isOrderOngoing(status: number | null | undefined): boolean {
  // Ongoing = not yet completed (status 0, 1, or null/undefined)
  return status === 0 || status === 1 || status === null || status === undefined;
}

export function OrderEditorPanel() {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAction, setIsAction] = useState(false);
  const [editCod, setEditCod] = useState('');
  const [editFees, setEditFees] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [agents, setAgents] = useState<Array<{ fleet_id: number; name: string }>>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);

  // Re-order modal state
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [reorderDriver, setReorderDriver] = useState<string>('');
  const [reorderNotes, setReorderNotes] = useState('');
  const [isCreatingReorder, setIsCreatingReorder] = useState(false);

  // Return Order modal state
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnDriver, setReturnDriver] = useState<string>('');
  const [returnNotes, setReturnNotes] = useState('');
  const [isCreatingReturn, setIsCreatingReturn] = useState(false);

  // Load agents from Tookan API (live data)
  const loadAgentsFromTookan = async () => {
    setIsLoadingAgents(true);
    try {
      const result = await fetchAllDrivers();
      console.log('Fetched drivers result:', result); // Debug log
      if (result.status === 'success' && result.data?.fleets) {
        // Backend transforms: fleet_id -> id, fleet_name/username -> name
        // Also check rawData for original Tookan structure
        const validAgents = result.data.fleets
          .filter((f: any) => {
            // Check both transformed id and rawData.fleet_id
            const fleetId = f.id || f.rawData?.fleet_id || f.fleet_id;
            return fleetId != null && fleetId !== undefined;
          })
          .map((f: any) => {
            // Try transformed structure first, then rawData, then fallback
            const fleetId = f.id || f.rawData?.fleet_id || f.fleet_id;
            const name = f.name || f.rawData?.username || f.rawData?.fleet_name || f.rawData?.first_name || f.username || `Driver ${fleetId}`;
            return {
              fleet_id: fleetId,
              name: name
            };
          });
        console.log('Valid agents:', validAgents); // Debug log
        setAgents(validAgents);
      } else {
        console.warn('No fleets in response:', result);
      }
    } catch (err) {
      console.error('Failed to load agents from Tookan', err);
      toast.error('Failed to load drivers from Tookan');
    } finally {
      setIsLoadingAgents(false);
    }
  };

  const loadOrder = async () => {
    if (!search.trim()) {
      toast.error('Enter a Task ID');
      return;
    }
    setIsLoading(true);
    try {
      const result = await fetchCachedOrders({
        page: 1,
        limit: 1,
        search: search.trim()
      });
      const first = result.data?.orders?.[0];
      if (!first) {
        setOrder(null);
        toast.error('Order not found');
        return;
      }

      let pickupAddr = first.pickupAddress || '';
      let deliveryAddr = first.deliveryAddress || '';

      // If pickup === delivery (pickup task), fetch the related delivery address
      if (pickupAddr.trim().toLowerCase() === deliveryAddr.trim().toLowerCase() && first.jobId) {
        console.log('Pickup task detected, fetching related delivery address...');
        const relatedResult = await fetchRelatedDeliveryAddress(first.jobId);
        if (relatedResult.status === 'success' && relatedResult.hasRelatedTask && relatedResult.deliveryAddress) {
          console.log('Found related delivery address:', relatedResult.deliveryAddress);
          deliveryAddr = relatedResult.deliveryAddress;
        }
      }

      setOrder({
        jobId: first.jobId,
        codAmount: first.codAmount || 0,
        orderFees: first.orderFees || 0,
        assignedDriverName: first.assignedDriverName || '',
        assignedDriver: first.assignedDriver ?? null,
        notes: first.notes || '',
        date: first.date || null,
        customerName: first.customerName || '',
        customerPhone: first.customerPhone || '',
        customerEmail: first.customerEmail || '',
        pickupAddress: pickupAddr,
        deliveryAddress: deliveryAddr,
        status: typeof first.status === 'number' ? first.status : (typeof first.status === 'string' ? parseInt(first.status, 10) : null)
      });
      setEditCod((first.codAmount || 0).toString());
      setEditFees((first.orderFees || 0).toString());
      setEditNotes(first.notes || '');
    } catch (err) {
      console.error('Search failed', err);
      toast.error('Failed to fetch order');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!order) return;
    setIsSaving(true);
    try {
      const payload = {
        codAmount: parseFloat(editCod) || 0,
        orderFees: parseFloat(editFees) || 0,
        notes: editNotes.trim()
      };

      const result = await updateOrder(order.jobId, payload as any);
      if (result.status === 'success') {
        setOrder(prev => prev ? ({
          ...prev,
          codAmount: payload.codAmount,
          orderFees: payload.orderFees,
          notes: payload.notes
        }) : prev);
        toast.success('Changes saved');
      } else {
        toast.error(result.message || 'Failed to save');
      }
    } catch (err) {
      console.error('Save error', err);
      toast.error('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const openReorderModal = () => {
    setReorderDriver('');
    setReorderNotes('');
    setShowReorderModal(true);
    loadAgentsFromTookan(); // Fetch fresh agents from Tookan API
  };

  const openReturnModal = () => {
    setReturnDriver('');
    setReturnNotes('');
    setShowReturnModal(true);
    loadAgentsFromTookan(); // Fetch fresh agents from Tookan API
  };

  const handleCreateReorder = async () => {
    if (!order) return;
    setIsCreatingReorder(true);
    try {
      // If reorder notes are blank, use original order's notes (system note)
      const effectiveNotes = reorderNotes.trim() || order.notes || '';

      const result = await reorderOrder(order.jobId, {
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        pickupAddress: order.pickupAddress,
        deliveryAddress: order.deliveryAddress,
        codAmount: order.codAmount,
        orderFees: order.orderFees,
        notes: effectiveNotes,
        assignedDriver: reorderDriver || null
      });
      if (result.status === 'success') {
        toast.success('Re-order created successfully!');
        setShowReorderModal(false);
        setReorderDriver('');
        setReorderNotes('');
      } else {
        toast.error(result.message || 'Failed to create re-order');
      }
    } catch (err) {
      console.error('Reorder error', err);
      toast.error('Failed to create re-order');
    } finally {
      setIsCreatingReorder(false);
    }
  };

  const handleCreateReturn = async () => {
    if (!order) return;
    setIsCreatingReturn(true);
    try {
      // If return notes are blank, use original order's notes
      const effectiveNotes = returnNotes.trim() || order.notes || '';

      // Determine assigned driver:
      // - Empty string: keep original driver
      // - "unassigned": set to null
      // - Number string: parse as driver ID
      let assignedDriverValue: number | null = order.assignedDriver || null;
      if (returnDriver === 'unassigned') {
        assignedDriverValue = null;
      } else if (returnDriver && returnDriver !== '') {
        assignedDriverValue = parseInt(returnDriver, 10);
      }

      // Send ALL order data - keep everything the same except:
      // - Addresses are reversed by backend
      // - COD is removed by backend
      const result = await returnOrder(order.jobId, {
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerEmail: order.customerEmail,
        pickupAddress: order.pickupAddress,
        deliveryAddress: order.deliveryAddress,
        notes: effectiveNotes,
        orderFees: order.orderFees,
        assignedDriver: assignedDriverValue
      });
      if (result.status === 'success') {
        toast.success('Return order created successfully!');
        setShowReturnModal(false);
        setReturnDriver('');
        setReturnNotes('');
      } else {
        toast.error(result.message || 'Failed to create return order');
      }
    } catch (err) {
      console.error('Return order error', err);
      toast.error('Failed to create return order');
    } finally {
      setIsCreatingReturn(false);
    }
  };

  // Locked field style
  const lockedInputClass = "w-full px-3 py-2 bg-gray-100 dark:bg-[#1A2C53]/50 border-2 border-dashed border-gray-300 dark:border-[#2A3C63] rounded-lg text-sm text-gray-500 dark:text-gray-400 cursor-not-allowed";
  // Editable field style
  const editableInputClass = "w-full px-3 py-2 bg-white dark:bg-[#1A2C53] border border-blue-300 dark:border-blue-500 rounded-lg text-sm text-heading focus:ring-2 focus:ring-blue-400 focus:border-blue-400";

  return (
    <div className="p-6 space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-heading leading-tight">
          Order Editor
        </h1>
        <p className="text-sm text-subheading mt-1">
          Search by Task ID, then Re-Order / Return
        </p>
      </div>


      <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6 space-y-5 shadow-sm hover:shadow-md transition-shadow">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-md uppercase text-muted-foreground tracking-wider">Search by Task ID</p>

          </div>
          <button
            onClick={() => { setSearch(''); setOrder(null); }}
            className="text-xs text-muted-foreground hover:text-heading transition-colors font-medium"
          >
            Clear
          </button>
        </div>

        {/* Search Input + Button */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div
            className="w-full max-w-sm flex items-center gap-3 px-4 py-3 rounded-xl border border-input-border dark:border-[#2A3C63] bg-input-bg dark:bg-[#1A2C53] focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 transition-all"
            style={{ marginTop: '15px' }}
          >
            <Search className="w-5 h-5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadOrder()}
              placeholder="Enter Task ID (job_id)"
              className="flex-1 bg-transparent border-0 focus:ring-0 focus:outline-none text-heading text-sm placeholder:text-muted-foreground"
            />
          </div>


          <button
            onClick={loadOrder}
            disabled={isLoading}
            className="px-6 py-3 bg-[#C1EEFA] text-[#1A2C53] rounded-xl flex items-center gap-3 justify-center hover:shadow-xl hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            Search
          </button>
        </div>
      </div>


      {!isLoading && !order && (
        <div className="text-subheading text-sm">No order selected. Search by Task ID to begin.</div>
      )}

      {order && (
        <div className="bg-card dark:bg-[#223560] rounded-xl border border-border dark:border-[#2A3C63] p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6">
            {/* Task Info */}
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Task ID
              </p>
              <p className="text-xl font-mono text-heading leading-snug">
                {order.jobId}
              </p>
              {order.date && (
                <p className="text-sm text-muted-foreground mt-1">
                  {new Date(order.date).toLocaleString()}
                </p>
              )}
            </div>

            {/* COD & Fees */}
            <div className="text-sm text-muted-foreground mt-2 sm:mt-0">
              <span className="font-medium">COD:</span> ${order.codAmount.toFixed(2)} •{" "}
              <span className="font-medium">Fees:</span> ${order.orderFees.toFixed(2)}
            </div>
          </div>


          {/* Locked Fields Section */}
          <div className="space-y-2">

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-subheading text-xs uppercase mb-1">Order Date</p>
                <input
                  value={order.date ? new Date(order.date).toLocaleString() : 'N/A'}
                  disabled
                  className={lockedInputClass}
                />
              </div>
              <div>
                <p className="text-subheading text-xs uppercase mb-1">Driver</p>
                <input
                  value={order.assignedDriverName || 'Unassigned'}
                  disabled
                  className={lockedInputClass}
                />
              </div>
              <div>
                <p className="text-subheading text-xs uppercase mb-1">Customer Name</p>
                <input
                  value={order.customerName || 'N/A'}
                  disabled
                  className={lockedInputClass}
                />
              </div>
              <div>
                <p className="text-subheading text-xs uppercase mb-1">Customer Phone</p>
                <input
                  value={order.customerPhone || 'N/A'}
                  disabled
                  className={lockedInputClass}
                />
              </div>
              <div className="md:col-span-2">
                <p className="text-subheading text-xs uppercase mb-1">Customer Email</p>
                <input
                  value={order.customerEmail || 'N/A'}
                  disabled
                  className={lockedInputClass}
                />
              </div>
            </div>
          </div>

          {/* Editable Fields Section */}
          <div className="space-y-2">

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-subheading text-xs uppercase mb-1">COD Amount ($)</p>
                <input
                  type="number"
                  value={editCod}
                  onChange={(e) => setEditCod(e.target.value)}
                  className={editableInputClass}
                />
              </div>
              <div>
                <p className="text-subheading text-xs uppercase mb-1">Order Delivery Fee ($)</p>
                <input
                  type="number"
                  value={editFees}
                  onChange={(e) => setEditFees(e.target.value)}
                  className={editableInputClass}
                />
              </div>
            </div>

            <div>
              <p className="text-subheading text-xs uppercase mb-1">System Note</p>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                className={editableInputClass}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-[#C1EEFA] text-[#1A2C53] rounded-lg flex items-center gap-2 hover:shadow-lg transition disabled:opacity-50"
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={openReorderModal}
              disabled={isAction}
              className="flex-1 px-4 py-3 bg-[#C1EEFA] text-[#1A2C53] rounded-lg hover:shadow-lg transition disabled:opacity-50 flex items-center gap-2 justify-center"
            >
              <RotateCcw className="w-4 h-4" />
              Re-Order
            </button>
            {/* Return Order Button - Disabled for Pickup Tasks (where Pickup Address == Delivery Address) */}
            <button
              onClick={openReturnModal}
              disabled={isAction || (order.pickupAddress?.trim().toLowerCase() === order.deliveryAddress?.trim().toLowerCase())}
              title={(order.pickupAddress?.trim().toLowerCase() === order.deliveryAddress?.trim().toLowerCase())
                ? "Return Order is not available for Pickup tasks (same pickup & delivery address)"
                : "Create Return Order"}
              className={`flex-1 px-4 py-3 border rounded-lg flex items-center gap-2 justify-center transition
                ${(order.pickupAddress?.trim().toLowerCase() === order.deliveryAddress?.trim().toLowerCase())
                  ? 'bg-muted/50 text-muted-foreground border-border cursor-not-allowed opacity-70'
                  : 'bg-muted dark:bg-[#2A3C63] text-heading dark:text-white border-border dark:border-[#4D6AA5] hover:bg-muted/80 dark:hover:bg-[#324a78] disabled:opacity-50'
                }`}
            >
              <CornerDownLeft className="w-4 h-4" />
              Return Order
            </button>
          </div>

        </div>
      )}

      {/* Re-Order Modal */}
      {showReorderModal && order && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#1A2C53] rounded-2xl border border-border dark:border-[#2A3C63] w-full max-w-md shadow-2xl">
            {/* Header */}
            <div
              className="flex items-center justify-between py-4 border-b border-border dark:border-[#2A3C63]"
              style={{ paddingLeft: '15px', paddingRight: '15px' }}
            >

              <h2 className="text-lg font-bold text-heading">Create Re-Order</h2>
              <button
                onClick={() => setShowReorderModal(false)}
                className="p-1.5 hover:bg-muted rounded-lg transition"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-5 space-y-5 max-h-[70vh] overflow-y-auto">


              {/* Locked Fields */}
              <div className="bg-muted/20 dark:bg-[#0F1D33]/40  p-4 border border-border/40 dark:border-[#2A3C63]/40">

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase mb-1">Customer</p>
                    <p className="text-heading truncate">{order.customerName || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase mb-1">Phone</p>
                    <p className="text-heading truncate">{order.customerPhone || 'N/A'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground text-xs uppercase mb-1">Email</p>
                    <p className="text-heading truncate">{order.customerEmail || 'N/A'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground text-xs uppercase mb-1">Pickup</p>
                    <p className="text-heading truncate">{order.pickupAddress || 'N/A'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground text-xs uppercase mb-1">Delivery</p>
                    <p className="text-heading truncate">{order.deliveryAddress || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase mb-1">COD</p>
                    <p className="text-heading font-mono">${order.codAmount.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase mb-1">Fees</p>
                    <p className="text-heading font-mono">${order.orderFees.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              {/* Editable Fields */}
              <div className="bg-[#C1EEFA]/5  p-4 border border-[#C1EEFA]/15">

                <div className="space-y-3">
                  <div>
                    <p
                      className="text-muted-foreground text-xs uppercase mb-1.5"
                      style={{ paddingBottom: '10px' }}
                    >
                      Assign Driver
                    </p>

                    <select
                      value={reorderDriver}
                      onChange={(e) => setReorderDriver(e.target.value)}
                      disabled={isLoadingAgents}
                      className={editableInputClass + ' text-sm py-2'}
                    >
                      <option value="">Unassigned (Default)</option>
                      {agents.length > 0 ? (
                        agents
                          .filter(a => a.fleet_id != null && a.fleet_id !== undefined)
                          .map(a => (
                            <option key={a.fleet_id} value={a.fleet_id.toString()}>
                              {a.name}
                            </option>
                          ))
                      ) : (
                        !isLoadingAgents && <option disabled>No drivers available</option>
                      )}
                    </select>
                    {isLoadingAgents && <p className="text-xs text-muted-foreground mt-1">Loading...</p>}
                  </div>
                  <div>
                    <p
                      className="text-muted-foreground text-xs uppercase mb-1.5"
                      style={{ paddingBottom: '10px' }}
                    >
                      Notes
                    </p>


                    <textarea
                      value={reorderNotes}
                      onChange={(e) => setReorderNotes(e.target.value)}
                      rows={2}
                      placeholder="Add notes (optional)"
                      className={editableInputClass + ' text-sm py-2 resize-none'}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-center gap-3 px-5 py-4 border-t border-border dark:border-[#2A3C63] bg-muted/10 dark:bg-[#0F1D33]/30 rounded-b-2xl">
              {/* Cancel Button */}
              <button
                onClick={() => setShowReorderModal(false)}
                className="px-6 py-2.5 text-sm font-medium text-heading bg-muted dark:bg-[#2A3C63] rounded-lg hover:bg-muted/80 dark:hover:bg-[#374766] transition-shadow shadow-sm hover:shadow-md"
              >
                Cancel
              </button>

              {/* Create Reorder Button */}
              <button
                onClick={handleCreateReorder}
                disabled={isCreatingReorder}
                className="px-6 py-2.5 text-sm font-semibold text-[#1A2C53] bg-[#C1EEFA] rounded-lg flex items-center gap-2 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingReorder
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <Plus className="w-4 h-4" />
                }
                Create Re-Order
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Return Order Modal */}
      {showReturnModal && order && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#1A2C53] rounded-2xl border border-border dark:border-[#2A3C63] w-full max-w-md shadow-2xl">
            {/* Header */}
            <div
              className="flex items-center justify-between py-4 border-b border-border dark:border-[#2A3C63]"
              style={{ paddingLeft: '15px', paddingRight: '15px' }}
            >
              <h2 className="text-lg font-bold text-heading">Create Return Order</h2>
              <button
                onClick={() => setShowReturnModal(false)}
                className="p-1.5 hover:bg-muted rounded-lg transition"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-5 space-y-5 max-h-[70vh] overflow-y-auto">

              {/* Locked Fields (from original order) */}
              <div className="bg-muted/20 dark:bg-[#0F1D33]/40 p-4 border border-border/40 dark:border-[#2A3C63]/40">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase mb-1">Customer</p>
                    <p className="text-heading truncate">{order.customerName || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase mb-1">Phone</p>
                    <p className="text-heading truncate">{order.customerPhone || 'N/A'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground text-xs uppercase mb-1">Email</p>
                    <p className="text-heading truncate">{order.customerEmail || 'N/A'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground text-xs uppercase mb-1">Original Pickup → Return Delivery</p>
                    <p className="text-heading truncate">{order.pickupAddress || 'N/A'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground text-xs uppercase mb-1">Original Delivery → Return Pickup</p>
                    <p className="text-heading truncate">{order.deliveryAddress || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase mb-1">Fees</p>
                    <p className="text-heading font-mono">{order.orderFees || 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase mb-1">COD</p>
                    <p className="text-heading font-mono text-muted-foreground/50">Removed</p>
                  </div>
                </div>
              </div>

              {/* Editable Fields for Return Order */}
              <div className="bg-[#C1EEFA]/5 p-4 border border-[#C1EEFA]/15">
                <div className="space-y-3">
                  <div>
                    <p
                      className="text-muted-foreground text-xs uppercase mb-1.5"
                      style={{ paddingBottom: '10px' }}
                    >
                      Assign Driver
                    </p>
                    <select
                      value={returnDriver}
                      onChange={(e) => setReturnDriver(e.target.value)}
                      disabled={isLoadingAgents}
                      className={editableInputClass + ' text-sm py-2'}
                    >
                      <option value="">Keep Original Driver ({order.assignedDriverName || 'Unassigned'})</option>
                      <option value="unassigned">Unassigned</option>
                      {agents.length > 0 ? (
                        agents
                          .filter(a => a.fleet_id != null && a.fleet_id !== undefined)
                          .map(a => (
                            <option key={a.fleet_id} value={a.fleet_id.toString()}>
                              {a.name}
                            </option>
                          ))
                      ) : (
                        !isLoadingAgents && <option disabled>No drivers available</option>
                      )}
                    </select>
                    {isLoadingAgents && <p className="text-xs text-muted-foreground mt-1">Loading drivers...</p>}
                  </div>
                  <div>
                    <p
                      className="text-muted-foreground text-xs uppercase mb-1.5"
                      style={{ paddingBottom: '10px' }}
                    >
                      Notes for Return Order
                    </p>
                    <textarea
                      value={returnNotes}
                      onChange={(e) => setReturnNotes(e.target.value)}
                      rows={2}
                      placeholder="Add notes (optional)"
                      className={editableInputClass + ' text-sm py-2 resize-none'}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-center gap-3 px-5 py-4 border-t border-border dark:border-[#2A3C63] bg-muted/10 dark:bg-[#0F1D33]/30 rounded-b-2xl">
              <button
                onClick={() => setShowReturnModal(false)}
                className="px-6 py-2.5 text-sm font-medium text-heading bg-muted dark:bg-[#2A3C63] rounded-lg hover:bg-muted/80 dark:hover:bg-[#374766] transition-shadow shadow-sm hover:shadow-md"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateReturn}
                disabled={isCreatingReturn}
                className="px-6 py-2.5 text-sm font-semibold text-[#1A2C53] bg-[#C1EEFA] rounded-lg flex items-center gap-2 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingReturn ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CornerDownLeft className="w-4 h-4" />}
                Create Return Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
