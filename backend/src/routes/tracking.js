const express = require('express');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/trackingController');

const router = express.Router();

router.post('/import/validate', upload.single('file'), ctrl.validate);
router.post('/import/start', ctrl.start);
router.get('/import/:importId', ctrl.status);
router.get('/import/:importId/status', ctrl.status);
router.get('/import/:importId/errors', ctrl.errors);
router.post('/import/:importId/resume', ctrl.resume);
router.post('/import/:importId/retry-failed', ctrl.retryFailed);
router.post('/import/:importId/cancel', ctrl.cancel);

module.exports = router;
