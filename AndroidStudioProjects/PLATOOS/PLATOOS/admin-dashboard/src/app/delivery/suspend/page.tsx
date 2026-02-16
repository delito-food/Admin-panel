'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface DeliveryPerson {
    deliveryPersonId: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    isOnline: boolean;
    isVerified: boolean;
    isSuspended?: boolean;
    suspensionReason?: string;
    totalDeliveries: number;
    rating: number;
    profileImageUrl?: string;
}

interface SuspendedDeliveryPerson {
    deliveryPersonId: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    suspensionReason: string;
    suspensionNotes: string;
    suspendedAt: string;
    suspendedBy: string;
    totalDeliveries: number;
    rating: number;
}

const SUSPENSION_REASONS = {
    POLICY_VIOLATION: 'Policy Violation',
    CUSTOMER_COMPLAINTS: 'Multiple Customer Complaints',
    LATE_DELIVERIES: 'Frequent Late Deliveries',
    UNPROFESSIONAL_BEHAVIOR: 'Unprofessional Behavior',
    DOCUMENT_EXPIRED: 'Documents Expired',
    FRAUDULENT_ACTIVITY: 'Fraudulent Activity',
    NON_COMPLIANCE: 'Non-compliance with Platform Rules',
    PAYMENT_ISSUES: 'Payment/Settlement Issues',
    VEHICLE_ISSUES: 'Vehicle/License Issues',
    INACTIVE: 'Extended Inactivity',
    OTHER: 'Other (See Notes)',
};

