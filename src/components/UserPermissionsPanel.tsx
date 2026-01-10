import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit, Trash2, Shield, User as UserIcon, CheckCircle, XCircle, Save, X, UserPlus, Lock, X as XIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { fetchAllUsers, createUser, updateUser, updateUserPermissions, updateUserRole, deleteUser, changeUserPassword, updateUserStatus, type UserAccount as ApiUserAccount } from '../services/userApi';

// Available permissions
const availablePermissions = [
  { id: 'edit_order_financials', label: 'Edit Order Financials', category: 'Orders' },
  { id: 'manage_wallets', label: 'Manage Wallets', category: 'Financial' },
  { id: 'perform_reorder', label: 'Perform Reorder', category: 'Orders' },
  { id: 'perform_return', label: 'Perform Return', category: 'Orders' },
  { id: 'delete_ongoing_orders', label: 'Delete Ongoing Orders', category: 'Orders' },
  { id: 'export_reports', label: 'Export Reports', category: 'Reports' },
  { id: 'add_cod', label: 'Add COD', category: 'Financial' },
  { id: 'confirm_cod_payments', label: 'Confirm COD Payments', category: 'Financial' },
];

interface UserAccount {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  status: 'Active' | 'Inactive' | 'Banned';
  lastLogin: string;
  role?: string;
}

// Convert API user to UI user format
function apiUserToUIUser(apiUser: ApiUserAccount): UserAccount {
  // Convert permissions object to array
  const permissionsArray = typeof apiUser.permissions === 'object' && !Array.isArray(apiUser.permissions)
    ? Object.keys(apiUser.permissions).filter(key => apiUser.permissions[key] === true)
    : Array.isArray(apiUser.permissions) 
      ? apiUser.permissions 
      : [];
  
  // Map status from API to UI format
  const statusMap: Record<string, 'Active' | 'Inactive' | 'Banned'> = {
    'active': 'Active',
    'disabled': 'Inactive',
    'banned': 'Banned',
    'inactive': 'Inactive' // tolerate legacy UI label
  };
  const rawStatus = (apiUser.status || 'active').toString().toLowerCase();
  const uiStatus = statusMap[rawStatus] || 'Active';
  
  return {
    id: apiUser.id,
    name: apiUser.name || apiUser.email,
    email: apiUser.email,
    permissions: permissionsArray,
    status: uiStatus,
    lastLogin: apiUser.lastLogin || 'Never',
    role: apiUser.role
  };
}

// Convert UI user permissions array to API permissions object
function permissionsArrayToObject(permissions: string[]): Record<string, boolean> {
  const obj: Record<string, boolean> = {};
  permissions.forEach(perm => {
    obj[perm] = true;
  });
  return obj;
}

