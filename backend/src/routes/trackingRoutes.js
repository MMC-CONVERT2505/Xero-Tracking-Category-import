const express = require('express');
const ctrl = require('../controllers/xeroController');
const requireTenant = require('../middleware/requireTenant');

const router = express.Router();
router.use(requireTenant);

router.get('/tracking-categories', ctrl.listTrackingCategories);
router.get('/tracking-categories/:trackingCategoryId', ctrl.getTrackingCategory);
router.get('/tracking-categories/:trackingCategoryId/options', ctrl.getTrackingCategoryOptions);

module.exports = router;
