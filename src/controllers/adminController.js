const repo = require('../repositories');
const saw = require('../services/sawService');
const { validateIndicatorCsv } = require('../services/csvValidationService');
const { DEFAULT_SOURCE } = require('../config/indicators');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { parseYear, requireIndicator } = require('../utils/validate');

const PREVIEW_LIMIT = 20;

function uploadSummary(u) {
  return {
    id: u.id,
    filename: u.filename,
    indicator_type: u.indicator_type,
    source: u.source,
    period: u.period,
    status: u.status,
    valid_row_count: u.valid_row_count,
    invalid_row_count: u.invalid_row_count,
    unmatched_row_count: u.unmatched_row_count,
    created_at: u.created_at,
    published_at: u.published_at || null,
  };
}

// POST /api/admin/uploads  (multipart: file, indicator_type, year, source)
// Hanya memvalidasi + menyimpan sebagai "pending". Data produksi baru berubah saat publish.
async function createUpload(req, res) {
  if (!req.file) throw badRequest('File CSV wajib dilampirkan pada field "file"');
  if (!/\.csv$/i.test(req.file.originalname)) throw badRequest('Hanya file .csv yang diizinkan');

  const indicator = requireIndicator(req.body.indicator_type);
  const year = parseYear(req.body.year, { required: true });
  const source = (req.body.source || '').trim() || DEFAULT_SOURCE;

  const areas = await repo.listAreaSummaries();
  const validation = await validateIndicatorCsv(req.file.buffer, indicator, areas);

  const upload = await repo.createUpload({
    filename: req.file.originalname,
    indicator_type: indicator.id,
    source,
    period: year,
    uploaded_by: req.user.id,
    valid_row_count: validation.summary.valid_row_count,
    invalid_row_count: validation.summary.invalid_row_count,
    unmatched_row_count: validation.summary.unmatched_row_count,
    validation,
  });
  await repo.addAuditLog({
    user_id: req.user.id,
    action: 'upload.create',
    resource: 'data_uploads',
    resource_id: upload.id,
    metadata: { filename: upload.filename, indicator: indicator.id, year, summary: validation.summary },
  });

  res.status(201).json({
    data: uploadSummary(upload),
    validation: {
      columns: validation.columns,
      summary: validation.summary,
      preview: validation.valid.slice(0, PREVIEW_LIMIT),
      invalid: validation.invalid,
      unmatched: validation.unmatched,
    },
    next: `POST /api/admin/uploads/${upload.id}/publish untuk mempublikasikan baris valid`,
  });
}

// GET /api/admin/uploads
async function listUploads(_req, res) {
  const rows = await repo.listUploads();
  res.json({ data: rows.map(uploadSummary) });
}

// GET /api/admin/uploads/:id/validation
async function getUploadValidation(req, res) {
  const upload = await repo.getUpload(req.params.id);
  if (!upload) throw notFound('Upload tidak ditemukan');
  res.json({ data: uploadSummary(upload), validation: upload.validation });
}

// POST /api/admin/uploads/:id/publish
async function publishUpload(req, res) {
  const upload = await repo.getUpload(req.params.id);
  if (!upload) throw notFound('Upload tidak ditemukan');
  if (upload.status !== 'pending') throw conflict(`Upload berstatus "${upload.status}", tidak dapat dipublikasikan`);
  if (!upload.valid_row_count) throw badRequest('Tidak ada baris valid untuk dipublikasikan');

  const indicator = requireIndicator(upload.indicator_type);
  const published = await repo.publishIndicatorValues({
    indicator,
    year: upload.period,
    source: upload.source,
    rows: upload.validation.valid,
    uploadId: upload.id,
  });
  const updated = await repo.updateUpload(upload.id, { status: 'published', published_by: req.user.id, published_at: new Date().toISOString() });
  await repo.addAuditLog({
    user_id: req.user.id,
    action: 'upload.publish',
    resource: 'data_uploads',
    resource_id: upload.id,
    metadata: { indicator: indicator.id, year: upload.period, rows: published },
  });
  res.json({ data: uploadSummary(updated), published_rows: published });
}

// POST /api/admin/uploads/:id/reject
async function rejectUpload(req, res) {
  const upload = await repo.getUpload(req.params.id);
  if (!upload) throw notFound('Upload tidak ditemukan');
  if (upload.status !== 'pending') throw conflict(`Upload berstatus "${upload.status}"`);
  const updated = await repo.updateUpload(upload.id, { status: 'rejected' });
  await repo.addAuditLog({ user_id: req.user.id, action: 'upload.reject', resource: 'data_uploads', resource_id: upload.id });
  res.json({ data: uploadSummary(updated) });
}

// POST /api/admin/saw/calculate  { year, weights: {stunting, kemiskinan, pangan, air}, weight_version }
async function calculateSaw(req, res) {
  const body = req.body || {};
  const year = parseYear(body.year);
  const { year: resolvedYear, rows } = await repo.getIndicatorRows({ year });
  if (!rows.length) throw notFound('Tidak ada data indikator untuk tahun tersebut');

  const result = saw.calculate(rows, body.weights);
  const weightVersion = typeof body.weight_version === 'string' && body.weight_version.trim()
    ? body.weight_version.trim()
    : body.weights ? `custom-${Date.now()}` : saw.WEIGHT_VERSION_DEFAULT;

  const run = await repo.saveSawRun({
    period: resolvedYear,
    weights: result.weights,
    weight_version: weightVersion,
    created_by: req.user.id,
    ranking: result.ranking,
  });
  await repo.addAuditLog({
    user_id: req.user.id,
    action: 'saw.calculate',
    resource: 'saw_runs',
    resource_id: run.id,
    metadata: { year: resolvedYear, weights: result.weights, weight_version: weightVersion },
  });

  res.status(201).json({ run: { id: run.id, period: resolvedYear, weight_version: weightVersion, created_at: run.created_at }, ...result });
}

// GET /api/admin/audit-logs?limit=50
async function listAuditLogs(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  res.json({ data: await repo.listAuditLogs({ limit }) });
}

module.exports = { createUpload, listUploads, getUploadValidation, publishUpload, rejectUpload, calculateSaw, listAuditLogs };
