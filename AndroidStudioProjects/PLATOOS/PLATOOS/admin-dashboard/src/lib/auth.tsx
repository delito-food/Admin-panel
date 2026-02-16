'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
    signup: (name: string, email: string, password: string) => Promise<boolean>;
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

    const login = async (email: string, password: string): Promise<boolean> => {
        if (!auth) {
            console.error('Firebase Auth is not configured');
            return false;
        }
        try {
            await signInWithEmailAndPassword(auth, email, password);
            return true;
        } catch (error) {
            console.error('Login error:', error);
            return false;
        }
    };

    const signup = async (name: string, email: string, password: string): Promise<boolean> => {
        if (!auth) {
            console.error('Firebase Auth is not configured');
            return false;
        }
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const firebaseUser = userCredential.user;
            
            // Update display name
            await updateProfile(firebaseUser, { displayName: name });
            
            // Create admin document in Firestore
            if (db) {
                await setDoc(doc(db, 'admins', firebaseUser.uid), {
                    name,
                    email,
                    role: 'admin',
                    createdAt: new Date().toISOString(),
                });
            }
            
            return true;
        } catch (error) {
            console.error('Signup error:', error);
            return false;
        }
    };

    const logout = async () => {
        if (!auth) {
            window.location.href = '/login';
            return;
        }
        try {
            await signOut(auth);
            window.location.href = '/login';
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, isConfigured: isConfigValid, login, signup, logout }}>
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
