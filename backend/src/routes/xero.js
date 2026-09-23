const express = require('express');
const ctrl = require('../controllers/xeroController');

const router = express.Router();

router.get('/connect', ctrl.connect);
router.get('/callback', ctrl.callback);
router.get('/connections', ctrl.connections);
router.get('/tracking-categories', ctrl.listTrackingCategories);
router.get('/tracking-categories/:trackingCategoryId/options', ctrl.getTrackingCategoryOptions);

module.exports = router;
