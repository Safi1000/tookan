import { useState, useEffect, useRef } from 'react';
import { Edit3, Trash2, RotateCcw, AlertTriangle, X, Check, Search, Lock, RefreshCw, Clock, Save } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { toast } from 'sonner';
import { 
  fetchOrderDetails, 
  updateOrder, 
  reorderOrder, 
  returnOrder, 
  deleteOrder, 
  checkOrderConflicts,
  fetchAllDrivers,
  updateTaskCOD,
  type OrderData,
  type OrderUpdates 
} from '../services/tookanApi';
import { usePermissions, PERMISSIONS, PermissionGate } from '../contexts/PermissionContext';

export function OrderEditorPanel() {
  const { hasPermission, isAdmin } = usePermissions();
  // Search and Order State
  const [orderSearch, setOrderSearch] = useState('');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Order Data State
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [originalOrderData, setOriginalOrderData] = useState<OrderData | null>(null);
  const [localLastModified, setLocalLastModified] = useState<string | null>(null);

  // Editable Fields State
  const [codAmount, setCodAmount] = useState('');
  const [codCollected, setCodCollected] = useState(false);
  const [orderFees, setOrderFees] = useState('');
  const [assignedDriver, setAssignedDriver] = useState<string | number | null>(null);
  const [notes, setNotes] = useState('');
  const [isUpdatingCOD, setIsUpdatingCOD] = useState(false);

  // Conflict Detection
  const [hasConflict, setHasConflict] = useState(false);
  const [conflictData, setConflictData] = useState<{ localTimestamp: string | null; tookanTimestamp: string } | null>(null);
  const conflictCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Modal States
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteNote, setDeleteNote] = useState('');
  const [newOrderId, setNewOrderId] = useState('');

  // Driver List - fetch from Tookan API
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(false);

  // Fetch drivers on component mount
  useEffect(() => {
    const loadDrivers = async () => {
      setIsLoadingDrivers(true);
      try {
        const result = await fetchAllDrivers();
        if (result.status === 'success' && result.data) {
          const driverList = result.data.fleets.map((fleet: any) => ({
            id: fleet.id || fleet.fleet_id || '',
            name: fleet.name || fleet.fleet_name || 'Unknown Driver'
          }));
          setDrivers(driverList);
        } else {
          // Fallback to empty array if API fails
          setDrivers([]);
        }
      } catch (error) {
        console.error('Failed to load drivers:', error);
        setDrivers([]);
      } finally {
        setIsLoadingDrivers(false);
      }
    };
    loadDrivers();
  }, []);

  // Load order when search is submitted
  const handleSearchOrder = async () => {
    if (!orderSearch.trim()) {
      toast.error('Please enter an Order ID');
      return;
    }

    setIsLoading(true);
    setError(null);
    setHasConflict(false);
    setConflictData(null);

    try {
      const result = await fetchOrderDetails(orderSearch.trim());
      
      if (result.status === 'success' && result.data) {
        const order = result.data;
        setCurrentOrderId(order.orderId);
        setOrderData(order);
        setOriginalOrderData(order);
        setLocalLastModified(order.lastModified || new Date().toISOString());
        
        // Set editable fields
        setCodAmount(order.codAmount.toString());
        setCodCollected(order.codCollected || false);
        setOrderFees(order.orderFees.toString());
        setAssignedDriver(order.assignedDriver);
        setNotes(order.notes || '');

        toast.success('Order loaded successfully');
        
        // Start conflict checking
        startConflictChecking(order.orderId, order.lastModified || new Date().toISOString());
      } else {
        setError(result.message || 'Failed to load order');
        toast.error(result.message || 'Failed to load order');
        setOrderData(null);
        setCurrentOrderId(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error occurred';
      setError(errorMessage);
      toast.error(errorMessage);
      setOrderData(null);
      setCurrentOrderId(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Check for conflicts periodically
  const startConflictChecking = (orderId: string, localTimestamp: string) => {
    // Clear existing interval
    if (conflictCheckIntervalRef.current) {
      clearInterval(conflictCheckIntervalRef.current);
    }

    // Check conflicts every 30 seconds
    conflictCheckIntervalRef.current = setInterval(async () => {
      if (!orderId || !localTimestamp) return;

      try {
        const result = await checkOrderConflicts(orderId, localTimestamp);
        if (result.status === 'success' && result.data) {
          setHasConflict(result.data.hasConflict);
          if (result.data.hasConflict) {
            setConflictData({
              localTimestamp: result.data.localTimestamp,
              tookanTimestamp: result.data.tookanTimestamp
            });
            toast.warning('Order has been updated externally. Please refresh to see latest changes.');
          }
        }
      } catch (err) {
        // Silently fail conflict checks
        console.error('Conflict check error:', err);
      }
    }, 30000); // Check every 30 seconds
  };

  // Stop conflict checking
  const stopConflictChecking = () => {
    if (conflictCheckIntervalRef.current) {
      clearInterval(conflictCheckIntervalRef.current);
      conflictCheckIntervalRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopConflictChecking();
    };
  }, []);

  // Refresh order from Tookan
  const handleRefreshOrder = async () => {
    if (!currentOrderId) return;

    setIsLoading(true);
    setError(null);
    setHasConflict(false);

    try {
      const result = await fetchOrderDetails(currentOrderId);
      
      if (result.status === 'success' && result.data) {
        const order = result.data;
        setOrderData(order);
        setOriginalOrderData(order);
        setLocalLastModified(order.lastModified || new Date().toISOString());
        
        // Update editable fields
        setCodAmount(order.codAmount.toString());
        setCodCollected(order.codCollected || false);
        setOrderFees(order.orderFees.toString());
        setAssignedDriver(order.assignedDriver);
        setNotes(order.notes || '');

        toast.success('Order refreshed from Tookan');
        startConflictChecking(order.orderId, order.lastModified || new Date().toISOString());
      } else {
        toast.error(result.message || 'Failed to refresh order');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error occurred';
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle COD Collected Toggle
  const handleCODCollectedToggle = async () => {
    if (!currentOrderId) {
      toast.error('No order loaded');
      return;
    }

    const newCollectedStatus = !codCollected;
    setIsUpdatingCOD(true);

    try {
      const result = await updateTaskCOD(currentOrderId, {
        cod_collected: newCollectedStatus
      });

      if (result.status === 'success' && result.data) {
        setCodCollected(newCollectedStatus);
        
        // Update order data if available
        if (orderData) {
          setOrderData({
            ...orderData,
            codCollected: newCollectedStatus
          });
        }

        if (result.data.tookan_synced) {
          toast.success(`COD marked as ${newCollectedStatus ? 'collected' : 'not collected'} and synced to Tookan`);
        } else {
          toast.success(`COD marked as ${newCollectedStatus ? 'collected' : 'not collected'} (local storage only)`);
        }
      } else {
        toast.error(result.message || 'Failed to update COD status');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error occurred';
      toast.error(errorMessage);
    } finally {
      setIsUpdatingCOD(false);
    }
  };

  // Save changes to Tookan
  const handleSaveChanges = async () => {
    if (!currentOrderId || !orderData) {
      toast.error('No order loaded');
      return;
    }

    // Validate inputs
    const cod = parseFloat(codAmount);
    const fees = parseFloat(orderFees);

    if (isNaN(cod) || cod < 0) {
      toast.error('Invalid COD amount');
      return;
    }

    if (isNaN(fees) || fees < 0) {
      toast.error('Invalid order fees');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updates: OrderUpdates = {
        codAmount: cod,
        orderFees: fees,
        assignedDriver: assignedDriver,
        notes: notes.trim(),
      };

      const result = await updateOrder(currentOrderId, updates);

      if (result.status === 'success' && result.data) {
        const updatedOrder = result.data;
        setOrderData(updatedOrder);
        setOriginalOrderData(updatedOrder);
        setLocalLastModified(updatedOrder.lastModified || new Date().toISOString());
        setHasConflict(false);
        setConflictData(null);

        toast.success('Order updated successfully');
        startConflictChecking(updatedOrder.orderId, updatedOrder.lastModified || new Date().toISOString());
      } else {
        setError(result.message || 'Failed to update order');
        toast.error(result.message || 'Failed to update order');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error occurred';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Re-order
  const handleReorder = async () => {
    if (!currentOrderId || !orderData) {
      toast.error('No order loaded');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await reorderOrder(currentOrderId, {
        customerName: orderData.customerName,
        customerPhone: orderData.customerPhone,
        customerEmail: orderData.customerEmail,
        pickupAddress: orderData.pickupAddress,
        deliveryAddress: orderData.deliveryAddress,
        codAmount: parseFloat(codAmount),
        orderFees: parseFloat(orderFees),
        assignedDriver: assignedDriver,
        notes: notes.trim(),
      });

      if (result.status === 'success' && result.data) {
        setNewOrderId(result.data.newOrderId);
        setShowReorderModal(true);
        toast.success('Re-order created successfully');
      } else {
        setError(result.message || 'Failed to create re-order');
        toast.error(result.message || 'Failed to create re-order');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error occurred';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Return Order
  const handleReturn = async () => {
    if (!currentOrderId) {
      toast.error('No order loaded');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await returnOrder(currentOrderId);

      if (result.status === 'success' && result.data) {
        setNewOrderId(result.data.returnOrderId);
        setShowReturnModal(true);
        toast.success('Return order created successfully');
      } else {
        setError(result.message || 'Failed to create return order');
        toast.error(result.message || 'Failed to create return order');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error occurred';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Delete Order
  const handleDelete = async () => {
    if (!currentOrderId) {
      toast.error('No order loaded');
      return;
    }

    if (!deleteNote.trim()) {
      toast.error('Deletion note is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await deleteOrder(currentOrderId, deleteNote.trim());

      if (result.status === 'success') {
        if (result.data?.cannotDelete) {
          toast.info('Note added. Successful orders cannot be deleted.');
        } else {
          toast.success('Order deleted successfully');
          // Clear order data
          setOrderData(null);
          setCurrentOrderId(null);
          setOrderSearch('');
          setCodAmount('');
          setOrderFees('');
          setAssignedDriver(null);
          setNotes('');
          stopConflictChecking();
        }
        setShowDeleteModal(false);
        setDeleteNote('');
      } else {
        setError(result.message || 'Failed to delete order');
        toast.error(result.message || 'Failed to delete order');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error occurred';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Check if order can be edited (status check + permission check)
  const canEditOrderStatus = orderData && orderData.status !== 'delivered' && orderData.status !== 'completed' && 
                       orderData.status !== 6 && orderData.status !== 7 && orderData.status !== 8;
  const canEditOrder = canEditOrderStatus && hasPermission(PERMISSIONS.EDIT_ORDER_FINANCIALS);

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-heading text-3xl mb-2">Order Editor Panel</h1>
        <p className="text-subheading">Edit order details and manage order lifecycle with two-way sync</p>
      </div>

      {/* Order ID Search */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <label className="block text-heading mb-2">Order ID Search</label>
        <div className="relative flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
            <input
              type="text"
              placeholder="Enter Order ID to search..."
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearchOrder();
                }
              }}
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-3 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            />
          </div>
          <button
            onClick={handleSearchOrder}
            disabled={isLoading || !orderSearch.trim()}
            className="px-6 py-3 bg-[#C1EEFA] text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Search
              </>
            )}
          </button>
        </div>
        {error && (
          <div className="mt-3 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Conflict Warning */}
      {hasConflict && conflictData && (
        <div className="bg-warning/10 dark:bg-warning/20 border border-warning/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-warning font-semibold mb-1">Order Conflict Detected</h4>
            <p className="text-sm text-heading dark:text-[#C1EEFA] mb-2">
              This order has been modified externally. Your local changes may conflict with the latest version.
            </p>
            <div className="space-y-1 text-xs text-muted-light dark:text-[#99BFD1] mb-3">
              {conflictData.localTimestamp && (
                <div>Local: {new Date(conflictData.localTimestamp).toLocaleString()}</div>
              )}
              <div>Tookan: {new Date(conflictData.tookanTimestamp).toLocaleString()}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRefreshOrder}
                className="px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning rounded-lg text-sm font-medium transition-all flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh from Tookan
              </button>
              <button
                onClick={() => {
                  setHasConflict(false);
                  setConflictData(null);
                }}
                className="px-3 py-1.5 bg-muted dark:bg-[#2A3C63] hover:bg-muted/80 dark:hover:bg-[#2A3C63]/80 text-heading dark:text-[#C1EEFA] rounded-lg text-sm font-medium transition-all"
              >
                Keep Local Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Details Section */}
      {orderData && (
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-foreground text-xl">Order Details</h3>
            {localLastModified && (
              <div className="flex items-center gap-2 text-xs text-muted-light dark:text-[#99BFD1]">
                <Clock className="w-4 h-4" />
                <span>Last modified: {new Date(localLastModified).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {/* Order Date */}
            <div>
              <label className="block text-heading mb-2">Order Date</label>
              <div className="relative">
                <input
                  type="text"
                  value={orderData.orderDate ? new Date(orderData.orderDate).toLocaleDateString() : 'N/A'}
                  disabled
                  className="w-full bg-muted dark:bg-[#1A2C53] border-dashed border-2 border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 pr-10 text-heading dark:text-[#C1EEFA] opacity-60 cursor-not-allowed"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground cursor-help" strokeWidth={3} />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>This field is locked and cannot be edited</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Driver */}
            <div>
              <label className="block text-heading mb-2">Assigned Driver</label>
              <select
                value={assignedDriver?.toString() || ''}
                onChange={(e) => setAssignedDriver(e.target.value || null)}
                disabled={!canEditOrder}
                className={`w-full ${canEditOrder ? 'bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63]' : 'bg-muted dark:bg-[#1A2C53] border-dashed border-2 border-input-border dark:border-[#2A3C63] opacity-60 cursor-not-allowed'} rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all`}
              >
                <option value="">Select Driver</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </div>

            {/* COD */}
            <div className="space-y-3">
              <div>
                <label className="block text-heading mb-2">COD Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={codAmount}
                  onChange={(e) => setCodAmount(e.target.value)}
                  disabled={!canEditOrder}
                  className={`w-full ${canEditOrder ? 'bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63]' : 'bg-muted dark:bg-[#1A2C53] border-dashed border-2 border-input-border dark:border-[#2A3C63] opacity-60 cursor-not-allowed'} rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all`}
                />
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={codCollected}
                    onChange={handleCODCollectedToggle}
                    disabled={!currentOrderId || isUpdatingCOD}
                    className="w-5 h-5 rounded border-input-border dark:border-[#2A3C63] text-[#DE3544] focus:ring-[#DE3544] dark:focus:ring-[#C1EEFA] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-heading dark:text-[#C1EEFA]">
                    COD Collected
                    {isUpdatingCOD && <span className="ml-2 text-xs text-muted-foreground">(Updating...)</span>}
                  </span>
                </label>
              </div>
            </div>

            {/* Order Delivery Fee */}
            <div>
              <label className="block text-heading mb-2">Order Delivery Fee ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={orderFees}
                onChange={(e) => setOrderFees(e.target.value)}
                disabled={!canEditOrder}
                className={`w-full ${canEditOrder ? 'bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63]' : 'bg-muted dark:bg-[#1A2C53] border-dashed border-2 border-input-border dark:border-[#2A3C63] opacity-60 cursor-not-allowed'} rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all`}
              />
            </div>

            {/* Distance */}
            <div>
              <label className="block text-heading mb-2">Distance (KM)</label>
              <div className="relative">
                <input
                  type="number"
                  value={orderData.distance?.toFixed(1) || '0.0'}
                  disabled
                  className="w-full bg-muted dark:bg-[#1A2C53] border-dashed border-2 border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 pr-10 text-heading dark:text-[#C1EEFA] opacity-60 cursor-not-allowed"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground cursor-help" strokeWidth={3} />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>This field is locked and cannot be edited</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-heading mb-2">System Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={!canEditOrder}
                placeholder="Add system notes..."
                rows={4}
                className={`w-full ${canEditOrder ? 'bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63]' : 'bg-muted dark:bg-[#1A2C53] border-dashed border-2 border-input-border dark:border-[#2A3C63] opacity-60 cursor-not-allowed'} rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all resize-none`}
              />
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSaveChanges}
            disabled={isSaving || !canEditOrder}
            className="w-full mt-6 bg-[#C1EEFA] text-[#1A2C53] py-3 rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Changes
              </>
            )}
          </button>
          {!canEditOrder && (
            <p className="text-center text-sm text-muted-light dark:text-[#99BFD1] mt-2">
              {!hasPermission(PERMISSIONS.EDIT_ORDER_FINANCIALS) 
                ? 'You do not have permission to edit order financials'
                : `This order cannot be edited (status: ${orderData.status})`}
            </p>
          )}
        </div>
      )}

      {/* Admin Actions - Only shown if user has any relevant permission */}
      {orderData && (hasPermission(PERMISSIONS.PERFORM_REORDER) || hasPermission(PERMISSIONS.PERFORM_RETURN) || hasPermission(PERMISSIONS.DELETE_ONGOING_ORDERS)) && (
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
          <h3 className="text-foreground text-xl mb-4">Admin Actions</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Re-order - Requires perform_reorder permission */}
            <PermissionGate permission={PERMISSIONS.PERFORM_REORDER}>
              <button 
                onClick={handleReorder}
                disabled={isLoading}
                className="flex items-center gap-3 px-6 py-4 bg-[#DE3544]/10 dark:bg-[#C1EEFA]/10 border border-[#DE3544]/30 dark:border-[#C1EEFA]/30 rounded-xl hover:bg-[#DE3544]/20 dark:hover:bg-[#C1EEFA]/20 transition-all text-[#DE3544] dark:text-[#C1EEFA] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-5 h-5" />
                <span>Re-order</span>
              </button>
            </PermissionGate>

            {/* Return Order - Requires perform_return permission */}
            <PermissionGate permission={PERMISSIONS.PERFORM_RETURN}>
              <button 
                onClick={handleReturn}
                disabled={isLoading}
                className="flex items-center gap-3 px-6 py-4 bg-muted/30 dark:bg-[#99BFD1]/10 border border-border dark:border-[#99BFD1]/30 rounded-xl hover:bg-hover-bg-light dark:hover:bg-[#99BFD1]/20 transition-all text-heading dark:text-[#99BFD1] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-5 h-5" />
                <span>Return Order</span>
              </button>
            </PermissionGate>

            {/* Delete Order - Requires delete_ongoing_orders permission (SRS: only ongoing orders) */}
            <PermissionGate permission={PERMISSIONS.DELETE_ONGOING_ORDERS}>
              <button 
                onClick={() => setShowDeleteModal(true)}
                disabled={isLoading}
                className="flex items-center gap-3 px-6 py-4 bg-[#DE3544]/10 border border-[#DE3544]/30 rounded-xl hover:bg-[#DE3544]/20 transition-all text-[#DE3544] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-5 h-5" />
                <span>Delete Order</span>
              </button>
            </PermissionGate>
          </div>
        </div>
      )}

      {/* Re-order Modal */}
      {showReorderModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h3 className="text-heading">Re-order Successful</h3>
                <p className="text-subheading text-sm">New order has been created</p>
              </div>
            </div>
            <div className="bg-muted dark:bg-[#1A2C53] rounded-xl p-4 mb-4">
              <p className="text-subheading text-sm mb-1">New Order ID:</p>
              <p className="text-heading text-xl font-mono">{newOrderId}</p>
            </div>
            <button
              onClick={() => {
                setShowReorderModal(false);
                setOrderSearch(newOrderId);
                handleSearchOrder();
              }}
              className="w-full bg-[#DE3544] dark:bg-[#C1EEFA] text-white dark:text-[#1A2C53] py-3 rounded-xl hover:bg-[#C92A38] dark:hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all font-medium"
            >
              Load New Order
            </button>
          </div>
        </div>
      )}

      {/* Return Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h3 className="text-heading">Return Order Created</h3>
                <p className="text-subheading text-sm">Return order has been generated</p>
              </div>
            </div>
            <div className="bg-muted dark:bg-[#1A2C53] rounded-xl p-4 mb-4">
              <p className="text-subheading text-sm mb-1">Return Order ID:</p>
              <p className="text-heading text-xl font-mono">{newOrderId}</p>
            </div>
            <button
              onClick={() => {
                setShowReturnModal(false);
                setOrderSearch(newOrderId);
                handleSearchOrder();
              }}
              className="w-full bg-[#DE3544] dark:bg-[#C1EEFA] text-white dark:text-[#1A2C53] py-3 rounded-xl hover:bg-[#C92A38] dark:hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all font-medium"
            >
              Load Return Order
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-[#DE3544]/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-[#DE3544]" />
              </div>
              <div>
                <h3 className="text-heading">Delete Order</h3>
                <p className="text-subheading text-sm">This action cannot be undone</p>
              </div>
            </div>
            {orderData && (orderData.status === 'delivered' || orderData.status === 'completed' || 
                          orderData.status === 6 || orderData.status === 7 || orderData.status === 8) && (
              <div className="mb-4 p-3 bg-warning/10 border border-warning/30 rounded-lg">
                <p className="text-sm text-warning">
                  This order is {orderData.status}. Successful orders cannot be deleted, but you can add a note instead.
                </p>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-heading mb-2">
                Deletion Note (Required)
              </label>
              <textarea
                value={deleteNote}
                onChange={(e) => setDeleteNote(e.target.value)}
                placeholder="Please provide a reason for deletion..."
                rows={4}
                className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteNote('');
                }}
                className="flex-1 bg-muted dark:bg-[#2A3C63] text-heading dark:text-[#C1EEFA] py-3 rounded-xl hover:bg-hover-bg-light dark:hover:bg-[#3A4C73] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!deleteNote.trim() || isLoading}
                className="flex-1 bg-[#DE3544] text-white py-3 rounded-xl hover:shadow-[0_0_16px_rgba(222,53,68,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Delete Order'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
