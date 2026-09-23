import React from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useNavigate } from 'react-router-dom';

export default function Settings() {
  const { tenantName, selectedTenantId, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    toast.info('Disconnected from Xero.');
    navigate('/');
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-ink-900">Settings</h1>

      <div className="mt-6 rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-medium text-ink-900">Xero Connection</h2>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-ink-500">Organisation</span>
          <span className="font-medium text-ink-900">{tenantName || selectedTenantId}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-ink-500">Status</span>
          <span className="inline-flex items-center gap-1.5 font-medium text-success-700">
            <span className="h-1.5 w-1.5 rounded-full bg-success-600" /> Connected
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-danger-600/15 bg-white p-5">
        <h2 className="text-sm font-medium text-ink-900">Disconnect</h2>
        <p className="text-sm text-ink-500 mt-1">
          Signs this browser out of Xero. Any import currently running keeps going in the background -
          reconnect any time to check on it.
        </p>
        <button onClick={handleLogout} className="mt-4 px-4 py-2 rounded-lg border border-danger-600/20 text-danger-700 text-sm font-medium hover:bg-danger-50">
          Disconnect Xero
        </button>
      </div>
    </div>
  );
}
