'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    RefreshCw, Gift, Users, Store, DollarSign, Save, Loader2,
    CheckCircle, Coins, ShoppingBag,
    Clock, Shield,
} from 'lucide-react';

interface ReferralSettings {
    isReferralEnabled: boolean;
    customerReferralBonus: number;
    referredCustomerBonus: number;
    vendorReferralBonus: number;
    referredVendorBonus: number;
    minOrderForReferral: number;
    maxReferralsPerUser: number;
    referralExpiryDays: number;
    updatedAt: string | null;
    lastUpdatedBy: string | null;
}

const fld: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' };

export default function ReferralSettingsPage() {
    const [settings, setSettings] = useState<ReferralSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/referral-settings');
            const result = await res.json();
            if (result.success) {
                setSettings(result.data);
            } else {
                setError(result.error || 'Failed to load');
            }
        } catch {
            setError('Network error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSave = async () => {
        if (!settings) return;
        setSaving(true);
        setError('');

        try {
            const res = await fetch('/api/referral-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings }),
            });

            const result = await res.json();
            if (result.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
                fetchData();
            } else {
                setError(result.error || 'Failed to save');
            }
        } catch {
            setError('Network error');
        } finally {
            setSaving(false);
        }
    };

    const updateField = (key: keyof ReferralSettings, value: number | boolean) => {
        if (!settings) return;
        setSettings(prev => prev ? { ...prev, [key]: value } : null);
    };

    if (loading || !settings) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center animate-pulse">
                        <RefreshCw className="w-8 h-8 animate-spin text-[var(--primary)]" />
                    </div>
                    <p className="text-[var(--foreground-secondary)] font-medium">Loading referral settings...</p>
                </div>
            </div>
        );
    }

    const sections = [
        {
            title: 'Referral Program',
            subtitle: 'Enable or disable the referral system',
            icon: Gift,
            color: '#F4511E',
            fields: [
                {
                    type: 'toggle' as const,
                    key: 'isReferralEnabled' as keyof ReferralSettings,
                    label: 'Enable Referral Program',
                    desc: 'When enabled, users can earn rewards by referring friends',
                    value: settings.isReferralEnabled,
                },
            ],
        },
        {
            title: 'Customer Referral Rewards',
            subtitle: 'Coins earned when customers refer other customers',
            icon: Users,
            color: '#3B82F6',
            fields: [
                { type: 'number' as const, key: 'customerReferralBonus' as keyof ReferralSettings, label: 'Referrer Bonus (Coins)', desc: 'Coins earned by the person who refers', icon: Coins, value: settings.customerReferralBonus },
                { type: 'number' as const, key: 'referredCustomerBonus' as keyof ReferralSettings, label: 'New Customer Bonus (Coins)', desc: 'Coins given to the newly referred customer', icon: Gift, value: settings.referredCustomerBonus },
            ],
        },
        {
            title: 'Vendor Referral Rewards',
            subtitle: 'Amount earned when vendors refer new customers',
            icon: Store,
            color: '#F59E0B',
            fields: [
                { type: 'number' as const, key: 'vendorReferralBonus' as keyof ReferralSettings, label: 'Vendor Referral Reward (₹)', desc: '₹ credited to vendor when referred customer completes first order', icon: DollarSign, value: settings.vendorReferralBonus },
                { type: 'number' as const, key: 'referredVendorBonus' as keyof ReferralSettings, label: 'New Vendor Bonus (Coins)', desc: 'Coins given to newly onboarded vendor (0 = disabled)', icon: Gift, value: settings.referredVendorBonus },
            ],
        },
        {
            title: 'Referral Limits',
            subtitle: 'Set boundaries for the referral program',
            icon: Shield,
            color: '#8B5CF6',
            fields: [
                { type: 'number' as const, key: 'minOrderForReferral' as keyof ReferralSettings, label: 'Min Order Value (₹)', desc: 'Minimum order value for referral reward to trigger', icon: ShoppingBag, value: settings.minOrderForReferral },
                { type: 'number' as const, key: 'maxReferralsPerUser' as keyof ReferralSettings, label: 'Max Referrals Per User', desc: 'Maximum number of referrals per user', icon: Users, value: settings.maxReferralsPerUser },
                { type: 'number' as const, key: 'referralExpiryDays' as keyof ReferralSettings, label: 'Referral Expiry (Days)', desc: 'Days before an unused referral expires', icon: Clock, value: settings.referralExpiryDays },
            ],
        },
    ];

    return (
        <div className="space-y-8" style={{ padding: 20 }}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="page-title">Referral & Rewards</h1>
                    <p className="page-description">Configure referral bonuses and reward amounts for customers and vendors</p>
                </div>
                {settings.updatedAt && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', textAlign: 'right' }}>
                        <p>Last updated: {new Date(settings.updatedAt).toLocaleString('en-IN')}</p>
                        {settings.lastUpdatedBy && <p>By: {settings.lastUpdatedBy}</p>}
                    </div>
                )}
            </div>

            {/* Error */}
            {error && (
                <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444', fontWeight: 600, fontSize: '0.85rem' }}>
                    {error}
                </div>
            )}

            {/* Settings Sections */}
            {sections.map((section, sIdx) => (
                <motion.div
                    key={section.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: sIdx * 0.05 }}
                    className="glass-card"
                    style={{ padding: 0, overflow: 'hidden' }}
                >
                    {/* Section Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${section.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <section.icon size={20} color={section.color} />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{section.title}</h2>
                            <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{section.subtitle}</p>
                        </div>
                    </div>

                    {/* Fields */}
                    <div style={{ padding: '16px 24px 24px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: section.fields.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
                            {section.fields.map(field => (
                                <div key={field.key} style={{ padding: 16, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                    {field.type === 'toggle' ? (
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div>
                                                <p style={{ fontWeight: 600, fontSize: '0.85rem' }}>{field.label}</p>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{field.desc}</p>
                                            </div>
                                            <button
                                                onClick={() => updateField(field.key, !field.value)}
                                                style={{
                                                    width: 50, height: 28, borderRadius: 100, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.25s',
                                                    background: field.value ? 'var(--primary)' : 'var(--border)',
                                                }}
                                            >
                                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'white', position: 'absolute', top: 3, transition: 'left 0.25s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', left: field.value ? 25 : 3 }} />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                                {'icon' in field && field.icon && (
                                                    <div style={{ width: 28, height: 28, borderRadius: 7, background: `${section.color}12`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <field.icon size={14} color={section.color} />
                                                    </div>
                                                )}
                                                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--foreground)' }}>{field.label}</label>
                                            </div>
                                            <input
                                                type="number"
                                                value={field.value as number}
                                                onChange={(e) => updateField(field.key, Number(e.target.value))}
                                                min={0}
                                                style={fld}
                                            />
                                            <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 6 }}>{field.desc}</p>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </motion.div>
            ))}

            {/* Save Button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 0' }}>
                <AnimatePresence>
                    {saved && (
                        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#10B981', fontWeight: 500, fontSize: '0.85rem' }}>
                            <CheckCircle size={16} /> Settings saved successfully!
                        </motion.div>
                    )}
                </AnimatePresence>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto',
                        padding: '12px 28px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                        background: 'var(--primary)', color: 'white', fontWeight: 700, fontSize: '0.9rem', opacity: saving ? 0.6 : 1,
                        boxShadow: '0 4px 12px rgba(244,81,30,0.25)',
                    }}
                >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    {saving ? 'Saving...' : 'Save All Settings'}
                </button>
            </div>
        </div>
    );
}









