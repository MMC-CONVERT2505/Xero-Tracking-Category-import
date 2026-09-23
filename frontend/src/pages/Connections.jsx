import React, { useEffect, useState } from 'react';
import * as xeroApi from '../services/xeroApi.js';
import * as authApi from '../services/authApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { IconBuilding } from '../components/icons.jsx';
import { SkeletonRows } from '../components/LoadingSkeleton.jsx';

export default function Connections() {
  const [connections, setConnections] = useState(null);
  const [switching, setSwitching] = useState(null);
  const { selectedTenantId, refresh } = useAuth();
  const toast = useToast();

  useEffect(() => { xeroApi.getConnections().then((d) => setConnections(d.connections)).catch(() => setConnections([])); }, []);

  async function handleSwitch(tenantId) {
    setSwitching(tenantId);
    try {
      await xeroApi.selectConnection(tenantId);
      await refresh();
      toast.success('Switched organisation.');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Could not switch organisation.');
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink-900">Connections</h1>
      <p className="text-sm text-ink-500 mt-1">Organisations available through your current Xero connection.</p>

      {connections === null && <div className="mt-6"><SkeletonRows rows={2} /></div>}

      {connections?.length > 0 && (
        <div className="mt-6 space-y-3">
          {connections.map((c) => {
            const active = c.tenantId === selectedTenantId;
            return (
              <div key={c.tenantId} className="flex items-center gap-4 rounded-xl border border-line bg-white px-5 py-4">
                <div className="h-10 w-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
                  <IconBuilding />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900 truncate">{c.tenantName}</p>
                  {active && <p className="text-xs text-success-700 mt-0.5">Currently selected</p>}
                </div>
                {!active && (
                  <button
                    disabled={switching !== null}
                    onClick={() => handleSwitch(c.tenantId)}
                    className="shrink-0 px-3 py-1.5 rounded-lg border border-line text-sm font-medium text-ink-700 hover:bg-ink-900/5 disabled:opacity-50"
                  >
                    {switching === c.tenantId ? 'Switching...' : 'Switch'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-line bg-white px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ink-900">Connect another Xero account</p>
          <p className="text-xs text-ink-500 mt-0.5">Re-runs the Xero login if you need access to a different account entirely.</p>
        </div>
        <button onClick={authApi.startXeroLogin} className="shrink-0 px-4 py-2 rounded-lg border border-line text-sm font-medium text-ink-700 hover:bg-ink-900/5">
          Reconnect
        </button>
      </div>
    </div>
  );
}
