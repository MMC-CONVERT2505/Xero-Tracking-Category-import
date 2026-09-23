import React, { useRef, useState } from 'react';
import { IconUpload } from './icons.jsx';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileUploader({ onFileSelected, disabled, selectedFile }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(fileList) {
    const file = fileList?.[0];
    if (file) onFileSelected(file);
  }

  return (
    <div>
      <div
        className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer
          ${disabled ? 'opacity-50 pointer-events-none' : ''}
          ${dragOver ? 'border-brand-500 bg-brand-50' : 'border-line bg-white hover:border-brand-300'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <IconUpload />
        </div>
        {selectedFile ? (
          <>
            <p className="font-medium text-ink-900">{selectedFile.name}</p>
            <p className="text-sm text-ink-500 mt-0.5">{formatBytes(selectedFile.size)} - click or drop to replace</p>
          </>
        ) : (
          <>
            <p className="font-medium text-ink-900">Drop your Excel file here</p>
            <p className="text-sm text-ink-500 mt-0.5">or click to browse - .xlsx, .xls or .csv</p>
          </>
        )}
      </div>
    </div>
  );
}
