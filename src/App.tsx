import { useState, useEffect, useCallback } from 'react';
import { Navigation } from './components/Navigation';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { ReportsPanel } from './components/ReportsPanel';
import { FinancialPanel } from './components/FinancialPanel';
import { OrderEditorPanel } from './components/OrderEditorPanel';
import { WithdrawalRequestsPanel } from './components/WithdrawalRequestsPanel';
import { MerchantPlansPanel } from './components/MerchantPlansPanel';
import { UserPermissionsPanel } from './components/UserPermissionsPanel';
import { SystemLogsPanel } from './components/SystemLogsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ThemeProvider } from './contexts/ThemeContext';
import { PermissionProvider } from './contexts/PermissionContext';
import { Toaster } from './components/ui/sonner';
import PaymentWall from './components/PaymentWall';
// Superadmin email consistent with backend
const SUPERADMIN_EMAIL = 'ahmedhassan123.ah83@gmail.com';

// 6 hours in milliseconds
const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'last_activity_timestamp';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [user, setUser] = useState<any>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  // Track visited panels for lazy mounting — only mount a panel after first visit
  const [visitedPanels, setVisitedPanels] = useState<Set<string>>(new Set(['dashboard']));
  const [suspended, setSuspended] = useState(false);
  const [suspendedAmount, setSuspendedAmount] = useState('');
  const isSuperadmin = user?.email?.toLowerCase() === SUPERADMIN_EMAIL.toLowerCase();
  useEffect(() => {
    fetch('https://api.bhdt.live/api/health')
      .then(async (res) => {
        if (res.status === 402) {
          const data = await res.json();
          setSuspended(true);
          setSuspendedAmount(data.amount || '');
        }
      })
      .catch(() => {
        setSuspended(true);
      });
  }, []);
  // Update visited panels when activeMenu changes
  useEffect(() => {
    setVisitedPanels(prev => {
      if (prev.has(activeMenu)) return prev;
      const next = new Set(prev);
      next.add(activeMenu);
      return next;
    });
  }, [activeMenu]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    setUser(null);
    setIsAuthenticated(false);
    setActiveMenu('dashboard');
    setVisitedPanels(new Set(['dashboard']));
  }, []);

  // Check for existing auth token on mount
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('user');

    if (token && storedUser) {
      // Check inactivity before restoring session
      const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed > INACTIVITY_TIMEOUT_MS) {
          // Inactive for more than 6 hours — force logout
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user');
          localStorage.removeItem(LAST_ACTIVITY_KEY);
          setIsCheckingAuth(false);
          return;
        }
      }

      try {
        const userData = JSON.parse(storedUser);
        setUser(userData);
        setIsAuthenticated(true);
        // Update activity timestamp on successful restore
        localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
      } catch (error) {
        console.error('Error parsing stored user:', error);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
      }
    }
    setIsCheckingAuth(false);
  }, []);

  // Track user activity and auto-logout after 6 hours of inactivity
  useEffect(() => {
    if (!isAuthenticated) return;

    // Update last activity timestamp on user interaction
    const updateActivity = () => {
      localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    };

    // Check if inactivity timeout has been exceeded
    const checkInactivity = () => {
      const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed > INACTIVITY_TIMEOUT_MS) {
          handleLogout();
        }
      }
    };

    // Listen for user activity events
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, updateActivity, { passive: true }));

    // Set initial activity timestamp
    updateActivity();

    // Check inactivity every 60 seconds
    const intervalId = setInterval(checkInactivity, 60 * 1000);

    return () => {
      events.forEach(event => window.removeEventListener(event, updateActivity));
      clearInterval(intervalId);
    };
  }, [isAuthenticated, handleLogout]);

  const handleLogin = (session: any, userData: any) => {
    setUser(userData);
    setIsAuthenticated(true);
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  };
  if (suspended) {
    return <PaymentWall amount={suspendedAmount} />;
  }
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-background dark:bg-[#1A2C53] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#DE3544] mx-auto"></div>
          <p className="mt-4 text-muted-light dark:text-[#99BFD1]">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  // Helper: only mount a panel if it has been visited at least once
  const lazyPanel = (key: string, component: React.ReactNode) =>
    visitedPanels.has(key) ? <div style={{ display: activeMenu === key ? 'block' : 'none' }}>{component}</div> : null;

  return (
    <ThemeProvider>
      <PermissionProvider>
        <div className="flex h-screen bg-background overflow-hidden transition-colors duration-300">
          <Navigation
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            onLogout={handleLogout}
            user={user}
          />
          <main className="flex-1 overflow-y-auto">
            {lazyPanel('dashboard', <Dashboard />)}
            {lazyPanel('reports', <ReportsPanel />)}
            {lazyPanel('financial', <FinancialPanel />)}
            {lazyPanel('order-editor', <OrderEditorPanel />)}
            {lazyPanel('withdrawals', <WithdrawalRequestsPanel />)}
            {lazyPanel('merchant-plans', <MerchantPlansPanel />)}
            {isSuperadmin && lazyPanel('permissions', <UserPermissionsPanel />)}
            {isSuperadmin && lazyPanel('logs', <SystemLogsPanel />)}
            {lazyPanel('settings', <SettingsPanel />)}
          </main>
        </div>
        <Toaster />
      </PermissionProvider>
    </ThemeProvider>
  );
}