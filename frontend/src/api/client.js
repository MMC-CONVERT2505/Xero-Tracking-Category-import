import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export async function validateUpload(file, tenantId) {
  const form = new FormData();
  form.append('file', file);
  form.append('tenantId', tenantId);
  const { data } = await api.post('/tracking/import/validate', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function startImport(tenantId, uploadToken, categoryKeys) {
  const { data } = await api.post('/tracking/import/start', { tenantId, uploadToken, categoryKeys });
  return data;
}

export async function getStatus(importId) {
  const { data } = await api.get(`/tracking/import/${importId}/status`);
  return data;
}

export async function getErrorReport(importId) {
  const { data } = await api.get(`/tracking/import/${importId}/errors`);
  return data;
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

export async function getConnections() {
  const { data } = await api.get('/xero/connections');
  return data;
}

export default api;
