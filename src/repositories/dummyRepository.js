/**
 * Repository mode DUMMY: membaca GeoJSON contoh dari data/dummy dan menyimpan
 * perubahan (upload, publish, SAW, audit) di memori. Semua perubahan hilang
 * saat server restart. Dipakai sampai GeoJSON resmi dan database PostGIS siap.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config/env');
const { INDICATORS, DEFAULT_SOURCE } = require('../config/indicators');

const DUMMY_DIR = path.join(__dirname, '..', '..', 'data', 'dummy');
const INDICATOR_KEYS = Object.values(INDICATORS).map((d) => d.key);

function readGeoJSON(file) {
  const full = path.join(DUMMY_DIR, file);
  if (!fs.existsSync(full)) {
    throw new Error(`File ${full} tidak ada. Jalankan "npm run generate:dummy" terlebih dahulu.`);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

const kelurahanFC = readGeoJSON('kelurahan_dummy.geojson');
const facilitiesFC = readGeoJSON('facilities_dummy.geojson');
const loadedAt = new Date().toISOString();

// Geometri + atribut statis per area
const areas = kelurahanFC.features.map((f) => {
  const p = f.properties;
  return {
    id: p.id,
    kode_wilayah: p.kode_wilayah,
    nama: p.nama,
    kecamatan: p.kecamatan,
    kode_kecamatan: p.kode_kecamatan,
    lat: p.lat,
    lng: p.lng,
    geometry: f.geometry,
  };
});
const areaById = new Map(areas.map((a) => [a.id, a]));

// values: Map<year, Map<areaId, {stunting, kemiskinan, kerentananPangan, airBersih}>>
const values = new Map();
// datasetMeta: key `${indicatorId}:${year}` -> {source, updated_at, status_validasi}
const datasetMeta = new Map();

const baseYear = kelurahanFC.metadata?.periode || 2025;
values.set(baseYear, new Map(kelurahanFC.features.map((f) => [f.properties.id, Object.fromEntries(INDICATOR_KEYS.map((k) => [k, f.properties[k] ?? null]))])));
for (const id of Object.keys(INDICATORS)) {
  datasetMeta.set(`${id}:${baseYear}`, { source: DEFAULT_SOURCE, updated_at: loadedAt, status_validasi: 'dummy' });
}

const uploads = new Map();
const sawRuns = [];
const auditLogs = [];
let users = null;

const latestYear = () => Math.max(...values.keys());
const resolveYear = (year) => (year && values.has(year) ? year : year ? null : latestYear());

function buildProperties(area, year) {
  const vals = values.get(year)?.get(area.id) || Object.fromEntries(INDICATOR_KEYS.map((k) => [k, null]));
  return {
    id: area.id,
    kode_wilayah: area.kode_wilayah,
    nama: area.nama,
    kecamatan: area.kecamatan,
    ...vals,
    lat: area.lat,
    lng: area.lng,
    year,
    is_dummy: true,
  };
}

const toFeature = (area, year) => ({ type: 'Feature', id: area.id, properties: buildProperties(area, year), geometry: area.geometry });

module.exports = {
  kind: 'dummy',

  async ping() {
    return { ok: true, kind: 'dummy' };
  },

  async listAreaSummaries() {
    return areas.map(({ id, kode_wilayah, nama, kecamatan }) => ({ id, kode_wilayah, nama, kecamatan }));
  },

  async getAvailableYears() {
    return [...values.keys()].sort((a, b) => b - a);
  },

  async getAreasGeoJSON({ kecamatan, year } = {}) {
    const y = resolveYear(year);
    const list = kecamatan ? areas.filter((a) => a.kecamatan.toLowerCase() === kecamatan.toLowerCase()) : areas;
    return { year: y, featureCollection: { type: 'FeatureCollection', features: y ? list.map((a) => toFeature(a, y)) : [] } };
  },

  async getAreaById(id, { year } = {}) {
    const area = areaById.get(id) || areas.find((a) => a.kode_wilayah === id);
    if (!area) return null;
    const y = resolveYear(year) || latestYear();
    return toFeature(area, y);
  },

  async getIndicatorRows({ year } = {}) {
    const y = resolveYear(year);
    if (!y) return { year, rows: [] };
    return { year: y, rows: areas.map((a) => buildProperties(a, y)) };
  },

  async getFacilities({ type } = {}) {
    const features = type ? facilitiesFC.features.filter((f) => f.properties.facility_type === type) : facilitiesFC.features;
    return { type: 'FeatureCollection', features };
  },

  async getFacilityTypes() {
    return [...new Set(facilitiesFC.features.map((f) => f.properties.facility_type))];
  },

  async getDatasetMeta(indicatorId, year) {
    return datasetMeta.get(`${indicatorId}:${year}`) || null;
  },

  async listDatasetMeta() {
    return [...datasetMeta.entries()].map(([key, meta]) => {
      const [indicator, year] = key.split(':');
      return { indicator, year: Number(year), ...meta };
    });
  },

  async publishIndicatorValues({ indicator, year, source, rows }) {
    if (!values.has(year)) {
      values.set(year, new Map(areas.map((a) => [a.id, Object.fromEntries(INDICATOR_KEYS.map((k) => [k, null]))])));
    }
    const yearMap = values.get(year);
    for (const r of rows) yearMap.get(r.area_id)[indicator.key] = r.value;
    datasetMeta.set(`${indicator.id}:${year}`, { source, updated_at: new Date().toISOString(), status_validasi: 'published' });
    return rows.length;
  },

  // ---- users ----
  async findUserByEmail(email) {
    if (!users) {
      users = config.seedUsers.map((u, i) => ({
        id: i + 1,
        email: u.email.toLowerCase(),
        name: u.name,
        role: u.role,
        password_hash: bcrypt.hashSync(u.password, 10),
      }));
    }
    return users.find((u) => u.email === String(email).toLowerCase()) || null;
  },

  // ---- uploads ----
  async createUpload(record) {
    const id = crypto.randomUUID();
    const row = { id, ...record, status: record.status || 'pending', created_at: new Date().toISOString() };
    uploads.set(id, row);
    return row;
  },
  async getUpload(id) {
    return uploads.get(id) || null;
  },
  async listUploads() {
    return [...uploads.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async updateUpload(id, patch) {
    const row = uploads.get(id);
    if (!row) return null;
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    return row;
  },

  // ---- SAW ----
  async saveSawRun(run) {
    const row = { id: sawRuns.length + 1, ...run, created_at: new Date().toISOString() };
    sawRuns.push(row);
    return row;
  },
  async getLatestSawRun(period) {
    for (let i = sawRuns.length - 1; i >= 0; i--) if (!period || sawRuns[i].period === period) return sawRuns[i];
    return null;
  },

  // ---- audit ----
  async addAuditLog(entry) {
    auditLogs.push({ id: auditLogs.length + 1, ...entry, created_at: new Date().toISOString() });
  },
  async listAuditLogs({ limit = 100 } = {}) {
    return auditLogs.slice(-limit).reverse();
  },
};
