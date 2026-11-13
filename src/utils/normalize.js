/**
 * Normalisasi nama wilayah sebelum join: huruf kecil, buang awalan
 * administratif, tanda baca, dan spasi. "Kel. Tanah Sareal" -> "tanahsareal".
 */
// Variasi ejaan antar dataset resmi (Bappeda 2014 vs FSVA/BPS) dipetakan ke bentuk kanonik
const WILAYAH_ALIASES = {
  balumbangjaya: 'balungbangjaya',
  kebonkalapa: 'kebonkelapa',
  tegalega: 'tegallega',
  tanahsereal: 'tanahsareal',
};

function normalizeWilayah(name) {
  if (name === undefined || name === null) return '';
  const cleaned = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(kelurahan|kel\.?|desa|kecamatan|kec\.?)\s+/, '')
    .replace(/[^a-z0-9]/g, '');
  return WILAYAH_ALIASES[cleaned] || cleaned;
}

function parseNumber(value) {
  if (value === undefined || value === null) return NaN;
  const s = String(value).trim().replace(/%$/, '');
  if (s === '') return NaN;
  // Dukung desimal koma ("12,5") tanpa merusak ribuan bertitik yang jarang ada di data persen
  const normalized = s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s;
  return Number(normalized);
}

module.exports = { normalizeWilayah, parseNumber };
