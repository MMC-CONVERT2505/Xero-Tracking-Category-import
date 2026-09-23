import React from 'react';

const STATUS_STYLES = {
  PENDING: 'bg-slate-100 text-slate-600',
  PROCESSING: 'bg-sky-100 text-sky-700',
  SUCCESS: 'bg-green-100 text-green-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-200 text-slate-500',
};

export default function ImportProgress({ job, onCancel, onViewErrors, onRetryFailed, onDone }) {
  const total = job.newOptions || 0;
  const done = job.successfulOptions + job.failedOptions;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const isTerminal = ['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(job.status);

  return (
    <div className="max-w-2xl mx-auto mt-10">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold text-slate-800">{job.categoryName}</h2>
        <span className={`text-xs font-medium rounded px-2 py-1 ${STATUS_STYLES[job.status] || ''}`}>
          {job.status}
        </span>
      </div>
      <p className="text-slate-400 text-xs mb-6">
        Import ID: {job.importId} &middot; TrackingCategoryID: {job.trackingCategoryId}
      </p>

      <div className="w-full bg-slate-100 rounded-full h-3 mb-2 overflow-hidden">
        <div
          className="h-3 bg-xero-blue transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-sm text-slate-500 mb-6">{done} / {total} processed ({pct}%)</p>

      <div className="grid grid-cols-4 gap-3 text-sm mb-6">
        <Stat label="Success" value={job.successfulOptions} color="text-green-600" />
        <Stat label="Failed" value={job.failedOptions} color="text-red-600" />
        <Stat label="Pending" value={job.pendingOptions} color="text-slate-600" />
        <Stat label="Batches" value={`${job.completedBatches}/${job.totalBatches}`} color="text-slate-600" />
      </div>

      <div className="flex gap-3">
        {!isTerminal && (
          <button className="px-4 py-2 rounded-md border border-red-300 text-red-600 hover:bg-red-50" onClick={onCancel}>
            Cancel Import
          </button>
        )}
        {job.failedOptions > 0 && (
          <>
            <button className="px-4 py-2 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50" onClick={onViewErrors}>
              Download / View Error Report
            </button>
            <button className="px-4 py-2 rounded-md bg-xero-blue text-white font-medium hover:brightness-95" onClick={onRetryFailed}>
              Retry Failed
            </button>
          </>
        )}
        {isTerminal && job.failedOptions === 0 && (
          <button className="px-4 py-2 rounded-md bg-xero-blue text-white font-medium hover:brightness-95" onClick={onDone}>
            Done
          </button>
        )}
      </div>

      <p className="text-xs text-slate-400 mt-6">
        You can safely close this tab - the import continues in the background and will resume
        automatically if the server restarts. Reopen with this Import ID to check progress anytime.
      </p>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="rounded-md bg-slate-50 p-3 text-center">
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
