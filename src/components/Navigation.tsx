import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  Wallet, 
  Edit3, 
  CreditCard, 
  Package, 
  Shield, 
  Activity, 
  Settings,
  ChevronDown,
  LogOut,
  Sun,
  Moon
} from 'lucide-react';
import tdLogo from 'figma:asset/69bff70c5b17d559501ad9bfcdc1a4c7d2dce43e.png';
import { useTheme } from '../contexts/ThemeContext';

interface NavigationProps {
  activeMenu: string;
  setActiveMenu: (menu: string) => void;
  onLogout: () => void;
  userRole?: string;
}

// Menu items with role-based visibility
// Per SRS: Admin has full access, Staff has limited access
const menuItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'staff', 'driver', 'merchant'] },
  { id: 'reports', label: 'Reports Panel', icon: FileText, roles: ['admin', 'staff', 'driver', 'merchant'] },
  { id: 'financial', label: 'Financial Panel', icon: Wallet, roles: ['admin', 'staff'] },
  { id: 'order-editor', label: 'Order Editor Panel', icon: Edit3, roles: ['admin', 'staff'] },
  { id: 'withdrawals', label: 'Withdrawal Requests', icon: CreditCard, roles: ['admin', 'staff'] },
  { id: 'merchant-plans', label: 'Merchant Plans', icon: Package, roles: ['admin'] }, // Admin only per SRS
  { id: 'permissions', label: 'User & Permissions', icon: Shield, roles: ['admin'] }, // Admin only per SRS
  { id: 'logs', label: 'System Logs', icon: Activity, roles: ['admin'] }, // Admin only per SRS
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['admin', 'staff', 'driver', 'merchant'] },
];

export function Navigation({ activeMenu, setActiveMenu, onLogout, userRole = 'staff' }: NavigationProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-screen transition-colors duration-300">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={tdLogo} alt="TD Logo" className="w-12 h-12 rounded-lg" />
          <div>
            <h1 className="text-heading">TD Admin</h1>
            <p className="text-xs text-muted-light dark:text-[#99BFD1]">Internal System</p>
          </div>
        </div>
        
        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-hover-bg-light dark:hover:bg-[#223560] transition-colors group"
          title="Toggle Theme"
        >
          {theme === 'dark' ? (
            <Sun className="w-5 h-5 text-[#C1EEFA] group-hover:text-[#DE3544]" />
          ) : (
            <Moon className="w-5 h-5 icon-default group-hover:text-[#DE3544]" />
          )}
        </button>
      </div>

      {/* Menu Items */}
      <div className="flex-1 overflow-y-auto py-4 px-3">
        {menuItems
          .filter(item => item.roles.includes(userRole))
          .map((item) => {
          const Icon = item.icon;
          const isActive = activeMenu === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => setActiveMenu(item.id)}
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-xl mb-2 transition-all relative group
                ${isActive 
                  ? 'bg-[#DE3544]/10 dark:bg-[#DE3544]/10 text-[#DE3544] dark:text-[#C1EEFA] border border-[#DE3544]/30 dark:border-[#DE3544]/30' 
                  : 'text-icon-default dark:text-[#99BFD1] hover:bg-hover-bg-light dark:hover:bg-[#223560] hover:text-[#DE3544] dark:hover:text-[#C1EEFA]'
                }
              `}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#DE3544] rounded-r-full shadow-[0_0_12px_rgba(222,53,68,0.6)]" />
              )}
              <Icon className={`w-5 h-5 ${isActive ? 'text-[#DE3544]' : 'icon-default dark:text-[#99BFD1]'}`} />
              <span className="text-sm">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* User Profile */}
      <div className="border-t border-sidebar-border dark:border-[#2A3C63] p-4">
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-hover-bg-light dark:hover:bg-[#223560] transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#DE3544] to-[#9B3249] flex items-center justify-center">
              <span className="text-white">AD</span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-heading dark:text-[#C1EEFA] text-sm">Admin User</p>
              <p className="text-xs text-muted-light dark:text-[#99BFD1]">admin@tdsystem.com</p>
            </div>
            <ChevronDown className={`w-4 h-4 icon-default dark:text-[#99BFD1] transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
          </button>

          {showUserMenu && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-card dark:bg-[#223560] rounded-xl border border-sidebar-border dark:border-[#2A3C63] shadow-lg overflow-hidden">
              <button
                onClick={onLogout}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-hover-bg-light dark:hover:bg-[#2A3C63] transition-colors text-[#DE3544]"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm">Logout</span>
              </button>
              <button
                onClick={toggleTheme}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-hover-bg-light dark:hover:bg-[#2A3C63] transition-colors text-[#DE3544]"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span className="text-sm">Toggle Theme</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}