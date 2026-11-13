const bcrypt = require('bcryptjs');
const repo = require('../repositories');
const saw = require('../services/sawService');
const { validateIndicatorCsv } = require('../services/csvValidationService');
const { DEFAULT_SOURCE } = require('../config/indicators');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { parseYear, requireIndicator } = require('../utils/validate');

const PREVIEW_LIMIT = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = ['admin', 'superadmin'];

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

// GET /api/admin/overview
async function getOverview(req, res) {
  const [areas, facilitiesFC, years, datasetMeta, uploads, latestSaw] = await Promise.all([
    repo.listAreaSummaries(),
    repo.getFacilities({}),
    repo.getAvailableYears(),
    repo.listDatasetMeta(),
    repo.listUploads(),
    repo.getLatestSawRun(),
  ]);

  const uploadsSummary = {
    total: uploads.length,
    pending: uploads.filter((u) => u.status === 'pending').length,
    published: uploads.filter((u) => u.status === 'published').length,
    rejected: uploads.filter((u) => u.status === 'rejected').length,
    latest_upload: uploads[0] ? uploadSummary(uploads[0]) : null,
  };

  const payload = {
    role_scope: req.user.role,
    data_source: repo.kind,
    areas_count: areas.length,
    facilities_count: facilitiesFC?.features?.length || 0,
    available_years: years,
    dataset_meta: datasetMeta,
    uploads_summary: uploadsSummary,
    latest_saw_run: latestSaw
      ? {
          id: latestSaw.id,
          period: latestSaw.period,
          weight_version: latestSaw.weight_version,
          weights: latestSaw.weights,
          created_at: latestSaw.created_at,
        }
      : null,
  };

  if (req.user.role === 'superadmin') {
    const [allUsers, logs] = await Promise.all([repo.listUsers(), repo.listAuditLogs({ limit: 8 })]);
    payload.users_summary = {
      total: allUsers.length,
      active: allUsers.filter((u) => u.is_active !== false).length,
      inactive: allUsers.filter((u) => u.is_active === false).length,
      admins: allUsers.filter((u) => u.role === 'admin').length,
      superadmins: allUsers.filter((u) => u.role === 'superadmin').length,
    };
    payload.recent_audit_logs = logs;
  }

  res.json({ data: payload });
}

// POST /api/admin/indicators  { area_id, indicator_type, year, value, source }
async function updateManualIndicator(req, res) {
  const { area_id: areaId, indicator_type: indicatorType, year: rawYear, value: rawValue, source: rawSource } = req.body || {};
  if (!areaId || typeof areaId !== 'string') throw badRequest('Parameter "area_id" wajib diisi');
  const indicator = requireIndicator(indicatorType);
  const year = parseYear(rawYear, { required: true });
  const numericVal = Number(rawValue);
  if (!Number.isFinite(numericVal) || numericVal < indicator.min || numericVal > indicator.max) {
    throw badRequest(`Nilai indikator "${indicator.id}" harus berada pada rentang ${indicator.min} - ${indicator.max}`);
  }
  const area = await repo.getAreaById(areaId.trim());
  if (!area) throw notFound(`Kelurahan "${areaId}" tidak ditemukan`);

  const source = typeof rawSource === 'string' && rawSource.trim() ? rawSource.trim() : DEFAULT_SOURCE;
  const resolvedCode = area.properties.id;
  await repo.publishIndicatorValues({
    indicator,
    year,
    source,
    rows: [{ area_id: resolvedCode, value: numericVal }],
  });
  await repo.addAuditLog({
    user_id: req.user.id,
    action: 'indicator.manual_update',
    resource: 'indicators',
    resource_id: `${resolvedCode}:${indicator.id}:${year}`,
    metadata: { area_id: resolvedCode, area_name: area.properties.nama, indicator: indicator.id, year, value: numericVal, source },
  });

  res.status(200).json({
    ok: true,
    data: {
      area_id: resolvedCode,
      nama: area.properties.nama,
      kecamatan: area.properties.kecamatan,
      indicator_type: indicator.id,
      year,
      value: numericVal,
      source,
    },
  });
}

// ---- Superadmin: Manajemen Akun Supabase ----

// GET /api/admin/users
async function listUsers(_req, res) {
  const rows = await repo.listUsers();
  res.json({ data: rows });
}

