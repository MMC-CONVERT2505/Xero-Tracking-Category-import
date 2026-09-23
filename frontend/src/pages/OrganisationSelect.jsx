import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as xeroApi from '../services/xeroApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Brand } from '../components/Sidebar.jsx';
import { IconBuilding } from '../components/icons.jsx';
import { SkeletonRows } from '../components/LoadingSkeleton.jsx';

export default function OrganisationSelect() {
  const [connections, setConnections] = useState(null);
  const [selecting, setSelecting] = useState(null);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const toast = useToast();

  useEffect(() => {
    xeroApi.getConnections().then((d) => setConnections(d.connections)).catch(() => setConnections([]));
  }, []);

  async function handleSelect(tenantId) {
    setSelecting(tenantId);
    try {
      await xeroApi.selectConnection(tenantId);
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Could not select that organisation.');
      setSelecting(null);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md animate-fade-rise">
        <div className="flex justify-center mb-8"><Brand /></div>
        <h1 className="text-xl font-semibold text-ink-900 text-center">Select your Xero organisation</h1>
        <p className="text-sm text-ink-500 text-center mt-1.5">Choose the company you want to work with</p>

        <div className="mt-8 space-y-3">
          {connections === null && <SkeletonRows rows={2} />}
          {connections?.map((c) => (
            <button
              key={c.tenantId}
              disabled={selecting !== null}
              onClick={() => handleSelect(c.tenantId)}
              className="w-full flex items-center gap-4 rounded-xl border border-line bg-white px-5 py-4 text-left hover:border-brand-300 hover:shadow-sm transition-all disabled:opacity-60"
            >
              <div className="h-10 w-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
                <IconBuilding />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900 truncate">{c.tenantName}</p>
                <p className="text-xs text-ink-500">Connected Xero Organisation</p>
              </div>
              <span className="text-sm font-medium text-brand-700 shrink-0">
                {selecting === c.tenantId ? 'Selecting...' : 'Select'}
              </span>
            </button>
          ))}
          {connections?.length === 0 && (
            <p className="text-center text-sm text-ink-500">No organisations were returned by Xero for this connection.</p>
          )}
        </div>
      </div>
    </div>
  );
}
