import { useState, useEffect } from 'react';
import { 
  Search, 
  Download, 
  Calendar, 
  CheckCircle, 
  XCircle,
  Activity,
  User,
  FileText,
  Truck,
  Store,
  Wallet,
  Settings,
  Info,
  ChevronDown,
  ChevronUp,
  Filter
} from 'lucide-react';

// Action type options
const actionTypes = ['ALL', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'EXPORT'];

// Entity type options
const entityTypes = ['ALL', 'Order', 'Driver', 'Merchant', 'Wallet', 'System'];

interface LogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  actionType: string;
  entity: string;
  entityId: string;
  oldValue: string;
  newValue: string;
  notes: string;
}

export function SystemLogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  
  // Fetch audit logs on mount
  useEffect(() => {
    const loadLogs = async () => {
      setIsLoading(true);
      try {
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${API_BASE_URL}/api/audit-logs`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });
        
        const data = await response.json();
        if (response.ok && data.status === 'success' && data.data?.logs) {
          const logsList: LogEntry[] = data.data.logs.map((log: any) => ({
            id: log.id?.toString() || '',
            timestamp: log.timestamp || log.created_at || '',
            userId: log.user_id?.toString() || log.userId?.toString() || '',
            userName: log.user_name || log.userName || 'Unknown User',
            actionType: log.action_type || log.actionType || 'UNKNOWN',
            entity: log.entity_type || log.entity || 'Unknown',
            entityId: log.entity_id?.toString() || log.entityId?.toString() || '',
            oldValue: log.old_value || log.oldValue || '-',
            newValue: log.new_value || log.newValue || '-',
            notes: log.notes || log.description || ''
          }));
          setLogs(logsList);
        } else {
          setLogs([]);
        }
      } catch (error) {
        console.error('Error loading logs:', error);
        setLogs([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadLogs();
  }, []);

  // Validation helper
  const getValidationColor = (value: string) => {
    if (!value) return 'border-input-border dark:border-[#2A3C63]';
    return value.length > 2 
      ? 'border-[#10B981] dark:border-[#C1EEFA] shadow-[0_0_8px_rgba(16,185,129,0.3)] dark:shadow-[0_0_8px_rgba(193,238,250,0.3)]' 
      : 'border-[#DE3544] shadow-[0_0_8px_rgba(222,53,68,0.3)]';
  };

  // Filter logs
  const filteredLogs = logs.filter(log => {
    // Search filter
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      const matchesSearch = 
        log.userId.toLowerCase().includes(lower) ||
        log.userName.toLowerCase().includes(lower) ||
        log.actionType.toLowerCase().includes(lower) ||
        log.entityId.toLowerCase().includes(lower) ||
        log.entity.toLowerCase().includes(lower) ||
        log.notes.toLowerCase().includes(lower);
      if (!matchesSearch) return false;
    }
    
    // Action type filter
    if (actionFilter !== 'ALL' && log.actionType !== actionFilter) return false;
    
    // Entity type filter
    if (entityFilter !== 'ALL' && log.entity !== entityFilter) return false;
    
    // Date range filter
    if (dateFrom) {
      const logDate = new Date(log.timestamp.split(' ')[0]);
      const fromDate = new Date(dateFrom);
      if (logDate < fromDate) return false;
    }
    if (dateTo) {
      const logDate = new Date(log.timestamp.split(' ')[0]);
      const toDate = new Date(dateTo);
      if (logDate > toDate) return false;
    }
    
    return true;
  });

  // Get entity icon
  const getEntityIcon = (entity: string) => {
    switch (entity) {
      case 'Order': return <FileText className="w-4 h-4" />;
      case 'Driver': return <Truck className="w-4 h-4" />;
      case 'Merchant': return <Store className="w-4 h-4" />;
      case 'Wallet': return <Wallet className="w-4 h-4" />;
      case 'System': return <Settings className="w-4 h-4" />;
      default: return <Activity className="w-4 h-4" />;
    }
  };

  // Get action color
  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30';
      case 'UPDATE': return 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30';
      case 'DELETE': return 'bg-destructive/10 text-destructive border-destructive/30';
      case 'APPROVE': return 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30';
      case 'REJECT': return 'bg-destructive/10 text-destructive border-destructive/30';
      case 'EXPORT': return 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30';
      default: return 'bg-muted text-muted-light dark:text-[#99BFD1] border-border';
    }
  };

  // Export logs
  const handleExport = async (format: 'csv' | 'excel') => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/logs/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          filters: { searchQuery, actionFilter, entityFilter, dateFrom, dateTo }
        })
      });
      
      if (!response.ok) throw new Error('Export failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const extension = format === 'excel' ? 'xlsx' : 'csv';
      a.download = `system-logs-${new Date().toISOString().split('T')[0]}.${extension}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      alert(`Failed to export ${format.toUpperCase()}. Using fallback method.`);
      
      // Fallback to client-side CSV export
      if (format === 'csv') {
        const data = filteredLogs.map(log => ({
          Timestamp: log.timestamp,
          'User ID': log.userId,
          'User Name': log.userName,
          'Action Type': log.actionType,
          Entity: log.entity,
          'Entity ID': log.entityId,
          'Old Value': log.oldValue,
          'New Value': log.newValue,
          Notes: log.notes,
        }));
        
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => Object.values(row).map(v => `"${v}"`).join(',')).join('\n');
        const csv = `${headers}\n${rows}`;
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `system-logs-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
      }
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading text-3xl mb-2 font-bold">System Logs</h1>
          <p className="text-subheading dark:text-[#99BFD1] text-muted-light">Track all system activities and changes</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => handleExport('csv')}
            className="flex items-center gap-2 px-6 py-3 bg-[#10B981] text-white rounded-xl hover:shadow-lg transition-all font-semibold"
          >
            <Download className="w-5 h-5" />
            Export CSV
          </button>
          <button 
            onClick={() => handleExport('excel')}
            className="flex items-center gap-2 px-6 py-3 bg-primary dark:bg-[#C1EEFA] text-white dark:text-[#1A2C53] rounded-xl hover:shadow-lg transition-all font-semibold"
          >
            <Download className="w-5 h-5" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-[#C1EEFA]/20 flex items-center justify-center">
              <Activity className="w-6 h-6 text-primary dark:text-[#C1EEFA]" />
            </div>
            <div>
              <p className="text-muted-light dark:text-[#99BFD1] text-sm">Total Logs</p>
              <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{logs.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#10B981]/10 dark:bg-[#10B981]/20 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-[#10B981]" />
            </div>
            <div>
              <p className="text-muted-light dark:text-[#99BFD1] text-sm">Creates/Approvals</p>
              <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">
                {logs.filter(l => l.actionType === 'CREATE' || l.actionType === 'APPROVE').length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#3B82F6]/10 dark:bg-[#3B82F6]/20 flex items-center justify-center">
              <FileText className="w-6 h-6 text-[#3B82F6]" />
            </div>
            <div>
              <p className="text-muted-light dark:text-[#99BFD1] text-sm">Updates</p>
              <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">
                {logs.filter(l => l.actionType === 'UPDATE').length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-destructive/10 dark:bg-destructive/20 flex items-center justify-center">
              <XCircle className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <p className="text-muted-light dark:text-[#99BFD1] text-sm">Deletes/Rejects</p>
              <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">
                {logs.filter(l => l.actionType === 'DELETE' || l.actionType === 'REJECT').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-heading dark:text-[#C1EEFA] font-semibold flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters
          </h3>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            {showFilters ? (
              <ChevronUp className="w-5 h-5 text-muted-light dark:text-[#99BFD1]" />
            ) : (
              <ChevronDown className="w-5 h-5 text-muted-light dark:text-[#99BFD1]" />
            )}
          </button>
        </div>

        {showFilters && (
          <div className="space-y-4">
            {/* Unified Search */}
            <div>
              <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-medium">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-light dark:text-[#99BFD1]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by User ID, User Name, Action, Entity ID..."
                  className={`w-full bg-input-bg dark:bg-[#1A2C53] border rounded-xl pl-10 pr-10 py-3 text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none transition-all ${getValidationColor(searchQuery)}`}
                />
                {searchQuery && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {searchQuery.length > 2 ? (
                      <CheckCircle className="w-5 h-5 text-[#10B981] dark:text-[#C1EEFA]" />
                    ) : (
                      <XCircle className="w-5 h-5 text-destructive" />
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Action Type Filter */}
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-medium">Action Type</label>
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] transition-all"
                >
                  {actionTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              {/* Entity Type Filter */}
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-medium">Entity Type</label>
                <select
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] transition-all"
                >
                  {entityTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              {/* Date From */}
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-medium">From Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-light dark:text-[#99BFD1]" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] transition-all"
                  />
                </div>
              </div>

              {/* Date To */}
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-medium">To Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-light dark:text-[#99BFD1]" />
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] transition-all"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Log Retention Notice */}
      <div className="flex items-center gap-3 p-4 bg-[#3B82F6]/10 dark:bg-[#3B82F6]/20 border border-[#3B82F6]/30 rounded-xl">
        <Info className="w-5 h-5 text-[#3B82F6]" />
        <p className="text-[#3B82F6] text-sm">
          Logs are retained according to system settings. Contact your administrator for retention policy details.
        </p>
      </div>

      {/* Logs Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <span className="text-muted-light dark:text-[#99BFD1] text-sm">
            Showing {filteredLogs.length} of {logs.length} logs
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="table-header-bg dark:bg-[#1A2C53]">
              <tr>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Timestamp</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">User</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Action Type</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Entity</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Old Value</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">New Value</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, index) => (
                <>
                  <tr 
                    key={log.id} 
                    className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors cursor-pointer ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}
                    onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                  >
                    <td className="px-6 py-4">
                      <div className="text-heading dark:text-[#C1EEFA] text-sm">{log.timestamp.split(' ')[0]}</div>
                      <div className="text-muted-light dark:text-[#99BFD1] text-xs">{log.timestamp.split(' ')[1]}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 dark:bg-[#C1EEFA]/20 flex items-center justify-center">
                          <User className="w-4 h-4 text-primary dark:text-[#C1EEFA]" />
                        </div>
                        <div>
                          <p className="text-heading dark:text-[#C1EEFA] text-sm">{log.userName}</p>
                          <p className="text-muted-light dark:text-[#99BFD1] text-xs">{log.userId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-lg text-xs font-medium border ${getActionColor(log.actionType)}`}>
                        {log.actionType}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-light dark:text-[#99BFD1]">
                          {getEntityIcon(log.entity)}
                        </span>
                        <div>
                          <p className="text-heading dark:text-[#C1EEFA] text-sm">{log.entity}</p>
                          <p className="text-muted-light dark:text-[#99BFD1] text-xs">{log.entityId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1] text-sm max-w-xs truncate">
                      {log.oldValue}
                    </td>
                    <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] text-sm max-w-xs truncate">
                      {log.newValue}
                    </td>
                    <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1] text-sm max-w-xs truncate">
                      {log.notes || '-'}
                    </td>
                  </tr>
                  {expandedLog === log.id && (
                    <tr className="bg-muted/30 dark:bg-[#1A2C53]/30">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="p-3 bg-card dark:bg-[#223560] rounded-xl border border-border">
                            <p className="text-xs text-muted-light dark:text-[#99BFD1] mb-1">Log ID</p>
                            <p className="text-heading dark:text-[#C1EEFA] font-medium">{log.id}</p>
                          </div>
                          <div className="p-3 bg-card dark:bg-[#223560] rounded-xl border border-border">
                            <p className="text-xs text-muted-light dark:text-[#99BFD1] mb-1">Full Timestamp</p>
                            <p className="text-heading dark:text-[#C1EEFA] font-medium">{log.timestamp}</p>
                          </div>
                          <div className="p-3 bg-card dark:bg-[#223560] rounded-xl border border-border col-span-2">
                            <p className="text-xs text-muted-light dark:text-[#99BFD1] mb-1">Notes</p>
                            <p className="text-heading dark:text-[#C1EEFA]">{log.notes || 'No additional notes'}</p>
                          </div>
                          <div className="p-3 bg-card dark:bg-[#223560] rounded-xl border border-border col-span-2">
                            <p className="text-xs text-muted-light dark:text-[#99BFD1] mb-1">Old Value</p>
                            <p className="text-heading dark:text-[#C1EEFA]">{log.oldValue}</p>
                          </div>
                          <div className="p-3 bg-card dark:bg-[#223560] rounded-xl border border-border col-span-2">
                            <p className="text-xs text-muted-light dark:text-[#99BFD1] mb-1">New Value</p>
                            <p className="text-heading dark:text-[#C1EEFA]">{log.newValue}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredLogs.length === 0 && (
          <div className="text-center py-12">
            <Activity className="w-12 h-12 text-muted-light dark:text-[#99BFD1] mx-auto mb-4" />
            <p className="text-heading dark:text-[#C1EEFA] font-medium">No logs found</p>
            <p className="text-muted-light dark:text-[#99BFD1] text-sm">Try adjusting your filters</p>
          </div>
        )}
      </div>
    </div>
  );
}










