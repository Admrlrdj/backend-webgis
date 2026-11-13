/**
 * Simple Additive Weighting (SAW).
 *
 * Dua skor dihitung terpisah agar tidak tertukar saat dibaca:
 *   - intervention_score : makin tinggi = makin butuh intervensi (dipakai untuk ranking)
 *   - condition_score    : makin tinggi = kondisi wilayah makin baik
 *
 * Normalisasi: benefit r = x / max, cost r = min / x.
 * Pada intervention_score, indikator "need" diperlakukan sebagai benefit dan
 * indikator "condition" (air bersih) sebagai cost. condition_score kebalikannya.
 */
const { INDICATORS } = require('../config/indicators');
const { badRequest } = require('../utils/httpError');

// Selaras dengan bobot default yang dipakai UI frontend (PriorityAreasView)
const DEFAULT_WEIGHTS = { stunting: 0.4, kemiskinan: 0.25, pangan: 0.2, air: 0.15 };
const WEIGHT_VERSION_DEFAULT = 'default-v1';

function normalizeWeights(input) {
  const raw = { ...DEFAULT_WEIGHTS, ...(input || {}) };
  const weights = {};
  for (const id of Object.keys(INDICATORS)) {
    const w = Number(raw[id]);
    if (!Number.isFinite(w) || w < 0) throw badRequest(`Bobot "${id}" harus angka >= 0`);
    weights[id] = w;
  }
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  if (total <= 0) throw badRequest('Total bobot harus lebih dari 0');
  // Terima bobot dalam persen (40, 25, ...) maupun desimal (0.4, 0.25, ...)
  for (const id of Object.keys(weights)) weights[id] = weights[id] / total;
  return weights;
}

function weightsFromQuery(query) {
  const picked = {};
  for (const id of Object.keys(INDICATORS)) {
    const v = query[`w_${id}`];
    if (v !== undefined) picked[id] = v;
  }
  return Object.keys(picked).length ? picked : undefined;
}

function normalizeColumn(values, kind) {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  if (!positive.length) return values.map(() => 0);
  const max = Math.max(...positive);
  const min = Math.min(...positive);
  return values.map((v) => {
    if (!Number.isFinite(v) || v <= 0) return kind === 'cost' ? 1 : 0;
    return kind === 'benefit' ? v / max : min / v;
  });
}

const round = (v, d = 4) => Number(v.toFixed(d));

function priorityFor(rank, total) {
  // Sama dengan pembagian zona di UI: 25% teratas merah, 40% berikutnya kuning
  if (rank <= Math.ceil(total * 0.25)) return { priority_level: 'tinggi', zona: 'merah', label: 'Prioritas 1 (Intervensi Utama)' };
  if (rank <= Math.ceil(total * 0.65)) return { priority_level: 'sedang', zona: 'kuning', label: 'Prioritas 2 (Perhatian Khusus)' };
  return { priority_level: 'rendah', zona: 'hijau', label: 'Prioritas Rendah' };
}

/**
 * @param {Array<{id,nama,kecamatan,stunting,kemiskinan,kerentananPangan,airBersih}>} rows
 * @param {object} [weightsInput]
 */
function calculate(rows, weightsInput) {
  const weights = normalizeWeights(weightsInput);
  const ids = Object.keys(INDICATORS);

  const isComplete = (r) => ids.every((id) => r[INDICATORS[id].key] !== null && Number.isFinite(Number(r[INDICATORS[id].key])));
  const complete = rows.filter(isComplete);
  const skipped = rows.filter((r) => !isComplete(r)).map((r) => ({ area_id: r.id, nama: r.nama, reason: 'Indikator tidak lengkap' }));

  const need = {};
  const cond = {};
  for (const id of ids) {
    const def = INDICATORS[id];
    const col = complete.map((r) => Number(r[def.key]));
    need[id] = normalizeColumn(col, def.direction === 'need' ? 'benefit' : 'cost');
    cond[id] = normalizeColumn(col, def.direction === 'need' ? 'cost' : 'benefit');
  }

  const scored = complete.map((r, i) => {
    const normalized = {};
    const contributions = {};
    let intervention = 0;
    let condition = 0;
    for (const id of ids) {
      normalized[id] = round(need[id][i], 3);
      contributions[id] = round(weights[id] * need[id][i]);
      intervention += weights[id] * need[id][i];
      condition += weights[id] * cond[id][i];
    }
    const mainDriver = ids.reduce((a, b) => (contributions[a] >= contributions[b] ? a : b));
    return {
      area_id: r.id,
      kode_wilayah: r.kode_wilayah,
      nama: r.nama,
      kecamatan: r.kecamatan,
      values: Object.fromEntries(ids.map((id) => [id, Number(r[INDICATORS[id].key])])),
      normalized,
      contributions,
      intervention_score: round(intervention),
      condition_score: round(condition),
      main_driver: { indicator: mainDriver, label: INDICATORS[mainDriver].label },
    };
  });

  scored.sort((a, b) => b.intervention_score - a.intervention_score);
  const total = scored.length;
  const ranking = scored.map((s, idx) => ({ rank: idx + 1, ...s, ...priorityFor(idx + 1, total) }));

  return {
    weights: Object.fromEntries(ids.map((id) => [id, round(weights[id])])),
    criteria: ids.map((id) => ({
      id,
      label: INDICATORS[id].label,
      type_for_intervention: INDICATORS[id].direction === 'need' ? 'benefit' : 'cost',
    })),
    ranking,
    skipped,
    summary: {
      total_areas: total,
      tinggi: ranking.filter((r) => r.priority_level === 'tinggi').length,
      sedang: ranking.filter((r) => r.priority_level === 'sedang').length,
      rendah: ranking.filter((r) => r.priority_level === 'rendah').length,
    },
  };
}

module.exports = { calculate, normalizeWeights, weightsFromQuery, DEFAULT_WEIGHTS, WEIGHT_VERSION_DEFAULT };
