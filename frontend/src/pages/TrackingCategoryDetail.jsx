import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as xeroApi from '../services/xeroApi.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { SkeletonRows } from '../components/LoadingSkeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function TrackingCategoryDetail() {
  const { trackingCategoryId } = useParams();
  const [options, setOptions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    xeroApi.getTrackingCategoryOptions(trackingCategoryId)
      .then(setOptions)
      .catch((e) => setError(e.response?.data?.error?.message || e.message));
  }, [trackingCategoryId]);

  return (
    <div>
      <Link to="/tracking-categories" className="text-sm text-ink-500 hover:text-ink-900">&larr; Tracking Categories</Link>
      <div className="flex items-center justify-between mt-3">
        <h1 className="text-xl font-semibold text-ink-900">Options</h1>
        <Link
          to="/tracking-categories/import"
          className="px-4 py-2.5 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800 transition-colors"
        >
          Upload Tracking File
        </Link>
      </div>

      {error && <p className="mt-6 text-sm text-danger-700 bg-danger-50 rounded-lg px-4 py-2.5">{error}</p>}
      {!options && !error && <div className="mt-6"><SkeletonRows rows={6} /></div>}

      {options?.length === 0 && (
        <div className="mt-6">
          <EmptyState title="No options yet" description="Upload a tracking file to populate this category." />
        </div>
      )}

      {options?.length > 0 && (
        <div className="mt-6 rounded-xl border border-line bg-white divide-y divide-line">
          {options.map((o) => (
            <div key={o.TrackingOptionID} className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="text-ink-900">{o.Name}</span>
              <StatusBadge status={o.Status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
