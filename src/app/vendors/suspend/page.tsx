'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Vendor {
    vendorId: string;
    shopName: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    isOnline: boolean;
    isVerified: boolean;
    isSuspended?: boolean;
    suspensionReason?: string;
    totalOrders: number;
    rating: number;
    profileImageUrl?: string;
}

interface SuspendedVendor {
    vendorId: string;
    shopName: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    suspensionReason: string;
    suspensionNotes: string;
    suspendedAt: string;
    suspendedBy: string;
    totalOrders: number;
    rating: number;
}

const SUSPENSION_REASONS = {
    POLICY_VIOLATION: 'Policy Violation',
    CUSTOMER_COMPLAINTS: 'Multiple Customer Complaints',
    FOOD_QUALITY: 'Food Quality Issues',
    HYGIENE_ISSUES: 'Hygiene Standards Not Met',
    DOCUMENT_EXPIRED: 'Documents Expired',
    FRAUDULENT_ACTIVITY: 'Fraudulent Activity',
    NON_COMPLIANCE: 'Non-compliance with Platform Rules',
    PAYMENT_ISSUES: 'Payment/Settlement Issues',
    INACTIVE: 'Extended Inactivity',
    OTHER: 'Other (See Notes)',
};

export default function SuspendedVendorsPage() {
    const [activeTab, setActiveTab] = useState<'suspended' | 'all'>('suspended');
    const [suspendedVendors, setSuspendedVendors] = useState<SuspendedVendor[]>([]);
    const [allVendors, setAllVendors] = useState<Vendor[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showSuspendModal, setShowSuspendModal] = useState(false);
    const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
    const [suspensionReason, setSuspensionReason] = useState('');
    const [suspensionNotes, setSuspensionNotes] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [suspendedRes, allRes] = await Promise.all([
                fetch('/api/vendors/suspend'),
                fetch('/api/vendors')
            ]);

            const suspendedData = await suspendedRes.json();
            const allData = await allRes.json();

            if (suspendedData.success) {
                setSuspendedVendors(suspendedData.data);
            }
            if (allData.success) {
                // Filter out already suspended vendors for the "all" tab
                setAllVendors(allData.data.filter((v: Vendor) => !v.isSuspended && v.isVerified));
            }
        } catch (error) {
            console.error('Fetch error:', error);
            setMessage({ type: 'error', text: 'Failed to fetch data' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSuspendVendor = async () => {
        if (!selectedVendor || !suspensionReason) {
            setMessage({ type: 'error', text: 'Please select a reason for suspension' });
            return;
        }

        setIsProcessing(true);
        try {
            const response = await fetch('/api/vendors/suspend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vendorId: selectedVendor.vendorId,
                    reason: suspensionReason,
                    notes: suspensionNotes,
                    adminId: 'admin', // Replace with actual admin ID
                }),
            });

            const result = await response.json();
            if (result.success) {
                setMessage({ type: 'success', text: result.message });
                setShowSuspendModal(false);
                setSelectedVendor(null);
                setSuspensionReason('');
                setSuspensionNotes('');
                fetchData(); // Refresh data
            } else {
                setMessage({ type: 'error', text: result.error });
            }
        } catch (error) {
            console.error('Suspend error:', error);
            setMessage({ type: 'error', text: 'Failed to suspend vendor' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReinstateVendor = async (vendorId: string) => {
        if (!confirm('Are you sure you want to reinstate this vendor?')) return;

        setIsProcessing(true);
        try {
            const response = await fetch(`/api/vendors/suspend?vendorId=${vendorId}&adminId=admin`, {
                method: 'DELETE',
            });

            const result = await response.json();
            if (result.success) {
                setMessage({ type: 'success', text: result.message });
                fetchData(); // Refresh data
            } else {
                setMessage({ type: 'error', text: result.error });
            }
        } catch (error) {
            console.error('Reinstate error:', error);
            setMessage({ type: 'error', text: 'Failed to reinstate vendor' });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Vendor Suspension Management</h1>
                        <p className="text-gray-600 mt-1">Suspend or reinstate vendors with proper reasoning</p>
                    </div>
                    <Link href="/" className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                        ← Back to Dashboard
                    </Link>
                </div>

                {/* Message */}
                {message && (
                    <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {message.text}
                        <button onClick={() => setMessage(null)} className="float-right font-bold">×</button>
                    </div>
                )}

                {/* Tabs */}
                <div className="flex gap-4 mb-6">
                    <button
                        onClick={() => setActiveTab('suspended')}
                        className={`px-6 py-3 rounded-lg font-medium ${activeTab === 'suspended'
                            ? 'bg-red-500 text-white'
                            : 'bg-white text-gray-700 border hover:bg-gray-50'}`}
                    >
                        🚫 Suspended Vendors ({suspendedVendors.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('all')}
                        className={`px-6 py-3 rounded-lg font-medium ${activeTab === 'all'
                            ? 'bg-orange-500 text-white'
                            : 'bg-white text-gray-700 border hover:bg-gray-50'}`}
                    >
                        🏪 Active Vendors ({allVendors.length})
                    </button>
                </div>

                {isLoading ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Loading...</p>
                    </div>
                ) : activeTab === 'suspended' ? (
                    /* Suspended Vendors List */
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                        {suspendedVendors.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <p className="text-5xl mb-4">✅</p>
                                <p>No suspended vendors</p>
                            </div>
                        ) : (
                            <table className="w-full">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="text-left py-3 px-4">Vendor</th>
                                        <th className="text-left py-3 px-4">Contact</th>
                                        <th className="text-left py-3 px-4">Reason</th>
                                        <th className="text-left py-3 px-4">Suspended On</th>
                                        <th className="text-center py-3 px-4">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {suspendedVendors.map((vendor) => (
                                        <tr key={vendor.vendorId} className="border-t hover:bg-gray-50">
                                            <td className="py-4 px-4">
                                                <p className="font-semibold">{vendor.shopName}</p>
                                                <p className="text-sm text-gray-500">{vendor.fullName}</p>
                                            </td>
                                            <td className="py-4 px-4">
                                                <p className="text-sm">{vendor.email}</p>
                                                <p className="text-sm text-gray-500">{vendor.phoneNumber}</p>
                                            </td>
                                            <td className="py-4 px-4">
                                                <span className="px-2 py-1 bg-red-100 text-red-700 text-sm rounded-full">
                                                    {vendor.suspensionReason}
                                                </span>
                                                {vendor.suspensionNotes && (
                                                    <p className="text-xs text-gray-500 mt-1">{vendor.suspensionNotes}</p>
                                                )}
                                            </td>
                                            <td className="py-4 px-4 text-sm text-gray-500">
                                                {vendor.suspendedAt ? new Date(vendor.suspendedAt).toLocaleDateString() : 'N/A'}
                                            </td>
                                            <td className="py-4 px-4 text-center">
                                                <button
                                                    onClick={() => handleReinstateVendor(vendor.vendorId)}
                                                    disabled={isProcessing}
                                                    className="px-4 py-2 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 disabled:opacity-50"
                                                >
                                                    Reinstate
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                ) : (
                    /* All Active Vendors List */
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="text-left py-3 px-4">Vendor</th>
                                    <th className="text-left py-3 px-4">Contact</th>
                                    <th className="text-center py-3 px-4">Orders</th>
                                    <th className="text-center py-3 px-4">Rating</th>
                                    <th className="text-center py-3 px-4">Status</th>
                                    <th className="text-center py-3 px-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allVendors.map((vendor) => (
                                    <tr key={vendor.vendorId} className="border-t hover:bg-gray-50">
                                        <td className="py-4 px-4">
                                            <p className="font-semibold">{vendor.shopName}</p>
                                            <p className="text-sm text-gray-500">{vendor.fullName}</p>
                                        </td>
                                        <td className="py-4 px-4">
                                            <p className="text-sm">{vendor.email}</p>
                                            <p className="text-sm text-gray-500">{vendor.phoneNumber}</p>
                                        </td>
                                        <td className="py-4 px-4 text-center font-medium">{vendor.totalOrders}</td>
                                        <td className="py-4 px-4 text-center">
                                            <span className="text-yellow-500">★</span> {vendor.rating.toFixed(1)}
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <span className={`px-2 py-1 text-xs rounded-full ${vendor.isOnline
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-gray-100 text-gray-600'}`}>
                                                {vendor.isOnline ? 'Online' : 'Offline'}
                                            </span>
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <button
                                                onClick={() => {
                                                    setSelectedVendor(vendor);
                                                    setShowSuspendModal(true);
                                                }}
                                                className="px-4 py-2 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600"
                                            >
                                                Suspend
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Suspend Modal */}
                {showSuspendModal && selectedVendor && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
                            <h2 className="text-xl font-bold text-red-600 mb-4">🚫 Suspend Vendor</h2>
                            <p className="text-gray-600 mb-4">
                                You are about to suspend <strong>{selectedVendor.shopName}</strong>.
                                This will immediately take them offline and prevent them from receiving orders.
                            </p>

                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Suspension Reason *
                                </label>
                                <select
                                    value={suspensionReason}
                                    onChange={(e) => setSuspensionReason(e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2"
                                >
                                    <option value="">Select a reason...</option>
                                    {Object.entries(SUSPENSION_REASONS).map(([key, value]) => (
                                        <option key={key} value={value}>{value}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Additional Notes (Optional)
                                </label>
                                <textarea
                                    value={suspensionNotes}
                                    onChange={(e) => setSuspensionNotes(e.target.value)}
                                    placeholder="Add any additional details..."
                                    className="w-full border rounded-lg px-3 py-2 h-24"
                                />
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => {
                                        setShowSuspendModal(false);
                                        setSelectedVendor(null);
                                        setSuspensionReason('');
                                        setSuspensionNotes('');
                                    }}
                                    className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSuspendVendor}
                                    disabled={isProcessing || !suspensionReason}
                                    className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                                >
                                    {isProcessing ? 'Processing...' : 'Confirm Suspension'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

