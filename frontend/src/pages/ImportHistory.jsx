import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as importApi from '../services/importApi.js';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { SkeletonRows } from '../components/LoadingSkeleton.jsx';
import { IconHistory } from '../components/icons.jsx';

export default function ImportHistory() {
  const [jobs, setJobs] = useState(null);

  useEffect(() => { importApi.listImports().then(setJobs).catch(() => setJobs([])); }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink-900">Import History</h1>
      <p className="text-sm text-ink-500 mt-1">Every import run for this organisation, most recent first.</p>

      {jobs === null && <div className="mt-6"><SkeletonRows rows={5} /></div>}

      {jobs?.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<IconHistory />}
            title="No imports yet"
            description="Runs will appear here once you start your first import."
            action={<Link to="/tracking-categories/import" className="text-sm font-medium text-brand-700 hover:text-brand-800">Upload Tracking File &rarr;</Link>}
          />
        </div>
      )}

      {jobs?.length > 0 && (
        <div className="mt-6 rounded-xl border border-line bg-white divide-y divide-line">
          {jobs.map((job) => (
            <Link key={job.importId} to={`/imports/${job.importId}`} className="flex items-center justify-between px-5 py-4 hover:bg-ink-900/[.02] transition-colors">
              <div>
                <p className="text-sm font-medium text-ink-900">{job.categoryName}</p>
                <p className="text-xs text-ink-400 mt-0.5 font-mono">{job.importId}</p>
                <p className="text-xs text-ink-500 mt-1">
                  {job.successfulOptions} created &middot; {job.existingOptions} existing &middot; {job.failedOptions} failed
                </p>
              </div>
              <StatusBadge status={job.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
