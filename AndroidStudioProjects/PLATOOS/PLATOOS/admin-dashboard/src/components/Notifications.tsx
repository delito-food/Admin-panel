'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell,
    Store,
    Bike,
    UtensilsCrossed,
    ShoppingBag,
    CheckCircle,
    X,
    Clock
} from 'lucide-react';

interface Notification {
    id: string;
    type: 'vendor' | 'delivery' | 'menu' | 'order';
    title: string;
    message: string;
    time: string;
    read: boolean;
}

const sampleNotifications: Notification[] = [
    {
        id: 'n1',
        type: 'vendor',
        title: 'New Vendor Registration',
        message: 'Pizza Corner has requested verification',
        time: '2 min ago',
        read: false,
    },
    {
        id: 'n2',
        type: 'delivery',
        title: 'Delivery Partner Pending',
        message: 'Ramesh Kumar awaiting license verification',
        time: '15 min ago',
        read: false,
    },
    {
        id: 'n3',
        type: 'menu',
        title: 'Menu Items Pending',
        message: '3 new menu items need approval',
        time: '1 hour ago',
        read: false,
    },
    {
        id: 'n4',
        type: 'order',
        title: 'Order Issue',
        message: 'Customer reported issue with order #ORD-2045',
        time: '2 hours ago',
        read: true,
    },
    {
        id: 'n5',
        type: 'vendor',
        title: 'Vendor Updated Profile',
        message: 'Biryani House updated their menu',
        time: '3 hours ago',
        read: true,
    },
];

interface NotificationsProps {
    isOpen: boolean;
    onClose: () => void;
}

export function Notifications({ isOpen, onClose }: NotificationsProps) {
    const [notifications, setNotifications] = useState(sampleNotifications);

    const unreadCount = notifications.filter(n => !n.read).length;

    const markAsRead = (id: string) => {
        setNotifications(prev => prev.map(n =>
            n.id === id ? { ...n, read: true } : n
        ));
    };

    const markAllAsRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const removeNotification = (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    const getIcon = (type: Notification['type']) => {
        switch (type) {
            case 'vendor': return Store;
            case 'delivery': return Bike;
            case 'menu': return UtensilsCrossed;
            case 'order': return ShoppingBag;
        }
    };

    const getIconColor = (type: Notification['type']) => {
        switch (type) {
            case 'vendor': return 'text-[var(--primary)]';
            case 'delivery': return 'text-[var(--accent-active)]';
            case 'menu': return 'text-[var(--accent-warning-text)]';
            case 'order': return 'text-[var(--accent-error)]';
        }
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
                        className="absolute right-0 top-full mt-2 w-96 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl z-50 overflow-hidden"
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Bell size={18} className="text-[var(--foreground)]" />
                                <h3 className="font-semibold text-[var(--foreground)]">Notifications</h3>
                                {unreadCount > 0 && (
                                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--accent-error)] text-white">
                                        {unreadCount}
                                    </span>
                                )}
                            </div>
                            {unreadCount > 0 && (
                                <button
                                    onClick={markAllAsRead}
                                    className="text-sm text-[var(--primary)] hover:underline"
                                >
                                    Mark all read
                                </button>
                            )}
                        </div>

                        {/* Notifications List */}
                        <div className="max-h-[400px] overflow-y-auto">
                            {notifications.length > 0 ? (
                                notifications.map((notification) => {
                                    const Icon = getIcon(notification.type);
                                    return (
                                        <motion.div
                                            key={notification.id}
                                            layout
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className={`p-4 border-b border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer ${!notification.read ? 'bg-[var(--primary)]/5' : ''
                                                }`}
                                            onClick={() => markAsRead(notification.id)}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className={`w-9 h-9 rounded-lg bg-[var(--background-secondary)] flex items-center justify-center flex-shrink-0 ${getIconColor(notification.type)}`}>
                                                    <Icon size={18} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <p className={`text-sm ${!notification.read ? 'font-semibold' : 'font-medium'} text-[var(--foreground)]`}>
                                                            {notification.title}
                                                        </p>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                removeNotification(notification.id);
                                                            }}
                                                            className="p-1 rounded hover:bg-[var(--background-secondary)] transition-colors"
                                                        >
                                                            <X size={14} className="text-[var(--foreground-secondary)]" />
                                                        </button>
                                                    </div>
                                                    <p className="text-sm text-[var(--foreground-secondary)] mt-0.5 truncate">
                                                        {notification.message}
                                                    </p>
                                                    <div className="flex items-center gap-1 mt-1 text-xs text-[var(--foreground-secondary)]">
                                                        <Clock size={12} />
                                                        <span>{notification.time}</span>
                                                    </div>
                                                </div>
                                                {!notification.read && (
                                                    <span className="w-2 h-2 rounded-full bg-[var(--primary)] flex-shrink-0 mt-2" />
                                                )}
                                            </div>
                                        </motion.div>
                                    );
                                })
                            ) : (
                                <div className="p-8 text-center">
                                    <CheckCircle size={40} className="text-[var(--accent-success)] mx-auto mb-3" />
                                    <p className="text-[var(--foreground-secondary)]">All caught up!</p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        {notifications.length > 0 && (
                            <div className="p-3 border-t border-[var(--border)]">
                                <button className="w-full py-2 text-sm text-[var(--primary)] hover:bg-[var(--primary)]/5 rounded-lg transition-colors">
                                    View All Notifications
                                </button>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
