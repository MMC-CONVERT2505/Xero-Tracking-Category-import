const express = require('express');
const ctrl = require('../controllers/authController');

const router = express.Router();

router.get('/xero', ctrl.xeroLogin);
router.get('/xero/callback', ctrl.xeroCallback);
router.post('/xero/logout', ctrl.logout);
router.get('/xero/session', ctrl.sessionStatus);

module.exports = router;
