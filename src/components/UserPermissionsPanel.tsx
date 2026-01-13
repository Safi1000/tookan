"use client"

import { useState, useEffect } from "react"
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Shield,
  UserIcon,
  CheckCircle,
  Save,
  X,
  UserPlus,
  Lock,
  ChevronDown,
  Mail,
  KeyRound,
  UserCog,
} from "lucide-react"
import { toast } from "sonner"
import { FormGroup, FormControlLabel, Checkbox } from "@mui/material"
import {
  fetchAllUsers,
  createUser,
  updateUser,
  deleteUser,
  changeUserPassword,
  updateUserStatus,
  type UserAccount as ApiUserAccount,
} from "../services/userApi"
import { Listbox } from "@headlessui/react"
// Available permissions
const availablePermissions = [
  { id: "edit_order_financials", label: "Edit Order Financials", category: "Orders" },
  { id: "manage_wallets", label: "Manage Wallets", category: "Financial" },
  { id: "perform_reorder", label: "Perform Reorder", category: "Orders" },
  { id: "perform_return", label: "Perform Return", category: "Orders" },
  { id: "delete_ongoing_orders", label: "Delete Ongoing Orders", category: "Orders" },
  { id: "export_reports", label: "Export Reports", category: "Reports" },
  { id: "add_cod", label: "Add COD", category: "Financial" },
  { id: "confirm_cod_payments", label: "Confirm COD Payments", category: "Financial" },
]

interface UserAccount {
  id: string
  name: string
  email: string
  permissions: string[]
  status: "Active" | "Inactive" | "Banned"
  lastLogin: string
  role?: string
}

// Convert API user to UI user format
function apiUserToUIUser(apiUser: ApiUserAccount): UserAccount {
  // Convert permissions object to array
  const permissionsArray =
    typeof apiUser.permissions === "object" && !Array.isArray(apiUser.permissions)
      ? Object.keys(apiUser.permissions).filter((key) => (apiUser.permissions as Record<string, boolean>)[key] === true)
      : Array.isArray(apiUser.permissions)
        ? apiUser.permissions
        : []

  // Map status from API to UI format
  const statusMap: Record<string, "Active" | "Inactive" | "Banned"> = {
    active: "Active",
    disabled: "Inactive",
    banned: "Banned",
    inactive: "Inactive", // tolerate legacy UI label
  }
  const rawStatus = (apiUser.status || "active").toString().toLowerCase()
  const uiStatus = statusMap[rawStatus] || "Active"

  return {
    id: apiUser.id,
    name: apiUser.name || apiUser.email,
    email: apiUser.email,
    permissions: permissionsArray,
    status: uiStatus,
    lastLogin: apiUser.lastLogin || "Never",
    role: apiUser.role,
  }
}

// Convert UI user permissions array to API permissions object
function permissionsArrayToObject(permissions: string[]): Record<string, boolean> {
  const obj: Record<string, boolean> = {}
  permissions.forEach((perm) => {
    obj[perm] = true
  })
  return obj
}

