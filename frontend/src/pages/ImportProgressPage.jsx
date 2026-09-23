import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as importApi from '../services/importApi.js';
import { useToast } from '../context/ToastContext.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { IconCheckCircle } from '../components/icons.jsx';

const TERMINAL = ['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'];
// If the currently-processing batch hasn't moved on within this long, it's
// almost certainly sitting in the retry/backoff path (429s are the common
// cause) - purely a frontend heuristic over already-persisted batch status,
// no backend event log needed for this.
const SLOW_BATCH_HINT_MS = 6000;

function csvSafe(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ImportProgressPage() {
  const { importId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [errors, setErrors] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const [rateLimitHint, setRateLimitHint] = useState(false);
  const pollRef = useRef(null);
  const slowBatchTracker = useRef({ batchNumber: null, sinceMs: null });

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const status = await importApi.getStatus(importId);
        if (cancelled) return;
        setJob(status);
        checkSlowBatch(status);
        if (TERMINAL.includes(status.status)) clearInterval(pollRef.current);
      } catch {
        clearInterval(pollRef.current);
      }
    }
    poll();
    pollRef.current = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [importId]);

  function checkSlowBatch(status) {
    const current = (status.batches || []).find((b) => b.status === 'PROCESSING');
    if (!current) {
      slowBatchTracker.current = { batchNumber: null, sinceMs: null };
      setRateLimitHint(false);
      return;
    }
    const tracker = slowBatchTracker.current;
    if (tracker.batchNumber !== current.batchNumber) {
      slowBatchTracker.current = { batchNumber: current.batchNumber, sinceMs: Date.now() };
      setRateLimitHint(false);
      return;
    }
    setRateLimitHint(Date.now() - tracker.sinceMs > SLOW_BATCH_HINT_MS);
  }

  async function handleCancel() {
    await importApi.cancelImport(importId);
    toast.info('Cancelling - already-queued requests will finish, nothing new will start.');
  }

  async function handleRetryFailed() {
    setJob((j) => ({ ...j, status: 'PROCESSING' }));
    pollRef.current = setInterval(async () => {
      const status = await importApi.getStatus(importId);
      setJob(status);
      if (TERMINAL.includes(status.status)) clearInterval(pollRef.current);
    }, 1500);
    await importApi.retryFailed(importId);
  }

  async function handleViewErrors() {
    const report = await importApi.getErrorReport(importId);
    setErrors(report);
    setShowErrors(true);
  }

  function downloadErrors(report) {
    const header = 'Tracking Category,Tracking Option,Batch,Status,Error,Retryable,Attempts\n';
    const rows = report.map((e) => [
      csvSafe(job.categoryName), csvSafe(e.optionName), e.batchNumber, 'FAILED',
      csvSafe(e.xeroError ?? ''), e.permanent ? 'No' : 'Yes', e.attempts,
    ].join(','));
    const blob = new Blob([header + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${importId}-errors.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (!job) return <ProgressSkeleton />;

  const isTerminal = TERMINAL.includes(job.status);
  const isSuccessClean = isTerminal && job.status === 'SUCCESS';
  const total = job.newOptions || 0;
  const done = job.successfulOptions + job.failedOptions;
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);

  if (isTerminal) return (
    <CompletionScreen
      job={job}
      onViewDetails={() => {}}
      onDownloadErrors={() => importApi.getErrorReport(importId).then(downloadErrors)}
      onImportMore={() => navigate('/tracking-categories/import')}
    />
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-500">Importing Tracking Options</p>
          <h1 className="text-xl font-semibold text-ink-900 mt-0.5">{job.categoryName}</h1>
        </div>
        <StatusBadge status={job.status} dot />
      </div>

      <div className="mt-6">
        <ProgressBar percent={percent} />
        <p className="text-sm text-ink-500 mt-2 tabular-nums">{done.toLocaleString()} / {total.toLocaleString()} ({percent}%)</p>
      </div>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Successful" value={job.successfulOptions} tone="success" />
        <MiniStat label="Failed" value={job.failedOptions} tone="danger" />
        <MiniStat label="Pending" value={job.pendingOptions} />
        <MiniStat label="Batch" value={`${job.completedBatches}/${job.totalBatches}`} />
      </div>

      {rateLimitHint && (
        <div className="mt-4 rounded-lg border border-warning-600/10 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Xero rate limit reached. Requests are being retried automatically - this can take a little
          longer, no action needed.
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <button onClick={handleCancel} className="px-4 py-2.5 rounded-lg border border-danger-600/20 text-danger-700 text-sm font-medium hover:bg-danger-50">
          Cancel Import
        </button>
        {job.failedOptions > 0 && (
          <button onClick={handleViewErrors} className="px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink-700 hover:bg-ink-900/5">
            View Errors
          </button>
        )}
      </div>

      <BatchActivity batches={job.batches} />

      <p className="text-xs text-ink-400 mt-6">
        You can safely close this tab - the import continues in the background and resumes automatically
        if the server restarts. Come back to this page anytime with the same link.
      </p>

      {showErrors && errors && <ErrorTable errors={errors} onClose={() => setShowErrors(false)} />}
    </div>
  );
}

function BatchActivity({ batches }) {
  if (!batches || batches.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-ink-700 mb-2">Import Activity</h2>
      <div className="rounded-xl border border-line bg-white divide-y divide-line max-h-64 overflow-y-auto">
        {batches.map((b) => <BatchActivityRow key={b.batchNumber} batch={b} />)}
      </div>
    </div>
  );
}

function BatchActivityRow({ batch }) {
  const total = (batch.successCount || 0) + (batch.failedCount || 0);
  let icon = <span className="text-ink-300">&#9679;</span>;
  let text = `Batch ${batch.batchNumber} pending`;
  let tone = 'text-ink-400';

  if (batch.status === 'PROCESSING') {
    icon = <span className="inline-block h-3 w-3 rounded-full border-2 border-brand-300 border-t-brand-600 animate-spin" />;
    text = `Batch ${batch.batchNumber} processing...`;
    tone = 'text-brand-700';
  } else if (batch.status === 'SUCCESS') {
    icon = <IconCheckCircle className="text-success-600" />;
    text = `Batch ${batch.batchNumber} completed - ${batch.successCount} option${batch.successCount === 1 ? '' : 's'}`;
    tone = 'text-ink-900';
  } else if (batch.status === 'PARTIAL') {
    icon = <span className="text-warning-600">&#9888;</span>;
    text = `Batch ${batch.batchNumber} completed - ${batch.successCount} ok, ${batch.failedCount} failed`;
    tone = 'text-ink-900';
  } else if (batch.status === 'FAILED') {
    icon = <span className="text-danger-600">&#9888;</span>;
    text = `Batch ${batch.batchNumber} failed - ${batch.failedCount} option${batch.failedCount === 1 ? '' : 's'}`;
    tone = 'text-danger-700';
  } else if (batch.status === 'CANCELLED') {
    text = `Batch ${batch.batchNumber} cancelled`;
    tone = 'text-ink-400';
  }

  return (
    <div className={`flex items-center gap-2.5 px-4 py-2.5 text-sm ${tone}`}>
      <span className="shrink-0 flex items-center justify-center w-4">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  const color = { success: 'text-success-700', danger: 'text-danger-700' }[tone] || 'text-ink-900';
  return (
    <div className="rounded-lg bg-white border border-line p-3 text-center">
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-ink-500 mt-0.5">{label}</p>
    </div>
  );
}

function CompletionScreen({ job, onDownloadErrors, onImportMore }) {
  const clean = job.status === 'SUCCESS';
  return (
    <div className="max-w-xl">
      <div className="text-center">
        <div className={`mx-auto h-12 w-12 rounded-full flex items-center justify-center ${clean ? 'bg-success-50 text-success-600' : 'bg-warning-50 text-warning-600'}`}>
          <IconCheckCircle />
        </div>
        <h1 className="text-xl font-semibold text-ink-900 mt-4">
          {clean ? 'Import Completed' : job.status === 'CANCELLED' ? 'Import Cancelled' : 'Import Finished With Errors'}
        </h1>
        <p className="text-sm text-ink-500 mt-1">{job.categoryName}</p>
      </div>

      <dl className="mt-6 rounded-xl border border-line bg-white divide-y divide-line">
        {[
          ['Total', job.newOptions],
          ['Successfully Created', job.successfulOptions],
          ['Already Existing', job.existingOptions],
          ['Failed', job.failedOptions],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-5 py-3 text-sm">
            <dt className="text-ink-500">{label}</dt>
            <dd className="font-medium text-ink-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-wrap gap-3">
        {job.failedOptions > 0 && (
          <>
            <RetryFailedButton importId={job.importId} />
            <button onClick={onDownloadErrors} className="px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink-700 hover:bg-ink-900/5">
              Download Error Report
            </button>
          </>
        )}
        <button onClick={onImportMore} className="px-4 py-2.5 rounded-lg bg-brand-700 text-white text-sm font-medium hover:bg-brand-800">
          Import More
        </button>
        <Link to="/dashboard" className="px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink-700 hover:bg-ink-900/5">
          Back to Dashboard
        </Link>
      </div>

      <BatchActivity batches={job.batches} />
      {clean && (
        <div className="mt-4 flex items-center gap-2.5 text-sm text-success-700">
          <IconCheckCircle /> Import completed successfully
        </div>
      )}
    </div>
  );
}

function RetryFailedButton({ importId }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await importApi.retryFailed(importId);
          toast.info('Retrying failed options...');
          navigate(0); // re-mount this page to resume polling
        } catch {
          toast.error('Could not retry failed options.');
          setBusy(false);
        }
      }}
      className="px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink-700 hover:bg-ink-900/5 disabled:opacity-50"
    >
      {busy ? 'Retrying...' : 'Retry Failed'}
    </button>
  );
}

function ErrorTable({ errors, onClose }) {
  return (
    <div className="mt-6 rounded-xl border border-line bg-white overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-5 py-3 border-b border-line">
        <p className="text-sm font-medium text-ink-900">{errors.length} failed option(s)</p>
        <button onClick={onClose} className="text-sm text-ink-500 hover:text-ink-900">Close</button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/[.02] text-ink-500 sticky top-0">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Option</th>
              <th className="text-left px-4 py-2 font-medium">Batch</th>
              <th className="text-left px-4 py-2 font-medium">Error</th>
              <th className="text-left px-4 py-2 font-medium">Retryable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {errors.map((e, i) => (
              <tr key={i}>
                <td className="px-4 py-2 text-ink-900">{e.optionName}</td>
                <td className="px-4 py-2 text-ink-500">{e.batchNumber}</td>
                <td className="px-4 py-2 text-danger-700">{e.xeroError}</td>
                <td className="px-4 py-2 text-ink-500">{e.permanent ? 'No' : 'Yes'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProgressSkeleton() {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="skeleton h-6 w-48" />
      <div className="skeleton h-2.5 w-full rounded-full" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16" />)}
      </div>
    </div>
  );
}
