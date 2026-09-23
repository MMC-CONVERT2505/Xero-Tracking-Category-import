import React from 'react';

export default function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <p className="text-sm text-ink-500">{label}</p>
      <p className="mt-1.5 text-[1.75rem] leading-none font-semibold text-ink-900">{value}</p>
      {hint && <p className="mt-1.5 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