export function UserPermissionsPanel() {
  // Get permission categories (must be defined before useState)
  const permissionCategories = Array.from(new Set(availablePermissions.map((p) => p.category)))

  const [users, setUsers] = useState<UserAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false)
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null)
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [isProcessingCustomer, setIsProcessingCustomer] = useState(false)
  const [showDeleteAuthModal, setShowDeleteAuthModal] = useState(false)
  const [userToDelete, setUserToDelete] = useState<string | null>(null)
  const [deletePassword, setDeletePassword] = useState("")
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false)
  const [userToChangePassword, setUserToChangePassword] = useState<UserAccount | null>(null)
  const [passwordData, setPasswordData] = useState({ newPassword: "", confirmPassword: "" })
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(
    permissionCategories.reduce((acc, cat) => ({ ...acc, [cat]: false }), {}),
  )

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    status: "Active" as "Active" | "Inactive" | "Banned",
  })

  // Customer form state
  const [customerFormData, setCustomerFormData] = useState({
    name: "",
    phone: "",
  })

  // Fetch users on mount
  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    setIsLoading(true)
    try {
      const response = await fetchAllUsers()
      if (response.status === "success" && response.data.users) {
        const uiUsers = response.data.users.map(apiUserToUIUser)
        setUsers(uiUsers)
      } else {
        toast.error(response.message || "Failed to load users")
      }
    } catch (error) {
      console.error("Error loading users:", error)
      toast.error("Failed to load users")
    } finally {
      setIsLoading(false)
    }
  }

  // Filter users
  const filteredUsers = (users || []).filter((user) => {
    if (!searchQuery) return true
    const lower = searchQuery.toLowerCase()
    return (
      user.name.toLowerCase().includes(lower) ||
      user.email.toLowerCase().includes(lower) ||
      user.id.toLowerCase().includes(lower)
    )
  })

  // Handle add user
  const handleAddUser = () => {
    setFormData({ name: "", email: "", password: "", status: "Active" })
    setSelectedPermissions([])
    setEditingUser(null)
    setShowAddModal(true)
  }

  // Handle edit user
  const handleEditUser = (user: UserAccount) => {
    setFormData({
      name: user.name,
      email: user.email,
      password: "",
      status: user.status,
    })
    setSelectedPermissions([...user.permissions])
    setEditingUser(user)
    setShowAddModal(true)
  }

  // Handle save user
  const handleSaveUser = async () => {
    if (!formData.name || !formData.email) {
      toast.error("Please fill in all required fields")
      return
    }

    try {
      if (editingUser) {
        // Update existing user
        const permissionsObj = permissionsArrayToObject(selectedPermissions)
        const response = await updateUser(editingUser.id, {
          name: formData.name,
          email: formData.email,
          permissions: permissionsObj,
        })

        if (response.status === "success") {
          toast.success("User updated successfully")
          await loadUsers()
          setShowAddModal(false)
          setEditingUser(null)
          setFormData({ name: "", email: "", password: "", status: "Active" })
          setSelectedPermissions([])
        } else {
          toast.error(response.message || "Failed to update user")
        }
      } else {
        // Create new user with password
        if (!formData.password) {
          toast.error("Password is required for new users")
          return
        }

        if (formData.password.length < 6) {
          toast.error("Password must be at least 6 characters long")
          return
        }

        const permissionsObj = permissionsArrayToObject(selectedPermissions)
        const response = await createUser({
          email: formData.email,
          password: formData.password,
          name: formData.name,
          role: "user",
          permissions: permissionsObj,
        })

        if (response.status === "success") {
          toast.success("User created successfully")
          await loadUsers()
          setShowAddModal(false)
          setFormData({ name: "", email: "", password: "", status: "Active" })
          setSelectedPermissions([])
        } else {
          toast.error(response.message || "Failed to create user")
        }
      }
    } catch (error) {
      console.error("Error saving user:", error)
      toast.error("Failed to save user")
    }
  }

  // Check if user is admin
  const isAdminUser = (userId: string): boolean => {
    const user = users.find((u) => u.id === userId)
    return user
      ? user.email.toLowerCase().includes("admin@turbobahrain.com") || user.name.toLowerCase().includes("admin user")
      : false
  }

  // Handle delete user - show password modal
  const handleDeleteUser = (userId: string) => {
    if (isAdminUser(userId)) {
      toast.error("Admin users cannot be deleted")
      return
    }
    setUserToDelete(userId)
    setDeletePassword("")
    setShowDeleteAuthModal(true)
  }

  // Verify admin password and delete user
  const handleDeleteConfirm = async () => {
    if (!userToDelete) {
      return
    }

    // Double check to prevent admin deletion
    if (isAdminUser(userToDelete)) {
      toast.error("Admin users cannot be deleted")
      setShowDeleteAuthModal(false)
      setUserToDelete(null)
      setDeletePassword("")
      return
    }

    try {
      const response = await deleteUser(userToDelete)
      if (response.status === "success") {
        toast.success("User deleted successfully")
        await loadUsers()
        setShowDeleteAuthModal(false)
        setUserToDelete(null)
        setDeletePassword("")
      } else {
        toast.error(response.message || "Failed to delete user")
      }
    } catch (error) {
      console.error("Error deleting user:", error)
      toast.error("Failed to delete user")
    }
  }

  // Handle change password
  const handleChangePasswordClick = (user: UserAccount) => {
    setUserToChangePassword(user)
    setPasswordData({ newPassword: "", confirmPassword: "" })
    setShowChangePasswordModal(true)
  }

  // Confirm password change
  const handleChangePasswordConfirm = async () => {
    if (!passwordData.newPassword || !passwordData.confirmPassword) {
      toast.error("Please fill in all fields")
      return
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error("Passwords do not match")
      return
    }

    if (passwordData.newPassword.length < 6) {
      toast.error("Password must be at least 6 characters long")
      return
    }

    if (!userToChangePassword) {
      return
    }

    try {
      const response = await changeUserPassword(userToChangePassword.id, passwordData.newPassword)
      if (response.status === "success") {
        toast.success(`Password changed successfully for ${userToChangePassword.name}`)
        setShowChangePasswordModal(false)
        setUserToChangePassword(null)
        setPasswordData({ newPassword: "", confirmPassword: "" })
      } else {
        toast.error(response.message || "Failed to change password")
      }
    } catch (error) {
      console.error("Error changing password:", error)
      toast.error("Failed to change password")
    }
  }

  // Handle status change (enable/disable/ban)
  const handleStatusChange = async (userId: string, newStatus: "active" | "disabled" | "banned") => {
    const user = users.find((u) => u.id === userId)
    if (!user) {
      toast.error("User not found")
      return
    }

    // Prevent changing superadmin status
    if (user.email === "ahmedhassan123.ah83@gmail.com") {
      toast.error("Cannot change superadmin status")
      return
    }

    try {
      const response = await updateUserStatus(userId, newStatus)
      if (response.status === "success") {
        const actionLabel = newStatus === "active" ? "enabled" : newStatus === "banned" ? "banned" : "disabled"
        toast.success(`User ${actionLabel} successfully`)
        await loadUsers()
      } else {
        toast.error(response.message || "Failed to update user status")
      }
    } catch (error) {
      console.error("Error updating user status:", error)
      toast.error("Failed to update user status")
    }
  }

  // Toggle permission
  const togglePermission = (permissionId: string) => {
    if (selectedPermissions.includes(permissionId)) {
      setSelectedPermissions(selectedPermissions.filter((p) => p !== permissionId))
    } else {
      setSelectedPermissions([...selectedPermissions, permissionId])
    }
    // Keep dropdown open for multiple selections
  }

  // Toggle category
  const toggleCategory = (category: string) => {
    setOpenCategories((prev) => ({ ...prev, [category]: !prev[category] }))
  }

  // Handle add customer
  const handleAddCustomer = async () => {
    if (!customerFormData.name || !customerFormData.phone) {
      toast.error("Please fill in all required fields")
      return
    }

    setIsProcessingCustomer(true)
    try {
      const token = localStorage.getItem("auth_token")
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (token) {
        headers["Authorization"] = `Bearer ${token}`
      }

      const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || ""
      const response = await fetch(`${apiBase}/api/tookan/customer/add`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: customerFormData.name,
          phone: customerFormData.phone,
        }),
      })

      const result = await response.json()

      if (result.status === "success") {
        toast.success("Customer added successfully")
        setShowAddCustomerModal(false)
        setCustomerFormData({ name: "", phone: "" })
      } else {
        toast.error(result.message || "Failed to add customer")
      }
    } catch (error) {
      console.error("Add customer error:", error)
      toast.error("Failed to add customer. Please try again.")
    } finally {
      setIsProcessingCustomer(false)
    }
  }

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
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">
                  Permissions
                </th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">
                  Status
                </th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">
                  Last Login
                </th>
                <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user, index) => (
                <tr
                  key={user.id}
                  className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? "table-zebra dark:bg-[#223560]/20" : ""}`}
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
                        <span className="px-2 py-1 rounded text-md bg-muted dark:bg-[#2A3C63] text-muted-light dark:text-[#99BFD1]">
                          No permissions
                        </span>
                      ) : (
                        <>
                          {user.permissions.slice(0, 3).map((perm) => (
                            <span
                              key={perm}
                              style={{ fontSize: '20px !important', lineHeight: '1.4', fontWeight: '500' }}
                              className="px-2 py-1 rounded bg-primary/10 dark:bg-[#C1EEFA]/20 text-primary dark:text-[#C1EEFA] border border-primary/30 dark:border-[#C1EEFA]/30"
                            >
                              {availablePermissions.find((p) => p.id === perm)?.label || perm}
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
                    {user.email === "ahmedhassan123.ah83@gmail.com" ? (
                      <span className="px-3 py-1 rounded-lg text-xs font-medium bg-[#8B5CF6]/10 text-[#8B5CF6] border border-[#8B5CF6]/30">
                        👑 Superadmin
                      </span>
                    ) : (
                      <select
                        value={user.status === "Active" ? "active" : user.status === "Inactive" ? "disabled" : "banned"}
                        onChange={(e) =>
                          handleStatusChange(user.id, e.target.value as "active" | "disabled" | "banned")
                        }
                        className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer border ${user.status === "Active"
                          ? "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30"
                          : user.status === "Inactive"
                            ? "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30"
                            : "bg-destructive/10 text-destructive border-destructive/30"
                          }`}
                      >
                        <option value="active" className="bg-background text-foreground">
                          ✓ Active
                        </option>
                        <option value="disabled" className="bg-background text-foreground">
                          ⏸ Disabled
                        </option>
                        <option value="banned" className="bg-background text-foreground">
                          🚫 Banned
                        </option>
                      </select>
                    )}
                  </td>
                  <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1] text-sm">{user.lastLogin}</td>
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
                        <span
                          className="p-2 text-muted-light dark:text-[#99BFD1] cursor-not-allowed opacity-50"
                          title="Admin users cannot be deleted"
                        >
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

      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] px-4 py-12 animate-in fade-in-0 duration-300"
          onClick={() => {
            setShowAddModal(false)
            setEditingUser(null)
            setFormData({ name: "", email: "", password: "", status: "Active" })
            setSelectedPermissions([])
          }}
        >
          <div
            className="bg-[#1A2C53] rounded-2xl shadow-2xl w-full max-h-full flex flex-col border border-[#3D5A80] overflow-hidden"
            style={{ maxWidth: "600px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-6 py-5 border-b border-[#3D5A80] bg-[#152342] shrink-0"
              style={{ paddingBottom: '15px', marginTop: '15px' }}
            >

              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#DE3544] to-[#C42E3C] flex items-center justify-center shadow-lg">
                  {editingUser ? (
                    <UserCog className="w-5 h-5 text-white" />
                  ) : (
                    <UserPlus className="w-5 h-5 text-white" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">
                    {editingUser ? "Edit User" : "Create User"}
                  </h2>

                </div>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false)
                  setEditingUser(null)
                  setFormData({ name: "", email: "", password: "", status: "Active" })
                  setSelectedPermissions([])
                }}
                className="p-2 rounded-xl hover:bg-white/10 transition-all duration-200 group"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-[#99BFD1] group-hover:text-white transition-colors" />
              </button>
            </div>

            <div
              className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0"
              style={{ paddingTop: '12px', paddingBottom: '12px' }}
            >
              {/* User Details Section */}
              <div className="space-y-6">


                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Full Name */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-m font-bold text-[#99BFD1] uppercase tracking-wider">
                      <UserIcon className="w-6 h-6" />
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-[#0F172A] border border-[#3D5A80] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#5B7894] focus:outline-none focus:border-[#C1EEFA] focus:ring-2 focus:ring-[#C1EEFA]/20 transition-all duration-200"
                      placeholder="Enter full name"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-m font-bold text-[#99BFD1] uppercase tracking-wider">
                      <Mail className="w-6 h-6" />
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-[#0F172A] border border-[#3D5A80] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#5B7894] focus:outline-none focus:border-[#C1EEFA] focus:ring-2 focus:ring-[#C1EEFA]/20 transition-all duration-200"
                      placeholder="user@example.com"
                    />
                  </div>

                  {/* Password - only for new users */}
                  {!editingUser && (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-m font-bold text-[#99BFD1] uppercase tracking-wider">
                        <KeyRound className="w-6 h-6" />
                        Password
                      </label>
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full bg-[#0F172A] border border-[#3D5A80] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#5B7894] focus:outline-none focus:border-[#C1EEFA] focus:ring-2 focus:ring-[#C1EEFA]/20 transition-all duration-200"
                        placeholder="Min. 6 characters"
                      />
                    </div>
                  )}

                  {/* Status */}
                  <div className={`space-y-2 ${!editingUser ? "" : "md:col-span-2"}`}>
                    <label className="flex items-center gap-2 text-m font-bold text-[#99BFD1] uppercase tracking-wider">
                      <CheckCircle className="w-6 h-6" />
                      Account Status
                    </label>

                    <Listbox value={formData.status} onChange={(value) => setFormData({ ...formData, status: value })}>
                      <div className="relative">
                        {/* Button */}
                        <Listbox.Button className="w-full bg-[#0F172A] border border-[#3D5A80] rounded-lg px-3 py-2 text-sm text-white flex justify-between items-center cursor-pointer focus:outline-none focus:border-[#C1EEFA] focus:ring-2 focus:ring-[#C1EEFA]/20 transition-all duration-200">
                          {formData.status}
                          <ChevronDown className="w-4 h-4 text-[#5B7894]" />
                        </Listbox.Button>

                        {/* Options */}
                        <Listbox.Options
                          style={{ backgroundColor: "#0F172A", opacity: 1 }}
                          className="absolute mt-1 w-full border border-[#3D5A80] rounded-lg z-10 shadow-lg"
                        >
                          {["Active", "Inactive", "Banned"].map((option) => (
                            <Listbox.Option
                              key={option}
                              value={option}
                              className={({ active, selected }) =>
                                `px-3 py-2 cursor-pointer ${active ? "bg-[#1E2A4C]" : ""} ${selected ? "font-bold" : ""
                                }`
                              }
                            >
                              {option}
                            </Listbox.Option>
                          ))}
                        </Listbox.Options>
                      </div>
                    </Listbox>
                  </div>




                </div>
              </div>

              {/* Permissions Section */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 bg-[#C1EEFA] rounded-full" />
                    <h3 className="text-m font-bold text-[#C1EEFA] uppercase tracking-widest flex items-center gap-2">
                      <Shield className="w-6 h-6" />
                      Permissions
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedPermissions.length === availablePermissions.length) {
                        setSelectedPermissions([])
                      } else {
                        setSelectedPermissions(availablePermissions.map((p) => p.id))
                      }
                    }}
                    className="text-s font-bold text-[#C1EEFA] hover:text-white transition-colors px-3 py-1.5 bg-[#C1EEFA]/10 hover:bg-[#C1EEFA]/20 rounded-lg"
                  >
                    {selectedPermissions.length === availablePermissions.length ? "Clear All" : "Select All"}
                  </button>
                </div>



                {/* Permission Categories */}
                <div className="grid grid-cols-1 gap-3">
                  {permissionCategories.map((category) => {
                    const categoryPermissions = availablePermissions.filter((p) => p.category === category)
                    const selectedInCategory = categoryPermissions.filter((p) =>
                      selectedPermissions.includes(p.id),
                    ).length

                    return (
                      <div key={category} className="bg-[#0F172A] rounded-xl border border-[#3D5A80] overflow-hidden">
                        {/* Category Header */}
                        <div className="flex items-center justify-between px-4 py-2 border-b border-[#3D5A80] bg-[#1A2C53]/50">
                          <div className="flex items-center gap-2">
                            <span className="text-s font-bold text-white uppercase tracking-wide">{category}</span>
                            <span className="text-m font-semibold text-[#5B7894] bg-[#1A2C53] border border-[#3D5A80] px-2 py-0.5 rounded-full">
                              {selectedInCategory}/{categoryPermissions.length}
                            </span>
                          </div>
                        </div>

                        {/* Permission Items */}
                        <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <FormGroup className="contents">
                            {categoryPermissions.map((permission) => {
                              const isSelected = selectedPermissions.includes(permission.id)
                              return (
                                <FormControlLabel
                                  key={permission.id}
                                  control={
                                    <Checkbox
                                      checked={isSelected}
                                      onChange={() => togglePermission(permission.id)}
                                      sx={{
                                        color: "#3D5A80",
                                        padding: "4px",
                                        "&.Mui-checked": {
                                          color: "#DE3544",
                                        },
                                        "& .MuiSvgIcon-root": { fontSize: 20 },
                                      }}
                                    />
                                  }
                                  label={permission.label}
                                  sx={{
                                    margin: 0,
                                    width: '100%',
                                    borderRadius: "6px",
                                    padding: "2px 6px",
                                    backgroundColor: isSelected ? "rgba(222, 53, 68, 0.08)" : "transparent",
                                    border: isSelected ? "1px solid rgba(222, 53, 68, 0.2)" : "1px solid transparent",
                                    transition: "all 0.2s",
                                    "& .MuiFormControlLabel-label": {
                                      fontSize: "13px",
                                      fontWeight: 600,
                                      color: isSelected ? "#fff" : "#99BFD1",
                                      transition: "color 0.2s",
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      lineHeight: 1.2
                                    },
                                    "&:hover": {
                                      backgroundColor: isSelected
                                        ? "rgba(222, 53, 68, 0.15)"
                                        : "rgba(193, 238, 250, 0.05)",
                                    },
                                    minHeight: "32px"
                                  }}
                                />
                              )
                            })}
                          </FormGroup>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div
              className="flex items-center gap-4 px-6 bg-[#152342] border-t border-[#3D5A80] shrink-0"
              style={{ justifyContent: 'center', paddingTop: '12px', paddingBottom: '12px' }} // top/bottom padding
            >
              <div
                className="flex items-center gap-3"
                style={{ justifyContent: 'center', width: '100%' }} // center buttons
              >
                <button
                  onClick={() => {
                    setShowAddModal(false)
                    setEditingUser(null)
                    setFormData({ name: "", email: "", password: "", status: "Active" })
                    setSelectedPermissions([])
                  }}
                  className="px-6 py-2.5 text-sm font-medium text-heading bg-muted dark:bg-[#2A3C63] rounded-lg hover:bg-muted/80 dark:hover:bg-[#374766] transition-shadow shadow-sm hover:shadow-md"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveUser}
                  className="px-6 py-2.5 text-sm font-semibold text-[#1A2C53] bg-[#C1EEFA] rounded-lg flex items-center gap-2 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {editingUser ? (
                    <>
                      <Save className="w-4 h-4" />
                      Save Changes
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      Create User
                    </>
                  )}
                </button>
              </div>
            </div>


          </div>
        </div>
      )}

      {/* Delete User Password Modal - unchanged */}
      {showDeleteAuthModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in-0 duration-200"
          onClick={() => {
            setShowDeleteAuthModal(false)
            setUserToDelete(null)
            setDeletePassword("")
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
                  <h2 className="text-heading dark:text-[#C1EEFA] text-xl font-bold">Admin Password Required</h2>
                  <p className="text-muted-light dark:text-[#99BFD1] text-xs mt-0.5">
                    Enter admin password to delete user
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDeleteAuthModal(false)
                  setUserToDelete(null)
                  setDeletePassword("")
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
                    if (e.key === "Enter") {
                      handleDeleteConfirm()
                    }
                  }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-border/50 dark:border-[#2A3C63]/50">
              <button
                onClick={() => {
                  setShowDeleteAuthModal(false)
                  setUserToDelete(null)
                  setDeletePassword("")
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

      {/* Change Password Modal - unchanged */}
      {showChangePasswordModal && userToChangePassword && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in-0 duration-200"
          onClick={() => {
            setShowChangePasswordModal(false)
            setUserToChangePassword(null)
            setPasswordData({ newPassword: "", confirmPassword: "" })
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
                  <h2 className="text-heading dark:text-[#C1EEFA] text-xl font-bold">Change Password</h2>
                  <p className="text-muted-light dark:text-[#99BFD1] text-xs mt-0.5">
                    Set new password for {userToChangePassword.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowChangePasswordModal(false)
                  setUserToChangePassword(null)
                  setPasswordData({ newPassword: "", confirmPassword: "" })
                }}
                className="p-2 hover:bg-muted/80 dark:hover:bg-[#2A3C63]/80 rounded-xl transition-all hover:scale-110 active:scale-95"
              >
                <X className="w-5 h-5 text-heading dark:text-[#C1EEFA]" />
              </button>
            </div>

            {/* Form Content */}
            <div className="space-y-4">
              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-semibold">
                  New Password <span className="text-destructive">*</span>
                </label>
                <input
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border/50 dark:border-[#2A3C63]/50 rounded-xl px-4 py-3 text-sm text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  placeholder="Enter new password"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-semibold">
                  Confirm Password <span className="text-destructive">*</span>
                </label>
                <input
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border/50 dark:border-[#2A3C63]/50 rounded-xl px-4 py-3 text-sm text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  placeholder="Confirm new password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleChangePasswordConfirm()
                    }
                  }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-border/50 dark:border-[#2A3C63]/50">
              <button
                onClick={() => {
                  setShowChangePasswordModal(false)
                  setUserToChangePassword(null)
                  setPasswordData({ newPassword: "", confirmPassword: "" })
                }}
                className="px-5 py-2.5 bg-muted/80 dark:bg-[#2A3C63]/80 hover:bg-muted dark:hover:bg-[#2A3C63] text-heading dark:text-[#C1EEFA] rounded-xl transition-all text-sm font-semibold active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePasswordConfirm}
                disabled={!passwordData.newPassword || !passwordData.confirmPassword}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all text-sm font-semibold flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
              >
                <Lock className="w-4 h-4" />
                Update Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
