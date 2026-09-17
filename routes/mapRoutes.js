const express = require('express');
const router = express.Router();
const mapController = require('../controllers/mapController');

// Endpoint API khusus pemetaan stunting
router.get('/stunting', mapController.getStuntingMap);

module.exports = router;