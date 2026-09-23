import React from 'react';

export default function ProgressBar({ percent, tone = 'brand' }) {
  const barColor = { brand: 'bg-brand-600', success: 'bg-success-600', danger: 'bg-danger-600' }[tone] || 'bg-brand-600';
  return (
    <div className="w-full h-2.5 rounded-full bg-ink-900/5 overflow-hidden">
      <div
        className={`h-full ${barColor} transition-[width] duration-500 ease-out rounded-full`}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}
