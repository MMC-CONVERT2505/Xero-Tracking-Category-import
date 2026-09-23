import api from '../lib/api.js';

export async function getConnections() {
  const { data } = await api.get('/xero/connections');
  return data; // { connections, selectedTenantId }
}

export async function selectConnection(tenantId) {
  const { data } = await api.post('/xero/select-connection', { tenantId });
  return data;
}

export async function getCurrentConnection() {
  const res = await api.get('/xero/current-connection', { validateStatus: (s) => s === 200 || s === 204 });
  return res.status === 204 ? null : res.data;
}

export async function getDashboard() {
  const { data } = await api.get('/xero/dashboard');
  return data;
}

export async function listTrackingCategories() {
  const { data } = await api.get('/xero/tracking-categories');
  return data.categories;
}

export async function getTrackingCategoryOptions(trackingCategoryId) {
  const { data } = await api.get(`/xero/tracking-categories/${trackingCategoryId}/options`);
  return data.options;
}

export default { getConnections, selectConnection, getCurrentConnection, getDashboard, listTrackingCategories, getTrackingCategoryOptions };
