import React, { useEffect, useState } from 'react';
import { Search, RefreshCw, RotateCcw, CornerDownLeft, Save, X, Plus, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchCachedOrders,
  reorderOrder,
  returnOrder,
  updateOrder,
  fetchAllDrivers,
  fetchRelatedDeliveryAddress,
  deleteTask,
  updateTaskStatus,
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
  connectedTaskId?: string | number | null; // Connected pickup/delivery task ID
  isPickupTask?: boolean; // True if original task is a pickup task (original pickup == delivery)
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
  const [reorderCod, setReorderCod] = useState('');
  const [reorderFees, setReorderFees] = useState('');
  const [isCreatingReorder, setIsCreatingReorder] = useState(false);

  // Return Order modal state
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnDriver, setReturnDriver] = useState<string>('');
  const [returnNotes, setReturnNotes] = useState('');
  const [isCreatingReturn, setIsCreatingReturn] = useState(false);

  // Status update state
  const [editStatus, setEditStatus] = useState<string>('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);

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
        search: search.trim(),
        includePickups: true
      });
      const first = result.data?.orders?.[0];
      if (!first) {
        setOrder(null);
        toast.error('Order not found');
        return;
      }

      let pickupAddr = first.pickupAddress || '';
      let deliveryAddr = first.deliveryAddress || '';
      let connectedTaskId: string | number | null = null;

      // Determine task type BEFORE modifying addresses (original addresses comparison)
      const isPickupTask = pickupAddr.trim().toLowerCase() === deliveryAddr.trim().toLowerCase();

      // If pickup === delivery (pickup task), fetch the related delivery address for display
      if (isPickupTask && first.jobId) {
        console.log('Pickup task detected, fetching related delivery address...');
        const relatedResult = await fetchRelatedDeliveryAddress(first.jobId);
        if (relatedResult.status === 'success' && relatedResult.hasRelatedTask) {
          if (relatedResult.deliveryAddress) {
            console.log('Found related delivery address:', relatedResult.deliveryAddress);
            deliveryAddr = relatedResult.deliveryAddress;
          }
          if (relatedResult.deliveryJobId) {
            connectedTaskId = relatedResult.deliveryJobId;
            console.log('Found connected task ID:', connectedTaskId);
          }
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
        status: typeof first.status === 'number' ? first.status : (typeof first.status === 'string' ? parseInt(first.status, 10) : null),
        connectedTaskId: connectedTaskId,
        isPickupTask: isPickupTask
      });
      setEditCod((first.codAmount || 0).toString());
      setEditFees((first.orderFees || 0).toString());
      setEditNotes(first.notes || '');
      // Initialize status: use current status value or empty
      const currentStatus = typeof first.status === 'number' ? first.status : (typeof first.status === 'string' ? parseInt(first.status, 10) : null);
      setEditStatus(currentStatus !== null ? String(currentStatus) : '');
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
    setReorderCod('0'); // Default to 0 for reorders (can be changed if needed)
    setReorderFees((order?.orderFees || 0).toString());
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
        codAmount: parseFloat(reorderCod) || 0,
        orderFees: parseFloat(reorderFees) || 0,
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

  // Status update handler
  const handleStatusUpdate = async () => {
    if (!order || !editStatus) return;
    const newStatus = parseInt(editStatus);
    setIsUpdatingStatus(true);
    try {
      const result = await updateTaskStatus(order.jobId, newStatus);
      if (result.status === 'success') {
        const statusLabels: Record<number, string> = { 2: 'Successful', 3: 'Failed', 9: 'Deleted' };
        toast.success(`Status updated to ${statusLabels[newStatus]}`);
        setShowStatusConfirm(false);
        if (newStatus === 9) {
          // Clear order if deleted
          setOrder(null);
          setSearch('');
        } else {
          setOrder(prev => prev ? ({ ...prev, status: newStatus }) : prev);
        }
      } else {
        toast.error(result.message || 'Failed to update status');
      }
    } catch (err) {
      console.error('Status update error', err);
      toast.error('Failed to update status');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Delete Order state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteCallback = async () => {
    if (!order) return;
    setIsDeleting(true);
    try {
      const result = await deleteTask(order.jobId);
      if (result.status === 'success') {
        toast.success(result.message || 'Order deleted successfully');
        setShowDeleteModal(false);
        setOrder(null); // Clear the deleted order from view
        setSearch(''); // Clear search
      } else {
        toast.error(result.message || 'Failed to delete order');
      }
    } catch (err) {
      console.error('Delete error', err);
      toast.error('Failed to delete order');
    } finally {
      setIsDeleting(false);
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
                <p className="text-subheading text-xs uppercase mb-1">COD Amount (BHD)</p>
                <input
                  type="number"
                  value={editCod}
                  onChange={(e) => setEditCod(e.target.value)}
                  className={editableInputClass}
                />
              </div>
              <div>
                <p className="text-subheading text-xs uppercase mb-1">Order Delivery Fee (BHD)</p>
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

          {/* Status Update Section */}
          <div className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-subheading text-xs uppercase mb-1">Change Status</p>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className={editableInputClass + ' py-2'}
                >
                  <option value="" disabled>Select new status</option>
                  <option value="2">✅ Successful</option>
                  <option value="3">❌ Failed</option>
                  <option value="9">🗑️ Deleted</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Current: <span className="font-semibold">
                    {order.status === 0 ? 'Assigned' : order.status === 1 ? 'Started' : order.status === 2 ? 'Successful' : order.status === 3 ? 'Failed' : order.status === 9 || order.status === 10 ? 'Deleted' : `Unknown (${order.status})`}
                  </span>
                  {order.connectedTaskId && <span className="text-orange-500 dark:text-orange-400 ml-2">• Connected task {order.connectedTaskId} will also be updated</span>}
                </p>
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => setShowStatusConfirm(true)}
                  disabled={!editStatus || parseInt(editStatus) === order.status}
                  className="px-5 py-2.5 bg-amber-500 text-white rounded-lg flex items-center gap-2 hover:bg-amber-600 hover:shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold"
                >
                  <RefreshCw className="w-4 h-4" />
                  Update Status
                </button>
              </div>
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

            {/* DELETE Button */}
            <button
              onClick={() => setShowDeleteModal(true)}
              disabled={isAction}
              className="flex-1 px-4 py-3 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/30 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition disabled:opacity-50 flex items-center gap-2 justify-center"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>

        </div>
      )}

      {/* Status Update Confirmation Modal */}
      {showStatusConfirm && order && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#1A2C53] rounded-2xl border border-border dark:border-[#2A3C63] w-[90vw] max-w-[380px] mx-auto shadow-2xl p-5 sm:p-6 space-y-4 sm:space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-full shrink-0 ${editStatus === '9' ? 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                  : editStatus === '3' ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
                    : 'bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                }`}>
                {editStatus === '9' ? <Trash2 className="w-5 h-5 sm:w-6 sm:h-6" />
                  : editStatus === '3' ? <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" />
                    : <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6" />}
              </div>
              <h2 className="text-lg font-bold text-heading">
                {editStatus === '2' ? 'Mark as Successful?' : editStatus === '3' ? 'Mark as Failed?' : 'Delete Task?'}
              </h2>
            </div>

            <div className="text-sm text-muted-foreground space-y-3">
              <p>Are you sure you want to change the status of this task? This will update both Tookan and the database.</p>
              <div className="bg-muted/30 p-3 rounded-lg border border-border/50 text-xs font-mono space-y-1.5 break-all" style={{ margin: 15 }}>
                <p>
                  <span className="font-semibold text-heading">Task ID:</span> {order.jobId}
                </p>
                <p>
                  <span className="font-semibold text-heading">New Status:</span>{' '}
                  <span className={editStatus === '2' ? 'text-green-600 dark:text-green-400' : editStatus === '3' ? 'text-orange-600 dark:text-orange-400' : 'text-red-600 dark:text-red-400'}>
                    {editStatus === '2' ? 'Successful' : editStatus === '3' ? 'Failed' : 'Deleted'}
                  </span>
                </p>
                {order.connectedTaskId && (
                  <p>
                    <span className="font-semibold text-heading">Connected Task:</span>{' '}
                    <span className="text-orange-600 dark:text-orange-400">{order.connectedTaskId} (will also be updated)</span>
                  </p>
                )}
              </div>
              {editStatus === '9' && (
                <div className="flex gap-2 items-start text-red-500/90 dark:text-red-400/90 text-xs bg-red-50 dark:bg-red-900/10 p-2.5 rounded-md" style={{ margin: 15 }}>
                  <p>Warning: Deleting a task is permanent and cannot be undone.</p>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-2">
              <button
                onClick={() => setShowStatusConfirm(false)}
                disabled={isUpdatingStatus}
                className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-heading bg-muted dark:bg-[#2A3C63] rounded-lg hover:bg-muted/80 transition order-1 sm:order-none"
              >
                Cancel
              </button>
              <button
                onClick={handleStatusUpdate}
                disabled={isUpdatingStatus}
                className={`w-full sm:w-auto px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm ${editStatus === '9' ? 'bg-red-600 hover:bg-red-700'
                    : editStatus === '3' ? 'bg-orange-500 hover:bg-orange-600'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
              >
                {isUpdatingStatus ? <RefreshCw className="w-4 h-4 animate-spin" /> : editStatus === '9' ? <Trash2 className="w-4 h-4" /> : editStatus === '3' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                {isUpdatingStatus ? 'Updating...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && order && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#1A2C53] rounded-2xl border border-border dark:border-[#2A3C63] w-[90vw] max-w-[340px] mx-auto shadow-2xl p-5 sm:p-6 space-y-4 sm:space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <div className="p-3 bg-red-100 dark:bg-red-900/20 rounded-full shrink-0">
                <Trash2 className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <h2 className="text-lg font-bold text-heading">Delete Order?</h2>
            </div>

            <div className="text-sm text-muted-foreground space-y-3">
              <p>Are you sure you want to delete this order? This action cannot be undone.</p>
              <div
                className="bg-muted/30 p-3 rounded-lg border border-border/50 text-xs font-mono space-y-1.5 break-all"
                style={{ margin: 15 }}
              >
                <p>
                  <span className="font-semibold text-heading">Task ID:</span> {order.jobId}
                </p>

                <p>
                  <span className="font-semibold text-heading">Task Type:</span>{' '}
                  <span className={order.isPickupTask
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-green-600 dark:text-green-400'}>
                    {order.isPickupTask ? 'Pickup Task' : 'Delivery Task'}
                  </span>
                </p>

                <p>
                  <span className="font-semibold text-heading">Connected Task ID:</span>{' '}
                  {order.connectedTaskId ? (
                    <span className="text-orange-600 dark:text-orange-400">{order.connectedTaskId} (will also be deleted)</span>
                  ) : (
                    <span className="text-muted-foreground">None (Standalone Task)</span>
                  )}
                </p>

                <div className="flex gap-2">
                  <span className="font-semibold text-heading shrink-0">Pickup:</span>
                  <span className="truncate">{order.pickupAddress}</span>
                </div>

                <div className="flex gap-2">
                  <span className="font-semibold text-heading shrink-0">Delivery:</span>
                  <span className="truncate">{order.deliveryAddress}</span>
                </div>
              </div>
              <div
                className="flex gap-2 items-start text-red-500/90 dark:text-red-400/90 text-xs bg-red-50 dark:bg-red-900/10 p-2.5 rounded-md"
                style={{ margin: 15 }}
              >
                <p>Alert: This will delete both the pickup and delivery tasks associated with this order.</p>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-heading bg-muted dark:bg-[#2A3C63] rounded-lg hover:bg-muted/80 transition order-1 sm:order-none"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCallback}
                disabled={isDeleting}
                className="w-full sm:w-auto px-4 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
              >
                {isDeleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Confirm Delete
              </button>
            </div>
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
                  {/* COD and Fees moved to editable section */}
                </div>
              </div>

              {/* Editable Fields */}
              <div className="bg-[#C1EEFA]/5  p-4 border border-[#C1EEFA]/15">

                <div className="space-y-3">
                  {/* Driver Assignment Removed as per request */}
                  {/* 
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
                  */}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-muted-foreground text-xs uppercase mb-1.5">COD Amount (BHD)</p>
                      <input
                        type="number"
                        value={reorderCod}
                        onChange={(e) => setReorderCod(e.target.value)}
                        className={editableInputClass + ' py-2'}
                      />
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs uppercase mb-1.5">Order Fees (BHD)</p>
                      <input
                        type="number"
                        value={reorderFees}
                        onChange={(e) => setReorderFees(e.target.value)}
                        className={editableInputClass + ' py-2'}
                      />
                    </div>
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
                  {/* Driver Assignment Removed as per request */}
                  {/* 
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
                  */}
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
