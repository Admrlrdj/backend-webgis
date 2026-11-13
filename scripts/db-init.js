/**
 * Membuat schema PostGIS (db/schema.sql) dan akun admin dari .env.
 * Jalankan: npm run db:init   (butuh DATABASE_URL)
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const config = require('../src/config/env');
const db = require('../src/config/db');

// Buat database target jika belum ada, dengan konek sementara ke database "postgres"
async function ensureDatabase() {
  const url = new URL(config.databaseUrl);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName || dbName === 'postgres') return;
  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`Database "${dbName}" dibuat.`);
    }
  } finally {
    await admin.end();
  }
}

async function main() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL belum diisi di .env');
  await ensureDatabase();
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('Schema siap.');

  for (const u of config.seedUsers) {
    const defaultAgency = u.role === 'superadmin' ? 'Diskominfo Kota Bogor' : 'Bappeda Kota Bogor';
    await db.query(
      `INSERT INTO users (email, name, password_hash, role, agency) VALUES (lower($1), $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, agency = COALESCE(NULLIF(users.agency, ''), EXCLUDED.agency), is_active = TRUE`,
      [u.email, u.name, await bcrypt.hash(u.password, 10), u.role, defaultAgency]
    );
    console.log(`Akun ${u.role} disiapkan: ${u.email}`);
  }
  await db.getPool().end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
