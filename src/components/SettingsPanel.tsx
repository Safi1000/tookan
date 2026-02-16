"use client"

import { useState, useEffect } from "react"
import {
    Key,
    Plus,
    Trash2,
    Copy,
    CheckCircle,
    AlertTriangle,
    RefreshCw,
    Shield,
    Clock,
    X,
    Eye,
    EyeOff,
} from "lucide-react"
import { toast } from "sonner"
import {
    listTokens,
    createToken,
    revokeToken,
    type ApiToken,
    type CreateTokenResponse,
} from "../services/apiTokenService"

export function SettingsPanel() {
    const [tokens, setTokens] = useState<ApiToken[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showRevokeConfirm, setShowRevokeConfirm] = useState<string | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [isRevoking, setIsRevoking] = useState(false)
    const [newlyCreatedToken, setNewlyCreatedToken] = useState<CreateTokenResponse | null>(null)
    const [tokenCopied, setTokenCopied] = useState(false)
    const [showToken, setShowToken] = useState(false)

    // Create form state
    const [formData, setFormData] = useState({
        name: "",
        merchantId: "",
        description: "",
    })

    // Load tokens on mount
    useEffect(() => {
        loadTokens()
    }, [])

    const loadTokens = async () => {
        setIsLoading(true)
        try {
            const result = await listTokens()
            if (result.status === "success" && result.data) {
                setTokens(result.data)
            } else {
                toast.error(result.message || "Failed to load tokens")
            }
        } catch (error) {
            toast.error("Failed to load API tokens")
        } finally {
            setIsLoading(false)
        }
    }

    const handleCreateToken = async () => {
        if (!formData.name.trim() || !formData.merchantId.trim()) {
            toast.error("Token name and Merchant ID are required")
            return
        }

        setIsCreating(true)
        try {
            const result = await createToken(formData.name, formData.merchantId, formData.description)
            if (result.status === "success" && result.data) {
                setNewlyCreatedToken(result.data)
                setShowCreateModal(false)
                setFormData({ name: "", merchantId: "", description: "" })
                toast.success("API token created successfully")
                loadTokens()
            } else {
                toast.error(result.message || "Failed to create token")
            }
        } catch (error) {
            toast.error("Failed to create token")
        } finally {
            setIsCreating(false)
        }
    }

    const handleRevokeToken = async (tokenId: string) => {
        setIsRevoking(true)
        try {
            const result = await revokeToken(tokenId)
            if (result.status === "success") {
                toast.success("Token revoked successfully")
                setShowRevokeConfirm(null)
                loadTokens()
            } else {
                toast.error(result.message || "Failed to revoke token")
            }
        } catch (error) {
            toast.error("Failed to revoke token")
        } finally {
            setIsRevoking(false)
        }
    }

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
        setTokenCopied(true)
        toast.success("Token copied to clipboard")
        setTimeout(() => setTokenCopied(false), 3000)
    }

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return "Never"
        const date = new Date(dateStr)
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
    }

    const activeTokens = tokens.filter((t) => t.is_active)
    const revokedTokens = tokens.filter((t) => !t.is_active)

    return (
        <div className="p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-heading text-3xl mb-2 font-bold">Settings</h1>
                    <p className="text-subheading dark:text-[#99BFD1] text-muted-light">
                        Manage API tokens and system configuration
                    </p>
                </div>
            </div>

            {/* API Tokens Section */}
            <div className="space-y-6">
                {/* Stats Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-[#C1EEFA]/20 flex items-center justify-center">
                                <Key className="w-6 h-6 text-primary dark:text-[#C1EEFA]" />
                            </div>
                            <div>
                                <p className="text-muted-light dark:text-[#99BFD1] text-sm">Total Tokens</p>
                                <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{tokens.length}</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-[#10B981]/10 dark:bg-[#10B981]/20 flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-[#10B981]" />
                            </div>
                            <div>
                                <p className="text-muted-light dark:text-[#99BFD1] text-sm">Active</p>
                                <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{activeTokens.length}</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-destructive/10 dark:bg-destructive/20 flex items-center justify-center">
                                <AlertTriangle className="w-6 h-6 text-destructive" />
                            </div>
                            <div>
                                <p className="text-muted-light dark:text-[#99BFD1] text-sm">Revoked</p>
                                <p className="text-heading dark:text-[#C1EEFA] text-2xl font-bold">{revokedTokens.length}</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tokens Card */}
                <div className="bg-card rounded-2xl border border-border shadow-sm">
                    {/* Card Header */}
                    <div className="p-6 border-b border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <Shield className="w-5 h-5 text-primary dark:text-[#C1EEFA]" />
                            <h2 className="text-heading dark:text-[#C1EEFA] text-lg font-semibold">API Tokens</h2>
                        </div>
                        <div className="flex gap-3 w-full sm:w-auto">
                            <button
                                onClick={loadTokens}
                                disabled={isLoading}
                                className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-xl text-heading dark:text-[#C1EEFA] hover:bg-muted/50 active:bg-muted/70 active:scale-95 transition-all text-sm font-medium shadow-sm flex-1 sm:flex-none"
                            >
                                <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                                Refresh
                            </button>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#10B981] text-white rounded-xl hover:bg-[#059669] hover:shadow-lg active:scale-95 active:shadow-md transition-all text-sm font-semibold shadow-md flex-1 sm:flex-none"
                            >
                                <Plus className="w-4 h-4" />
                                Create Token
                            </button>
                        </div>
                    </div>

                    {/* Token List */}
                    {isLoading ? (
                        <div className="text-center py-16">
                            <RefreshCw className="w-8 h-8 text-primary dark:text-[#C1EEFA] mx-auto mb-4 animate-spin" />
                            <p className="text-muted-light dark:text-[#99BFD1]">Loading tokens...</p>
                        </div>
                    ) : tokens.length === 0 ? (
                        <div className="text-center py-16">
                            <Key className="w-12 h-12 text-muted-light dark:text-[#99BFD1] mx-auto mb-4 opacity-50" />
                            <p className="text-heading dark:text-[#C1EEFA] font-medium mb-1">No API tokens yet</p>
                            <p className="text-muted-light dark:text-[#99BFD1] text-sm mb-6">
                                Create your first token to start using the EDI API
                            </p>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#10B981] text-white rounded-xl hover:bg-[#059669] transition-all text-sm font-semibold"
                            >
                                <Plus className="w-4 h-4" />
                                Create Your First Token
                            </button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="table-header-bg dark:bg-[#1A2C53]">
                                    <tr>
                                        <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Name</th>
                                        <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Description</th>
                                        <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Prefix</th>
                                        <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Merchant</th>
                                        <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Status</th>
                                        <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Created</th>
                                        <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Last Used</th>
                                        <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tokens.map((token, index) => (
                                        <tr
                                            key={token.id}
                                            className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? "table-zebra dark:bg-[#223560]/20" : ""
                                                }`}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <Key className="w-4 h-4 text-primary dark:text-[#C1EEFA]" />
                                                    <span className="text-heading dark:text-[#C1EEFA] text-sm font-medium">{token.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-muted-light dark:text-[#99BFD1] text-sm">
                                                    {token.description || "—"}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <code className="px-2 py-1 bg-muted/50 dark:bg-[#1A2C53] rounded text-sm font-mono text-heading dark:text-[#C1EEFA]">
                                                    {token.prefix}••••••
                                                </code>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-heading dark:text-[#C1EEFA] text-sm">{token.merchant_id}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {token.is_active ? (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30">
                                                        <CheckCircle className="w-3 h-3" />
                                                        Active
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-destructive/10 text-destructive border border-destructive/30">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        Revoked
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-1.5 text-sm text-muted-light dark:text-[#99BFD1]">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    {formatDate(token.created_at)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm text-muted-light dark:text-[#99BFD1]">
                                                    {formatDate(token.last_used_at)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                {token.is_active ? (
                                                    <button
                                                        onClick={() => setShowRevokeConfirm(token.id)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive/10 text-destructive border border-destructive/30 rounded-lg hover:bg-destructive/20 active:bg-destructive/30 active:scale-95 transition-all text-xs font-medium shadow-sm"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                        Revoke
                                                    </button>
                                                ) : (
                                                    <span className="text-muted-light dark:text-[#5B7894] text-xs italic">
                                                        {formatDate(token.revoked_at)}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Info Banner */}
                <div className="flex items-start gap-3 p-4 bg-[#3B82F6]/10 dark:bg-[#3B82F6]/20 border border-[#3B82F6]/30 rounded-xl">
                    <Shield className="w-5 h-5 text-[#3B82F6] mt-0.5 shrink-0" />
                    <div className="text-[#3B82F6] text-sm space-y-1">
                        <p className="font-medium">API Token Security</p>
                        <p className="opacity-80">
                            Tokens are hashed and stored securely. The raw token is only shown once when created — make sure
                            to copy it immediately. Revoked tokens cannot be reactivated.
                        </p>
                    </div>
                </div>
            </div>

            {/* Create Token Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all duration-200">
                    <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border w-full max-w-lg shadow-2xl transform transition-all scale-100">
                        <div className="p-6 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 flex items-center justify-center shadow-sm">
                                    <Plus className="w-5 h-5 text-[#10B981]" />
                                </div>
                                <h3 className="text-heading dark:text-[#C1EEFA] text-lg font-semibold">Create API Token</h3>
                            </div>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="p-2 hover:bg-muted rounded-lg transition-colors active:scale-95"
                            >
                                <X className="w-5 h-5 text-muted-light dark:text-[#99BFD1]" />
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-medium">
                                    Token Name <span className="text-destructive">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g., Production EDI Token"
                                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-medium">
                                    Merchant ID <span className="text-destructive">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.merchantId}
                                    onChange={(e) => setFormData({ ...formData, merchantId: e.target.value })}
                                    placeholder="e.g., merchant_123"
                                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-medium">
                                    Description
                                </label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Optional description for this token..."
                                    rows={3}
                                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] focus:ring-2 focus:ring-primary/20 transition-all resize-none shadow-sm"
                                />
                            </div>
                        </div>

                        <div className="p-6 border-t border-border flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="px-5 py-2.5 border border-border rounded-xl text-heading dark:text-[#C1EEFA] hover:bg-muted/50 active:bg-muted/70 active:scale-95 transition-all text-sm font-medium shadow-sm w-full sm:w-auto"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateToken}
                                disabled={isCreating || !formData.name.trim() || !formData.merchantId.trim()}
                                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#10B981] text-white rounded-xl hover:bg-[#059669] hover:shadow-lg active:scale-95 active:shadow-md transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-md w-full sm:w-auto"
                            >
                                {isCreating ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Plus className="w-4 h-4" />
                                )}
                                {isCreating ? "Creating..." : "Create Token"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Newly Created Token Modal */}
            {newlyCreatedToken && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border w-full max-w-lg shadow-2xl">
                        <div className="p-6 border-b border-border">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 flex items-center justify-center">
                                    <CheckCircle className="w-5 h-5 text-[#10B981]" />
                                </div>
                                <div>
                                    <h3 className="text-heading dark:text-[#C1EEFA] text-lg font-semibold">Token Created</h3>
                                    <p className="text-muted-light dark:text-[#99BFD1] text-sm">{newlyCreatedToken.name}</p>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* Warning */}
                            <div className="flex items-start gap-3 p-4 bg-[#F59E0B]/10 dark:bg-[#F59E0B]/20 border border-[#F59E0B]/30 rounded-xl">
                                <AlertTriangle className="w-5 h-5 text-[#F59E0B] mt-0.5 shrink-0" />
                                <p className="text-[#F59E0B] text-sm font-medium">
                                    Copy this token now. It will not be shown again after you close this dialog.
                                </p>
                            </div>

                            {/* Token Display */}
                            <div>
                                <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2 font-medium">Your API Token</label>
                                <div className="relative">
                                    <div className="bg-[#1A2C53] dark:bg-[#0F1D36] rounded-xl p-4 font-mono text-sm break-all border border-[#2A3C63]">
                                        <span className="text-[#10B981]">
                                            {showToken ? newlyCreatedToken.token : newlyCreatedToken.token.substring(0, 12) + "•".repeat(40)}
                                        </span>
                                    </div>
                                    <div className="absolute top-3 right-3 flex gap-1">
                                        <button
                                            onClick={() => setShowToken(!showToken)}
                                            className="p-1.5 bg-[#2A3C63] rounded-lg hover:bg-[#3A4C73] transition-colors"
                                            title={showToken ? "Hide token" : "Show token"}
                                        >
                                            {showToken ? (
                                                <EyeOff className="w-4 h-4 text-[#99BFD1]" />
                                            ) : (
                                                <Eye className="w-4 h-4 text-[#99BFD1]" />
                                            )}
                                        </button>
                                        <button
                                            onClick={() => copyToClipboard(newlyCreatedToken.token)}
                                            className={`p-1.5 rounded-lg transition-colors ${tokenCopied
                                                ? "bg-[#10B981]/20 text-[#10B981]"
                                                : "bg-[#2A3C63] text-[#99BFD1] hover:bg-[#3A4C73]"
                                                }`}
                                            title="Copy to clipboard"
                                        >
                                            {tokenCopied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-border flex justify-end">
                            <button
                                onClick={() => {
                                    setNewlyCreatedToken(null)
                                    setShowToken(false)
                                    setTokenCopied(false)
                                }}
                                className="px-6 py-2.5 bg-primary dark:bg-[#C1EEFA] text-white dark:text-[#1A2C53] rounded-xl hover:shadow-lg active:scale-95 transition-all text-sm font-semibold shadow-md w-full sm:w-auto"
                            >
                                I've Copied the Token
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Revoke Confirmation Modal */}
            {
                showRevokeConfirm && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all duration-200">
                        <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border w-full max-w-md shadow-2xl transform transition-all scale-100">
                            <div className="p-6 border-b border-border flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shadow-sm">
                                    <AlertTriangle className="w-5 h-5 text-destructive" />
                                </div>
                                <h3 className="text-heading dark:text-[#C1EEFA] text-lg font-semibold">Revoke Token</h3>
                            </div>

                            <div className="p-6">
                                <p className="text-muted-light dark:text-[#99BFD1] text-sm leading-relaxed">
                                    Are you sure you want to revoke this token? This action cannot be undone. Any integrations
                                    using this token will immediately stop working.
                                </p>
                            </div>

                            <div className="p-6 border-t border-border flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                                <button
                                    onClick={() => setShowRevokeConfirm(null)}
                                    disabled={isRevoking}
                                    className="px-5 py-2.5 border border-border rounded-xl text-heading dark:text-[#C1EEFA] hover:bg-muted/50 active:bg-muted/70 active:scale-95 transition-all text-sm font-medium shadow-sm w-full sm:w-auto"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => handleRevokeToken(showRevokeConfirm)}
                                    disabled={isRevoking}
                                    className="flex items-center justify-center gap-2 px-5 py-2.5 bg-destructive text-white rounded-xl hover:bg-red-700 hover:shadow-lg active:scale-95 active:shadow-md transition-all text-sm font-semibold disabled:opacity-50 disabled:transform-none shadow-md w-full sm:w-auto"
                                >
                                    {isRevoking ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Trash2 className="w-4 h-4" />
                                    )}
                                    {isRevoking ? "Revoking..." : "Revoke Token"}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    )
}
