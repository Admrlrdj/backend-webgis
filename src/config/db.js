const { Pool } = require('pg');
const config = require('./env');

let pool = null;

// Pool dibuat saat pertama dipakai agar mode dummy tidak mencoba konek ke database
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  }
  return pool;
}

module.exports = { getPool, query: (text, params) => getPool().query(text, params) };
