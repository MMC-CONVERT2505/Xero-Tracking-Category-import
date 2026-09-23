import React from 'react';

export default function ErrorReport({ importId, errors, onBack }) {
  function downloadCsv() {
    const header = 'OptionName,BatchNumber,HttpStatus,XeroError,Attempts,Permanent\n';
    const rows = errors.map((e) => [
      csvSafe(e.optionName), e.batchNumber, e.httpStatus ?? '', csvSafe(e.xeroError ?? ''), e.attempts, e.permanent,
    ].join(','));
    const blob = new Blob([header + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${importId}-errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-3xl mx-auto mt-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-slate-800">Error Report - {importId}</h2>
        <button className="px-3 py-1.5 text-sm rounded-md border border-slate-300 hover:bg-slate-50" onClick={downloadCsv}>
          Download CSV
        </button>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Option</th>
              <th className="text-left px-3 py-2">Batch</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Error</th>
              <th className="text-left px-3 py-2">Retries</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((e, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2">{e.optionName}</td>
                <td className="px-3 py-2">{e.batchNumber}</td>
                <td className="px-3 py-2">{e.httpStatus}</td>
                <td className="px-3 py-2 text-red-600">{e.xeroError}</td>
                <td className="px-3 py-2">{e.attempts}{e.permanent ? ' (permanent)' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="mt-6 px-4 py-2 rounded-md border border-slate-300 hover:bg-slate-50" onClick={onBack}>
        Back to progress
      </button>
    </div>
  );
}

function csvSafe(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
