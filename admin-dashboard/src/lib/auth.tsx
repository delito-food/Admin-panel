'use client';

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    type User as FirebaseUser
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, isConfigValid } from './firebase';
import {
    syncSession,
    endCurrentSession,
    clearSessionId,
    rememberSignOutReason,
    SESSION_REVOKED_EVENT,
    HEARTBEAT_MS,
} from './admin-session-client';

interface User {
    uid: string;
    email: string;
    name: string;
    role: 'admin' | 'super_admin';
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isConfigured: boolean;
    login: (email: string, password: string) => Promise<boolean>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isConfigValid || !auth) {
            setIsLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                // Get additional user data from Firestore
                try {
                    if (db) {
                        const userDoc = await getDoc(doc(db, 'admins', firebaseUser.uid));
                        if (userDoc.exists()) {
                            const userData = userDoc.data();
                            setUser({
                                uid: firebaseUser.uid,
                                email: firebaseUser.email || '',
                                name: userData.name || firebaseUser.displayName || 'Admin',
                                role: userData.role || 'admin',
                            });
                        } else {
                            // User exists in Auth but not in admins collection
                            setUser({
                                uid: firebaseUser.uid,
                                email: firebaseUser.email || '',
                                name: firebaseUser.displayName || 'Admin',
                                role: 'admin',
                            });
                        }
                    } else {
                        setUser({
                            uid: firebaseUser.uid,
                            email: firebaseUser.email || '',
                            name: firebaseUser.displayName || 'Admin',
                            role: 'admin',
                        });
                    }
                } catch (error) {
                    console.error('Error fetching user data:', error);
                    setUser({
                        uid: firebaseUser.uid,
                        email: firebaseUser.email || '',
                        name: firebaseUser.displayName || 'Admin',
                        role: 'admin',
                    });
                }
            } else {
                setUser(null);
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // ── Device session (Settings → Security → Login activity) ──────────────
    // Register this browser on sign-in, then heartbeat while the tab is visible.
    const uid = user?.uid;
    useEffect(() => {
        if (!uid) return;
        let lastBeat = 0;
        const beat = (force = false) => {
            const now = Date.now();
            if (!force && now - lastBeat < 30_000) return;
            lastBeat = now;
            void syncSession();
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') beat();
        };
        beat(true);
        const interval = window.setInterval(onVisible, HEARTBEAT_MS);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        };
    }, [uid]);

    // Signed out from another device → sign this browser out too.
    const forcedOut = useRef(false);
    useEffect(() => {
        const onRevoked = async () => {
            if (forcedOut.current) return;
            forcedOut.current = true;
            clearSessionId();
            rememberSignOutReason('revoked');
            try {
                if (auth) await signOut(auth);
            } catch {
                // Redirect regardless
            }
            window.location.href = '/login';
        };
        window.addEventListener(SESSION_REVOKED_EVENT, onRevoked);
        return () => window.removeEventListener(SESSION_REVOKED_EVENT, onRevoked);
    }, []);

    const login = async (email: string, password: string): Promise<boolean> => {
        if (!auth) {
            console.error('Firebase Auth is not configured');
            return false;
        }
        try {
            clearSessionId(); // a fresh sign-in gets a fresh device session
            await signInWithEmailAndPassword(auth, email, password);
            return true;
        } catch (error) {
            console.error('Login error:', error);
            return false;
        }
    };



    const logout = async () => {
        if (!auth) {
            window.location.href = '/login';
            return;
        }
        try {
            await endCurrentSession(); // show this device as "Signed out" in Login activity
            clearSessionId();
            await signOut(auth);
            window.location.href = '/login';
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, isConfigured: isConfigValid, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
