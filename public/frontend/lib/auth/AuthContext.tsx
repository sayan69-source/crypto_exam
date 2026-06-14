'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { setAuthToken } from '@/lib/api/client';

export type AuthRole = 'candidate' | 'setter' | 'admin' | 'invigilator' | null;

interface UserSession {
  role: AuthRole;
  identifier: string;
  name?: string;
  token: string;
  expiresAt: number;
}

interface AuthContextType {
  session: UserSession | null;
  loading: boolean;
  login: (role: AuthRole, identifier: string, name?: string, token?: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  hasRole: (role: AuthRole) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Check session on mount
    const storedSession = sessionStorage.getItem('cryptoexam_session');
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession) as UserSession;
        if (parsed.expiresAt > Date.now()) {
          setSession(parsed);
          // Re-arm the API client with the stored JWT so authenticated
          // requests survive a page refresh (mock tokens are ignored).
          if (parsed.token && !parsed.token.startsWith('mock_token_')) {
            setAuthToken(parsed.token);
          }
        } else {
          sessionStorage.removeItem('cryptoexam_session');
        }
      } catch (e) {
        console.error('Failed to parse session', e);
      }
    }
    setLoading(false);
  }, []);

  // Protected route checking
  useEffect(() => {
    if (loading) return;

    // Public marketing/informational pages — open to everyone, no login required.
    // /exam stays public because /exam/page.tsx is the existing public candidate portal
    // (under CandidateLayout). /setter and /admin are NOT public landings any more — the
    // public role explainers live at /for-setters and /for-administrators so they don't
    // collide with the authenticated SetterLayout/AdminLayout chrome.
    const publicRoutes = [
      '/', '/about', '/platform', '/contact', '/privacy', '/terms',
      '/for-setters', '/for-administrators', '/center-access', '/pipeline',
      '/exam',
      '/login', '/setter/login', '/admin/login', '/invigilator/login', '/invigilator/register',
      '/exam/audit', '/exam/t0-broadcast', '/exam/complaint', '/ceremony',
      // Centre staff register on the PUBLIC site (centre LANs are internet-free,
      // ZUUP-OS INV-3); approval + in-person activation still gate every identity.
      '/staff-registration',
      // Candidates enrol (face + details) on the public site; they never log in
      // online — verified biometrically at the centre OS, offline, on exam day.
      '/candidate-enrolment',
    ];
    const isPublicRoute = publicRoutes.some(r => pathname === r) || pathname.startsWith('/exam/paper-info');

    if (!session && !isPublicRoute) {
      // Not logged in — redirect to the correct login portal
      if (pathname.startsWith('/setter')) {
        router.replace('/setter/login');
      } else if (pathname.startsWith('/admin')) {
        router.replace('/admin/login');
      } else if (pathname.startsWith('/invigilator')) {
        router.replace('/invigilator/login');
      } else {
        router.replace('/login');
      }
    } else if (session) {
      // Role-based protection — wrong role for the area
      if (pathname.startsWith('/setter') && pathname !== '/setter/login' && session.role !== 'setter') {
        router.replace('/setter/login');
      } else if (pathname.startsWith('/admin') && pathname !== '/admin/login' && session.role !== 'admin') {
        router.replace('/admin/login');
      } else if (pathname.startsWith('/invigilator') && pathname !== '/invigilator/login' && session.role !== 'invigilator') {
        router.replace('/invigilator/login');
      } else if (pathname.startsWith('/exam/session') && session.role !== 'candidate') {
        router.replace('/login');
      } else if (pathname.startsWith('/exam/system-check') && session.role !== 'candidate') {
        router.replace('/login');
      } else if (pathname.startsWith('/exam/instructions') && session.role !== 'candidate') {
        router.replace('/login');
      }
    }
  }, [session, pathname, loading, router]);

  const login = async (role: AuthRole, identifier: string, name?: string, token?: string) => {
    // When a real backend JWT is supplied, use it (and arm the API client so
    // every subsequent request is authenticated). Otherwise fall back to a mock
    // token for the still-mocked role portals.
    const realToken = !!token;
    const newSession: UserSession = {
      role,
      identifier,
      name: name || (role === 'candidate' ? 'Priya Sharma' : role === 'setter' ? 'Prof. Arvind Krishnamurthy' : role === 'invigilator' ? 'Smt. Lakshmi Bora' : 'Admin User'),
      token: token ?? `mock_token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      expiresAt: Date.now() + 4 * 60 * 60 * 1000, // 4 hours
    };

    sessionStorage.setItem('cryptoexam_session', JSON.stringify(newSession));
    setSession(newSession);
    setAuthToken(realToken ? token! : null);
  };

  const logout = () => {
    sessionStorage.removeItem('cryptoexam_session');
    setSession(null);
    setAuthToken(null);
    router.replace('/login');
  };

  const hasRole = (role: AuthRole) => {
    return session?.role === role;
  };

  return (
    <AuthContext.Provider value={{
      session,
      loading,
      login,
      logout,
      isAuthenticated: !!session,
      hasRole
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
