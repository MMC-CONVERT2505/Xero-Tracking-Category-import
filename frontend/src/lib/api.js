import axios from 'axios';

// withCredentials is required for the session cookie (xti.sid) to travel
// between the Vite dev server (5173) and the API (4000) - see backend
// app.js's cors({ origin, credentials: true }).
const api = axios.create({ baseURL: '/api', withCredentials: true });

export default api;
