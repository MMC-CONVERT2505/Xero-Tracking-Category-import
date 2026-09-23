import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as xeroApi from '../services/xeroApi.js';
import TrackingCategoryCard from '../components/TrackingCategoryCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { SkeletonStatGrid } from '../components/LoadingSkeleton.jsx';
import { IconTag } from '../components/icons.jsx';

export default function TrackingCategories() {
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    xeroApi.listTrackingCategories().then(setCategories).catch((e) => setError(e.response?.data?.error?.message || e.message));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Tracking Categories</h1>
          <p className="text-sm text-ink-500 mt-1">Live from your connected Xero organisation.</p>
        </div>
        <Link to="/tracking-categories/import" className="px-4 py-2.5 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800 transition-colors">
          Upload Tracking File
        </Link>
      </div>

      {error && <p className="mt-6 text-sm text-danger-700 bg-danger-50 rounded-lg px-4 py-2.5">{error}</p>}

      {!categories && !error && <div className="mt-6"><SkeletonStatGrid count={4} /></div>}

      {categories?.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<IconTag />}
            title="No tracking categories yet"
            description="Create a tracking category in Xero (Settings -> Tracking categories) and it will appear here."
          />
        </div>
      )}

      {categories?.length > 0 && (
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((c) => <TrackingCategoryCard key={c.TrackingCategoryID} category={c} />)}
        </div>
      )}
    </div>
  );
}
