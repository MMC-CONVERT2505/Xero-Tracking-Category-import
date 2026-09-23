import React from 'react';

export function SkeletonLine({ width = '100%', height = '0.875rem' }) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-line bg-white p-5 space-y-3">
      <SkeletonLine width="40%" height="0.75rem" />
      <SkeletonLine width="60%" height="1.75rem" />
    </div>
  );
}

export function SkeletonStatGrid({ count = 3 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }) {
  return (
    <div className="rounded-xl border border-line bg-white divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-4 flex items-center gap-4">
          <SkeletonLine width="30%" />
          <SkeletonLine width="15%" />
          <SkeletonLine width="20%" />
        </div>
      ))}
    </div>
  );
}
