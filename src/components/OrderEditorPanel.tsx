import { useEffect, useState, useCallback } from 'react';
import { Search, RefreshCw, ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchCachedOrders,
  fetchAgentsFromDB,
  assignDriverToOrder
} from '../services/tookanApi';
import { usePermissions, PERMISSIONS } from '../contexts/PermissionContext';

type OrderRow = {
  jobId: string;
  codAmount: number;
  orderFees: number;
  assignedDriver: number | null;
  assignedDriverName: string;
  notes: string;
  date?: string | null;
};

type AgentOption = { fleet_id: number; name: string };

const PAGE_SIZE = 50;

export function OrderEditorPanel() {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission(PERMISSIONS.EDIT_ORDER_FINANCIALS);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);

  const [search, setSearch] = useState('');
  const [driverFilter, setDriverFilter] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDriver, setEditDriver] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const loadAgents = useCallback(async () => {
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
  }, []);

  const loadOrders = useCallback(async (pageToLoad = 1) => {
    setIsLoading(true);
    try {
      const result = await fetchCachedOrders({
        page: pageToLoad,
        limit: PAGE_SIZE,
        search: search || undefined,
        driverId: driverFilter || undefined
      });

      if (result.status === 'success' && result.data) {
        setOrders(
          (result.data.orders || []).map((o: any) => ({
            jobId: o.jobId,
            codAmount: o.codAmount || 0,
            orderFees: o.orderFees || 0,
            assignedDriver: o.assignedDriver ?? null,
            assignedDriverName: o.assignedDriverName || '',
            notes: o.notes || '',
            date: o.date || null
          }))
        );
        setTotal(result.data.total || 0);
        setHasMore(result.data.hasMore || false);
        setPage(result.data.page || pageToLoad);
      } else {
        toast.error(result.message || 'Failed to fetch orders');
      }
    } catch (err) {
      console.error('Failed to fetch orders', err);
      toast.error('Failed to fetch orders');
    } finally {
      setIsLoading(false);
    }
  }, [search, driverFilter]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    loadOrders(1);
  }, [loadOrders]);

  const startEdit = (order: OrderRow) => {
    if (!canEdit) return;
    setEditingId(order.jobId);
    setEditDriver(order.assignedDriver ? order.assignedDriver.toString() : '');
    setEditNotes(order.notes || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDriver('');
    setEditNotes('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setIsSaving(true);
    try {
      const result = await assignDriverToOrder(editingId, editDriver || null, editNotes.trim());
      if (result.status === 'success') {
        const driverName = agents.find(a => a.fleet_id.toString() === editDriver)?.name || '';
        setOrders(prev => prev.map(o => o.jobId === editingId ? {
          ...o,
          assignedDriver: editDriver ? parseInt(editDriver, 10) : null,
          assignedDriverName: driverName,
          notes: editNotes.trim()
        } : o));
        toast.success('Saved');
        cancelEdit();
      } else {
        toast.error(result.message || 'Failed to save');
      }
    } catch (err) {
      console.error('Save failed', err);
      toast.error('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-heading">Order Editor</h1>
          <p className="text-subheading text-sm">Task ID, COD, Fees, Driver, Notes</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadOrders(1)}
              placeholder="Search task ID..."
              className="pl-9 pr-3 py-2 bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-lg text-sm text-heading"
            />
          </div>
          <select
            value={driverFilter}
            onChange={(e) => setDriverFilter(e.target.value)}
            className="px-3 py-2 bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-lg text-sm text-heading"
          >
            <option value="">All drivers</option>
            {agents.map(a => (
              <option key={a.fleet_id} value={a.fleet_id.toString()}>{a.name}</option>
            ))}
          </select>
          <button
            onClick={() => loadOrders(1)}
            disabled={isLoading}
            className="px-4 py-2 bg-[#C1EEFA] text-[#1A2C53] rounded-lg flex items-center gap-2 hover:shadow-lg transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-card dark:bg-[#223560] rounded-xl border border-border dark:border-[#2A3C63] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 dark:bg-[#1A2C53]/50 border-b border-border dark:border-[#2A3C63]">
              <tr>
                <th className="px-4 py-3 text-left">Task ID</th>
                <th className="px-4 py-3 text-left">COD amount</th>
                <th className="px-4 py-3 text-left">Order fees</th>
                <th className="px-4 py-3 text-left">Assigned driver</th>
                <th className="px-4 py-3 text-left">Notes</th>
                <th className="px-4 py-3 text-left w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-[#2A3C63]">
              {isLoading && orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-subheading">
                    <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-subheading">
                    No orders found
                  </td>
                </tr>
              )}
              {orders.map((o) => {
                const isEditing = editingId === o.jobId;
                return (
                  <tr key={o.jobId} className={isEditing ? 'bg-[#C1EEFA]/10' : ''}>
                    <td className="px-4 py-3 font-mono text-heading">{o.jobId}</td>
                    <td className="px-4 py-3 text-heading">${(o.codAmount || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-heading">${(o.orderFees || 0).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editDriver}
                          onChange={(e) => setEditDriver(e.target.value)}
                          className="w-full px-2 py-1.5 bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded"
                        >
                          <option value="">Unassigned</option>
                          {agents.map(a => (
                            <option key={a.fleet_id} value={a.fleet_id.toString()}>{a.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-heading">{o.assignedDriverName || 'Unassigned'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          rows={2}
                          className="w-full px-2 py-1.5 bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded resize-none"
                        />
                      ) : (
                        <span className="text-heading">{o.notes || '-'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button
                            onClick={saveEdit}
                            disabled={isSaving}
                            className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition disabled:opacity-50"
                          >
                            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={isSaving}
                            className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition disabled:opacity-50"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        canEdit && (
                          <button
                            onClick={() => startEdit(o)}
                            className="px-3 py-1.5 bg-muted dark:bg-[#2A3C63] text-heading rounded hover:bg-muted/80"
                          >
                            Edit
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="px-4 py-3 border-t border-border dark:border-[#2A3C63] flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadOrders(page - 1)}
                disabled={page <= 1 || isLoading}
                className="px-3 py-1.5 bg-muted dark:bg-[#2A3C63] text-heading rounded disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4 inline" /> Prev
              </button>
              <span>Page {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
              <button
                onClick={() => loadOrders(page + 1)}
                disabled={!hasMore || isLoading}
                className="px-3 py-1.5 bg-muted dark:bg-[#2A3C63] text-heading rounded disabled:opacity-50"
              >
                Next <ChevronRight className="w-4 h-4 inline" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