export function UserPermissionsPanel() {
  // Get permission categories (must be defined before useState)
  const permissionCategories = Array.from(new Set(availablePermissions.map(p => p.category)));
  
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [isProcessingCustomer, setIsProcessingCustomer] = useState(false);
  const [showDeleteAuthModal, setShowDeleteAuthModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [userToChangePassword, setUserToChangePassword] = useState<UserAccount | null>(null);
  const [passwordData, setPasswordData] = useState({ newPassword: '', confirmPassword: '' });
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(
    permissionCategories.reduce((acc, cat) => ({ ...acc, [cat]: false }), {})
  );
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    status: 'Active' as 'Active' | 'Inactive' | 'Banned',
  });

  // Customer form state
  const [customerFormData, setCustomerFormData] = useState({
    name: '',
    phone: '',
  });

  // Fetch users on mount
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const response = await fetchAllUsers();
      if (response.status === 'success' && response.data.users) {
        const uiUsers = response.data.users.map(apiUserToUIUser);
        setUsers(uiUsers);
      } else {
        toast.error(response.message || 'Failed to load users');
      }
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  // Filter users
  const filteredUsers = (users || []).filter(user => {
    if (!searchQuery) return true;
    const lower = searchQuery.toLowerCase();
    return (
      user.name.toLowerCase().includes(lower) ||
      user.email.toLowerCase().includes(lower) ||
      user.id.toLowerCase().includes(lower)
    );
  });

  // Handle add user
  const handleAddUser = () => {
    setFormData({ name: '', email: '', password: '', status: 'Active' });
    setSelectedPermissions([]);
    setEditingUser(null);
    setShowAddModal(true);
  };

  // Handle edit user
  const handleEditUser = (user: UserAccount) => {
    setFormData({
      name: user.name,
      email: user.email,
      password: '',
      status: user.status,
    });
    setSelectedPermissions([...user.permissions]);
    setEditingUser(user);
    setShowAddModal(true);
  };

  // Handle save user
  const handleSaveUser = async () => {
    if (!formData.name || !formData.email) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      if (editingUser) {
        // Update existing user
        const permissionsObj = permissionsArrayToObject(selectedPermissions);
        const response = await updateUser(editingUser.id, {
          name: formData.name,
          email: formData.email,
          permissions: permissionsObj
        });

        if (response.status === 'success') {
          toast.success('User updated successfully');
          await loadUsers();
          setShowAddModal(false);
          setEditingUser(null);
          setFormData({ name: '', email: '', password: '', status: 'Active' });
          setSelectedPermissions([]);
        } else {
          toast.error(response.message || 'Failed to update user');
        }
      } else {
        // Create new user with password
        if (!formData.password) {
          toast.error('Password is required for new users');
          return;
        }

        if (formData.password.length < 6) {
          toast.error('Password must be at least 6 characters long');
          return;
        }

        const permissionsObj = permissionsArrayToObject(selectedPermissions);
        const response = await createUser({
          email: formData.email,
          password: formData.password,
          name: formData.name,
          role: 'user',
          permissions: permissionsObj
        });

        if (response.status === 'success') {
          toast.success('User created successfully');
          await loadUsers();
          setShowAddModal(false);
          setFormData({ name: '', email: '', password: '', status: 'Active' });
          setSelectedPermissions([]);
        } else {
          toast.error(response.message || 'Failed to create user');
        }
      }
    } catch (error) {
      console.error('Error saving user:', error);
      toast.error('Failed to save user');
    }
  };

  // Check if user is admin
  const isAdminUser = (userId: string): boolean => {
    const user = users.find(u => u.id === userId);
    return user ? user.email.toLowerCase().includes('admin@turbobahrain.com') || user.name.toLowerCase().includes('admin user') : false;
  };

  // Handle delete user - show password modal
  const handleDeleteUser = (userId: string) => {
    if (isAdminUser(userId)) {
      toast.error('Admin users cannot be deleted');
      return;
    }
    setUserToDelete(userId);
    setDeletePassword('');
    setShowDeleteAuthModal(true);
  };

  // Verify admin password and delete user
  const handleDeleteConfirm = async () => {
    if (!userToDelete) {
      return;
    }

    // Double check to prevent admin deletion
    if (isAdminUser(userToDelete)) {
      toast.error('Admin users cannot be deleted');
      setShowDeleteAuthModal(false);
      setUserToDelete(null);
      setDeletePassword('');
      return;
    }

    try {
      const response = await deleteUser(userToDelete);
      if (response.status === 'success') {
        toast.success('User deleted successfully');
        await loadUsers();
        setShowDeleteAuthModal(false);
        setUserToDelete(null);
        setDeletePassword('');
      } else {
        toast.error(response.message || 'Failed to delete user');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Failed to delete user');
    }
  };

  // Handle change password
  const handleChangePasswordClick = (user: UserAccount) => {
    setUserToChangePassword(user);
    setPasswordData({ newPassword: '', confirmPassword: '' });
    setShowChangePasswordModal(true);
  };

  // Confirm password change
  const handleChangePasswordConfirm = async () => {
    if (!passwordData.newPassword || !passwordData.confirmPassword) {
      toast.error('Please fill in all fields');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }

    if (!userToChangePassword) {
      return;
    }

    try {
      const response = await changeUserPassword(userToChangePassword.id, passwordData.newPassword);
      if (response.status === 'success') {
        toast.success(`Password changed successfully for ${userToChangePassword.name}`);
        setShowChangePasswordModal(false);
        setUserToChangePassword(null);
        setPasswordData({ newPassword: '', confirmPassword: '' });
      } else {
        toast.error(response.message || 'Failed to change password');
      }
    } catch (error) {
      console.error('Error changing password:', error);
      toast.error('Failed to change password');
    }
  };

  // Handle status change (enable/disable/ban)
  const handleStatusChange = async (userId: string, newStatus: 'active' | 'disabled' | 'banned') => {
    const user = users.find(u => u.id === userId);
    if (!user) {
      toast.error('User not found');
      return;
    }

    // Prevent changing superadmin status
    if (user.email === 'ahmedhassan123.ah83@gmail.com') {
      toast.error('Cannot change superadmin status');
      return;
    }

    try {
      const response = await updateUserStatus(userId, newStatus);
      if (response.status === 'success') {
        const actionLabel = newStatus === 'active' ? 'enabled' : newStatus === 'banned' ? 'banned' : 'disabled';
        toast.success(`User ${actionLabel} successfully`);
        await loadUsers();
      } else {
        toast.error(response.message || 'Failed to update user status');
      }
    } catch (error) {
      console.error('Error updating user status:', error);
      toast.error('Failed to update user status');
    }
  };

  // Toggle permission
  const togglePermission = (permissionId: string) => {
    if (selectedPermissions.includes(permissionId)) {
      setSelectedPermissions(selectedPermissions.filter(p => p !== permissionId));
    } else {
      setSelectedPermissions([...selectedPermissions, permissionId]);
    }
    // Keep dropdown open for multiple selections
  };

  // Toggle category
  const toggleCategory = (category: string) => {
    setOpenCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };

  // Handle add customer
  const handleAddCustomer = async () => {
    if (!customerFormData.name || !customerFormData.phone) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsProcessingCustomer(true);
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
      const response = await fetch(`${apiBase}/api/tookan/customer/add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: customerFormData.name,
          phone: customerFormData.phone,
        }),
      });

      const result = await response.json();

      if (result.status === 'success') {
        toast.success('Customer added successfully');
        setShowAddCustomerModal(false);
        setCustomerFormData({ name: '', phone: '' });
      } else {
        toast.error(result.message || 'Failed to add customer');
      }
    } catch (error) {
      console.error('Add customer error:', error);
      toast.error('Failed to add customer. Please try again.');
    } finally {
      setIsProcessingCustomer(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading text-3xl mb-2 font-bold">User Permissions</h1>
          <p className="text-subheading dark:text-[#99BFD1]">Manage user permissions and access control</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleAddUser}
            className="flex items-center gap-2 px-6 py-3 bg-[#C1EEFA] text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all font-semibold"
          >
            <Plus className="w-5 h-5" />
            Add User
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-light dark:text-[#99BFD1]" />
          <input
            type="text"
            placeholder="Search by name, email, role, or user ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
              <tr>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">User</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Permissions</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Status</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Last Login</th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user, index) => (
                <tr
                  key={user.id}
                  className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 dark:bg-[#C1EEFA]/20 flex items-center justify-center">
                        <UserIcon className="w-5 h-5 text-primary dark:text-[#C1EEFA]" />
                      </div>
                      <div>
                        <p className="text-heading dark:text-[#C1EEFA] font-medium">{user.name}</p>
                        <p className="text-muted-light dark:text-[#99BFD1] text-sm">{user.email}</p>
                        <p className="text-muted-light dark:text-[#99BFD1] text-xs">{user.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.permissions.length === 0 ? (
                        <span className="px-2 py-1 rounded text-xs bg-muted dark:bg-[#2A3C63] text-muted-light dark:text-[#99BFD1]">
                          No permissions
                        </span>
                      ) : (
                        <>
                          {user.permissions.slice(0, 3).map(perm => (
                            <span key={perm} className="px-2 py-1 rounded text-xs bg-primary/10 dark:bg-[#C1EEFA]/20 text-primary dark:text-[#C1EEFA] border border-primary/30 dark:border-[#C1EEFA]/30">
                              {availablePermissions.find(p => p.id === perm)?.label || perm}
                            </span>
                          ))}
                          {user.permissions.length > 3 && (
                            <span className="px-2 py-1 rounded text-xs bg-muted dark:bg-[#2A3C63] text-muted-light dark:text-[#99BFD1]">
                              +{user.permissions.length - 3} more
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {user.email === 'ahmedhassan123.ah83@gmail.com' ? (
                      <span className="px-3 py-1 rounded-lg text-xs font-medium bg-[#8B5CF6]/10 text-[#8B5CF6] border border-[#8B5CF6]/30">
                        👑 Superadmin
                      </span>
                    ) : (
                      <select
                        value={user.status === 'Active' ? 'active' : user.status === 'Inactive' ? 'disabled' : 'banned'}
                        onChange={(e) => handleStatusChange(user.id, e.target.value as 'active' | 'disabled' | 'banned')}
                        className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer border ${
                          user.status === 'Active'
                            ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30'
                            : user.status === 'Inactive'
                            ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30'
                            : 'bg-destructive/10 text-destructive border-destructive/30'
                        }`}
                      >
                        <option value="active" className="bg-background text-foreground">✓ Active</option>
                        <option value="disabled" className="bg-background text-foreground">⏸ Disabled</option>
                        <option value="banned" className="bg-background text-foreground">🚫 Banned</option>
                      </select>
                    )}
                  </td>
                  <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1] text-sm">
                    {user.lastLogin}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditUser(user)}
                        className="p-2 hover:bg-primary/10 dark:hover:bg-[#C1EEFA]/20 rounded-lg transition-all"
                        title="Edit User"
                      >
                        <Edit className="w-4 h-4 text-primary dark:text-[#C1EEFA]" />
                      </button>
                      <button
                        onClick={() => handleChangePasswordClick(user)}
                        className="p-2 hover:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded-lg transition-all"
                        title="Change Password"
                      >
                        <Lock className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                      </button>
                      {!isAdminUser(user.id) ? (
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="p-2 hover:bg-destructive/10 rounded-lg transition-all"
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </button>
                      ) : (
                        <span className="p-2 text-muted-light dark:text-[#99BFD1] cursor-not-allowed opacity-50" title="Admin users cannot be deleted">
                          <Trash2 className="w-4 h-4" />
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-heading dark:text-[#C1EEFA] font-medium">Loading users...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-12">
            <UserIcon className="w-12 h-12 text-muted-light dark:text-[#99BFD1] mx-auto mb-4" />
            <p className="text-heading dark:text-[#C1EEFA] font-medium">No users found</p>
            <p className="text-muted-light dark:text-[#99BFD1] text-sm">Try adjusting your search</p>
          </div>
        ) : null}
      </div>

      {/* Add/Edit User Modal - Ultra Compact & Sleek */}
      {showAddModal && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 animate-in fade-in-0 duration-150" 
          onClick={() => {
            setShowAddModal(false);
            setEditingUser(null);
            setFormData({ name: '', email: '', password: '', status: 'Active' });
            setSelectedPermissions([]);
          }}
        >
          <div 
            className="relative bg-card dark:bg-[#1A2C53] rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col border border-border/50 dark:border-[#2A3C63]/50 animate-in zoom-in-95 slide-in-from-bottom-1 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Minimal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 dark:border-[#2A3C63]/50">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-primary/10 dark:bg-[#C1EEFA]/20 flex items-center justify-center">
                  <UserIcon className="w-3.5 h-3.5 text-primary dark:text-[#C1EEFA]" />
                </div>
                <h2 className="text-base font-semibold text-heading dark:text-[#C1EEFA]">
                  {editingUser ? 'Edit User' : 'Add User'}
                </h2>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingUser(null);
                  setFormData({ name: '', email: '', password: '', status: 'Active' });
                  setSelectedPermissions([]);
                }}
                className="p-1 rounded-md hover:bg-muted/50 dark:hover:bg-[#2A3C63]/50 transition-colors"
              >
                <X className="w-3.5 h-3.5 text-muted-light dark:text-[#99BFD1]" />
              </button>
            </div>

            {/* Compact Split View */}
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
              {/* Left - User Info */}
              <div className="flex-1 md:w-[52%] p-3 border-r-0 md:border-r border-border/50 dark:border-[#2A3C63]/50 overflow-y-auto">
                <div className="space-y-3">
                  <div>
                    <label className="block text-heading dark:text-[#C1EEFA] text-xs mb-1 font-medium">
                      Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border/50 dark:border-[#2A3C63]/50 rounded-lg px-3 py-1.5 text-sm text-heading dark:text-[#C1EEFA] focus:outline-none focus:ring-1 focus:ring-primary/30 dark:focus:ring-[#C1EEFA]/30 focus:border-primary/50 dark:focus:border-[#C1EEFA]/50 transition-all"
                      placeholder="Enter name"
                    />
                  </div>
                  <div>
                    <label className="block text-heading dark:text-[#C1EEFA] text-xs mb-1 font-medium">
                      Email <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border/50 dark:border-[#2A3C63]/50 rounded-lg px-3 py-1.5 text-sm text-heading dark:text-[#C1EEFA] focus:outline-none focus:ring-1 focus:ring-primary/30 dark:focus:ring-[#C1EEFA]/30 focus:border-primary/50 dark:focus:border-[#C1EEFA]/50 transition-all"
                      placeholder="user@example.com"
                    />
                  </div>
                  {!editingUser && (
                    <div>
                      <label className="block text-heading dark:text-[#C1EEFA] text-xs mb-1 font-medium">
                        Password <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border/50 dark:border-[#2A3C63]/50 rounded-lg px-3 py-1.5 text-sm text-heading dark:text-[#C1EEFA] focus:outline-none focus:ring-1 focus:ring-primary/30 dark:focus:ring-[#C1EEFA]/30 focus:border-primary/50 dark:focus:border-[#C1EEFA]/50 transition-all"
                        placeholder="Minimum 6 characters"
                      />
                      <p className="text-[10px] text-muted-light dark:text-[#99BFD1] mt-0.5">Password must be at least 6 characters</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-heading dark:text-[#C1EEFA] text-xs mb-1 font-medium">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Active' | 'Inactive' | 'Banned' })}
                      className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border/50 dark:border-[#2A3C63]/50 rounded-lg px-3 py-1.5 text-sm text-heading dark:text-[#C1EEFA] focus:outline-none focus:ring-1 focus:ring-primary/30 dark:focus:ring-[#C1EEFA]/30 focus:border-primary/50 dark:focus:border-[#C1EEFA]/50 transition-all"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                      <option value="Banned">Banned</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Right - Permissions */}
              <div className="flex-1 md:w-[48%] p-3 overflow-y-auto">
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-primary dark:text-[#C1EEFA]" />
                      <h3 className="text-sm font-semibold text-heading dark:text-[#C1EEFA]">Permissions</h3>
                      {selectedPermissions.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-primary/20 dark:bg-[#C1EEFA]/20 text-primary dark:text-[#C1EEFA] text-[10px] font-medium">
                          {selectedPermissions.length}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto pr-1">
                    <Collapsible open={permissionsOpen} onOpenChange={setPermissionsOpen}>
                      <CollapsibleTrigger className="w-full group mb-2">
                        <div className="flex items-center justify-between w-full px-2 py-1.5 rounded-md hover:bg-muted/30 dark:hover:bg-[#1A2C53]/50 transition-colors cursor-pointer border border-border/30 dark:border-[#2A3C63]/30">
                          <span className="text-[11px] font-medium text-heading dark:text-[#C1EEFA]">
                            {permissionsOpen ? 'Hide' : 'Show'}
                          </span>
                          {permissionsOpen ? (
                            <ChevronDown className="w-3 h-3 text-muted-light dark:text-[#99BFD1]" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-muted-light dark:text-[#99BFD1]" />
                          )}
                        </div>
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 duration-150">
                        <div className="space-y-1.5">
                          {permissionCategories.map(category => (
                            <Collapsible
                              key={category}
                              open={openCategories[category]}
                              onOpenChange={() => toggleCategory(category)}
                            >
                              <div className="bg-muted/10 dark:bg-[#223560]/30 rounded-md border border-border/30 dark:border-[#2A3C63]/30 overflow-hidden">
                                <CollapsibleTrigger className="w-full group">
                                  <div className="flex items-center justify-between w-full px-2 py-1.5 hover:bg-muted/20 dark:hover:bg-[#1A2C53]/30 transition-colors cursor-pointer">
                                    <h4 className="text-heading dark:text-[#C1EEFA] font-medium text-[10px] uppercase tracking-wider">
                                      {category}
                                    </h4>
                                    {openCategories[category] ? (
                                      <ChevronDown className="w-3 h-3 text-muted-light dark:text-[#99BFD1]" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3 text-muted-light dark:text-[#99BFD1]" />
                                    )}
                                  </div>
                                </CollapsibleTrigger>
                                
                                <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 duration-100">
                                  <div className="px-2 pb-2 space-y-1">
                                    {availablePermissions
                                      .filter(p => p.category === category)
                                      .map(permission => {
                                        const isSelected = selectedPermissions.includes(permission.id);
                                        return (
                                          <div
                                            key={permission.id}
                                            className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded-md transition-all ${
                                              isSelected
                                                ? 'bg-primary/10 dark:bg-[#C1EEFA]/10 border border-primary/20 dark:border-[#C1EEFA]/20'
                                                : 'hover:bg-muted/10 dark:hover:bg-[#223560]/20 border border-transparent'
                                            }`}
                                          >
                                            <span className={`flex-1 text-[11px] truncate ${isSelected ? 'text-primary dark:text-[#C1EEFA] font-medium' : 'text-heading dark:text-[#C1EEFA]'}`}>
                                              {permission.label}
                                            </span>
                                            {!isSelected ? (
                                              <button
                                                type="button"
                                                onClick={() => togglePermission(permission.id)}
                                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-primary/10 dark:bg-[#C1EEFA]/20 text-primary dark:text-[#C1EEFA] hover:bg-primary/20 dark:hover:bg-[#C1EEFA]/30 transition-all border border-primary/20 dark:border-[#C1EEFA]/20 text-[10px] font-medium"
                                                title="Allow"
                                              >
                                                <Plus className="w-2.5 h-2.5" />
                                                <span>Allow</span>
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() => togglePermission(permission.id)}
                                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-destructive/10 dark:bg-destructive/20 text-destructive hover:bg-destructive/20 dark:hover:bg-destructive/30 transition-all border border-destructive/20 text-[10px] font-medium"
                                                title="Deny"
                                              >
                                                <XIcon className="w-2.5 h-2.5" />
                                                <span>Deny</span>
                                              </button>
                                            )}
                                          </div>
                                        );
                                      })}
                                  </div>
                                </CollapsibleContent>
                              </div>
                            </Collapsible>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                </div>
              </div>
            </div>

            {/* Enhanced Footer */}
            <div className="flex justify-end gap-3 px-4 py-3 border-t border-border/50 dark:border-[#2A3C63]/50 bg-muted/10 dark:bg-[#223560]/20">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingUser(null);
                  setFormData({ name: '', email: '', password: '', status: 'Active' });
                  setSelectedPermissions([]);
                }}
                className="px-4 py-2 bg-transparent hover:bg-muted/50 dark:hover:bg-[#2A3C63]/50 text-heading dark:text-[#C1EEFA] rounded-lg transition-all text-xs font-medium border border-border/50 dark:border-[#2A3C63]/50 hover:border-border dark:hover:border-[#2A3C63] active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUser}
                className="px-4 py-2 bg-[#C1EEFA] dark:bg-[#C1EEFA] hover:bg-[#A8E0F0] dark:hover:bg-[#8FD0E0] text-[#1A2C53] dark:text-[#1A2C53] rounded-lg transition-all text-xs font-medium border border-[#C1EEFA]/30 dark:border-[#C1EEFA]/50 hover:border-[#A8E0F0] dark:hover:border-[#8FD0E0] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:shadow-[#C1EEFA]/20 dark:hover:shadow-[#C1EEFA]/30"
              >
                {editingUser ? 'Save Changes' : 'Add User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Password Modal */}
      {showDeleteAuthModal && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in-0 duration-200" 
          onClick={() => {
            setShowDeleteAuthModal(false);
            setUserToDelete(null);
            setDeletePassword('');
          }}
        >
          <div 
            className="relative bg-card dark:bg-[#223560] rounded-3xl border-2 border-[#C1EEFA]/60 dark:border-[#C1EEFA]/70 shadow-[0_0_30px_rgba(193,238,250,0.4)] dark:shadow-[0_0_40px_rgba(193,238,250,0.6)] p-6 max-w-md w-full shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-border/50 dark:border-[#2A3C63]/50">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-destructive/20 to-destructive/10 dark:from-destructive/30 dark:to-destructive/15 flex items-center justify-center shadow-lg shadow-destructive/10">
                  <Lock className="w-6 h-6 text-destructive" />
                </div>
                <div>
                  <h2 className="text-heading dark:text-[#C1EEFA] text-xl font-bold">
                    Admin Password Required
                  </h2>
                  <p className="text-muted-light dark:text-[#99BFD1] text-xs mt-0.5">
                    Enter admin password to delete user
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDeleteAuthModal(false);
                  setUserToDelete(null);
                  setDeletePassword('');
                }}
                className="p-2 hover:bg-muted/80 dark:hover:bg-[#2A3C63]/80 rounded-xl transition-all hover:scale-110 active:scale-95"
              >
                <X className="w-5 h-5 text-heading dark:text-[#C1EEFA]" />
              </button>
            </div>

            {/* Form Content */}
            <div className="space-y-5">
              <div className="bg-destructive/10 dark:bg-destructive/20 border border-destructive/30 rounded-xl p-4">
                <p className="text-sm text-destructive dark:text-destructive font-medium">
                  Warning: This action cannot be undone. The user will be permanently deleted.
                </p>
              </div>
               
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-semibold">
                  Admin Password <span className="text-destructive">*</span>
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border/50 dark:border-[#2A3C63]/50 rounded-xl px-4 py-3 text-sm text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-destructive focus:ring-2 focus:ring-destructive/20 transition-all hover:border-destructive/50"
                  placeholder="Enter admin password"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleDeleteConfirm();
                    }
                  }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-border/50 dark:border-[#2A3C63]/50">
              <button
                onClick={() => {
                  setShowDeleteAuthModal(false);
                  setUserToDelete(null);
                  setDeletePassword('');
                }}
                className="px-5 py-2.5 bg-muted/80 dark:bg-[#2A3C63]/80 hover:bg-muted dark:hover:bg-[#2A3C63] text-heading dark:text-[#C1EEFA] rounded-xl transition-all text-sm font-semibold active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={!deletePassword}
                className="px-5 py-2.5 bg-gradient-to-r from-destructive to-destructive/90 text-white rounded-xl hover:shadow-[0_0_20px_rgba(222,53,68,0.5)] transition-all text-sm font-semibold flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
              >
                <Trash2 className="w-4 h-4" />
                Delete User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showChangePasswordModal && userToChangePassword && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in-0 duration-200" 
          onClick={() => {
            setShowChangePasswordModal(false);
            setUserToChangePassword(null);
            setPasswordData({ newPassword: '', confirmPassword: '' });
          }}
        >
          <div 
            className="relative bg-card dark:bg-[#223560] rounded-3xl border-2 border-[#C1EEFA]/60 dark:border-[#C1EEFA]/70 shadow-[0_0_30px_rgba(193,238,250,0.4)] dark:shadow-[0_0_40px_rgba(193,238,250,0.6)] p-6 max-w-md w-full shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-border/50 dark:border-[#2A3C63]/50">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-500/10 dark:from-blue-500/30 dark:to-blue-500/15 flex items-center justify-center shadow-lg shadow-blue-500/10">
                  <Lock className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <h2 className="text-heading dark:text-[#C1EEFA] text-xl font-bold">
                    Change Password
                  </h2>
                  <p className="text-muted-light dark:text-[#99BFD1] text-xs mt-0.5">
                    Update password for {userToChangePassword.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowChangePasswordModal(false);
                  setUserToChangePassword(null);
                  setPasswordData({ newPassword: '', confirmPassword: '' });
                }}
                className="p-2 hover:bg-muted/80 dark:hover:bg-[#2A3C63]/80 rounded-xl transition-all hover:scale-110 active:scale-95"
              >
                <X className="w-5 h-5 text-heading dark:text-[#C1EEFA]" />
              </button>
            </div>

            {/* Form Content */}
            <div className="space-y-5">
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-semibold">
                  New Password <span className="text-destructive">*</span>
                </label>
                <input
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border/50 dark:border-[#2A3C63]/50 rounded-xl px-4 py-3 text-sm text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all hover:border-blue-500/50"
                  placeholder="Enter new password"
                  autoFocus
                />
                <p className="text-xs text-muted-light dark:text-[#99BFD1] mt-1.5">Minimum 6 characters</p>
              </div>
               
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-semibold">
                  Confirm Password <span className="text-destructive">*</span>
                </label>
                <input
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border/50 dark:border-[#2A3C63]/50 rounded-xl px-4 py-3 text-sm text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all hover:border-blue-500/50"
                  placeholder="Confirm new password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleChangePasswordConfirm();
                    }
                  }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-border/50 dark:border-[#2A3C63]/50">
              <button
                onClick={() => {
                  setShowChangePasswordModal(false);
                  setUserToChangePassword(null);
                  setPasswordData({ newPassword: '', confirmPassword: '' });
                }}
                className="px-5 py-2.5 bg-muted/80 dark:bg-[#2A3C63]/80 hover:bg-muted dark:hover:bg-[#2A3C63] text-heading dark:text-[#C1EEFA] rounded-xl transition-all text-sm font-semibold active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePasswordConfirm}
                disabled={!passwordData.newPassword || !passwordData.confirmPassword || passwordData.newPassword.length < 6}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all text-sm font-semibold flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
              >
                <Lock className="w-4 h-4" />
                Change Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
