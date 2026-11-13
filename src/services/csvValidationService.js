/**
 * Parsing + validasi CSV indikator sebelum dipublikasikan.
 *
 * Format minimal yang diterima (header tidak case-sensitive):
 *   kelurahan,value              <- nama kelurahan
 *   kode_wilayah,value           <- atau kode wilayah / id area (KEL-01)
 *   wadmkd,stunting              <- kolom nilai boleh memakai nama indikator
 * Kolom opsional: kecamatan (wadmkc) untuk membedakan nama kelurahan kembar.
 */
const { Readable } = require('stream');
const csv = require('csv-parser');
const { normalizeWilayah, parseNumber } = require('../utils/normalize');
const { badRequest } = require('../utils/httpError');

const AREA_NAME_COLUMNS = ['kelurahan', 'nama_kelurahan', 'wadmkd', 'nama_desa', 'desa'];
const AREA_CODE_COLUMNS = ['kode_wilayah', 'kode_desa', 'area_id', 'id'];
const KEC_COLUMNS = ['kecamatan', 'nama_kecamatan', 'wadmkc'];

function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from([buffer])
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim().toLowerCase() }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

const pick = (headers, candidates) => candidates.find((c) => headers.includes(c));

/**
 * @param {Buffer} buffer
 * @param {object} indicator  hasil resolveIndicator()
 * @param {Array} areas       master wilayah [{id, kode_wilayah, nama, kecamatan}]
 */
async function validateIndicatorCsv(buffer, indicator, areas) {
  let rows;
  try {
    rows = await parseCsvBuffer(buffer);
  } catch (err) {
    throw badRequest(`CSV tidak dapat dibaca: ${err.message}`);
  }
  if (!rows.length) throw badRequest('CSV kosong atau hanya berisi header');

  const headers = Object.keys(rows[0]);
  const nameCol = pick(headers, AREA_NAME_COLUMNS);
  const codeCol = pick(headers, AREA_CODE_COLUMNS);
  const kecCol = pick(headers, KEC_COLUMNS);
  const valueCandidates = ['value', 'nilai', indicator.id, indicator.key.toLowerCase(), ...indicator.aliases];
  const valueCol = pick(headers, valueCandidates);

  if (!nameCol && !codeCol) {
    throw badRequest('Kolom wilayah tidak ditemukan', { expected_one_of: [...AREA_NAME_COLUMNS, ...AREA_CODE_COLUMNS], headers });
  }
  if (!valueCol) {
    throw badRequest('Kolom nilai indikator tidak ditemukan', { expected_one_of: valueCandidates, headers });
  }

  const byCode = new Map();
  const byName = new Map();
  for (const a of areas) {
    byCode.set(String(a.id).toLowerCase(), a);
    if (a.kode_wilayah) byCode.set(String(a.kode_wilayah).toLowerCase(), a);
    const key = normalizeWilayah(a.nama);
    byName.set(key, [...(byName.get(key) || []), a]);
  }

  const valid = [];
  const invalid = [];
  const unmatched = [];
  const seen = new Map();

  rows.forEach((row, idx) => {
    const line = idx + 2; // baris 1 adalah header
    const rawName = nameCol ? row[nameCol] : undefined;
    const rawCode = codeCol ? row[codeCol] : undefined;

    let area = rawCode ? byCode.get(String(rawCode).trim().toLowerCase()) : undefined;
    if (!area && rawName) {
      const candidates = byName.get(normalizeWilayah(rawName)) || [];
      area = candidates.length > 1 && kecCol
        ? candidates.find((c) => normalizeWilayah(c.kecamatan) === normalizeWilayah(row[kecCol]))
        : candidates[0];
    }
    if (!area) {
      unmatched.push({ line, wilayah: rawName || rawCode || null, reason: 'Wilayah tidak cocok dengan master administratif' });
      return;
    }

    const value = parseNumber(row[valueCol]);
    if (!Number.isFinite(value)) {
      invalid.push({ line, wilayah: area.nama, value: row[valueCol] ?? null, reason: 'Nilai kosong atau bukan angka' });
      return;
    }
    if (value < indicator.min || value > indicator.max) {
      invalid.push({ line, wilayah: area.nama, value, reason: `Nilai di luar rentang ${indicator.min}-${indicator.max}` });
      return;
    }
    if (seen.has(area.id)) {
      invalid.push({ line, wilayah: area.nama, value, reason: `Duplikat wilayah (sudah ada di baris ${seen.get(area.id)})` });
      return;
    }
    seen.set(area.id, line);
    valid.push({ line, area_id: area.id, nama: area.nama, kecamatan: area.kecamatan, value });
  });

  const missingAreas = areas.filter((a) => !seen.has(a.id)).map((a) => ({ id: a.id, nama: a.nama }));

  return {
    columns: { wilayah: nameCol || codeCol, kecamatan: kecCol || null, value: valueCol },
    summary: {
      total_rows: rows.length,
      valid_row_count: valid.length,
      invalid_row_count: invalid.length,
      unmatched_row_count: unmatched.length,
      missing_area_count: missingAreas.length,
    },
    valid,
    invalid,
    unmatched,
    missing_areas: missingAreas,
  };
}

module.exports = { validateIndicatorCsv, parseCsvBuffer };
