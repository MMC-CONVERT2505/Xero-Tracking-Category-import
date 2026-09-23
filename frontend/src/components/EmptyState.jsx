import React from 'react';

/**
 * "An empty screen is an invitation to act" - always paired with the
 * primary action that resolves the emptiness, never a generic icon alone.
 */
export default function EmptyState({ title, description, action, icon }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white/60 px-6 py-14 text-center">
      {icon && <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">{icon}</div>}
      <p className="text-sm font-medium text-ink-900">{title}</p>
      {description && <p className="mt-1 text-sm text-ink-500 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
