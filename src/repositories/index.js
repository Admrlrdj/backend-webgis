const config = require('../config/env');

// Pilih implementasi sekali saat start. Lihat DATA_SOURCE / DATABASE_URL di .env
module.exports = config.dataSource === 'postgis' ? require('./postgisRepository') : require('./dummyRepository');
