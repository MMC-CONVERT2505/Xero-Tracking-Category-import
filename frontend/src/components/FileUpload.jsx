import React, { useRef, useState } from 'react';

export default function FileUpload({ tenantId, onTenantChange, onValidate, loading }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');

  function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    onValidate(file);
  }

  return (
    <div className="max-w-2xl mx-auto mt-10">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Tracking Options Import</h1>
      <p className="text-slate-500 mb-6">Upload an Excel/CSV file with CategoryName / OptionName columns.</p>

      <label className="block text-sm font-medium text-slate-700 mb-1">Xero Tenant ID</label>
      <input
        className="w-full border border-slate-300 rounded-md px-3 py-2 mb-6 focus:outline-none focus:ring-2 focus:ring-xero-blue"
        placeholder="Paste the connected tenant's ID"
        value={tenantId}
        onChange={(e) => onTenantChange(e.target.value)}
      />

      <div
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-xero-blue bg-sky-50' : 'border-slate-300 bg-white'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {loading ? (
          <p className="text-slate-500">Validating file...</p>
        ) : fileName ? (
          <p className="text-slate-700 font-medium">{fileName}</p>
        ) : (
          <>
            <p className="text-slate-600 font-medium">Drag & drop a file here, or click to browse</p>
            <p className="text-slate-400 text-sm mt-1">.xlsx, .xls or .csv - single or multi-sheet</p>
          </>
        )}
      </div>
    </div>
  );
}
