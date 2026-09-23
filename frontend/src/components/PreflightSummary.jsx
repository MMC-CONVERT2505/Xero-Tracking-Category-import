import React, { useState } from 'react';

export default function PreflightSummary({ preflight, onCancel, onConfirm, submitting }) {
  const validGroups = preflight.groups.filter((g) => !g.error);
  const invalidGroups = preflight.groups.filter((g) => g.error);
  const [selected, setSelected] = useState(new Set(validGroups.map((g) => g.key)));

  function toggle(key) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
  }

  return (
    <div className="max-w-3xl mx-auto mt-10">
      <h2 className="text-xl font-semibold text-slate-800 mb-1">Pre-flight Summary</h2>
      <p className="text-slate-500 mb-6">{preflight.fileName} - review before importing.</p>

      {preflight.rowErrors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-4 text-sm text-amber-800">
          <p className="font-medium mb-1">{preflight.rowErrors.length} row(s) skipped due to validation issues:</p>
          <ul className="list-disc list-inside max-h-32 overflow-y-auto">
            {preflight.rowErrors.slice(0, 20).map((e, i) => (
              <li key={i}>Sheet "{e.sheet}", row {e.row}: {e.error}</li>
            ))}
          </ul>
        </div>
      )}

      {preflight.duplicatesInFile > 0 && (
        <div className="bg-slate-100 rounded-md p-3 mb-4 text-sm text-slate-600">
          {preflight.duplicatesInFile} duplicate option(s) within the file were automatically collapsed.
        </div>
      )}

      {invalidGroups.map((g) => (
        <div key={g.key} className="bg-red-50 border border-red-200 rounded-md p-4 mb-4 text-sm text-red-700">
          <p className="font-medium">Category "{g.categoryName}" cannot be imported</p>
          <p>{g.error}</p>
        </div>
      ))}

      {validGroups.map((g) => (
        <div key={g.key} className="border border-slate-200 rounded-lg p-5 mb-4 bg-white">
          <div className="flex items-start justify-between">
            <div>
              <label className="flex items-center gap-2 font-medium text-slate-800">
                <input type="checkbox" checked={selected.has(g.key)} onChange={() => toggle(g.key)} />
                {g.categoryName}
                <span className="text-xs font-normal text-green-700 bg-green-100 rounded px-2 py-0.5">ACTIVE</span>
                {g.categoryCreatedByThisRequest && (
                  <span className="text-xs font-normal text-blue-700 bg-blue-100 rounded px-2 py-0.5">will be created</span>
                )}
              </label>
              <p className="text-xs text-slate-400 mt-1">TrackingCategoryID: {g.trackingCategoryId}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
            <Stat label="Source options" value={g.sourceOptionsTotal} />
            <Stat label="Already in Xero" value={g.existingOptionsCount} />
            <Stat label="New to create" value={g.newOptionsCount} highlight />
          </div>

          {g.softLimitWarning && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              Xero recommends a soft limit of 100 options per tracking category. This category will exceed
              that after import. Import can continue, but very large numbers of tracking options may affect
              reporting performance in Xero.
            </p>
          )}

          {g.archivedConflicts?.length > 0 && (
            <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {g.archivedConflicts.length} option(s) already exist but are ARCHIVED and will be skipped:
              {' '}{g.archivedConflicts.slice(0, 10).join(', ')}
              {g.archivedConflicts.length > 10 ? '...' : ''}
            </p>
          )}
        </div>
      ))}

      <div className="flex gap-3 mt-6">
        <button
          className="px-4 py-2 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          disabled={selected.size === 0 || submitting}
          className="px-4 py-2 rounded-md bg-xero-blue text-white font-medium disabled:opacity-50 hover:brightness-95"
          onClick={() => onConfirm([...selected])}
        >
          {submitting ? 'Starting...' : `Start Import (${selected.size} categor${selected.size === 1 ? 'y' : 'ies'})`}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`rounded-md p-3 text-center ${highlight ? 'bg-sky-50' : 'bg-slate-50'}`}>
      <p className={`text-lg font-semibold ${highlight ? 'text-xero-blue' : 'text-slate-700'}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
