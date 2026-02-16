'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, DollarSign, Truck, Package, Settings as SettingsIcon, Bell, Shield, Database, Loader2, CheckCircle, MapPin } from 'lucide-react';

const fld: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' };

type TabId = 'platform' | 'notifications' | 'security' | 'database';

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<TabId>('platform');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const [platformSettings, setPlatformSettings] = useState({
        platformCommission: 15, minOrderAmount: 100, deliveryFeeDistance: 5,
        deliveryFeeAmount: 30, freeDeliveryThreshold: 500, maxDeliveryRadius: 10,
    });

    const [notificationSettings, setNotificationSettings] = useState({
        newOrderAlert: true, verificationAlert: true, lowInventoryAlert: false,
        dailyReportEmail: true, weeklyReportEmail: true,
    });

    const handleSave = async () => {
        setSaving(true);
        await new Promise(resolve => setTimeout(resolve, 1500));
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
        { id: 'platform', label: 'Platform', icon: SettingsIcon },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        { id: 'security', label: 'Security', icon: Shield },
        { id: 'database', label: 'Database', icon: Database },
    ];

    const tabColors: Record<TabId, string> = { platform: '#288990', notifications: '#FF9904', security: '#10B981', database: '#EF4444' };

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            {/* Header */}
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Settings</h1>
                <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Configure platform settings and preferences</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
                {/* Sidebar */}
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="glass-card" style={{ padding: 8, alignSelf: 'start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {tabs.map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', transition: 'all 0.2s', fontWeight: 600, fontSize: '0.85rem',
                                background: activeTab === tab.id ? 'var(--primary)' : 'transparent',
                                color: activeTab === tab.id ? 'white' : 'var(--foreground-secondary)',
                            }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: activeTab === tab.id ? 'rgba(255,255,255,0.2)' : 'var(--surface)',
                                }}>
                                    <tab.icon size={16} />
                                </div>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </motion.div>

                {/* Content */}
                <AnimatePresence mode="wait">
                    <motion.div key={activeTab} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.2 }} className="glass-card" style={{ padding: 24 }}>
                        {/* Tab Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 12, background: tabColors[activeTab], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {(() => { const Icon = tabs.find(t => t.id === activeTab)!.icon; return <Icon size={20} color="white" />; })()}
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                                    {activeTab === 'platform' && 'Platform Settings'}
                                    {activeTab === 'notifications' && 'Notification Settings'}
                                    {activeTab === 'security' && 'Security Settings'}
                                    {activeTab === 'database' && 'Database Settings'}
                                </h2>
                                <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                    {activeTab === 'platform' && 'Configure commission rates, delivery fees, and order limits'}
                                    {activeTab === 'notifications' && 'Configure alerts and email preferences'}
                                    {activeTab === 'security' && 'Manage access and authentication settings'}
                                    {activeTab === 'database' && 'Firebase configuration and data management'}
                                </p>
                            </div>
                        </div>

                        {/* Platform Tab */}
                        {activeTab === 'platform' && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                                {[
                                    { key: 'platformCommission', label: 'Platform Commission (%)', desc: 'Commission charged on each order', icon: DollarSign, color: '#288990', val: platformSettings.platformCommission },
                                    { key: 'minOrderAmount', label: 'Minimum Order Amount (₹)', desc: 'Minimum cart value before checkout', icon: Package, color: '#F59E0B', val: platformSettings.minOrderAmount },
                                    { key: 'deliveryFeeAmount', label: 'Base Delivery Fee (₹)', desc: 'Base delivery charge per order', icon: Truck, color: '#10B981', val: platformSettings.deliveryFeeAmount },
                                    { key: 'freeDeliveryThreshold', label: 'Free Delivery Threshold (₹)', desc: 'Orders above this get free delivery', icon: Truck, color: '#3B82F6', val: platformSettings.freeDeliveryThreshold },
                                    { key: 'deliveryFeeDistance', label: 'Delivery Fee per KM (₹)', desc: 'Additional charge per kilometer', icon: MapPin, color: '#8B5CF6', val: platformSettings.deliveryFeeDistance },
                                    { key: 'maxDeliveryRadius', label: 'Max Delivery Radius (km)', desc: 'Maximum delivery distance from vendor', icon: MapPin, color: '#EF4444', val: platformSettings.maxDeliveryRadius },
                                ].map(field => (
                                    <div key={field.key} style={{ padding: 16, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                            <div style={{ width: 30, height: 30, borderRadius: 8, background: `${field.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <field.icon size={15} color={field.color} />
                                            </div>
                                            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--foreground)' }}>{field.label}</label>
                                        </div>
                                        <input
                                            type="number"
                                            value={field.val}
                                            onChange={e => setPlatformSettings(prev => ({ ...prev, [field.key]: Number(e.target.value) }))}
                                            style={fld}
                                        />
                                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 6 }}>{field.desc}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Notifications Tab */}
                        {activeTab === 'notifications' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {[
                                    { key: 'newOrderAlert', label: 'New Order Alerts', desc: 'Get notified when a new order is placed', icon: Package },
                                    { key: 'verificationAlert', label: 'Verification Requests', desc: 'Notify when vendors/delivery partners need verification', icon: Shield },
                                    { key: 'lowInventoryAlert', label: 'Low Inventory Alerts', desc: 'Alert when vendor items are running low', icon: Database },
                                    { key: 'dailyReportEmail', label: 'Daily Report Email', desc: 'Receive daily summary of platform activity', icon: Bell },
                                    { key: 'weeklyReportEmail', label: 'Weekly Report Email', desc: 'Receive weekly analytics and insights', icon: SettingsIcon },
                                ].map(item => {
                                    const checked = notificationSettings[item.key as keyof typeof notificationSettings];
                                    return (
                                        <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', transition: 'all 0.2s' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <div style={{ width: 36, height: 36, borderRadius: 10, background: checked ? 'rgba(40,137,144,0.1)' : 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.25s' }}>
                                                    <item.icon size={17} color={checked ? '#288990' : 'var(--foreground-secondary)'} />
                                                </div>
                                                <div>
                                                    <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{item.label}</p>
                                                    <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{item.desc}</p>
                                                </div>
                                            </div>
                                            {/* Toggle */}
                                            <button onClick={() => setNotificationSettings(prev => ({ ...prev, [item.key]: !prev[item.key as keyof typeof prev] }))} style={{
                                                width: 46, height: 26, borderRadius: 100, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.25s',
                                                background: checked ? 'var(--primary)' : 'var(--border)',
                                            }}>
                                                <div style={{
                                                    width: 20, height: 20, borderRadius: '50%', background: 'white', position: 'absolute', top: 3, transition: 'left 0.25s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                                                    left: checked ? 23 : 3,
                                                }} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Security Tab */}
                        {activeTab === 'security' && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 12 }}>
                                <div style={{ width: 60, height: 60, borderRadius: 16, background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Shield size={28} color="#10B981" />
                                </div>
                                <p style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--foreground)' }}>Coming Soon</p>
                                <p style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)', textAlign: 'center' }}>Two-factor authentication, session management, and more</p>
                            </div>
                        )}

                        {/* Database Tab */}
                        {activeTab === 'database' && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 12 }}>
                                <div style={{ width: 60, height: 60, borderRadius: 16, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Database size={28} color="#EF4444" />
                                </div>
                                <p style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--foreground)' }}>Coming Soon</p>
                                <p style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)', textAlign: 'center' }}>Backup, export, and maintenance tools</p>
                            </div>
                        )}

                        {/* Save Button */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                            <AnimatePresence>
                                {saved && (
                                    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#10B981', fontWeight: 500, fontSize: '0.85rem' }}>
                                        <CheckCircle size={16} /> Settings saved successfully!
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            <button onClick={handleSave} disabled={saving} style={{
                                display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', padding: '10px 24px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                                background: 'var(--primary)', color: 'white', fontWeight: 600, fontSize: '0.875rem', opacity: saving ? 0.6 : 1,
                            }}>
                                {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Save size={16} /> Save Changes</>}
                            </button>
                        </div>
                    </motion.div>
                </AnimatePresence>
            </div>
        </motion.div>
    );
}
