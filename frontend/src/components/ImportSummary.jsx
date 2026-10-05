import React, { useState } from 'react';
import { IconAlertTriangle, IconCheckCircle } from './icons.jsx';
import StatusBadge from './StatusBadge.jsx';
import Modal from './Modal.jsx';

/**
 * Shows every auto-detected category from the uploaded file. FOUND
 * categories are ready immediately. NOT_FOUND ones show a "Continue
 * Import" action that creates the category in Xero (see
 * onResolveCategory) before they can be included in the overall import.
 * POSSIBLE_MISMATCH ones (a likely typo against an existing category)
 * open a confirmation popup requiring an explicit choice - never silently
 * assumed either way. ARCHIVED categories are always blocked - never
 * created over, never offered an override.
 */
export default function ImportSummary({ preflight, categories, onResolveCategory, onCancel, onStart, starting }) {
  const importable = categories.filter((c) => c.status === 'FOUND');
  const totalNew = importable.reduce((sum, c) => sum + (c.newOptionsCount ?? 0), 0);
  const pendingCount = categories.filter((c) => c.status === 'NOT_FOUND' || c.status === 'POSSIBLE_MISMATCH').length;

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink-900">Import Summary</h2>
      <p className="text-sm text-ink-500 mt-1">{preflight.fileName} &middot; {preflight.sheetsCount} sheet{preflight.sheetsCount === 1 ? '' : 's'}</p>

      {preflight.rowErrors?.length > 0 && (
        <Notice tone="warning" title={`${preflight.rowErrors.length} sheet row issue(s)`}>
          <ul className="list-disc list-inside space-y-0.5 max-h-28 overflow-y-auto">
            {preflight.rowErrors.slice(0, 15).map((e, i) => (
              <li key={i}>Sheet "{e.sheet}", row {e.row}: {e.error}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="mt-5 space-y-3">
        {categories.map((c) => (
          <CategoryCard key={c.key} category={c} onResolveCategory={onResolveCategory} />
        ))}
      </div>

      <div className="flex items-center justify-between mt-6">
        <p className="text-sm text-ink-500">
          {importable.length} categor{importable.length === 1 ? 'y' : 'ies'} ready &middot; <span className="font-medium text-ink-900 tabular-nums">{totalNew}</span> new option{totalNew === 1 ? '' : 's'} total
          {pendingCount > 0 && <span className="text-warning-700"> &middot; {pendingCount} still need{pendingCount === 1 ? 's' : ''} your confirmation</span>}
        </p>
      </div>

      <div className="flex gap-3 mt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink-700 hover:bg-ink-900/5"
        >
          Cancel
        </button>
        <button
          onClick={onStart}
          disabled={starting || importable.length === 0}
          className="px-4 py-2.5 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800 disabled:opacity-50 transition-colors"
        >
          {starting ? 'Starting import...' : importable.length === 0 ? 'Nothing ready yet' : `Start Import (${totalNew})`}
        </button>
      </div>
    </div>
  );
}

function CategoryCard({ category: c, onResolveCategory }) {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function handleDecision(decision) {
    setResolving(true);
    setError(null);
    try {
      await onResolveCategory(c.key, decision);
      setModalOpen(false);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Could not resolve this Tracking Category.');
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink-900">{c.categoryNameInFile}</p>
          <p className="text-xs text-ink-400 mt-0.5">
            {c.sheetsInvolved.length} sheet{c.sheetsInvolved.length === 1 ? '' : 's'} &middot; {c.excelOptionsTotal} row{c.excelOptionsTotal === 1 ? '' : 's'}
          </p>
        </div>
        <StatusPill status={c.status} wasCreated={c.wasCreated} />
      </div>

      {c.status === 'FOUND' && (
        <dl className="mt-4 grid grid-cols-4 gap-3 text-center">
          <Stat label="Unique" value={c.uniqueOptionsCount} />
          <Stat label="Existing" value={c.existingOptionsCount} />
          <Stat label="New" value={c.newOptionsCount} highlight />
          <Stat label="Dupes" value={c.duplicateRows} />
        </dl>
      )}

      {c.status === 'FOUND' && c.softLimitWarning && (
        <Notice tone="warning" title="Large tracking category">
          Xero recommends keeping tracking category options manageable, since a large number can affect
          reporting usability. This import can still continue.
        </Notice>
      )}

      {c.status === 'FOUND' && c.archivedConflicts?.length > 0 && (
        <Notice tone="danger" title={`${c.archivedConflicts.length} option(s) already exist but are archived`}>
          These will be skipped: {c.archivedConflicts.slice(0, 8).join(', ')}{c.archivedConflicts.length > 8 ? '...' : ''}
        </Notice>
      )}

      {c.status === 'ARCHIVED' && (
        <Notice tone="danger" title="Category is archived">
          {c.error}
        </Notice>
      )}

      {c.status === 'NOT_FOUND' && (
        <div className="mt-3">
          {c.categoryLimitReached ? (
            <Notice tone="danger" title="Xero Tracking Category limit reached">
              This organisation already has {c.activeCategoryCount} active Tracking Categories, and Xero
              allows a maximum of 2. "{c.categoryNameInFile}" cannot be created and will be skipped.
            </Notice>
          ) : (
            <>
              <Notice tone="warning" title="Tracking Category not found in Xero">
                The application will create this Tracking Category automatically before importing the options.
              </Notice>
              {error && <p className="mt-2 text-sm text-danger-700">{error}</p>}
              <button
                onClick={() => handleDecision(undefined)}
                disabled={resolving}
                className="mt-3 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800 disabled:opacity-50"
              >
                {resolving ? 'Creating category...' : 'Continue Import'}
              </button>
            </>
          )}
        </div>
      )}

      {c.status === 'POSSIBLE_MISMATCH' && (
        <div className="mt-3">
          <Notice tone="warning" title="Possible category name mismatch">
            "{c.categoryNameInFile}" doesn't exactly match any Tracking Category in Xero, but "{c.suggestion.name}" is very
            close - this is often a typo. Please choose how to proceed.
          </Notice>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-3 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800"
          >
            Resolve mismatch
          </button>

          <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Possible Tracking Category Mismatch">
            <p className="text-sm text-ink-700">Your uploaded file contains:</p>
            <p className="mt-1 font-medium text-ink-900">&ldquo;{c.categoryNameInFile}&rdquo;</p>
            <p className="mt-3 text-sm text-ink-700">But Xero already has:</p>
            <p className="mt-1 font-medium text-ink-900">&ldquo;{c.suggestion.name}&rdquo;</p>

            {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}

            <div className="mt-5 space-y-3">
              <button
                onClick={() => handleDecision('use_existing')}
                disabled={resolving}
                className="w-full text-left px-4 py-3 rounded-lg border border-line hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 transition-colors"
              >
                <p className="font-medium text-ink-900">Use existing &ldquo;{c.suggestion.name}&rdquo;</p>
                <p className="text-xs text-ink-500 mt-0.5">Import all options from this file into the existing &ldquo;{c.suggestion.name}&rdquo; Tracking Category.</p>
              </button>

              {c.categoryLimitReached ? (
                <div className="w-full px-4 py-3 rounded-lg border border-line bg-ink-900/[.02]">
                  <p className="font-medium text-ink-400">Create new &ldquo;{c.categoryNameInFile}&rdquo;</p>
                  <p className="text-xs text-ink-400 mt-0.5">
                    Not available - this organisation already has {c.activeCategoryCount} active Tracking Categories,
                    and Xero allows a maximum of 2.
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => handleDecision('create_new')}
                  disabled={resolving}
                  className="w-full text-left px-4 py-3 rounded-lg border border-line hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 transition-colors"
                >
                  <p className="font-medium text-ink-900">Create new &ldquo;{c.categoryNameInFile}&rdquo;</p>
                  <p className="text-xs text-ink-500 mt-0.5">Create a new Tracking Category named &ldquo;{c.categoryNameInFile}&rdquo;.</p>
                </button>
              )}
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status, wasCreated }) {
  if (status === 'FOUND' && wasCreated) return <span className="inline-flex items-center gap-1.5 text-success-700 text-sm font-medium"><IconCheckCircle /> Category created</span>;
  if (status === 'FOUND') return <span className="inline-flex items-center gap-1.5 text-success-700 text-sm font-medium"><IconCheckCircle /> Found in Xero</span>;
  if (status === 'ARCHIVED') return <StatusBadge status="ARCHIVED" />;
  if (status === 'POSSIBLE_MISMATCH') return <span className="inline-flex items-center gap-1.5 text-warning-700 text-sm font-medium"><IconAlertTriangle /> Possible Mismatch</span>;
  return <span className="inline-flex items-center gap-1.5 text-warning-700 text-sm font-medium"><IconAlertTriangle /> Not Found</span>;
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`rounded-md p-2.5 ${highlight ? 'bg-brand-50' : 'bg-ink-900/[.03]'}`}>
      <p className={`text-base font-semibold tabular-nums ${highlight ? 'text-brand-700' : 'text-ink-900'}`}>{value}</p>
      <p className="text-[0.7rem] text-ink-500 mt-0.5">{label}</p>
    </div>
  );
}

function Notice({ tone, title, children }) {
  const cls = tone === 'danger' ? 'bg-danger-50 text-danger-700 border-danger-600/10' : 'bg-warning-50 text-warning-700 border-warning-600/10';
  return (
    <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <div className="flex items-start gap-2">
        <IconAlertTriangle className="shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">{title}</p>
          <div className="mt-0.5 opacity-90">{children}</div>
        </div>
      </div>
    </div>
  );
}
