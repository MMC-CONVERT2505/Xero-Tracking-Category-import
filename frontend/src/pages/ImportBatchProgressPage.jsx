import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as importApi from '../services/importApi.js';
import ProgressBar from '../components/ProgressBar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { IconCheckCircle } from '../components/icons.jsx';

const TERMINAL = ['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'];

/**
 * Aggregate progress across every Tracking Category detected in one
 * multi-category upload - "3 categories, 1,250 total options..." plus a
 * per-category breakdown. Each category card links through to its own
 * existing single-job progress page (ImportProgressPage) for full detail
 * (error report, retry-failed, cancel) - this page is purely a rollup.
 */
export default function ImportBatchProgressPage() {
  const { batchId } = useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const status = await importApi.getBatchStatus(batchId);
        if (cancelled) return;
        setBatch(status);
        if (TERMINAL.includes(status.status)) clearInterval(pollRef.current);
      } catch {
        clearInterval(pollRef.current);
      }
    }
    poll();
    pollRef.current = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [batchId]);

  if (!batch) return <BatchSkeleton />;

  const done = batch.successfulTotal + batch.failedTotal + batch.skippedTotal;
  const percent = batch.totalOptions === 0 ? 100 : Math.round((done / batch.totalOptions) * 100);
  const isTerminal = TERMINAL.includes(batch.status);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-500">{isTerminal ? 'Import Completed' : 'Importing Tracking Options'}</p>
          <h1 className="text-xl font-semibold text-ink-900 mt-0.5">{batch.categoriesCount} categories</h1>
        </div>
        <StatusBadge status={batch.status} dot />
      </div>

      <div className="mt-6">
        <ProgressBar percent={percent} />
        <p className="text-sm text-ink-500 mt-2 tabular-nums">{done.toLocaleString()} / {batch.totalOptions.toLocaleString()} ({percent}%)</p>
      </div>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3">
        <MiniStat label="Categories" value={batch.categoriesCount} />
        <MiniStat label="Total Options" value={batch.totalOptions} />
        <MiniStat label="Successful" value={batch.successfulTotal} tone="success" />
        <MiniStat label="Skipped" value={batch.skippedTotal} />
        <MiniStat label="Failed" value={batch.failedTotal} tone="danger" />
      </div>

      <h2 className="text-sm font-medium text-ink-700 mt-8 mb-3">Categories</h2>
      <div className="space-y-3">
        {batch.categories.map((c) => <CategoryProgressCard key={c.importId} category={c} />)}
      </div>

      {isTerminal && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {batch.status === 'SUCCESS' && (
            <p className="inline-flex items-center gap-2 text-sm text-success-700">
              <IconCheckCircle /> All categories imported successfully
            </p>
          )}
          <button onClick={() => navigate('/tracking-categories/import')} className="px-4 py-2.5 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800">
            Import More
          </button>
          <Link to="/dashboard" className="px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink-700 hover:bg-ink-900/5">
            Back to Dashboard
          </Link>
        </div>
      )}

      <p className="text-xs text-ink-400 mt-6">
        You can safely close this tab - every category continues importing in the background
        independently and resumes automatically if the server restarts.
      </p>
    </div>
  );
}

function CategoryProgressCard({ category: c }) {
  const done = c.successfulOptions + c.failedOptions;
  const percent = c.newOptions === 0 ? 100 : Math.round((done / c.newOptions) * 100);
  return (
    <Link
      to={`/imports/${c.importId}`}
      className="block rounded-xl border border-line bg-white p-5 hover:border-brand-300 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink-900">{c.categoryName}</p>
          <p className="text-xs text-ink-400 mt-0.5 font-mono">{c.trackingCategoryId}</p>
        </div>
        <StatusBadge status={c.status} />
      </div>
      <div className="mt-3"><ProgressBar percent={percent} /></div>
      <div className="mt-3 grid grid-cols-4 gap-3 text-center">
        <MiniStat label="Options" value={c.newOptions} small />
        <MiniStat label="Successful" value={c.successfulOptions} tone="success" small />
        <MiniStat label="Skipped" value={c.existingOptions} small />
        <MiniStat label="Failed" value={c.failedOptions} tone="danger" small />
      </div>
    </Link>
  );
}

function MiniStat({ label, value, tone, small }) {
  const color = { success: 'text-success-700', danger: 'text-danger-700' }[tone] || 'text-ink-900';
  return (
    <div className={`rounded-lg bg-ink-900/[.03] ${small ? 'p-2' : 'border border-line bg-white p-3'} text-center`}>
      <p className={`${small ? 'text-sm' : 'text-lg'} font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-ink-500 mt-0.5">{label}</p>
    </div>
  );
}

function BatchSkeleton() {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="skeleton h-6 w-48" />
      <div className="skeleton h-2.5 w-full rounded-full" />
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-16" />)}
      </div>
    </div>
  );
}
