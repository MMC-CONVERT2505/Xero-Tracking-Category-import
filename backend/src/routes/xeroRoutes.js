const express = require('express');
const ctrl = require('../controllers/xeroController');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');

const router = express.Router();

// Connection management only needs an active login, not yet a selected org.
router.get('/connections', requireAuth, ctrl.connections);
router.post('/select-connection', requireAuth, ctrl.selectConnection);
router.get('/current-connection', requireAuth, ctrl.currentConnection);

// Everything else needs a selected organisation.
router.use(requireTenant);
router.get('/dashboard', ctrl.dashboardSummary);

module.exports = router;
