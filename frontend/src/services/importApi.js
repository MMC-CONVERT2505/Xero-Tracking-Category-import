import api from '../lib/api.js';

export async function validateUpload(file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/tracking/import/validate', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/** The "Continue Import" step for one NOT_FOUND category: finds-or-creates it in Xero. */
export async function resolveCategory(uploadToken, key) {
  const { data } = await api.post('/tracking/import/resolve-category', { uploadToken, key });
  return data.category;
}

export async function startImport(uploadToken) {
  const { data } = await api.post('/tracking/import/start', { uploadToken });
  return data; // { jobs: [...], skipped: [...] }
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

export default { validateUpload, startImport, listImports, getStatus, getErrorReport, retryFailed, resumeImport, cancelImport };
