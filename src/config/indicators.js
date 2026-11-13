/**
 * Katalog indikator. `key` mengikuti nama properti GeoJSON yang dipakai frontend.
 * `direction` menjelaskan arti nilai tinggi:
 *   - "need"      : nilai tinggi = kondisi lebih buruk / kebutuhan intervensi lebih besar
 *   - "condition" : nilai tinggi = kondisi lebih baik
 */
const INDICATORS = {
  stunting: {
    key: 'stunting',
    label: 'Prevalensi Stunting',
    unit: '%',
    min: 0,
    max: 100,
    direction: 'need',
    aliases: ['stunting', 'balita_stunting'],
  },
  kemiskinan: {
    key: 'kemiskinan',
    label: 'Tingkat Kemiskinan / DTKS',
    unit: '%',
    min: 0,
    max: 100,
    direction: 'need',
    aliases: ['kemiskinan', 'welfare', 'kesejahteraan'],
  },
  pangan: {
    key: 'kerentananPangan',
    label: 'Skor Kerentanan Pangan',
    unit: 'skor (0-100)',
    min: 0,
    max: 100,
    direction: 'need',
    aliases: ['pangan', 'food', 'ikp', 'kerentananpangan', 'ketahanan_pangan'],
  },
  air: {
    key: 'airBersih',
    label: 'Akses Air Bersih',
    unit: '%',
    min: 0,
    max: 100,
    direction: 'condition',
    aliases: ['air', 'water', 'airbersih', 'air_bersih'],
  },
};

const DEFAULT_SOURCE = 'Data contoh NutriMap (dummy) - menunggu dataset resmi';

function resolveIndicator(type) {
  if (!type) return null;
  const t = String(type).toLowerCase().trim();
  for (const [id, def] of Object.entries(INDICATORS)) {
    if (id === t || def.key.toLowerCase() === t || def.aliases.includes(t)) return { id, ...def };
  }
  return null;
}

module.exports = { INDICATORS, DEFAULT_SOURCE, resolveIndicator };
