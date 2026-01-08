import { useState, useEffect } from 'react';
import { KPICard } from './KPICard';
import { 
  ShoppingCart, 
  Car, 
  Store, 
  DollarSign, 
  AlertTriangle, 
  CheckCircle,
  Download,
  RefreshCw,
  Loader2,
  Users
} from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchAnalytics, type AnalyticsData } from '../services/tookanApi';
import { toast } from 'sonner';

export function Dashboard() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Fetch analytics on mount
  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await fetchAnalytics();
      
      if (result.status === 'success' && result.data) {
        setAnalytics(result.data);
        setLastUpdated(new Date());
      } else {
        setError(result.message || 'Failed to load analytics');
        toast.error(result.message || 'Failed to load analytics');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load analytics';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Format number with commas
  const formatNumber = (num: number): string => {
    return num.toLocaleString('en-US');
  };

  // Format currency
  const formatCurrency = (amount: number): string => {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Prepare KPI data from analytics
  // Tookan terminology:
  // - Customers: delivery recipients (people who receive packages)
  // - Merchants: registered businesses with vendor_id
  // - Agents (Drivers): delivery personnel
  const kpiData = analytics ? [
    { 
      id: 'orders', 
      label: 'Total Orders', 
      value: formatNumber(analytics.kpis.totalOrders), 
      icon: ShoppingCart, 
      trend: analytics.trends.orders 
    },
    { 
      id: 'agents', 
      label: 'Agents (Drivers)', 
      value: formatNumber(analytics.kpis.totalDrivers), 
      icon: Car, 
      trend: analytics.trends.drivers 
    },
    { 
      id: 'merchants', 
      label: 'Customers', 
      value: formatNumber(analytics.kpis.totalMerchants), 
      icon: Store, 
      trend: analytics.trends.merchants 
    },
    { 
      id: 'pending-cod', 
      label: 'Total Pending COD', 
      value: formatCurrency(analytics.kpis.pendingCOD), 
      icon: DollarSign, 
      trend: analytics.trends.pendingCOD 
    },
    { 
      id: 'completed', 
      label: 'Completed Deliveries', 
      value: formatNumber(analytics.kpis.completedDeliveries), 
      icon: CheckCircle, 
      trend: analytics.trends.completed 
    },
  ] : [];

  // Get chart data from analytics
  const codData = analytics?.codStatus || [];
  const orderVolumeData = analytics?.orderVolume || [];
  const driverPerformanceData = analytics?.driverPerformance || [];

  // Format last updated time
  const formatLastUpdated = (date: Date): string => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Calculate max deliveries for progress bar
  const maxDeliveries = driverPerformanceData.length > 0 
    ? Math.max(...driverPerformanceData.map(d => d.deliveries), 1)
    : 1;

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-heading text-3xl mb-2 font-bold">Dashboard</h1>
          <p className="text-subheading dark:text-[#99BFD1] text-muted-light">Welcome back! Here&apos;s your system overview</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={loadAnalytics}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 dark:bg-[#C1EEFA]/10 hover:bg-primary/20 dark:hover:bg-[#C1EEFA]/20 border border-primary/30 dark:border-[#C1EEFA]/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-primary dark:text-[#C1EEFA] ${isLoading ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium text-primary dark:text-[#C1EEFA]">Refresh</span>
          </button>
          <div className="text-right">
            <p className="text-subheading dark:text-[#99BFD1] text-muted-light text-sm font-medium">Last updated</p>
            <p className="text-heading dark:text-[#C1EEFA] font-semibold text-sm">
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </span>
              ) : (
                formatLastUpdated(lastUpdated)
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-destructive/10 dark:bg-destructive/10 border border-destructive/30 dark:border-destructive/30 rounded-xl p-4 mb-6">
          <p className="text-destructive dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* KPI Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-6 shadow-sm animate-pulse">
              <div className="h-20 bg-muted dark:bg-[#2A3C63] rounded-lg"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {kpiData.map((kpi) => (
            <KPICard key={kpi.id} {...kpi} />
          ))}
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* COD vs Settled COD - Pie Chart */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
          <h3 className="text-heading dark:text-foreground mb-6 font-semibold">COD Collection Status</h3>
          {isLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary dark:text-[#C1EEFA]" />
            </div>
          ) : codData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={codData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  style={{ fontSize: '12px', fontWeight: 500 }}
                >
                  {codData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    color: 'var(--heading-color)',
                    boxShadow: 'var(--shadow-md)',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                  formatter={(value: number) => `$${value.toLocaleString()}`}
                  labelStyle={{ color: 'var(--heading-color)', fontWeight: 600 }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-light dark:text-[#99BFD1]">
              No COD data available
            </div>
          )}
        </div>

        {/* Order Volume per Day - Bar Chart */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
          <h3 className="text-heading dark:text-foreground mb-6 font-semibold">Order Volume (Last 7 Days)</h3>
          {isLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary dark:text-[#C1EEFA]" />
            </div>
          ) : orderVolumeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={orderVolumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" className="dark:stroke-[#2A3C63]" />
                <XAxis 
                  dataKey="day" 
                  stroke="var(--caption-text)" 
                  tick={{ fill: 'var(--caption-text)', fontSize: 12, fontWeight: 500 }}
                  className="dark:stroke-[#99BFD1]"
                  style={{ fontSize: '12px' }}
                />
                <YAxis 
                  stroke="var(--caption-text)" 
                  tick={{ fill: 'var(--caption-text)', fontSize: 12, fontWeight: 500 }}
                  className="dark:stroke-[#99BFD1]"
                  style={{ fontSize: '12px' }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    color: 'var(--heading-color)',
                    boxShadow: 'var(--shadow-md)',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                  labelStyle={{ color: 'var(--heading-color)', fontWeight: 600 }}
                  cursor={{ fill: 'rgba(26, 44, 83, 0.08)' }}
                  className="dark:cursor-[rgba(193,238,250,0.1)]"
                />
                <Bar dataKey="orders" fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-light dark:text-[#99BFD1]">
              No order volume data available
            </div>
          )}
        </div>

        {/* Driver Performance - Leaderboard */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
          <h3 className="text-heading dark:text-foreground mb-6 font-semibold">Top Drivers (This Month)</h3>
          {isLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary dark:text-[#C1EEFA]" />
            </div>
          ) : driverPerformanceData.length > 0 ? (
            <div className="space-y-4">
              {driverPerformanceData.map((driver, index) => (
                <div key={driver.name} className="flex items-center gap-4 p-2 rounded-lg hover:bg-[var(--bg-hover)] dark:hover:bg-[#2A3C63]/50 transition-colors">
                  <div className={`
                    w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-sm
                    ${index === 0 ? 'bg-gradient-to-br from-[#FFD700] to-[#FFA500] text-white shadow-md' : 
                      index === 1 ? 'bg-gradient-to-br from-[#C0C0C0] to-[#808080] text-white shadow-md' :
                      index === 2 ? 'bg-gradient-to-br from-[#CD7F32] to-[#8B4513] text-white shadow-md' :
                      'bg-muted dark:bg-[#2A3C63] text-muted-light dark:text-[#99BFD1]'}
                  `}>
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-heading dark:text-[#C1EEFA] font-medium">{driver.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-muted dark:bg-[#2A3C63] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-[#DE3544] to-[#1A2C53] dark:from-[#DE3544] dark:to-[#C1EEFA] transition-all duration-300"
                        style={{ width: `${(driver.deliveries / maxDeliveries) * 100}%` }}
                      />
                    </div>
                    <span className="text-heading dark:text-[#C1EEFA] min-w-[3rem] text-right font-semibold">{driver.deliveries}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-light dark:text-[#99BFD1]">
              No driver performance data available
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
          <h3 className="text-heading dark:text-foreground mb-6 font-semibold">Quick Actions</h3>
          <div className="space-y-4">
            <button 
              onClick={async () => {
                try {
                  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/reports/daily?format=excel`);
                  if (!response.ok) throw new Error('Export failed');
                  const blob = await response.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `daily-report-${new Date().toISOString().split('T')[0]}.xlsx`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                } catch (error) {
                  console.error('Export error:', error);
                  alert('Failed to export daily report');
                }
              }}
              className="w-full flex items-center gap-4 px-6 py-4 bg-destructive/10 dark:bg-destructive/10 hover:bg-destructive/20 dark:hover:bg-destructive/20 border border-destructive/30 dark:border-destructive/30 rounded-xl transition-all group shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 rounded-xl bg-destructive dark:bg-destructive flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <Download className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-heading dark:text-[#C1EEFA] font-semibold">Export Daily Report</p>
                <p className="text-subheading dark:text-[#99BFD1] text-muted-light text-sm">Download today's summary</p>
              </div>
            </button>

            <button 
              onClick={async () => {
                try {
                  const month = new Date().toISOString().slice(0, 7);
                  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/reports/monthly?format=excel&month=${month}`);
                  if (!response.ok) throw new Error('Export failed');
                  const blob = await response.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `monthly-report-${month}.xlsx`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                } catch (error) {
                  console.error('Export error:', error);
                  alert('Failed to export monthly report');
                }
              }}
              className="w-full flex items-center gap-4 px-6 py-4 bg-primary/10 dark:bg-[#C1EEFA]/10 hover:bg-primary/20 dark:hover:bg-[#C1EEFA]/20 border border-primary/30 dark:border-[#C1EEFA]/30 rounded-xl transition-all group shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 rounded-xl bg-primary dark:bg-[#C1EEFA] flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <Download className="w-6 h-6 text-white dark:text-[#1A2C53]" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-heading dark:text-[#C1EEFA] font-semibold">Export Monthly Report</p>
                <p className="text-subheading dark:text-[#99BFD1] text-muted-light text-sm">Download this month's data</p>
              </div>
            </button>

            <div className="pt-4 border-t border-border dark:border-[#2A3C63]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-subheading dark:text-[#99BFD1] text-muted-light text-sm font-medium">System Status</span>
                <span className="text-[#10B981] dark:text-green-400 text-sm flex items-center gap-2 font-semibold">
                  <span className="w-2 h-2 bg-[#10B981] dark:bg-green-400 rounded-full animate-pulse" />
                  All Systems Operational
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-subheading dark:text-[#99BFD1] text-muted-light text-sm font-medium">Last Backup</span>
                <span className="text-heading dark:text-[#C1EEFA] text-sm font-semibold">2 hours ago</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}