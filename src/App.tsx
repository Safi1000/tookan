import { useState, useEffect } from 'react';
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

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [user, setUser] = useState<any>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Check for existing auth token on mount
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('user');

    if (token && storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        setUser(userData);
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Error parsing stored user:', error);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
      }
    }
    setIsCheckingAuth(false);
  }, []);

  const handleLogin = (session: any, userData: any) => {
    setUser(userData);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    setUser(null);
    setIsAuthenticated(false);
    setActiveMenu('dashboard');
  };

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
            {activeMenu === 'dashboard' && <Dashboard />}
            {activeMenu === 'reports' && <ReportsPanel />}
            {activeMenu === 'financial' && <FinancialPanel />}
            {activeMenu === 'order-editor' && <OrderEditorPanel />}
            {activeMenu === 'withdrawals' && <WithdrawalRequestsPanel />}
            {activeMenu === 'merchant-plans' && <MerchantPlansPanel />}
            {activeMenu === 'permissions' && <UserPermissionsPanel />}
            {activeMenu === 'logs' && <SystemLogsPanel />}
            {activeMenu === 'settings' && <SettingsPanel />}
          </main>
        </div>
        <Toaster />
      </PermissionProvider>
    </ThemeProvider>
  );
}