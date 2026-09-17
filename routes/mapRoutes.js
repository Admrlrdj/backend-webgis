const express = require('express');
const router = express.Router();
const mapController = require('../controllers/mapController');

// Endpoint untuk mengambil data GeoJSON
router.get('/locations', mapController.getLocations);

module.exports = router;