import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Permission constants (matching SRS and backend)
export const PERMISSIONS = {
  EDIT_ORDER_FINANCIALS: 'edit_order_financials',
  MANAGE_WALLETS: 'manage_wallets',
  PERFORM_REORDER: 'perform_reorder',
  PERFORM_RETURN: 'perform_return',
  DELETE_ONGOING_ORDERS: 'delete_ongoing_orders',
  EXPORT_REPORTS: 'export_reports',
  ADD_COD: 'add_cod',
  CONFIRM_COD_PAYMENTS: 'confirm_cod_payments',
  MANAGE_USERS: 'manage_users'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: Record<string, boolean>;
  source?: string;
}

interface PermissionContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  hasPermission: (permission: Permission | Permission[]) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  hasAllPermissions: (permissions: Permission[]) => boolean;
  setUser: (user: User | null) => void;
  logout: () => void;
}

const PermissionContext = createContext<PermissionContextType | undefined>(undefined);

export function PermissionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);

  // Load user from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setUserState(parsed);
      } catch (e) {
        console.error('Failed to parse stored user:', e);
        localStorage.removeItem('user');
      }
    }
  }, []);

  const setUser = (newUser: User | null) => {
    setUserState(newUser);
    if (newUser) {
      localStorage.setItem('user', JSON.stringify(newUser));
    } else {
      localStorage.removeItem('user');
    }
  };

  const logout = () => {
    setUserState(null);
    localStorage.removeItem('user');
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin';

  // Check if user has a specific permission
  const hasPermission = (permission: Permission | Permission[]): boolean => {
    if (!user) return false;
    
    // Admin has all permissions per SRS
    if (isAdmin) return true;

    const permissions = Array.isArray(permission) ? permission : [permission];
    return permissions.some(p => user.permissions?.[p] === true);
  };

  // Check if user has any of the permissions
  const hasAnyPermission = (permissions: Permission[]): boolean => {
    if (!user) return false;
    if (isAdmin) return true;
    return permissions.some(p => user.permissions?.[p] === true);
  };

  // Check if user has all permissions
  const hasAllPermissions = (permissions: Permission[]): boolean => {
    if (!user) return false;
    if (isAdmin) return true;
    return permissions.every(p => user.permissions?.[p] === true);
  };

  return (
    <PermissionContext.Provider value={{
      user,
      isAuthenticated,
      isAdmin,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
      setUser,
      logout
    }}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  const context = useContext(PermissionContext);
  if (context === undefined) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return context;
}

// HOC for protecting components
export function withPermission<P extends object>(
  Component: React.ComponentType<P>,
  requiredPermission: Permission | Permission[],
  fallback: React.ReactNode = null
) {
  return function PermissionGuardedComponent(props: P) {
    const { hasPermission } = usePermissions();
    
    if (!hasPermission(requiredPermission)) {
      return <>{fallback}</>;
    }
    
    return <Component {...props} />;
  };
}

// Component for conditionally rendering based on permission
export function PermissionGate({ 
  permission, 
  children, 
  fallback = null 
}: { 
  permission: Permission | Permission[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasPermission } = usePermissions();
  
  if (!hasPermission(permission)) {
    return <>{fallback}</>;
  }
  
  return <>{children}</>;
}

