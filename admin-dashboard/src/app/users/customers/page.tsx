'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    Filter,
    Eye,
    MoreVertical,
    User,
    Phone,
    Mail,
    MapPin,
    Calendar,
    ShoppingBag,
    Ban,
    CheckCircle,
    X,
    ChevronDown,
    IndianRupee,
    Loader2,
    TrendingUp,
    Users,
    UserX,
    RefreshCw
} from 'lucide-react';
import { useApi, apiPatch, Customer } from '@/hooks/useApi';

const statusFilters = ['All', 'Active', 'Suspended'];

export default function CustomersPage() {
    const { data: customersData, loading, refetch } = useApi<Customer[]>('/api/customers');
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [actionMenuId, setActionMenuId] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    useEffect(() => {
        if (customersData) {
            setCustomers(customersData);
        }
    }, [customersData]);

    const filteredCustomers = customers.filter(customer => {
        const matchesSearch =
            customer.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
            customer.phoneNumber.includes(searchQuery);

        const matchesStatus = statusFilter === 'All' ||
            customer.status.toLowerCase() === statusFilter.toLowerCase();

        return matchesSearch && matchesStatus;
    });

    const toggleCustomerStatus = async (customerId: string) => {
        const customer = customers.find(c => c.customerId === customerId);
        if (!customer) return;

        const newStatus = customer.status === 'active' ? 'suspended' : 'active';
        setUpdating(customerId);

        const result = await apiPatch('/api/customers', {
            customerId,
            updates: { status: newStatus }
        });

        if (result.success) {
            setCustomers(prev => prev.map(c =>
                c.customerId === customerId ? { ...c, status: newStatus } : c
            ));
        }
        setUpdating(null);
        setActionMenuId(null);
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    const stats = {
        total: customers.length,
        active: customers.filter(c => c.status === 'active').length,
        suspended: customers.filter(c => c.status === 'suspended').length,
        totalOrders: customers.reduce((sum, c) => sum + (c.totalOrders || 0), 0),
    };

    if (loading) {
        return (
            <div className="space-y-8">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--foreground)]">Customers</h1>
                    <p className="text-[var(--foreground-secondary)] mt-1">Loading customers...</p>
                </div>
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-10 h-10 animate-spin text-[var(--primary)]" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--foreground)]">Customers</h1>
                    <p className="text-[var(--foreground-secondary)] mt-1">Manage registered customers and their accounts</p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="btn btn-primary flex items-center gap-2"
                    style={{ opacity: refreshing ? 0.6 : 1 }}
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Premium Stats Section */}
            <section>
                <div className="section-header">
                    <div className="section-title">
                        <div className="icon"><TrendingUp size={18} /></div>
                        Overview
                    </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                        { label: 'Total Customers', value: stats.total, icon: Users, gradient: 'var(--gradient-primary)' },
                        { label: 'Active', value: stats.active, icon: CheckCircle, gradient: 'var(--gradient-success)' },
                        { label: 'Suspended', value: stats.suspended, icon: UserX, gradient: 'var(--gradient-error)' },
                        { label: 'Total Orders', value: stats.totalOrders, icon: ShoppingBag, gradient: 'var(--gradient-warning)' },
                    ].map((stat, index) => (
                        <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="stat-card-premium"
                        >
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="stat-label">{stat.label}</p>
                                    <p className="stat-value">{stat.value}</p>
                                </div>
                                <div className="icon-box" style={{ background: stat.gradient }}>
                                    <stat.icon size={24} className="text-white" />
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* Search and Filter */}
            <section>
                <div className="section-header">
                    <div className="section-title">
                        <div className="icon"><User size={18} /></div>
                        Customer List
                        <span className="section-badge">{filteredCustomers.length}</span>
                    </div>
                </div>

                <div className="glass-card p-4 mb-6">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--foreground-secondary)]" />
                            <input
                                type="text"
                                placeholder="Search by name, email, or phone..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="input pl-10"
                            />
                        </div>

                        <div className="relative">
                            <button
                                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                                className="btn btn-outline w-full sm:w-auto"
                            >
                                <Filter size={16} />
                                {statusFilter}
                                <ChevronDown size={16} />
                            </button>

                            <AnimatePresence>
                                {showFilterDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="dropdown-menu right-0"
                                    >
                                        {statusFilters.map(status => (
                                            <button
                                                key={status}
                                                onClick={() => {
                                                    setStatusFilter(status);
                                                    setShowFilterDropdown(false);
                                                }}
                                                className={`dropdown-item ${statusFilter === status ? 'active' : ''}`}
                                            >
                                                {status}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {/* Customers Table */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card overflow-hidden"
                >
                    <div className="overflow-x-auto">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Customer</th>
                                    <th>Contact</th>
                                    <th>Orders</th>
                                    <th>Total Spent</th>
                                    <th>Last Order</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCustomers.map((customer) => (
                                    <tr key={customer.customerId} className="hover:bg-[var(--surface-hover)]/50">
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] flex items-center justify-center">
                                                    <User size={20} className="text-white" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-[var(--foreground)]">{customer.fullName}</p>
                                                    <p className="text-xs text-[var(--foreground-secondary)]">Since {formatDate(customer.registeredAt || customer.createdAt)}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div>
                                                <p className="text-sm font-medium">{customer.phoneNumber}</p>
                                                <p className="text-xs text-[var(--foreground-secondary)] truncate max-w-[150px]">{customer.email}</p>
                                            </div>
                                        </td>
                                        <td className="font-semibold text-[var(--foreground)]">{customer.totalOrders}</td>
                                        <td className="font-semibold text-[var(--foreground)]">₹{(customer.totalSpent || 0).toLocaleString()}</td>
                                        <td className="text-[var(--foreground-secondary)]">{formatDate(customer.lastOrderAt || customer.createdAt)}</td>
                                        <td>
                                            <span className={`badge ${customer.status === 'active' ? 'badge-approved' : 'badge-rejected'}`}>
                                                {customer.status}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setSelectedCustomer(customer)}
                                                    className="btn btn-ghost btn-icon-sm"
                                                    title="View Details"
                                                >
                                                    <Eye size={16} />
                                                </button>
                                                <div className="relative">
                                                    <button
                                                        onClick={() => setActionMenuId(actionMenuId === customer.customerId ? null : customer.customerId)}
                                                        className="btn btn-ghost btn-icon-sm"
                                                    >
                                                        <MoreVertical size={16} />
                                                    </button>

                                                    <AnimatePresence>
                                                        {actionMenuId === customer.customerId && (
                                                            <motion.div
                                                                initial={{ opacity: 0, scale: 0.95 }}
                                                                animate={{ opacity: 1, scale: 1 }}
                                                                exit={{ opacity: 0, scale: 0.95 }}
                                                                className="dropdown-menu right-0"
                                                            >
                                                                <button
                                                                    onClick={() => toggleCustomerStatus(customer.customerId)}
                                                                    className="dropdown-item"
                                                                >
                                                                    {customer.status === 'active' ? (
                                                                        <>
                                                                            <Ban size={14} className="text-[var(--accent-error)]" />
                                                                            <span>Suspend</span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <CheckCircle size={14} className="text-[var(--accent-success)]" />
                                                                            <span>Activate</span>
                                                                        </>
                                                                    )}
                                                                </button>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {filteredCustomers.length === 0 && (
                        <div className="empty-state">
                            <User size={56} className="text-[var(--foreground-secondary)] mx-auto mb-4" />
                            <p className="text-lg font-medium text-[var(--foreground)]">No customers found</p>
                            <p className="text-[var(--foreground-secondary)]">Try adjusting your search or filters</p>
                        </div>
                    )}
                </motion.div>
            </section>

            {/* Customer Detail Modal */}
            <AnimatePresence>
                {selectedCustomer && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                        onClick={() => setSelectedCustomer(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="modal-content w-full max-w-lg"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] flex items-center justify-center">
                                        <User size={28} className="text-white" />
                                    </div>
                                    <div>
                                        <h2 className="modal-title">{selectedCustomer.fullName}</h2>
                                        <span className={`badge ${selectedCustomer.status === 'active' ? 'badge-approved' : 'badge-rejected'}`}>
                                            {selectedCustomer.status}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedCustomer(null)}
                                    className="btn btn-ghost btn-icon-sm"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="modal-body space-y-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="glass-card p-4">
                                        <div className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)] mb-1">
                                            <Phone size={14} />
                                            Phone
                                        </div>
                                        <p className="font-medium text-[var(--foreground)]">{selectedCustomer.phoneNumber}</p>
                                    </div>
                                    <div className="glass-card p-4">
                                        <div className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)] mb-1">
                                            <Mail size={14} />
                                            Email
                                        </div>
                                        <p className="font-medium text-[var(--foreground)] text-sm truncate">{selectedCustomer.email}</p>
                                    </div>
                                </div>

                                <div className="glass-card p-4">
                                    <div className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)] mb-1">
                                        <MapPin size={14} />
                                        Address
                                    </div>
                                    <p className="font-medium text-[var(--foreground)]">{selectedCustomer.address || (selectedCustomer.addresses?.[0]?.fullAddress || 'N/A')}</p>
                                    <p className="text-sm text-[var(--foreground-secondary)]">{selectedCustomer.city || selectedCustomer.addresses?.[0]?.city || ''} - {selectedCustomer.pincode || selectedCustomer.addresses?.[0]?.pincode || ''}</p>
                                </div>

                                <div className="grid grid-cols-3 gap-4">
                                    <div className="glass-card p-4 text-center">
                                        <ShoppingBag size={22} className="text-[var(--primary)] mx-auto mb-2" />
                                        <p className="text-xl font-bold text-[var(--foreground)]">{selectedCustomer.totalOrders || 0}</p>
                                        <p className="text-xs text-[var(--foreground-secondary)]">Orders</p>
                                    </div>
                                    <div className="glass-card p-4 text-center">
                                        <IndianRupee size={22} className="text-[var(--accent-success)] mx-auto mb-2" />
                                        <p className="text-xl font-bold text-[var(--foreground)]">₹{(selectedCustomer.totalSpent || 0).toLocaleString()}</p>
                                        <p className="text-xs text-[var(--foreground-secondary)]">Spent</p>
                                    </div>
                                    <div className="glass-card p-4 text-center">
                                        <Calendar size={22} className="text-[var(--accent-active)] mx-auto mb-2" />
                                        <p className="text-sm font-bold text-[var(--foreground)]">{formatDate(selectedCustomer.registeredAt || selectedCustomer.createdAt)}</p>
                                        <p className="text-xs text-[var(--foreground-secondary)]">Joined</p>
                                    </div>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    onClick={() => {
                                        toggleCustomerStatus(selectedCustomer.customerId);
                                        setSelectedCustomer(null);
                                    }}
                                    className={`btn flex-1 ${selectedCustomer.status === 'active' ? 'btn-danger' : 'btn-success'}`}
                                >
                                    {selectedCustomer.status === 'active' ? (
                                        <>
                                            <Ban size={16} />
                                            Suspend Account
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle size={16} />
                                            Activate Account
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
