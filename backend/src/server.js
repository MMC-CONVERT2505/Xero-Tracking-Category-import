// MUST be the very first thing that runs: several modules read process.env
// at module-load time (e.g. xeroAuthService.js's top-level CLIENT_ID
// constant), and those modules can get required - via app.js's require
// chain - BEFORE config/constants.js's own dotenv.config() call would
// otherwise run. Loading .env here, before anything else, guarantees every
// module sees real values on its very first read.
require('dotenv').config();

const app = require('./app');
const store = require('./db/store');
const trackingBatchService = require('./services/trackingBatchService');
const { PORT } = require('./config/constants');

async function recoverInFlightImports() {
  // If the process crashed/restarted mid-import, PROCESSING jobs need a
  // nudge to pick back up where they left off (section 15 - resumability).
  const jobs = await store.listJobs();
  const inFlight = jobs.filter((j) => j.status === 'PROCESSING');
  for (const job of inFlight) {
    // eslint-disable-next-line no-console
    console.log(`[startup] resuming in-flight import ${job.importId}`);
    trackingBatchService.processJob(job.importId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[startup] failed to resume ${job.importId}:`, err);
    });
  }
}

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Xero Tracking Options Import API listening on port ${PORT}`);
  recoverInFlightImports();
});

function gracefulShutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[server] received ${signal}, shutting down gracefully`);
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log('[server] closed remaining connections');
    process.exit(0);
  });
  // Force-exit if close hangs (e.g. long-lived polling connections)
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = server;
