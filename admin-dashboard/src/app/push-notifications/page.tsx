'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell, Send, RefreshCw, Search, Users, MapPin, UserCheck,
    Loader2, CheckCircle2, XCircle, AlertCircle, Image,
    ChevronDown, X, Clock, Eye, Smartphone,
} from 'lucide-react';

interface Campaign {
    id: string;
    title: string;
    body: string;
    imageUrl: string | null;
    target: 'all' | 'city' | 'specific';
    cityFilter: string | null;
    sentCount: number;
    failedCount: number;
    totalTargeted: number;
    tokensFound: number;
    status: 'sent' | 'partial' | 'failed';
    sentBy: string;
    createdAt: string;
}

interface CustomerOption {
    id: string;
    name: string;
    phone: string;
    email: string;
    city: string;
    hasFcmToken: boolean;
}

export default function PushNotificationsPage() {
    // Tab state
    const [activeTab, setActiveTab] = useState<'compose' | 'history'>('compose');

    // Compose form state
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [target, setTarget] = useState<'all' | 'city' | 'specific'>('all');
    const [cityFilter, setCityFilter] = useState('');
    const [selectedCustomers, setSelectedCustomers] = useState<CustomerOption[]>([]);
    const [customerSearch, setCustomerSearch] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

    // Data state
    const [customers, setCustomers] = useState<CustomerOption[]>([]);
    const [cities, setCities] = useState<string[]>([]);
    const [totalCustomers, setTotalCustomers] = useState(0);
    const [withTokenCount, setWithTokenCount] = useState(0);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);

    // UI state
    const [sending, setSending] = useState(false);
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [sendResult, setSendResult] = useState<{
        success: boolean;
        sentCount?: number;
        failedCount?: number;
        error?: string;
    } | null>(null);

    // Fetch customers & cities for targeting
    const fetchCustomers = useCallback(async () => {
        try {
            setLoadingCustomers(true);
            const res = await fetch('/api/push-notifications/customers');
            const result = await res.json();
            if (result.success) {
                setCustomers(result.data);
                setCities(result.cities || []);
                setTotalCustomers(result.totalCount || 0);
                setWithTokenCount(result.withTokenCount || 0);
            }
        } catch (err) {
            console.error('Customer fetch error:', err);
        } finally {
            setLoadingCustomers(false);
        }
    }, []);

    // Fetch campaign history
    const fetchHistory = useCallback(async () => {
        try {
            setLoadingHistory(true);
            const res = await fetch('/api/push-notifications');
            const result = await res.json();
            if (result.success) {
                setCampaigns(result.data);
            }
        } catch (err) {
            console.error('History fetch error:', err);
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        fetchCustomers();
        fetchHistory();
    }, [fetchCustomers, fetchHistory]);

    // Filtered customers for dropdown
    const filteredCustomers = customers.filter(c => {
        if (!customerSearch) return true;
        const q = customerSearch.toLowerCase();
        return (
            c.name.toLowerCase().includes(q) ||
            c.phone.includes(q) ||
            c.email.toLowerCase().includes(q)
        );
    }).filter(c => !selectedCustomers.find(s => s.id === c.id));

    // Calculate target count
    const getTargetCount = () => {
        if (target === 'all') return withTokenCount;
        if (target === 'city') {
            return customers.filter(c => c.city === cityFilter && c.hasFcmToken).length;
        }
        if (target === 'specific') {
            return selectedCustomers.filter(c => c.hasFcmToken).length;
        }
        return 0;
    };

    const getTargetLabel = () => {
        if (target === 'all') return 'All Customers';
        if (target === 'city') return `Customers in ${cityFilter || '(select city)'}`;
        if (target === 'specific') return `${selectedCustomers.length} Selected Customer${selectedCustomers.length !== 1 ? 's' : ''}`;
        return '';
    };

    // Validate form
    const isFormValid = () => {
        if (!title.trim() || !body.trim()) return false;
        if (target === 'city' && !cityFilter) return false;
        if (target === 'specific' && selectedCustomers.length === 0) return false;
        return true;
    };

    // Send notification
    const handleSend = async () => {
        setShowConfirmModal(false);
        setSending(true);
        setSendResult(null);

        try {
            const payload: Record<string, unknown> = {
                title: title.trim(),
                body: body.trim(),
                imageUrl: imageUrl.trim() || null,
                target,
            };

            if (target === 'city') {
                payload.cityFilter = cityFilter;
            } else if (target === 'specific') {
                payload.customerIds = selectedCustomers.map(c => c.id);
            }

            const res = await fetch('/api/push-notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await res.json();

            if (result.success) {
                setSendResult({
                    success: true,
                    sentCount: result.sentCount,
                    failedCount: result.failedCount,
                });
                // Reset form
                setTitle('');
                setBody('');
                setImageUrl('');
                setTarget('all');
                setCityFilter('');
                setSelectedCustomers([]);
                // Refresh history
                fetchHistory();
            } else {
                setSendResult({ success: false, error: result.error });
            }
        } catch {
            setSendResult({ success: false, error: 'Network error. Please try again.' });
        } finally {
            setSending(false);
        }
    };

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const statusBadge = (status: string) => {
        const map: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
            sent: {
                bg: 'rgba(34, 197, 94, 0.12)',
                text: 'var(--accent-success)',
                icon: <CheckCircle2 size={12} />,
            },
            partial: {
                bg: 'rgba(251, 191, 36, 0.12)',
                text: 'var(--accent-warning)',
                icon: <AlertCircle size={12} />,
            },
            failed: {
                bg: 'rgba(239, 68, 68, 0.12)',
                text: 'var(--accent-error)',
                icon: <XCircle size={12} />,
            },
        };
        const s = map[status] || map.sent;
        return (
            <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: s.bg, color: s.text }}
            >
                {s.icon}
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
        );
    };

    const targetBadge = (t: string, city?: string | null) => {
        if (t === 'all') return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: 'rgba(99, 102, 241, 0.12)', color: 'var(--accent-primary)' }}>
                <Users size={11} /> All
            </span>
        );
        if (t === 'city') return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: 'rgba(14, 165, 233, 0.12)', color: 'var(--accent-info, #0ea5e9)' }}>
                <MapPin size={11} /> {city || 'City'}
            </span>
        );
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: 'rgba(168, 85, 247, 0.12)', color: '#a855f7' }}>
                <UserCheck size={11} /> Specific
            </span>
        );
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--foreground)]">Push Notifications</h1>
                    <p className="text-sm text-[var(--foreground-secondary)] mt-1">
                        Send promotional notifications to your customers
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)' }}
                    >
                        <Users size={14} />
                        <span>{totalCustomers.toLocaleString('en-IN')} customers</span>
                        <span className="text-[var(--foreground-secondary)]">•</span>
                        <span className="text-[var(--accent-success)]">{withTokenCount} reachable</span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)', width: 'fit-content' }}>
                {(['compose', 'history'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className="relative px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                        style={{
                            background: activeTab === tab ? 'var(--gradient-primary)' : 'transparent',
                            color: activeTab === tab ? 'white' : 'var(--foreground-secondary)',
                        }}
                    >
                        <span className="flex items-center gap-2">
                            {tab === 'compose' ? <Send size={15} /> : <Clock size={15} />}
                            {tab === 'compose' ? 'Compose' : 'History'}
                        </span>
                    </button>
                ))}
            </div>

            {/* ══════════════════════════════ COMPOSE TAB ══════════════════════════════ */}
            {activeTab === 'compose' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Form — 2 columns */}
                    <div className="lg:col-span-2 space-y-5">
                        {/* Notification Content Card */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="card-premium p-6"
                        >
                            <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4 flex items-center gap-2">
                                <Bell size={18} style={{ color: 'var(--accent-primary)' }} />
                                Notification Content
                            </h2>

                            <div className="space-y-4">
                                {/* Title */}
                                <div>
                                    <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                                        Title <span style={{ color: 'var(--accent-error)' }}>*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value.slice(0, 65))}
                                        placeholder="e.g., 🔥 50% OFF on your first order!"
                                        className="w-full px-4 py-2.5 rounded-xl text-sm transition-all duration-200"
                                        style={{
                                            background: 'var(--glass-bg)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--foreground)',
                                            outline: 'none',
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                                        onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                                    />
                                    <p className="text-xs text-[var(--foreground-secondary)] mt-1 text-right">
                                        {title.length}/65
                                    </p>
                                </div>

                                {/* Body */}
                                <div>
                                    <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                                        Message <span style={{ color: 'var(--accent-error)' }}>*</span>
                                    </label>
                                    <textarea
                                        value={body}
                                        onChange={(e) => setBody(e.target.value.slice(0, 240))}
                                        placeholder="e.g., Order now and enjoy amazing discounts on your favorite dishes. Limited time offer!"
                                        rows={3}
                                        className="w-full px-4 py-2.5 rounded-xl text-sm transition-all duration-200 resize-none"
                                        style={{
                                            background: 'var(--glass-bg)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--foreground)',
                                            outline: 'none',
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                                        onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                                    />
                                    <p className="text-xs text-[var(--foreground-secondary)] mt-1 text-right">
                                        {body.length}/240
                                    </p>
                                </div>

                                {/* Image URL */}
                                <div>
                                    <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                                        <span className="flex items-center gap-1.5">
                                            <Image size={14} />
                                            Image URL <span className="text-xs text-[var(--foreground-secondary)] font-normal">(optional — shows as banner)</span>
                                        </span>
                                    </label>
                                    <input
                                        type="url"
                                        value={imageUrl}
                                        onChange={(e) => setImageUrl(e.target.value)}
                                        placeholder="https://example.com/promo-banner.jpg"
                                        className="w-full px-4 py-2.5 rounded-xl text-sm transition-all duration-200"
                                        style={{
                                            background: 'var(--glass-bg)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--foreground)',
                                            outline: 'none',
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                                        onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                                    />
                                </div>
                            </div>
                        </motion.div>

                        {/* Target Audience Card */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 }}
                            className="card-premium p-6"
                        >
                            <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4 flex items-center gap-2">
                                <Users size={18} style={{ color: 'var(--accent-primary)' }} />
                                Target Audience
                            </h2>

                            {/* Target type selector */}
                            <div className="grid grid-cols-3 gap-3 mb-4">
                                {([
                                    { key: 'all' as const, label: 'All Customers', icon: <Users size={18} />, desc: `${withTokenCount} reachable` },
                                    { key: 'city' as const, label: 'By City', icon: <MapPin size={18} />, desc: 'Location based' },
                                    { key: 'specific' as const, label: 'Specific Users', icon: <UserCheck size={18} />, desc: 'Hand-picked' },
                                ]).map(opt => (
                                    <button
                                        key={opt.key}
                                        onClick={() => {
                                            setTarget(opt.key);
                                            setCityFilter('');
                                            setSelectedCustomers([]);
                                        }}
                                        className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all duration-200 text-center"
                                        style={{
                                            background: target === opt.key
                                                ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(99, 102, 241, 0.05))'
                                                : 'var(--glass-bg)',
                                            border: `1.5px solid ${target === opt.key ? 'var(--accent-primary)' : 'var(--border)'}`,
                                            color: target === opt.key ? 'var(--accent-primary)' : 'var(--foreground-secondary)',
                                        }}
                                    >
                                        {opt.icon}
                                        <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{opt.label}</span>
                                        <span className="text-xs">{opt.desc}</span>
                                    </button>
                                ))}
                            </div>

                            {/* City selector */}
                            {target === 'city' && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3">
                                    <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Select City</label>
                                    <div className="relative">
                                        <select
                                            value={cityFilter}
                                            onChange={(e) => setCityFilter(e.target.value)}
                                            className="w-full px-4 py-2.5 rounded-xl text-sm appearance-none"
                                            style={{
                                                background: 'var(--glass-bg)',
                                                border: '1px solid var(--border)',
                                                color: 'var(--foreground)',
                                                outline: 'none',
                                            }}
                                        >
                                            <option value="">-- Select a city --</option>
                                            {cities.map(c => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--foreground-secondary)]" />
                                    </div>
                                    {cityFilter && (
                                        <p className="text-xs text-[var(--foreground-secondary)] mt-1.5">
                                            {customers.filter(c => c.city === cityFilter && c.hasFcmToken).length} reachable customers in {cityFilter}
                                        </p>
                                    )}
                                </motion.div>
                            )}

                            {/* Specific customer picker */}
                            {target === 'specific' && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3">
                                    <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Search & Select Customers</label>
                                    <div className="relative">
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--foreground-secondary)]" />
                                        <input
                                            type="text"
                                            value={customerSearch}
                                            onChange={(e) => {
                                                setCustomerSearch(e.target.value);
                                                setShowCustomerDropdown(true);
                                            }}
                                            onFocus={() => setShowCustomerDropdown(true)}
                                            placeholder="Search by name, phone, or email..."
                                            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm"
                                            style={{
                                                background: 'var(--glass-bg)',
                                                border: '1px solid var(--border)',
                                                color: 'var(--foreground)',
                                                outline: 'none',
                                            }}
                                        />

                                        {/* Dropdown */}
                                        <AnimatePresence>
                                            {showCustomerDropdown && filteredCustomers.length > 0 && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -5 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -5 }}
                                                    className="absolute z-20 w-full mt-1 rounded-xl overflow-hidden shadow-lg max-h-48 overflow-y-auto"
                                                    style={{
                                                        background: 'var(--card-bg)',
                                                        border: '1px solid var(--border)',
                                                    }}
                                                >
                                                    {filteredCustomers.slice(0, 20).map(c => (
                                                        <button
                                                            key={c.id}
                                                            onClick={() => {
                                                                setSelectedCustomers(prev => [...prev, c]);
                                                                setCustomerSearch('');
                                                                setShowCustomerDropdown(false);
                                                            }}
                                                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--glass-bg)] transition-colors flex items-center justify-between"
                                                        >
                                                            <div>
                                                                <span className="font-medium text-[var(--foreground)]">{c.name}</span>
                                                                <span className="text-[var(--foreground-secondary)] ml-2">{c.phone}</span>
                                                            </div>
                                                            {!c.hasFcmToken && (
                                                                <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">No token</span>
                                                            )}
                                                        </button>
                                                    ))}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    {/* Selected chips */}
                                    {selectedCustomers.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {selectedCustomers.map(c => (
                                                <span
                                                    key={c.id}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                                                    style={{
                                                        background: c.hasFcmToken ? 'rgba(99, 102, 241, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                        color: c.hasFcmToken ? 'var(--accent-primary)' : 'var(--accent-error)',
                                                        border: `1px solid ${c.hasFcmToken ? 'rgba(99, 102, 241, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                                                    }}
                                                >
                                                    {c.name}
                                                    <button
                                                        onClick={() => setSelectedCustomers(prev => prev.filter(s => s.id !== c.id))}
                                                        className="hover:opacity-70"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </motion.div>

                        {/* Send Button + Result */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
                        >
                            <button
                                onClick={() => setShowConfirmModal(true)}
                                disabled={!isFormValid() || sending}
                                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white font-semibold text-sm transition-all duration-200"
                                style={{
                                    background: isFormValid() && !sending
                                        ? 'var(--gradient-primary)'
                                        : 'var(--glass-bg)',
                                    opacity: isFormValid() && !sending ? 1 : 0.5,
                                    cursor: isFormValid() && !sending ? 'pointer' : 'not-allowed',
                                    color: isFormValid() && !sending ? 'white' : 'var(--foreground-secondary)',
                                    boxShadow: isFormValid() && !sending ? 'var(--shadow-glow)' : 'none',
                                }}
                            >
                                {sending ? (
                                    <><Loader2 size={16} className="animate-spin" /> Sending...</>
                                ) : (
                                    <><Send size={16} /> Send to {getTargetCount()} customers</>
                                )}
                            </button>
                        </motion.div>

                        {/* Send Result */}
                        <AnimatePresence>
                            {sendResult && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="p-4 rounded-xl flex items-start gap-3"
                                    style={{
                                        background: sendResult.success
                                            ? 'rgba(34, 197, 94, 0.08)'
                                            : 'rgba(239, 68, 68, 0.08)',
                                        border: `1px solid ${sendResult.success ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                                    }}
                                >
                                    {sendResult.success ? (
                                        <CheckCircle2 size={20} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
                                    ) : (
                                        <XCircle size={20} style={{ color: 'var(--accent-error)', flexShrink: 0 }} />
                                    )}
                                    <div>
                                        <p className="text-sm font-medium text-[var(--foreground)]">
                                            {sendResult.success
                                                ? `Notification sent successfully!`
                                                : 'Failed to send notification'}
                                        </p>
                                        <p className="text-xs text-[var(--foreground-secondary)] mt-0.5">
                                            {sendResult.success
                                                ? `${sendResult.sentCount} delivered, ${sendResult.failedCount} failed`
                                                : sendResult.error}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setSendResult(null)}
                                        className="ml-auto text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
                                    >
                                        <X size={16} />
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Preview — 1 column */}
                    <div className="lg:col-span-1">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 }}
                            className="card-premium p-6 sticky top-6"
                        >
                            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4 flex items-center gap-2">
                                <Smartphone size={16} style={{ color: 'var(--accent-primary)' }} />
                                Android Preview
                            </h3>

                            {/* Mock Android notification */}
                            <div
                                className="rounded-2xl overflow-hidden"
                                style={{
                                    background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
                                    padding: '16px',
                                }}
                            >
                                {/* Status bar mock */}
                                <div className="flex justify-between items-center mb-3 px-1">
                                    <span className="text-[10px] text-gray-400">9:41</span>
                                    <div className="flex gap-1.5">
                                        <div className="w-3 h-2 rounded-sm bg-gray-500" />
                                        <div className="w-4 h-2 rounded-sm bg-gray-500" />
                                        <div className="w-5 h-2.5 rounded-sm border border-gray-500 relative">
                                            <div className="absolute inset-0.5 bg-green-400 rounded-[1px]" style={{ width: '70%' }} />
                                        </div>
                                    </div>
                                </div>

                                {/* Notification card */}
                                <div
                                    className="rounded-2xl p-3.5 space-y-2"
                                    style={{
                                        background: 'rgba(255,255,255,0.08)',
                                        backdropFilter: 'blur(20px)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                    }}
                                >
                                    {/* App icon + title row */}
                                    <div className="flex items-center gap-2">
                                        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: 'var(--gradient-primary)' }}>
                                            <span className="text-[8px] text-white font-bold">D</span>
                                        </div>
                                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">Delito</span>
                                        <span className="text-[10px] text-gray-500 ml-auto">now</span>
                                    </div>

                                    <p className="text-sm font-semibold text-white leading-tight">
                                        {title || 'Notification Title'}
                                    </p>
                                    <p className="text-xs text-gray-300 leading-relaxed">
                                        {body || 'Your notification message will appear here...'}
                                    </p>

                                    {/* Image preview */}
                                    {imageUrl && (
                                        <div className="rounded-xl overflow-hidden mt-1" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={imageUrl}
                                                alt="Banner preview"
                                                className="w-full h-28 object-cover"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Target summary */}
                            <div className="mt-4 space-y-2 text-xs text-[var(--foreground-secondary)]">
                                <div className="flex justify-between">
                                    <span>Target</span>
                                    <span className="font-medium text-[var(--foreground)]">{getTargetLabel()}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Reachable</span>
                                    <span className="font-medium text-[var(--accent-success)]">{getTargetCount()} devices</span>
                                </div>
                                {imageUrl && (
                                    <div className="flex justify-between">
                                        <span>Style</span>
                                        <span className="font-medium text-[var(--foreground)]">BigPicture</span>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                </div>
            )}

            {/* ══════════════════════════════ HISTORY TAB ══════════════════════════════ */}
            {activeTab === 'history' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-[var(--foreground-secondary)]">
                            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} sent
                        </p>
                        <button
                            onClick={fetchHistory}
                            disabled={loadingHistory}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                            style={{
                                background: 'var(--glass-bg)',
                                border: '1px solid var(--border)',
                                color: 'var(--foreground-secondary)',
                            }}
                        >
                            <RefreshCw size={13} className={loadingHistory ? 'animate-spin' : ''} />
                            Refresh
                        </button>
                    </div>

                    {loadingHistory ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 size={24} className="animate-spin text-[var(--accent-primary)]" />
                        </div>
                    ) : campaigns.length === 0 ? (
                        <div className="card-premium p-12 text-center">
                            <Bell size={40} className="mx-auto mb-3 text-[var(--foreground-secondary)]" style={{ opacity: 0.3 }} />
                            <p className="text-[var(--foreground-secondary)] text-sm">No notifications sent yet</p>
                            <p className="text-[var(--foreground-secondary)] text-xs mt-1">Compose your first notification to get started</p>
                        </div>
                    ) : (
                        <div className="card-premium overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr style={{ background: 'var(--glass-bg)', borderBottom: '1px solid var(--border)' }}>
                                            <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--foreground-secondary)] uppercase tracking-wider">Notification</th>
                                            <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--foreground-secondary)] uppercase tracking-wider">Target</th>
                                            <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--foreground-secondary)] uppercase tracking-wider">Delivered</th>
                                            <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--foreground-secondary)] uppercase tracking-wider">Failed</th>
                                            <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--foreground-secondary)] uppercase tracking-wider">Status</th>
                                            <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--foreground-secondary)] uppercase tracking-wider">Sent At</th>
                                            <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--foreground-secondary)] uppercase tracking-wider">Sent By</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {campaigns.map((campaign, idx) => (
                                            <tr
                                                key={campaign.id}
                                                className="transition-colors duration-150"
                                                style={{
                                                    borderBottom: idx < campaigns.length - 1 ? '1px solid var(--border)' : 'none',
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-bg)'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <td className="px-4 py-3.5">
                                                    <div className="max-w-xs">
                                                        <p className="font-medium text-[var(--foreground)] truncate">{campaign.title}</p>
                                                        <p className="text-xs text-[var(--foreground-secondary)] truncate mt-0.5">{campaign.body}</p>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3.5">{targetBadge(campaign.target, campaign.cityFilter)}</td>
                                                <td className="px-4 py-3.5 text-center">
                                                    <span className="font-semibold" style={{ color: 'var(--accent-success)' }}>{campaign.sentCount}</span>
                                                </td>
                                                <td className="px-4 py-3.5 text-center">
                                                    <span className="font-semibold" style={{ color: campaign.failedCount > 0 ? 'var(--accent-error)' : 'var(--foreground-secondary)' }}>
                                                        {campaign.failedCount}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3.5 text-center">{statusBadge(campaign.status)}</td>
                                                <td className="px-4 py-3.5 text-xs text-[var(--foreground-secondary)] whitespace-nowrap">{formatDate(campaign.createdAt)}</td>
                                                <td className="px-4 py-3.5 text-xs text-[var(--foreground-secondary)]">{campaign.sentBy}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}

            {/* ══════════════════════════════ CONFIRM MODAL ══════════════════════════════ */}
            <AnimatePresence>
                {showConfirmModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                        onClick={() => setShowConfirmModal(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="w-full max-w-md rounded-2xl p-6 space-y-4"
                            style={{
                                background: 'var(--card-bg)',
                                border: '1px solid var(--border)',
                                boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                                    style={{ background: 'rgba(99, 102, 241, 0.12)' }}
                                >
                                    <Send size={18} style={{ color: 'var(--accent-primary)' }} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-[var(--foreground)]">Confirm Send</h3>
                                    <p className="text-xs text-[var(--foreground-secondary)]">This action cannot be undone</p>
                                </div>
                            </div>

                            <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--glass-bg)' }}>
                                <div className="flex justify-between text-sm">
                                    <span className="text-[var(--foreground-secondary)]">Title</span>
                                    <span className="font-medium text-[var(--foreground)] text-right max-w-[200px] truncate">{title}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-[var(--foreground-secondary)]">Target</span>
                                    <span className="font-medium text-[var(--foreground)]">{getTargetLabel()}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-[var(--foreground-secondary)]">Reachable Devices</span>
                                    <span className="font-semibold" style={{ color: 'var(--accent-success)' }}>{getTargetCount()}</span>
                                </div>
                                {imageUrl && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-[var(--foreground-secondary)]">Image</span>
                                        <span className="font-medium text-[var(--accent-primary)]">Attached</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowConfirmModal(false)}
                                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
                                    style={{
                                        background: 'var(--glass-bg)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--foreground)',
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSend}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200"
                                    style={{
                                        background: 'var(--gradient-primary)',
                                        boxShadow: 'var(--shadow-glow)',
                                    }}
                                >
                                    <Send size={14} /> Send Now
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
