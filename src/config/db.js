const { Pool } = require('pg');
const config = require('./env');

let pool = null;

function isLocalHost(hostname) {
  return !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function buildPoolConfig(connectionString) {
  if (!connectionString) return { connectionString };
  try {
    const u = new URL(connectionString);
    const sslMode = u.searchParams.get('sslmode');
    const remote = !isLocalHost(u.hostname);
    if (remote || (sslMode && sslMode !== 'disable')) {
      u.searchParams.delete('sslmode');
      return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
    }
  } catch {
    // Biarkan pg menangani URL apa adanya jika gagal di-parse
  }
  return { connectionString };
}

// Pool dibuat saat pertama dipakai agar mode dummy tidak mencoba konek ke database
function getPool() {
  if (!pool) {
    pool = new Pool(buildPoolConfig(config.databaseUrl));
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  }
  return pool;
}

module.exports = { getPool, query: (text, params) => getPool().query(text, params) };
