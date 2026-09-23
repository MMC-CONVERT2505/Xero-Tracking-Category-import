import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as importApi from '../services/importApi.js';
import { useToast } from '../context/ToastContext.jsx';
import FileUploader from '../components/FileUploader.jsx';
import ImportSummary from '../components/ImportSummary.jsx';

export default function TrackingImport() {
  const navigate = useNavigate();
  const toast = useToast();

  const [file, setFile] = useState(null);
  const [validating, setValidating] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [categories, setCategories] = useState([]);
  const [starting, setStarting] = useState(false);

  async function handleFileSelected(f) {
    setFile(f);
    setValidating(true);
    setPreflight(null);
    setCategories([]);
    try {
      const result = await importApi.validateUpload(f);
      setPreflight(result);
      setCategories(result.categories);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Could not read that file.');
      setFile(null);
    } finally {
      setValidating(false);
    }
  }

  // "Continue Import" for one NOT_FOUND category: creates it in Xero, then
  // swaps that category's card into its resolved (FOUND) state.
  async function handleResolveCategory(key) {
    const resolved = await importApi.resolveCategory(preflight.uploadToken, key);
    setCategories((prev) => prev.map((c) => (c.key === key ? resolved : c)));
    toast.success(resolved.wasCreated ? `"${resolved.categoryName}" created in Xero.` : `"${resolved.categoryName}" resolved.`);
  }

  async function handleStart() {
    setStarting(true);
    try {
      const { jobs, skipped } = await importApi.startImport(preflight.uploadToken);

      if (skipped.length > 0) {
        toast.info(`Skipped ${skipped.length} categor${skipped.length === 1 ? 'y' : 'ies'} that weren't resolved yet: ${skipped.map((s) => s.categoryNameInFile).join(', ')}`);
      }
      if (jobs.length === 0) {
        toast.error('Nothing was imported - no category was ready.');
        setStarting(false);
        return;
      }
      toast.success(jobs.length === 1 ? 'Import started.' : `${jobs.length} imports started.`);
      navigate(jobs.length === 1 ? `/imports/${jobs[0].importId}` : '/imports');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Could not start the import.');
      setStarting(false);
    }
  }

  function reset() {
    setFile(null);
    setPreflight(null);
    setCategories([]);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-ink-900">Import Tracking Options</h1>
      <p className="text-sm text-ink-500 mt-1">
        Upload a file with the Tracking Category as the header of the first column and its options
        listed below it - we'll detect it, match it to Xero, and create it automatically if it
        doesn't exist yet.
      </p>

      <div className="mt-6">
        <FileUploader onFileSelected={handleFileSelected} disabled={validating} selectedFile={file} />
        {validating && <p className="text-sm text-ink-500 mt-3">Reading file and checking against Xero...</p>}
      </div>

      {preflight && (
        <div className="mt-8">
          <ImportSummary
            preflight={preflight}
            categories={categories}
            onResolveCategory={handleResolveCategory}
            onCancel={reset}
            onStart={handleStart}
            starting={starting}
          />
        </div>
      )}
    </div>
  );
}
