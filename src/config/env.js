const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const requestedSource = (process.env.DATA_SOURCE || '').toLowerCase();
const hasDatabase = Boolean(process.env.DATABASE_URL);

// "postgis" hanya dipakai bila DATABASE_URL tersedia; selain itu otomatis jatuh ke "dummy"
const dataSource = requestedSource === 'postgis' || (!requestedSource && hasDatabase) ? 'postgis' : 'dummy';
if (dataSource === 'postgis' && !hasDatabase) {
  throw new Error('DATA_SOURCE=postgis membutuhkan DATABASE_URL di .env');
}

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || (isProduction ? null : 'dev-only-insecure-secret');
if (!jwtSecret) throw new Error('JWT_SECRET wajib diisi saat NODE_ENV=production');

module.exports = {
  port: Number(process.env.PORT) || 5000,
  isProduction,
  dataSource,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : '*',
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES) || 5 * 1024 * 1024,
  seedUsers: [
    { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, name: 'Admin Instansi', role: 'admin' },
    { email: process.env.SUPERADMIN_EMAIL, password: process.env.SUPERADMIN_PASSWORD, name: 'Super Admin', role: 'superadmin' },
  ].filter((u) => u.email && u.password),
};
