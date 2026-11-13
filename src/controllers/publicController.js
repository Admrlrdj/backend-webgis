const repo = require('../repositories');
const config = require('../config/env');
const { INDICATORS, DEFAULT_SOURCE } = require('../config/indicators');
const saw = require('../services/sawService');
const { notFound, badRequest } = require('../utils/httpError');
const { parseYear, requireIndicator } = require('../utils/validate');

const FACILITY_TYPES = ['market', 'water_facility', 'puskesmas', 'posyandu', 'agricultural_area'];

// is_dummy mengikuti datanya (kolom is_dummy per wilayah), bukan jenis repository,
// supaya data dummy yang sudah diimport ke PostGIS tetap ditandai dummy
const baseMeta = (items) => ({
  data_source: repo.kind,
  is_dummy: items ? items.some((f) => (f.properties ? f.properties.is_dummy : f.is_dummy)) : repo.kind === 'dummy',
});

async function health(_req, res) {
  let db;
  try {
    db = await repo.ping();
  } catch (err) {
    db = { ok: false, error: err.message };
  }
  res.status(db.ok ? 200 : 503).json({ status: db.ok ? 'ok' : 'degraded', data_source: config.dataSource, db, time: new Date().toISOString() });
}

// GET /api/areas?kecamatan=&year=
async function listAreas(req, res) {
  const year = parseYear(req.query.year);
  const { year: resolvedYear, featureCollection } = await repo.getAreasGeoJSON({ kecamatan: req.query.kecamatan, year });
  res.json({
    data: featureCollection,
    meta: { ...baseMeta(featureCollection.features), year: resolvedYear, count: featureCollection.features.length, kecamatan: req.query.kecamatan || null },
  });
}

// GET /api/areas/:id
async function getArea(req, res) {
  const year = parseYear(req.query.year);
  const feature = await repo.getAreaById(req.params.id, { year });
  if (!feature) throw notFound(`Wilayah "${req.params.id}" tidak ditemukan`);
  res.json({ data: feature, meta: { ...baseMeta([feature]), year: feature.properties.year } });
}

// GET /api/indicators?type=stunting&year=2025
async function getIndicator(req, res) {
  const indicator = requireIndicator(req.query.type);
  const year = parseYear(req.query.year);
  const [{ year: snapshotYear, featureCollection }, datasetMeta] = await Promise.all([
    repo.getAreasGeoJSON({ kecamatan: req.query.kecamatan, year }),
    repo.getDatasetMeta(indicator.id, year || undefined),
  ]);
  const resolvedYear = year || datasetMeta?.year || snapshotYear;

  const features = featureCollection.features.map((f) => ({
    ...f,
    properties: {
      id: f.properties.id,
      kode_wilayah: f.properties.kode_wilayah,
      nama: f.properties.nama,
      kecamatan: f.properties.kecamatan,
      value: f.properties[indicator.key],
    },
  }));
  const numeric = features.map((f) => f.properties.value).filter((v) => Number.isFinite(v));

  res.json({
    data: { type: 'FeatureCollection', features },
    indicator: indicator.id,
    label: indicator.label,
    unit: indicator.unit,
    year: resolvedYear,
    source: datasetMeta?.source || DEFAULT_SOURCE,
    updatedAt: datasetMeta?.updated_at || null,
    stats: numeric.length
      ? {
          count: numeric.length,
          min: Math.min(...numeric),
          max: Math.max(...numeric),
          mean: Number((numeric.reduce((s, v) => s + v, 0) / numeric.length).toFixed(3)),
        }
      : { count: 0 },
    meta: baseMeta(featureCollection.features),
  });
}

// GET /api/facilities?type=market
async function listFacilities(req, res) {
  const { type } = req.query;
  if (type && !FACILITY_TYPES.includes(type)) throw badRequest('Jenis fasilitas tidak dikenal', { allowed: FACILITY_TYPES });
  const fc = await repo.getFacilities({ type });
  res.json({
    data: fc,
    meta: {
      ...baseMeta(),
      type: type || null,
      count: fc.features.length,
      note: 'Titik fasilitas memberi konteks spasial, bukan bukti cakupan layanan wilayah.',
    },
  });
}

// GET /api/rankings?year=2025&w_stunting=40&w_kemiskinan=25&w_pangan=20&w_air=15
async function getRankings(req, res) {
  const year = parseYear(req.query.year);
  const { year: resolvedYear, rows } = await repo.getIndicatorRows({ year });
  const result = saw.calculate(rows, saw.weightsFromQuery(req.query));
  res.json({
    data: result.ranking,
    weights: result.weights,
    criteria: result.criteria,
    summary: result.summary,
    skipped: result.skipped,
    year: resolvedYear,
    meta: {
      ...baseMeta(rows),
      method: 'Simple Additive Weighting (SAW)',
      disclaimer: 'Hasil SAW adalah rekomendasi analitis untuk mendukung keputusan, bukan keputusan otomatis.',
    },
  });
}

// GET /api/metadata
async function getMetadata(_req, res) {
  const [years, datasets, facilityTypes, areas] = await Promise.all([
    repo.getAvailableYears(),
    repo.listDatasetMeta(),
    repo.getFacilityTypes(),
    repo.listAreaSummaries(),
  ]);
  const kecamatan = [...new Set(areas.map((a) => a.kecamatan))].sort();
  res.json({
    data: {
      indicators: Object.entries(INDICATORS).map(([id, d]) => ({ id, property: d.key, label: d.label, unit: d.unit, direction: d.direction })),
      years,
      datasets,
      facility_types: facilityTypes,
      kecamatan,
      area_count: areas.length,
      default_weights: saw.DEFAULT_WEIGHTS,
    },
    meta: baseMeta(),
  });
}

module.exports = { health, listAreas, getArea, getIndicator, listFacilities, getRankings, getMetadata };
