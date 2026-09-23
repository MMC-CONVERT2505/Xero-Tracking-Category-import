import React from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge.jsx';

// No per-category "Import" action here anymore - the category is
// auto-detected from the uploaded file itself, so there's nothing
// meaningful to pre-select from a specific category's card. Use the
// single "Upload Tracking File" entry point (Dashboard / Tracking
// Categories page header) instead.
export default function TrackingCategoryCard({ category }) {
  const activeOptions = (category.Options || []).filter((o) => o.Status === 'ACTIVE').length;

  return (
    <div className="rounded-xl border border-line bg-white p-5 flex flex-col gap-4 hover:border-brand-300 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium text-ink-900">{category.Name}</h3>
        <StatusBadge status={category.Status} />
      </div>
      <p className="text-sm text-ink-500">{activeOptions} option{activeOptions === 1 ? '' : 's'}</p>
      <Link
        to={`/tracking-categories/${category.TrackingCategoryID}`}
        className="mt-auto pt-1 text-center px-3 py-2 rounded-lg border border-line text-sm font-medium text-ink-700 hover:bg-ink-900/5"
      >
        View Options
      </Link>
    </div>
  );
}