// POST /api/admin/users  { email, name, password, role, agency, is_active }
async function createUser(req, res) {
  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : 'admin';
  const agency = typeof body.agency === 'string' && body.agency.trim() ? body.agency.trim() : 'Pemerintah Kota Bogor';
  const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

  if (!email || !EMAIL_RE.test(email)) throw badRequest('Alamat email tidak valid');
  if (!name || name.length < 2) throw badRequest('Nama lengkap wajib diisi (minimal 2 karakter)');
  if (!password || password.length < 6) throw badRequest('Kata sandi wajib diisi minimal 6 karakter');
  if (!ALLOWED_ROLES.includes(role)) throw badRequest('Role harus "admin" atau "superadmin"');

  const existing = await repo.findUserByEmail(email);
  if (existing) throw conflict(`Email "${email}" sudah terdaftar di sistem`);

  const password_hash = await bcrypt.hash(password, 10);
  const created = await repo.createUser({ email, name, password_hash, role, agency, is_active: isActive });
  await repo.addAuditLog({
    user_id: req.user.id,
    action: 'user.create',
    resource: 'users',
    resource_id: created.id,
    metadata: { email: created.email, role: created.role, agency: created.agency, is_active: created.is_active },
  });

  res.status(201).json({ data: created });
}

// PATCH /api/admin/users/:id
async function updateUser(req, res) {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) throw badRequest('ID akun tidak valid');

  const currentTarget = await repo.findUserById(targetId);
  if (!currentTarget) throw notFound('Akun pengguna tidak ditemukan');

  const body = req.body || {};
  const patch = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length < 2) {
      throw badRequest('Nama lengkap minimal 2 karakter');
    }
    patch.name = body.name.trim();
  }
  if (body.email !== undefined) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !EMAIL_RE.test(email)) throw badRequest('Alamat email tidak valid');
    if (email !== currentTarget.email.toLowerCase()) {
      const dup = await repo.findUserByEmail(email);
      if (dup && dup.id !== targetId) throw conflict(`Email "${email}" sudah digunakan akun lain`);
    }
    patch.email = email;
  }
  if (body.role !== undefined) {
    const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
    if (!ALLOWED_ROLES.includes(role)) throw badRequest('Role harus "admin" atau "superadmin"');
    if (targetId === Number(req.user.id) && role !== 'superadmin') {
      throw badRequest('Tidak dapat menurunkan role akun yang sedang login');
    }
    patch.role = role;
  }
  if (body.agency !== undefined) {
    patch.agency = typeof body.agency === 'string' && body.agency.trim() ? body.agency.trim() : 'Pemerintah Kota Bogor';
  }
  if (body.is_active !== undefined) {
    const isActive = Boolean(body.is_active);
    if (targetId === Number(req.user.id) && !isActive) {
      throw badRequest('Tidak dapat menonaktifkan akun yang sedang login');
    }
    patch.is_active = isActive;
  }
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 6) throw badRequest('Kata sandi baru minimal 6 karakter');
    patch.password_hash = await bcrypt.hash(body.password, 10);
  }

  const updated = await repo.updateUser(targetId, patch);
  await repo.addAuditLog({
    user_id: req.user.id,
    action: 'user.update',
    resource: 'users',
    resource_id: targetId,
    metadata: {
      email: updated.email,
      role: updated.role,
      is_active: updated.is_active,
      password_changed: Boolean(patch.password_hash),
    },
  });

  res.json({ data: updated });
}

// DELETE /api/admin/users/:id
async function deleteUser(req, res) {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) throw badRequest('ID akun tidak valid');
  if (targetId === Number(req.user.id)) throw badRequest('Tidak dapat menghapus akun Anda sendiri yang sedang login');

  const existing = await repo.findUserById(targetId);
  if (!existing) throw notFound('Akun pengguna tidak ditemukan');

  await repo.deleteUser(targetId);
  await repo.addAuditLog({
    user_id: req.user.id,
    action: 'user.delete',
    resource: 'users',
    resource_id: targetId,
    metadata: { email: existing.email, role: existing.role },
  });

  res.json({ ok: true, deleted_id: targetId });
}

module.exports = {
  createUpload,
  listUploads,
  getUploadValidation,
  publishUpload,
  rejectUpload,
  calculateSaw,
  listAuditLogs,
  getOverview,
  updateManualIndicator,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
};
