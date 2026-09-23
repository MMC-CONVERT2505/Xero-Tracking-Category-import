import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as authApi from '../services/authApi.js';
import * as xeroApi from '../services/xeroApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    authenticated: false,
    selectedTenantId: null,
    tenantName: null,
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const session = await authApi.getSessionStatus();
      if (!session.authenticated) {
        setState({ loading: false, authenticated: false, selectedTenantId: null, tenantName: null });
        return;
      }
      let tenantName = null;
      if (session.selectedTenantId) {
        const current = await xeroApi.getCurrentConnection();
        tenantName = current?.tenantName || null;
      }
      setState({
        loading: false,
        authenticated: true,
        selectedTenantId: session.selectedTenantId,
        tenantName,
      });
    } catch {
      setState({ loading: false, authenticated: false, selectedTenantId: null, tenantName: null });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function logout() {
    await authApi.logout();
    setState({ loading: false, authenticated: false, selectedTenantId: null, tenantName: null });
  }

  return (
    <AuthContext.Provider value={{ ...state, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
