'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell,
    Store,
    Bike,
    ShoppingBag,
    CheckCircle,
    X,
    Clock,
    RefreshCw,
    AlertCircle,
} from 'lucide-react';

interface Notification {
    id: string;
    type: 'vendor' | 'delivery' | 'order' | 'menu';
    title: string;
    message: string;
    time: string;
    createdAt: string;
    read: boolean;
}

interface NotificationsProps {
    isOpen: boolean;
    onClose: () => void;
}

const POLL_INTERVAL_MS = 120_000; // refresh every 2 min

export function Notifications({ isOpen, onClose }: NotificationsProps) {
    const router = useRouter();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Track which IDs have been dismissed locally so they don't re-appear
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    // Track locally-read IDs
    const [readIds, setReadIds] = useState<Set<string>>(new Set());

    const fetchNotifications = useCallback(async () => {
        try {
            setError(null);
            const res = await fetch('/api/notifications');
            if (!res.ok) throw new Error('Failed to fetch');
            const json = await res.json();
            if (json.success) {
                setNotifications(
                    (json.data as Notification[]).filter(n => !dismissed.has(n.id))
                );
            }
        } catch (e) {
            setError('Could not load notifications');
        } finally {
            setLoading(false);
        }
    }, [dismissed]);

    // Initial load
    useEffect(() => {
        setLoading(true);
        fetchNotifications();
    }, []);

    // Auto-poll
    useEffect(() => {
        const id = setInterval(fetchNotifications, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [fetchNotifications]);

    const visible = notifications.filter(n => !dismissed.has(n.id));
    const unreadCount = visible.filter(n => !readIds.has(n.id) && !n.read).length;

    const markAsRead = (id: string) => {
        setReadIds(prev => new Set(prev).add(id));
    };

    const markAllAsRead = () => {
        setReadIds(prev => {
            const next = new Set(prev);
            visible.forEach(n => next.add(n.id));
            return next;
        });
    };

    const removeNotification = (id: string) => {
        setDismissed(prev => new Set(prev).add(id));
    };

    const getIcon = (type: Notification['type']) => {
        switch (type) {
            case 'vendor': return Store;
            case 'delivery': return Bike;
            case 'order': return ShoppingBag;
            default: return Bell;
        }
    };

    const getIconStyle = (type: Notification['type']): React.CSSProperties => {
        switch (type) {
            case 'vendor': return { color: 'var(--primary)' };
            case 'delivery': return { color: '#10B981' };
            case 'order': return { color: '#F59E0B' };
            default: return { color: 'var(--foreground-secondary)' };
        }
    };

    const isUnread = (n: Notification) => !readIds.has(n.id) && !n.read;

    const getDestination = (n: Notification): string => {
        switch (n.type) {
            case 'vendor': return '/verification';
            case 'delivery': return '/verification/delivery';
            case 'order': return '/orders';
            default: return '/';
        }
    };

    const handleClick = (n: Notification) => {
        markAsRead(n.id);
        onClose();
        router.push(getDestination(n));
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-40"
                        onClick={onClose}
                    />

                    {/* Panel */}
                    <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        style={{
                            position: 'absolute',
                            right: 0,
                            top: 'calc(100% + 8px)',
                            width: 400,
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 16,
                            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                            zIndex: 50,
                            overflow: 'hidden',
                        }}
                    >
                        {/* Header */}
                        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Bell size={17} />
                                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Notifications</span>
                                {unreadCount > 0 && (
                                    <span style={{ padding: '1px 7px', fontSize: '0.7rem', fontWeight: 700, borderRadius: 20, background: '#ef4444', color: 'white' }}>
                                        {unreadCount}
                                    </span>
                                )}
                                {/* Live indicator */}
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.65rem', color: '#10B981', marginLeft: 4 }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                                    LIVE
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllAsRead}
                                        style={{ fontSize: '0.78rem', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer' }}
                                    >
                                        Mark all read
                                    </button>
                                )}
                                <button
                                    onClick={() => { setLoading(true); fetchNotifications(); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: 'var(--foreground-secondary)' }}
                                    title="Refresh"
                                >
                                    <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                                </button>
                            </div>
                        </div>

                        {/* Body */}
                        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                            {loading && visible.length === 0 ? (
                                <div style={{ padding: 32, textAlign: 'center', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>
                                    <RefreshCw size={24} style={{ margin: '0 auto 8px', opacity: 0.4, display: 'block' }} />
                                    Loading…
                                </div>
                            ) : error ? (
                                <div style={{ padding: 32, textAlign: 'center', color: '#ef4444', fontSize: '0.85rem' }}>
                                    <AlertCircle size={24} style={{ margin: '0 auto 8px', display: 'block' }} />
                                    {error}
                                </div>
                            ) : visible.length === 0 ? (
                                <div style={{ padding: 40, textAlign: 'center', color: 'var(--foreground-secondary)' }}>
                                    <CheckCircle size={36} style={{ margin: '0 auto 10px', display: 'block', color: '#10B981' }} />
                                    <p style={{ fontSize: '0.9rem', fontWeight: 500 }}>All caught up!</p>
                                    <p style={{ fontSize: '0.75rem', marginTop: 4, opacity: 0.6 }}>No pending actions</p>
                                </div>
                            ) : (
                                <AnimatePresence>
                                    {visible.map(n => {
                                        const Icon = getIcon(n.type);
                                        const unread = isUnread(n);
                                        return (
                                            <motion.div
                                                key={n.id}
                                                layout
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, height: 0, padding: 0 }}
                                                style={{
                                                    padding: '12px 16px',
                                                    borderBottom: '1px solid var(--border)',
                                                    background: unread ? 'rgba(var(--primary-rgb, 244,81,30), 0.06)' : 'transparent',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.15s',
                                                }}
                                                onClick={() => handleClick(n)}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                                    {/* Icon */}
                                                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...getIconStyle(n.type) }}>
                                                        <Icon size={17} />
                                                    </div>
                                                    {/* Text */}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                                                            <p style={{ fontSize: '0.82rem', fontWeight: unread ? 700 : 500, lineHeight: 1.3 }}>{n.title}</p>
                                                            <button
                                                                onClick={e => { e.stopPropagation(); removeNotification(n.id); }}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 6, color: 'var(--foreground-secondary)', flexShrink: 0 }}
                                                            >
                                                                <X size={13} />
                                                            </button>
                                                        </div>
                                                        <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {n.message}
                                                        </p>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: '0.67rem', color: 'var(--foreground-secondary)' }}>
                                                            <Clock size={11} />
                                                            <span>{n.time}</span>
                                                        </div>
                                                    </div>
                                                    {/* Unread dot */}
                                                    {unread && (
                                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0, marginTop: 6 }} />
                                                    )}
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </AnimatePresence>
                            )}
                        </div>

                        {/* Footer */}
                        {visible.length > 0 && (
                            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>
                                    Auto-refreshes every 20s
                                </span>
                                <button
                                    onClick={() => setDismissed(new Set(visible.map(n => n.id)))}
                                    style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                                >
                                    Clear all
                                </button>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
