const express = require('express');
const cors = require('cors');
const sessionMiddleware = require('./middleware/session');
const { requestContextMiddleware } = require('./middleware/requestContext');
const authRoutes = require('./routes/authRoutes');
const xeroRoutes = require('./routes/xeroRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const importRoutes = require('./routes/importRoutes');
const errorHandler = require('./middleware/errorHandler');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5005';

const app = express();

// credentials:true + an explicit origin (not '*') is required for the
// session cookie to travel between the Vite dev server and this API.
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(sessionMiddleware);
// TEMPORARY diagnostic plumbing - see middleware/requestContext.js. Purely
// observational, changes nothing about how requests are routed/handled.
app.use(requestContextMiddleware);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Section 30's API structure:
app.use('/auth', authRoutes);            // GET /auth/xero, /auth/xero/callback, POST /auth/xero/logout
app.use('/api/xero', xeroRoutes);        // connections, select-connection, current-connection, dashboard
app.use('/api/xero', trackingRoutes);    // tracking-categories (read-only)
app.use('/api/tracking', importRoutes);  // import job lifecycle

app.use((req, res) => res.status(404).json({ error: { message: 'Not found' } }));
app.use(errorHandler);

module.exports = app;
