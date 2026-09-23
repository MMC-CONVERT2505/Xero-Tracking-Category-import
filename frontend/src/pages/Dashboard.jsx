import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as xeroApi from '../services/xeroApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { SkeletonStatGrid, SkeletonRows } from '../components/LoadingSkeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { IconTag } from '../components/icons.jsx';

export default function Dashboard() {
  const { tenantName } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    xeroApi.getDashboard().then(setData).catch((e) => setError(e.response?.data?.error?.message || e.message));
  }, []);

  return (
    <div>
      <p className="text-sm text-ink-500">Welcome back</p>
      <h1 className="text-2xl font-semibold text-ink-900 mt-0.5">{tenantName || data?.tenantName || '\u00A0'}</h1>

      {error && <p className="mt-4 text-sm text-danger-700 bg-danger-50 rounded-lg px-4 py-2.5">{error}</p>}

      {!data && !error && <div className="mt-6"><SkeletonStatGrid count={3} /></div>}

      {data && (
        <>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <StatCard label="Tracking Categories" value={data.trackingCategoriesCount} hint={`${data.activeCategoriesCount} active`} />
            <StatCard label="Active Options" value={data.totalActiveOptions} />
            <StatCard label="Imports Run" value={data.totalImports} hint={data.lastImportStatus ? `Last: ${data.lastImportStatus}` : undefined} />
          </div>

          <div className="mt-6 rounded-xl border border-line bg-white p-6 flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="h-11 w-11 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
              <IconTag />
            </div>
            <div className="flex-1">
              <h2 className="font-medium text-ink-900">Tracking Categories</h2>
              <p className="text-sm text-ink-500 mt-0.5">Import and manage Tracking Categories and Tracking Options from your Excel files.</p>
            </div>
            <Link
              to="/tracking-categories/import"
              className="shrink-0 px-4 py-2.5 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800 transition-colors text-center"
            >
              Upload Tracking File
            </Link>
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium text-ink-900">Recent Imports</h2>
              <Link to="/imports" className="text-sm text-brand-700 hover:text-brand-800 font-medium">View all</Link>
            </div>
            {data.recentImports.length === 0 ? (
              <EmptyState
                title="No imports yet"
                description="Once you run an import, its progress and results will show up here."
                action={<Link to="/tracking-categories/import" className="text-sm font-medium text-brand-700 hover:text-brand-800">Upload Tracking File &rarr;</Link>}
              />
            ) : (
              <div className="rounded-xl border border-line bg-white divide-y divide-line">
                {data.recentImports.map((job) => (
                  <Link
                    key={job.importId}
                    to={`/imports/${job.importId}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-ink-900/[.02] transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink-900">{job.categoryName}</p>
                      <p className="text-xs text-ink-400 mt-0.5">{job.importId} &middot; {job.newOptions} options</p>
                    </div>
                    <StatusBadge status={job.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
