import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * `requireTenant`: most pages need a SELECTED organisation, not just a
 * login - those redirect to /select-organisation if none is chosen yet
 * (mirrors the backend's requireAuth vs requireTenant split).
 */
export default function ProtectedRoute({ children, requireTenant = true }) {
  const { loading, authenticated, selectedTenantId } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoading />;
  if (!authenticated) return <Navigate to="/" replace state={{ from: location }} />;
  if (requireTenant && !selectedTenantId) return <Navigate to="/select-organisation" replace />;

  return children;
}

function FullScreenLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas">
      <div className="h-8 w-8 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
    </div>
  );
}
