import React, { useEffect, useState } from 'react';
import { Search, RefreshCw, RotateCcw, Trash2, CornerDownLeft, Save, X, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchCachedOrders,
  reorderOrder,
  returnOrder,
  deleteOrder,
  updateOrder,
  fetchAgentsFromDB,
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
};

export function OrderEditorPanel() {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [deleteNote, setDeleteNote] = useState('');
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

  useEffect(() => {
    const loadAgents = async () => {
      setIsLoadingAgents(true);
      try {
        const result = await fetchAgentsFromDB();
        if (result.status === 'success' && result.data) {
          setAgents(result.data.agents || []);
        }
      } catch (err) {
        console.error('Failed to load agents', err);
      } finally {
        setIsLoadingAgents(false);
      }
    };
    loadAgents();
  }, []);

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
        pickupAddress: first.pickupAddress || '',
        deliveryAddress: first.deliveryAddress || ''
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

  const handleReturn = async () => {
    if (!order) return;
    setIsAction(true);
    try {
      const result = await returnOrder(order.jobId, {});
      if (result.status === 'success') {
        toast.success('Return order created');
      } else {
        toast.error(result.message || 'Failed to create return order');
      }
    } catch (err) {
      console.error('Return order error', err);
      toast.error('Failed to create return order');
    } finally {
      setIsAction(false);
    }
  };

  const handleDelete = async () => {
    if (!order) return;
    setIsAction(true);
    try {
      const result = await deleteOrder(order.jobId);
      if (result.status === 'success') {
        toast.success('Order deleted (or note added for successful orders)');
        setOrder(null);
        setDeleteNote('');
      } else {
        toast.error(result.message || 'Failed to delete');
      }
    } catch (err) {
      console.error('Delete error', err);
      toast.error('Failed to delete');
    } finally {
      setIsAction(false);
    }
  };

  // Locked field style
  const lockedInputClass = "w-full px-3 py-2 bg-gray-100 dark:bg-[#1A2C53]/50 border-2 border-dashed border-gray-300 dark:border-[#2A3C63] rounded-lg text-sm text-gray-500 dark:text-gray-400 cursor-not-allowed";
  // Editable field style
  const editableInputClass = "w-full px-3 py-2 bg-white dark:bg-[#1A2C53] border border-blue-300 dark:border-blue-500 rounded-lg text-sm text-heading focus:ring-2 focus:ring-blue-400 focus:border-blue-400";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-heading">Order Editor</h1>
        <p className="text-subheading text-sm">Search by Task ID, then Re-Order / Return / Delete</p>
      </div>

      <div className="bg-card dark:bg-[#223560] rounded-xl border border-border dark:border-[#2A3C63] p-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadOrder()}
            placeholder="Enter Task ID (job_id)"
            className="w-full pl-9 pr-3 py-2 bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-lg text-heading text-sm"
          />
        </div>
        <button
          onClick={loadOrder}
          disabled={isLoading}
          className="px-4 py-2 bg-[#C1EEFA] text-[#1A2C53] rounded-lg flex items-center gap-2 hover:shadow-lg transition disabled:opacity-50"
        >
          {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Search
        </button>
      </div>

      {!isLoading && !order && (
        <div className="text-subheading text-sm">No order selected. Search by Task ID to begin.</div>
      )}

      {order && (
        <div className="bg-card dark:bg-[#223560] rounded-xl border border-border dark:border-[#2A3C63] p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-subheading text-xs uppercase tracking-wide mb-1">Task ID</p>
              <p className="text-heading text-xl font-mono">{order.jobId}</p>
              {order.date && <p className="text-sm text-muted-foreground mt-1">{new Date(order.date).toLocaleString()}</p>}
            </div>
            <div className="text-sm text-muted-foreground">
              COD: ${order.codAmount.toFixed(2)} • Fees: ${order.orderFees.toFixed(2)}
            </div>
          </div>

          {/* Locked Fields Section */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">🔒 Locked Fields (Read Only)</p>
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
            <p className="text-xs font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wide">✏️ Editable Fields</p>
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
            <button
              onClick={handleReturn}
              disabled={isAction}
              className="flex-1 px-4 py-3 bg-muted dark:bg-[#2A3C63] text-heading rounded-lg hover:bg-muted/80 transition disabled:opacity-50 flex items-center gap-2 justify-center"
            >
              <CornerDownLeft className="w-4 h-4" />
              Return Order
            </button>
          </div>

          {/* Delete Section */}
          <div className="space-y-2">
            <p className="text-subheading text-xs uppercase">Delete Order (note required for successful orders)</p>
            <textarea
              value={deleteNote}
              onChange={(e) => setDeleteNote(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-lg text-sm text-heading"
              placeholder="Add a note (required for successful orders)"
            />
            <button
              onClick={handleDelete}
              disabled={isAction || (!deleteNote.trim())}
              className="px-4 py-3 bg-[#DE3544] text-white rounded-lg hover:bg-[#c92a38] transition disabled:opacity-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete / Add Note
            </button>
          </div>
        </div>
      )}

      {/* Re-Order Modal */}
      {showReorderModal && order && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#1A2C53] rounded-xl border border-border dark:border-[#2A3C63] w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border dark:border-[#2A3C63]">
              <h2 className="text-lg font-bold text-heading">Create Re-Order</h2>
              <button
                onClick={() => setShowReorderModal(false)}
                className="p-1 hover:bg-muted rounded-lg transition"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                This will create a new task with the same details as the original order.
              </p>

              {/* Locked Fields (from original order) */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">🔒 Order Details (Cannot be changed)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                  <div className="md:col-span-2">
                    <p className="text-subheading text-xs uppercase mb-1">Pickup Address</p>
                    <input
                      value={order.pickupAddress || 'N/A'}
                      disabled
                      className={lockedInputClass}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-subheading text-xs uppercase mb-1">Delivery Address</p>
                    <input
                      value={order.deliveryAddress || 'N/A'}
                      disabled
                      className={lockedInputClass}
                    />
                  </div>
                  <div>
                    <p className="text-subheading text-xs uppercase mb-1">COD Amount ($)</p>
                    <input
                      value={order.codAmount.toFixed(2)}
                      disabled
                      className={lockedInputClass}
                    />
                  </div>
                  <div>
                    <p className="text-subheading text-xs uppercase mb-1">Order Fees ($)</p>
                    <input
                      value={order.orderFees.toFixed(2)}
                      disabled
                      className={lockedInputClass}
                    />
                  </div>
                </div>
              </div>

              {/* Editable Fields for Re-order */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wide">✏️ Editable Options</p>
                <div>
                  <p className="text-subheading text-xs uppercase mb-1">Assign Driver</p>
                  <select
                    value={reorderDriver}
                    onChange={(e) => setReorderDriver(e.target.value)}
                    disabled={isLoadingAgents}
                    className={editableInputClass}
                  >
                    <option value="">Unassigned (Default)</option>
                    {agents.map(a => (
                      <option key={a.fleet_id} value={a.fleet_id.toString()}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {isLoadingAgents && <p className="text-xs text-muted-foreground mt-1">Loading drivers…</p>}
                </div>
                <div>
                  <p className="text-subheading text-xs uppercase mb-1">Notes for New Order</p>
                  <textarea
                    value={reorderNotes}
                    onChange={(e) => setReorderNotes(e.target.value)}
                    rows={3}
                    placeholder="Add any notes for this re-order..."
                    className={editableInputClass}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-4 border-t border-border dark:border-[#2A3C63]">
              <button
                onClick={() => setShowReorderModal(false)}
                className="px-4 py-2 bg-muted dark:bg-[#2A3C63] text-heading rounded-lg hover:bg-muted/80 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateReorder}
                disabled={isCreatingReorder}
                className="px-4 py-2 bg-[#C1EEFA] text-[#1A2C53] rounded-lg flex items-center gap-2 hover:shadow-lg transition disabled:opacity-50"
              >
                {isCreatingReorder ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Re-Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
