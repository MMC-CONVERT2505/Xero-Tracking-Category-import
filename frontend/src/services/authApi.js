import axios from 'axios';
import api from '../lib/api.js';

// /auth/* is not under /api - a plain root-relative URL so the browser
// actually navigates there (OAuth redirects can't happen via XHR).
export function startXeroLogin() {
  window.location.href = '/auth/xero';
}

export async function getSessionStatus() {
  const { data } = await axios.get('/auth/xero/session', { withCredentials: true });
  return data; // { authenticated, selectedTenantId }
}

export async function logout() {
  const { data } = await axios.post('/auth/xero/logout', null, { withCredentials: true });
  return data;
}

export default { startXeroLogin, getSessionStatus, logout };
