import React from 'react';

const STYLES = {
  ACTIVE: 'bg-success-50 text-success-700',
  ARCHIVED: 'bg-ink-900/5 text-ink-500',
  PENDING: 'bg-ink-900/5 text-ink-500',
  PROCESSING: 'bg-brand-50 text-brand-700',
  SUCCESS: 'bg-success-50 text-success-700',
  PARTIAL: 'bg-warning-50 text-warning-700',
  FAILED: 'bg-danger-50 text-danger-700',
  CANCELLED: 'bg-ink-900/5 text-ink-500',
  CONNECTED: 'bg-success-50 text-success-700',
  DISCONNECTED: 'bg-danger-50 text-danger-700',
};

export default function StatusBadge({ status, dot = false }) {
  const cls = STYLES[status] || 'bg-ink-900/5 text-ink-500';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {status}
    </span>
  );
}
