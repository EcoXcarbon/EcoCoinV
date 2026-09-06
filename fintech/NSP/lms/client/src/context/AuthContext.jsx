import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('tl-token');
    if (token) {
      api.get('/auth/me')
        .then(r => setUser(r.data.user))
        .catch(() => localStorage.removeItem('tl-token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    // If MFA is enabled, server returns { mfaRequired, challengeToken } — do NOT set user/token yet.
    // Caller must finish the flow by calling loginVerifyMfa.
    if (data.mfaRequired) return data;
    localStorage.setItem('tl-token', data.accessToken);
    setUser(data.user);
    return data;
  }, []);

  const loginVerifyMfa = useCallback(async (challengeToken, code) => {
    const { data } = await api.post('/auth/mfa/login-verify', { challengeToken, code });
    localStorage.setItem('tl-token', data.accessToken);
    setUser(data.user);
    return data;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    localStorage.setItem('tl-token', data.accessToken);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch {}
    localStorage.removeItem('tl-token');
    setUser(null);
  }, []);

  // Stage 1: Change password
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const { data } = await api.post('/auth/change-password', { currentPassword, newPassword });
    if (data.accessToken) {
      localStorage.setItem('tl-token', data.accessToken);
    }
    return data;
  }, []);

  // Stage 2: Deactivate account
  const deactivateAccount = useCallback(async (password, reason) => {
    const { data } = await api.post('/auth/deactivate-account', { password, reason });
    localStorage.removeItem('tl-token');
    setUser(null);
    return data;
  }, []);

  // Stage 2: Export user data
  const exportData = useCallback(async () => {
    const { data } = await api.post('/auth/export-data');
    return data;
  }, []);

  // Refresh user data
  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      return data.user;
    } catch {
      return null;
    }
  }, []);

  // OAuth callback: receive token from URL fragment, fetch user
  const loginWithToken = useCallback(async (token) => {
    localStorage.setItem('tl-token', token);
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      return data.user;
    } catch {
      localStorage.removeItem('tl-token');
      throw new Error('Failed to authenticate with OAuth token');
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, loading, login, loginVerifyMfa, register, logout,
      changePassword, deactivateAccount, exportData, refreshUser, loginWithToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
