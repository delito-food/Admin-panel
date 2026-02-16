'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Mail,
    Lock,
    Eye,
    EyeOff,
    AlertCircle,
    User,
    CheckCircle2,
    Sparkles,
    ArrowRight,
    Shield,
    Zap,
    BarChart3,
    Package,
    Truck,
    Store,
    AlertTriangle
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
    const { user, login, signup, isConfigured } = useAuth();
    const router = useRouter();
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [touched, setTouched] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (user) {
            router.push('/');
        }
    }, [user, router]);

    const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    const passwordStrength = useMemo(() => {
        if (!password) return { score: 0, label: '', color: '' };
        let score = 0;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        if (score <= 1) return { score: 1, label: 'Weak', color: 'var(--accent-error)' };
        if (score <= 2) return { score: 2, label: 'Fair', color: 'var(--accent-warning)' };
        if (score <= 3) return { score: 3, label: 'Good', color: 'var(--primary)' };
        return { score: 4, label: 'Strong', color: 'var(--accent-success)' };
    }, [password]);

    const validations = useMemo(() => ({
        name: name.trim().length >= 2,
        email: isValidEmail(email),
        password: password.length >= 8,
        confirmPassword: password === confirmPassword && confirmPassword.length > 0,
    }), [name, email, password, confirmPassword]);

    const handleBlur = (field: string) => {
        setTouched(prev => ({ ...prev, [field]: true }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        if (mode === 'login') {
            const success = await login(email, password);
            if (success) {
                router.push('/');
            } else {
                setError('Invalid email or password');
            }
        } else {
            if (!validations.name) {
                setError('Please enter your full name');
            } else if (!validations.email) {
                setError('Please enter a valid email address');
            } else if (!validations.password) {
                setError('Password must be at least 8 characters');
            } else if (!validations.confirmPassword) {
                setError('Passwords do not match');
            } else {
                const success = await signup(name, email, password);
                if (success) {
                    setMode('login');
                    setPassword('');
                    setConfirmPassword('');
                    setTouched({});
                    setError('Account created! Please sign in.');
                } else {
                    setError('Signup failed. Please try again.');
                }
            }
        }

        setLoading(false);
    };

    const features = [
        { icon: BarChart3, label: 'Real-time Analytics', desc: 'Track performance live' },
        { icon: Shield, label: 'Enterprise Security', desc: 'Bank-grade protection' },
        { icon: Zap, label: 'Lightning Fast', desc: 'Optimized for speed' },
    ];

    return (
        <div
            className="login-page"
            style={{
                minHeight: '100vh',
                display: 'flex',
                background: 'var(--background)',
            }}
        >
            {/* Left Panel - Branding */}
            <div
                className="login-brand-panel"
                style={{
                    display: 'none',
                    width: '55%',
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)',
                }}
            >
                {/* Decorative elements */}
                <div style={{
                    position: 'absolute',
                    top: '-100px',
                    right: '-100px',
                    width: '400px',
                    height: '400px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-150px',
                    left: '-100px',
                    width: '500px',
                    height: '500px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.05)',
                }} />

                {/* Content */}
                <div style={{
                    position: 'relative',
                    zIndex: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    height: '100%',
                    padding: '48px',
                }}>
                    {/* Logo */}
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
                    >
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '12px',
                            background: 'rgba(255,255,255,0.2)',
                            backdropFilter: 'blur(10px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <Sparkles size={24} color="white" />
                        </div>
                        <span style={{ color: 'white', fontSize: '24px', fontWeight: 700 }}>Delito</span>
                    </motion.div>

                    {/* Main content */}
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                    >
                        <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 12px',
                            borderRadius: '100px',
                            background: 'rgba(255,255,255,0.15)',
                            marginBottom: '24px',
                        }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981' }} />
                            <span style={{ color: 'white', fontSize: '14px', fontWeight: 500 }}>Admin Dashboard</span>
                        </div>

                        <h1 style={{
                            color: 'white',
                            fontSize: '42px',
                            fontWeight: 700,
                            lineHeight: 1.2,
                            marginBottom: '20px',
                        }}>
                            Powerful logistics<br />
                            <span style={{ opacity: 0.9 }}>management platform</span>
                        </h1>

                        <p style={{
                            color: 'rgba(255,255,255,0.8)',
                            fontSize: '16px',
                            lineHeight: 1.6,
                            maxWidth: '400px',
                            marginBottom: '32px',
                        }}>
                            Monitor orders, manage drivers, and analyze business performance with our comprehensive admin tools.
                        </p>

                        {/* Features */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                            {features.map((feature, idx) => (
                                <motion.div
                                    key={feature.label}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.3 + idx * 0.1 }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '10px 16px',
                                        borderRadius: '10px',
                                        background: 'rgba(255,255,255,0.1)',
                                        backdropFilter: 'blur(10px)',
                                    }}
                                >
                                    <feature.icon size={18} color="white" />
                                    <span style={{ color: 'white', fontSize: '14px', fontWeight: 500 }}>{feature.label}</span>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>

                    {/* Dashboard Preview */}
                    <motion.div
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                    >
                        <div style={{
                            borderRadius: '16px',
                            overflow: 'hidden',
                            background: 'rgba(15, 20, 25, 0.9)',
                            backdropFilter: 'blur(20px)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
                        }}>
                            {/* Dashboard Preview Image */}
                            <div style={{
                                aspectRatio: '16/9',
                                position: 'relative',
                                overflow: 'hidden',
                            }}>
                                <img
                                    src="/dashboard-preview.png"
                                    alt="Dashboard Preview"
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                    }}
                                    onError={(e) => {
                                        // Fallback if .png doesn't work, try other formats
                                        const target = e.target as HTMLImageElement;
                                        if (target.src.endsWith('.png')) {
                                            target.src = '/dashboard-preview.jpg';
                                        } else if (target.src.endsWith('.jpg')) {
                                            target.src = '/dashboard-preview.jpeg';
                                        } else if (target.src.endsWith('.jpeg')) {
                                            target.src = '/dashboard-preview.webp';
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Right Panel - Auth Form */}
            <div
                className="login-form-panel"
                style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '32px',
                }}
            >
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    style={{ width: '100%', maxWidth: '420px' }}
                >
                    {/* Mobile Logo */}
                    <div className="login-mobile-logo" style={{ marginBottom: '32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '44px',
                                height: '44px',
                                borderRadius: '12px',
                                background: 'var(--gradient-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: 'var(--shadow-glow)',
                            }}>
                                <Sparkles size={22} color="white" />
                            </div>
                            <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--foreground)' }}>Delito</span>
                        </div>
                    </div>

                    {/* Title */}
                    <div style={{ marginBottom: '32px' }}>
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={mode}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                            >
                                <h2 style={{
                                    fontSize: '28px',
                                    fontWeight: 700,
                                    color: 'var(--foreground)',
                                    marginBottom: '8px',
                                }}>
                                    {mode === 'login' ? 'Welcome back' : 'Create account'}
                                </h2>
                                <p style={{ color: 'var(--foreground-secondary)', fontSize: '15px' }}>
                                    {mode === 'login'
                                        ? 'Sign in to access your admin dashboard'
                                        : 'Get started with your admin account'}
                                </p>
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    {/* Firebase Configuration Warning */}
                    {!isConfigured && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            style={{ marginBottom: '24px' }}
                        >
                            <div style={{
                                padding: '16px',
                                borderRadius: 'var(--radius)',
                                border: '1px solid var(--accent-warning)',
                                background: 'rgba(245, 158, 11, 0.1)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                    <AlertTriangle size={20} style={{ color: 'var(--accent-warning)', flexShrink: 0, marginTop: '2px' }} />
                                    <div>
                                        <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--accent-warning)', marginBottom: '8px' }}>
                                            Firebase Not Configured
                                        </p>
                                        <p style={{ fontSize: '13px', color: 'var(--foreground-secondary)', lineHeight: 1.5 }}>
                                            Create <code style={{ background: 'var(--surface)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>.env.local</code> in admin-dashboard folder with your Firebase credentials.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Error/Success Message */}
                    <AnimatePresence>
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -10, height: 0 }}
                                animate={{ opacity: 1, y: 0, height: 'auto' }}
                                exit={{ opacity: 0, y: -10, height: 0 }}
                                style={{ marginBottom: '24px' }}
                            >
                                <div style={{
                                    padding: '14px 16px',
                                    borderRadius: 'var(--radius)',
                                    border: `1px solid ${error.includes('created') ? 'var(--accent-success)' : 'var(--accent-error)'}`,
                                    background: error.includes('created') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(233, 25, 12, 0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                }}>
                                    {error.includes('created') ? (
                                        <CheckCircle2 size={20} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
                                    ) : (
                                        <AlertCircle size={20} style={{ color: 'var(--accent-error)', flexShrink: 0 }} />
                                    )}
                                    <p style={{
                                        fontSize: '14px',
                                        color: error.includes('created') ? 'var(--accent-success)' : 'var(--accent-error)',
                                    }}>
                                        {error}
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Name Field (Signup only) */}
                            <AnimatePresence>
                                {mode === 'signup' && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                    >
                                        <label style={{
                                            display: 'block',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            color: 'var(--foreground)',
                                            marginBottom: '8px',
                                        }}>
                                            Full Name
                                        </label>
                                        <div style={{ position: 'relative' }}>
                                            <User
                                                size={18}
                                                style={{
                                                    position: 'absolute',
                                                    left: '14px',
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    color: 'var(--foreground-secondary)',
                                                }}
                                            />
                                            <input
                                                type="text"
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                onBlur={() => handleBlur('name')}
                                                placeholder="John Doe"
                                                className="login-input"
                                                style={{
                                                    width: '100%',
                                                    height: '48px',
                                                    paddingLeft: '44px',
                                                    paddingRight: touched.name ? '44px' : '14px',
                                                    borderRadius: 'var(--radius)',
                                                    border: `1px solid ${touched.name && !validations.name ? 'var(--accent-error)' : touched.name && validations.name ? 'var(--accent-success)' : 'var(--border)'}`,
                                                    background: 'var(--surface)',
                                                    color: 'var(--foreground)',
                                                    fontSize: '15px',
                                                    outline: 'none',
                                                    transition: 'all 0.2s',
                                                }}
                                                required
                                            />
                                            {touched.name && (
                                                <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)' }}>
                                                    {validations.name ? (
                                                        <CheckCircle2 size={18} style={{ color: 'var(--accent-success)' }} />
                                                    ) : (
                                                        <AlertCircle size={18} style={{ color: 'var(--accent-error)' }} />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Email Field */}
                            <div>
                                <label style={{
                                    display: 'block',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    color: 'var(--foreground)',
                                    marginBottom: '8px',
                                }}>
                                    Email address
                                </label>
                                <div style={{ position: 'relative' }}>
                                    <Mail
                                        size={18}
                                        style={{
                                            position: 'absolute',
                                            left: '14px',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            color: 'var(--foreground-secondary)',
                                        }}
                                    />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        onBlur={() => handleBlur('email')}
                                        placeholder="admin@delito.com"
                                        className="login-input"
                                        style={{
                                            width: '100%',
                                            height: '48px',
                                            paddingLeft: '44px',
                                            paddingRight: touched.email ? '44px' : '14px',
                                            borderRadius: 'var(--radius)',
                                            border: `1px solid ${touched.email && !validations.email ? 'var(--accent-error)' : touched.email && validations.email ? 'var(--accent-success)' : 'var(--border)'}`,
                                            background: 'var(--surface)',
                                            color: 'var(--foreground)',
                                            fontSize: '15px',
                                            outline: 'none',
                                            transition: 'all 0.2s',
                                        }}
                                        required
                                    />
                                    {touched.email && (
                                        <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)' }}>
                                            {validations.email ? (
                                                <CheckCircle2 size={18} style={{ color: 'var(--accent-success)' }} />
                                            ) : (
                                                <AlertCircle size={18} style={{ color: 'var(--accent-error)' }} />
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Password Field */}
                            <div>
                                <label style={{
                                    display: 'block',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    color: 'var(--foreground)',
                                    marginBottom: '8px',
                                }}>
                                    Password
                                </label>
                                <div style={{ position: 'relative' }}>
                                    <Lock
                                        size={18}
                                        style={{
                                            position: 'absolute',
                                            left: '14px',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            color: 'var(--foreground-secondary)',
                                        }}
                                    />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onBlur={() => handleBlur('password')}
                                        placeholder="Enter your password"
                                        className="login-input"
                                        style={{
                                            width: '100%',
                                            height: '48px',
                                            paddingLeft: '44px',
                                            paddingRight: '44px',
                                            borderRadius: 'var(--radius)',
                                            border: `1px solid ${touched.password && !validations.password ? 'var(--accent-error)' : touched.password && validations.password ? 'var(--accent-success)' : 'var(--border)'}`,
                                            background: 'var(--surface)',
                                            color: 'var(--foreground)',
                                            fontSize: '15px',
                                            outline: 'none',
                                            transition: 'all 0.2s',
                                        }}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        style={{
                                            position: 'absolute',
                                            right: '14px',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            color: 'var(--foreground-secondary)',
                                            padding: 0,
                                            display: 'flex',
                                        }}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>

                                {/* Password Strength */}
                                {mode === 'signup' && password && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        style={{ marginTop: '10px' }}
                                    >
                                        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                                            {[1, 2, 3, 4].map((level) => (
                                                <div
                                                    key={level}
                                                    style={{
                                                        height: '4px',
                                                        flex: 1,
                                                        borderRadius: '100px',
                                                        background: level <= passwordStrength.score ? passwordStrength.color : 'var(--border)',
                                                        transition: 'all 0.3s',
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        <p style={{ fontSize: '12px', color: passwordStrength.color }}>
                                            {passwordStrength.label} password
                                        </p>
                                    </motion.div>
                                )}
                            </div>

                            {/* Confirm Password (Signup only) */}
                            <AnimatePresence>
                                {mode === 'signup' && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                    >
                                        <label style={{
                                            display: 'block',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            color: 'var(--foreground)',
                                            marginBottom: '8px',
                                        }}>
                                            Confirm Password
                                        </label>
                                        <div style={{ position: 'relative' }}>
                                            <Lock
                                                size={18}
                                                style={{
                                                    position: 'absolute',
                                                    left: '14px',
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    color: 'var(--foreground-secondary)',
                                                }}
                                            />
                                            <input
                                                type={showPassword ? 'text' : 'password'}
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                onBlur={() => handleBlur('confirmPassword')}
                                                placeholder="Confirm your password"
                                                className="login-input"
                                                style={{
                                                    width: '100%',
                                                    height: '48px',
                                                    paddingLeft: '44px',
                                                    paddingRight: touched.confirmPassword ? '44px' : '14px',
                                                    borderRadius: 'var(--radius)',
                                                    border: `1px solid ${touched.confirmPassword && !validations.confirmPassword ? 'var(--accent-error)' : touched.confirmPassword && validations.confirmPassword ? 'var(--accent-success)' : 'var(--border)'}`,
                                                    background: 'var(--surface)',
                                                    color: 'var(--foreground)',
                                                    fontSize: '15px',
                                                    outline: 'none',
                                                    transition: 'all 0.2s',
                                                }}
                                                required
                                            />
                                            {touched.confirmPassword && (
                                                <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)' }}>
                                                    {validations.confirmPassword ? (
                                                        <CheckCircle2 size={18} style={{ color: 'var(--accent-success)' }} />
                                                    ) : (
                                                        <AlertCircle size={18} style={{ color: 'var(--accent-error)' }} />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Remember & Forgot */}
                            {mode === 'login' && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <button
                                        type="button"
                                        onClick={() => setRememberMe(!rememberMe)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: 0,
                                        }}
                                    >
                                        <div style={{
                                            width: '20px',
                                            height: '20px',
                                            borderRadius: '6px',
                                            border: `2px solid ${rememberMe ? 'var(--primary)' : 'var(--border)'}`,
                                            background: rememberMe ? 'var(--primary)' : 'transparent',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            transition: 'all 0.2s',
                                        }}>
                                            {rememberMe && (
                                                <motion.svg
                                                    initial={{ scale: 0 }}
                                                    animate={{ scale: 1 }}
                                                    width="12"
                                                    height="12"
                                                    viewBox="0 0 12 12"
                                                    fill="none"
                                                >
                                                    <path
                                                        d="M2.5 6L5 8.5L9.5 3.5"
                                                        stroke="white"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </motion.svg>
                                            )}
                                        </div>
                                        <span style={{ fontSize: '14px', color: 'var(--foreground-secondary)' }}>Remember me</span>
                                    </button>
                                    <button
                                        type="button"
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            color: 'var(--primary)',
                                            padding: 0,
                                        }}
                                    >
                                        Forgot password?
                                    </button>
                                </div>
                            )}

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="btn btn-primary"
                                style={{
                                    width: '100%',
                                    height: '48px',
                                    marginTop: '8px',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    opacity: loading ? 0.7 : 1,
                                }}
                            >
                                {loading ? (
                                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                        <motion.span
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                                            style={{
                                                width: '20px',
                                                height: '20px',
                                                border: '2px solid rgba(255,255,255,0.3)',
                                                borderTopColor: 'white',
                                                borderRadius: '50%',
                                                display: 'inline-block',
                                            }}
                                        />
                                        {mode === 'login' ? 'Signing in...' : 'Creating account...'}
                                    </span>
                                ) : (
                                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                        {mode === 'login' ? 'Sign In' : 'Create Account'}
                                        <ArrowRight size={18} />
                                    </span>
                                )}
                            </button>
                        </div>
                    </form>

                    {/* Switch mode */}
                    <p style={{
                        textAlign: 'center',
                        marginTop: '24px',
                        fontSize: '14px',
                        color: 'var(--foreground-secondary)',
                    }}>
                        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                        <button
                            type="button"
                            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setTouched({}); setError(''); }}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 600,
                                color: 'var(--primary)',
                                padding: 0,
                            }}
                        >
                            {mode === 'login' ? 'Sign up' : 'Sign in'}
                        </button>
                    </p>

                    {/* Footer */}
                    <p style={{
                        textAlign: 'center',
                        marginTop: '32px',
                        fontSize: '12px',
                        color: 'var(--foreground-secondary)',
                    }}>
                        © 2026 Delito. All rights reserved.
                    </p>
                </motion.div>
            </div>

            <style jsx>{`
                .login-input:focus {
                    border-color: var(--primary) !important;
                    box-shadow: 0 0 0 3px var(--primary-glow);
                }
                .login-input::placeholder {
                    color: var(--foreground-secondary);
                    opacity: 0.6;
                }
                @media (min-width: 1024px) {
                    .login-brand-panel {
                        display: flex !important;
                    }
                    .login-form-panel {
                        width: 45% !important;
                    }
                    .login-mobile-logo {
                        display: none !important;
                    }
                }
            `}</style>
        </div>
    );
}
