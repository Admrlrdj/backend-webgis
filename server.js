const config = require('./src/config/env');
const { createApp } = require('./src/app');

const app = createApp();

app.listen(config.port, () => {
  console.log(`NutriMap API berjalan di http://localhost:${config.port} (data source: ${config.dataSource})`);
  if (config.dataSource === 'dummy') {
    console.log('  Mode DUMMY: GeoJSON contoh dari data/dummy, perubahan disimpan di memori saja.');
  }
  if (!config.seedUsers.length) {
    console.log('  Belum ada akun admin. Isi ADMIN_EMAIL dan ADMIN_PASSWORD di .env untuk login.');
  }
});
