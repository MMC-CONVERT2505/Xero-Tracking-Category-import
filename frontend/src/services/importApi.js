import api from '../lib/api.js';

export async function validateUpload(file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/tracking/import/validate', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/**
 * The confirmation action for one unresolved category.
 * - Plain "Continue Import" (NOT_FOUND, no similar category): call with no
 *   `decision` - unchanged from before, still a single click, still
 *   auto-creates.
 * - A possible typo/mismatch (POSSIBLE_MISMATCH): `decision` is REQUIRED,
 *   either 'use_existing' or 'create_new' - the backend rejects the call
 *   without one rather than silently picking a side.
 */
export async function resolveCategory(uploadToken, key, decision) {
  const { data } = await api.post('/tracking/import/resolve-category', { uploadToken, key, decision });
  return data.category;
}

export async function startImport(uploadToken) {
  const { data } = await api.post('/tracking/import/start', { uploadToken });
  return data; // { batchId, jobs: [...], skipped: [...] }
}

/** Aggregate progress across every category created from one multi-category upload. */
export async function getBatchStatus(batchId) {
  const { data } = await api.get(`/tracking/import/batch/${batchId}`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  return data;
}

export async function listImports() {
  const { data } = await api.get('/tracking/import');
  return data.jobs;
}

export async function getStatus(importId) {
  // Belt-and-suspenders alongside the backend's own Cache-Control:
  // no-store on this route - guards against any browser-layer caching of
  // a GET request polled every ~1s.
  const { data } = await api.get(`/tracking/import/${importId}/status`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  return data;
}

export async function getErrorReport(importId) {
  const { data } = await api.get(`/tracking/import/${importId}/errors`);
  return data.errors;
}

export async function retryFailed(importId) {
  const { data } = await api.post(`/tracking/import/${importId}/retry-failed`);
  return data;
}

export async function resumeImport(importId) {
  const { data } = await api.post(`/tracking/import/${importId}/resume`);
  return data;
}

export async function cancelImport(importId) {
  const { data } = await api.post(`/tracking/import/${importId}/cancel`);
  return data;
}

export default { validateUpload, startImport, getBatchStatus, listImports, getStatus, getErrorReport, retryFailed, resumeImport, cancelImport };
