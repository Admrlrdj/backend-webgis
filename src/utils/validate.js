const { badRequest } = require('./httpError');
const { resolveIndicator } = require('../config/indicators');

function parseYear(value, { required = false } = {}) {
  if (value === undefined || value === '') {
    if (required) throw badRequest('Parameter "year" wajib diisi');
    return undefined;
  }
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw badRequest('Parameter "year" harus tahun 4 digit (2000-2100)');
  }
  return year;
}

function requireIndicator(type) {
  const def = resolveIndicator(type);
  if (!def) {
    throw badRequest('Jenis indikator tidak dikenal', {
      allowed: ['stunting', 'kemiskinan', 'pangan', 'air'],
      received: type ?? null,
    });
  }
  return def;
}

module.exports = { parseYear, requireIndicator };