export default function SuspendedDeliveryPage() {
    const [activeTab, setActiveTab] = useState<'suspended' | 'all'>('suspended');
    const [suspendedPersons, setSuspendedPersons] = useState<SuspendedDeliveryPerson[]>([]);
    const [allPersons, setAllPersons] = useState<DeliveryPerson[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showSuspendModal, setShowSuspendModal] = useState(false);
    const [selectedPerson, setSelectedPerson] = useState<DeliveryPerson | null>(null);
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
                fetch('/api/delivery/suspend'),
                fetch('/api/delivery')
            ]);

            const suspendedData = await suspendedRes.json();
            const allData = await allRes.json();

            if (suspendedData.success) {
                setSuspendedPersons(suspendedData.data);
            }
            if (allData.success) {
                // Filter out already suspended delivery persons for the "all" tab
                setAllPersons(allData.data.filter((d: DeliveryPerson) => !d.isSuspended && d.isVerified));
            }
        } catch (error) {
            console.error('Fetch error:', error);
            setMessage({ type: 'error', text: 'Failed to fetch data' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSuspendPerson = async () => {
        if (!selectedPerson || !suspensionReason) {
            setMessage({ type: 'error', text: 'Please select a reason for suspension' });
            return;
        }

        setIsProcessing(true);
        try {
            const response = await fetch('/api/delivery/suspend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deliveryPersonId: selectedPerson.deliveryPersonId,
                    reason: suspensionReason,
                    notes: suspensionNotes,
                    adminId: 'admin', // Replace with actual admin ID
                }),
            });

            const result = await response.json();
            if (result.success) {
                setMessage({ type: 'success', text: result.message });
                setShowSuspendModal(false);
                setSelectedPerson(null);
                setSuspensionReason('');
                setSuspensionNotes('');
                fetchData(); // Refresh data
            } else {
                setMessage({ type: 'error', text: result.error });
            }
        } catch (error) {
            console.error('Suspend error:', error);
            setMessage({ type: 'error', text: 'Failed to suspend delivery person' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReinstatePerson = async (deliveryPersonId: string) => {
        if (!confirm('Are you sure you want to reinstate this delivery person?')) return;

        setIsProcessing(true);
        try {
            const response = await fetch(`/api/delivery/suspend?deliveryPersonId=${deliveryPersonId}&adminId=admin`, {
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
            setMessage({ type: 'error', text: 'Failed to reinstate delivery person' });
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
                        <h1 className="text-3xl font-bold text-gray-900">Delivery Person Suspension Management</h1>
                        <p className="text-gray-600 mt-1">Suspend or reinstate delivery persons with proper reasoning</p>
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
                        🚫 Suspended ({suspendedPersons.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('all')}
                        className={`px-6 py-3 rounded-lg font-medium ${activeTab === 'all'
                            ? 'bg-orange-500 text-white'
                            : 'bg-white text-gray-700 border hover:bg-gray-50'}`}
                    >
                        🏍️ Active ({allPersons.length})
                    </button>
                </div>

                {isLoading ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Loading...</p>
                    </div>
                ) : activeTab === 'suspended' ? (
                    /* Suspended List */
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                        {suspendedPersons.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-gray-500">✅ No suspended delivery persons</p>
                            </div>
                        ) : (
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Delivery Person</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Suspended</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stats</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {suspendedPersons.map((person) => (
                                        <tr key={person.deliveryPersonId}>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-medium text-gray-900">{person.fullName}</div>
                                                <div className="text-sm text-gray-500">ID: {person.deliveryPersonId.slice(-8)}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{person.phoneNumber}</div>
                                                <div className="text-sm text-gray-500">{person.email}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm text-gray-900 font-medium">{person.suspensionReason}</div>
                                                {person.suspensionNotes && (
                                                    <div className="text-sm text-gray-500 mt-1">{person.suspensionNotes}</div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {new Date(person.suspendedAt).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{person.totalDeliveries} deliveries</div>
                                                <div className="text-sm text-gray-500">⭐ {person.rating.toFixed(1)}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                <button
                                                    onClick={() => handleReinstatePerson(person.deliveryPersonId)}
                                                    className="text-green-600 hover:text-green-900"
                                                    disabled={isProcessing}
                                                >
                                                    ✅ Reinstate
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                ) : (
                    /* Active List */
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                        {allPersons.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-gray-500">No active delivery persons found</p>
                            </div>
                        ) : (
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Delivery Person</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stats</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {allPersons.map((person) => (
                                        <tr key={person.deliveryPersonId}>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    <div className="h-10 w-10 flex-shrink-0">
                                                        <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                                                            {person.fullName.charAt(0)}
                                                        </div>
                                                    </div>
                                                    <div className="ml-4">
                                                        <div className="text-sm font-medium text-gray-900">{person.fullName}</div>
                                                        <div className="text-sm text-gray-500">ID: {person.deliveryPersonId.slice(-8)}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{person.phoneNumber}</div>
                                                <div className="text-sm text-gray-500">{person.email}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${person.isOnline ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                                    {person.isOnline ? '🟢 Online' : '⚫ Offline'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{person.totalDeliveries} deliveries</div>
                                                <div className="text-sm text-gray-500">⭐ {person.rating.toFixed(1)}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                <button
                                                    onClick={() => {
                                                        setSelectedPerson(person);
                                                        setShowSuspendModal(true);
                                                    }}
                                                    className="text-red-600 hover:text-red-900"
                                                >
                                                    🚫 Suspend
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* Suspend Modal */}
                {showSuspendModal && selectedPerson && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 w-full max-w-md">
                            <h2 className="text-xl font-bold mb-4">Suspend Delivery Person</h2>
                            <p className="text-gray-600 mb-4">
                                You are about to suspend: <strong>{selectedPerson.fullName}</strong>
                            </p>

                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Reason for Suspension *</label>
                                <select
                                    value={suspensionReason}
                                    onChange={(e) => setSuspensionReason(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                >
                                    <option value="">Select a reason</option>
                                    {Object.entries(SUSPENSION_REASONS).map(([key, label]) => (
                                        <option key={key} value={key}>{label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Additional Notes</label>
                                <textarea
                                    value={suspensionNotes}
                                    onChange={(e) => setSuspensionNotes(e.target.value)}
                                    placeholder="Provide additional details about the suspension..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                    rows={3}
                                />
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => {
                                        setShowSuspendModal(false);
                                        setSelectedPerson(null);
                                        setSuspensionReason('');
                                        setSuspensionNotes('');
                                    }}
                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                                    disabled={isProcessing}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSuspendPerson}
                                    className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300"
                                    disabled={isProcessing || !suspensionReason}
                                >
                                    {isProcessing ? 'Processing...' : 'Suspend'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

