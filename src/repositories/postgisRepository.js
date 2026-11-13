/**
 * Repository mode POSTGIS. Interface sama dengan dummyRepository sehingga
 * controller tidak perlu tahu sumber datanya. Schema: db/schema.sql.
 */
const db = require('../config/db');
const { INDICATORS } = require('../config/indicators');

// Pivot indikator per area -> kolom bernama sesuai properti frontend.
// Jika year diberikan, ambil tepat tahun tersebut; jika tidak, ambil tahun terbaru per (area_id, indicator_type)
// sehingga indikator lintas periode (mis. Stunting 2024 + FSVA 2025) tetap tergabung utuh.
const PIVOT_COLUMNS = Object.entries(INDICATORS)
  .map(([id, def]) => `MAX(i.value) FILTER (WHERE i.indicator_type = '${id}')::float AS "${def.key}"`)
  .join(',\n      ');

function areaSelectFor(year) {
  const joinSource = year
    ? 'SELECT area_id, indicator_type, value, year FROM indicators WHERE year = $1'
    : `SELECT DISTINCT ON (area_id, indicator_type) area_id, indicator_type, value, year
       FROM indicators
       ORDER BY area_id, indicator_type, year DESC`;
  return `
    SELECT a.id AS db_id, a.area_code AS id, a.kode_wilayah, a.nama_kelurahan AS nama, a.nama_kecamatan AS kecamatan,
           ST_Y(ST_PointOnSurface(a.geom)) AS lat, ST_X(ST_PointOnSurface(a.geom)) AS lng, a.is_dummy,
           ${PIVOT_COLUMNS}
    FROM administrative_areas a
    LEFT JOIN (${joinSource}) i ON i.area_id = a.id
  `;
}

async function resolveYear(year) {
  if (year) return year;
  const { rows } = await db.query('SELECT MAX(year) AS y FROM indicators');
  return rows[0].y;
}

function rowToProperties(r, year) {
  const props = { id: r.id, kode_wilayah: r.kode_wilayah, nama: r.nama, kecamatan: r.kecamatan };
  for (const def of Object.values(INDICATORS)) props[def.key] = r[def.key] ?? null;
  return { ...props, lat: Number(r.lat), lng: Number(r.lng), year, is_dummy: r.is_dummy };
}

module.exports = {
  kind: 'postgis',

  async ping() {
    const { rows } = await db.query('SELECT PostGIS_Version() AS v');
    return { ok: true, kind: 'postgis', postgis: rows[0].v };
  },

  async listAreaSummaries() {
    const { rows } = await db.query(
      'SELECT area_code AS id, kode_wilayah, nama_kelurahan AS nama, nama_kecamatan AS kecamatan FROM administrative_areas ORDER BY area_code'
    );
    return rows;
  },

  async getAvailableYears() {
    const { rows } = await db.query('SELECT DISTINCT year FROM indicators ORDER BY year DESC');
    return rows.map((r) => r.year);
  },

  async getAreasGeoJSON({ kecamatan, year } = {}) {
    const y = await resolveYear(year);
    const params = year ? [year] : [];
    let where = '';
    if (kecamatan) {
      params.push(kecamatan);
      where = `WHERE lower(a.nama_kecamatan) = lower($${params.length})`;
    }
    const sql = `
      WITH base AS (${areaSelectFor(year)} ${where} GROUP BY a.id)
      SELECT b.*, ST_AsGeoJSON(a.geom, 6)::json AS geometry
      FROM base b JOIN administrative_areas a ON a.id = b.db_id
      ORDER BY b.id`;
    const { rows } = await db.query(sql, params);
    return {
      year: y,
      featureCollection: {
        type: 'FeatureCollection',
        features: rows.map((r) => ({ type: 'Feature', id: r.id, properties: rowToProperties(r, y), geometry: r.geometry })),
      },
    };
  },

  async getAreaById(id, { year } = {}) {
    const y = await resolveYear(year);
    const params = year ? [year, id] : [id];
    const idParam = `$${params.length}`;
    const sql = `
      WITH base AS (${areaSelectFor(year)} WHERE a.area_code = ${idParam} OR a.kode_wilayah = ${idParam} GROUP BY a.id)
      SELECT b.*, ST_AsGeoJSON(a.geom, 6)::json AS geometry
      FROM base b JOIN administrative_areas a ON a.id = b.db_id`;
    const { rows } = await db.query(sql, params);
    if (!rows.length) return null;
    return { type: 'Feature', id: rows[0].id, properties: rowToProperties(rows[0], y), geometry: rows[0].geometry };
  },

  async getIndicatorRows({ year } = {}) {
    const y = await resolveYear(year);
    const params = year ? [year] : [];
    const { rows } = await db.query(`${areaSelectFor(year)} GROUP BY a.id ORDER BY a.area_code`, params);
    return { year: y, rows: rows.map((r) => rowToProperties(r, y)) };
  },

  async getFacilities({ type } = {}) {
    const params = [];
    let where = '';
    if (type) {
      params.push(type);
      where = 'WHERE f.facility_type = $1';
    }
    const { rows } = await db.query(
      `SELECT COALESCE(f.facility_code, f.id::text) AS id, f.name, f.facility_type, f.address, f.source,
              f.verification_status, f.year, a.nama_kelurahan AS kelurahan, a.nama_kecamatan AS kecamatan,
              ST_AsGeoJSON(f.geom, 6)::json AS geometry
       FROM facilities f LEFT JOIN administrative_areas a ON a.id = f.area_id ${where} ORDER BY f.id`,
      params
    );
    return {
      type: 'FeatureCollection',
      features: rows.map(({ geometry, ...p }) => ({ type: 'Feature', id: p.id, properties: p, geometry })),
    };
  },

  async getFacilityTypes() {
    const { rows } = await db.query('SELECT DISTINCT facility_type FROM facilities ORDER BY 1');
    return rows.map((r) => r.facility_type);
  },

  async getDatasetMeta(indicatorId, year) {
    if (year) {
      const { rows } = await db.query(
        `SELECT year, MAX(source) AS source, MAX(updated_at) AS updated_at, MAX(validation_status) AS status_validasi
         FROM indicators WHERE indicator_type = $1 AND year = $2 GROUP BY year`,
        [indicatorId, year]
      );
      return rows[0] || null;
    }
    const { rows } = await db.query(
      `SELECT year, MAX(source) AS source, MAX(updated_at) AS updated_at, MAX(validation_status) AS status_validasi
       FROM indicators WHERE indicator_type = $1
       GROUP BY year ORDER BY year DESC LIMIT 1`,
      [indicatorId]
    );
    return rows[0] || null;
  },

  async listDatasetMeta() {
    const { rows } = await db.query(
      `SELECT indicator_type AS indicator, year, MAX(source) AS source, MAX(updated_at) AS updated_at,
              MAX(validation_status) AS status_validasi, COUNT(*)::int AS area_count
       FROM indicators GROUP BY indicator_type, year ORDER BY year DESC, indicator_type`
    );
    return rows;
  },

  async publishIndicatorValues({ indicator, year, source, rows, uploadId }) {
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        await client.query(
          `INSERT INTO indicators (area_id, indicator_type, value, unit, year, source, validation_status, upload_id)
           SELECT a.id, $2, $3, $4, $5, $6, 'published', $7 FROM administrative_areas a WHERE a.area_code = $1
           ON CONFLICT (area_id, indicator_type, year)
           DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, source = EXCLUDED.source,
                         validation_status = 'published', upload_id = EXCLUDED.upload_id, updated_at = now()`,
          [r.area_id, indicator.id, r.value, indicator.unit, year, source, uploadId || null]
        );
      }
      await client.query('COMMIT');
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async findUserByEmail(email) {
    const { rows } = await db.query('SELECT * FROM users WHERE email = lower($1)', [email]);
    return rows[0] || null;
  },
  async findUserById(id) {
    const { rows } = await db.query(
      `SELECT id, email, name, role, agency, is_active, last_login_at, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },
  async findUserAuthById(id) {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async listUsers() {
    const { rows } = await db.query(
      `SELECT id, email, name, role, agency, is_active, last_login_at, created_at, updated_at
       FROM users ORDER BY id ASC`
    );
    return rows;
  },
  async createUser({ email, name, password_hash, role, agency = 'Pemerintah Kota Bogor', is_active = true }) {
    const { rows } = await db.query(
      `INSERT INTO users (email, name, password_hash, role, agency, is_active)
       VALUES (lower($1), $2, $3, $4, $5, $6)
       RETURNING id, email, name, role, agency, is_active, last_login_at, created_at, updated_at`,
      [email, name, password_hash, role, agency, is_active]
    );
    return rows[0];
  },
  async updateUser(id, patch) {
    const allowed = ['email', 'name', 'password_hash', 'role', 'agency', 'is_active', 'last_login_at'];
    const cols = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!cols.length) return this.findUserById(id);
    const sets = cols.map((c, i) => (c === 'email' ? `email = lower($${i + 2})` : `${c} = $${i + 2}`)).join(', ');
    const { rows } = await db.query(
      `UPDATE users SET ${sets}, updated_at = now() WHERE id = $1
       RETURNING id, email, name, role, agency, is_active, last_login_at, created_at, updated_at`,
      [id, ...cols.map((c) => patch[c])]
    );
    return rows[0] || null;
  },
  async deleteUser(id) {
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE data_uploads SET uploaded_by = NULL WHERE uploaded_by = $1', [id]);
      await client.query('UPDATE data_uploads SET published_by = NULL WHERE published_by = $1', [id]);
      await client.query('UPDATE saw_runs SET created_by = NULL WHERE created_by = $1', [id]);
      await client.query('UPDATE audit_logs SET user_id = NULL WHERE user_id = $1', [id]);
      const { rows } = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
      await client.query('COMMIT');
      return rows.length > 0;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async createUpload(r) {
    const { rows } = await db.query(
      `INSERT INTO data_uploads (id, filename, indicator_type, source, period, uploaded_by, valid_row_count,
                                 invalid_row_count, unmatched_row_count, status, validation)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9) RETURNING *`,
      [r.filename, r.indicator_type, r.source, r.period, r.uploaded_by, r.valid_row_count, r.invalid_row_count, r.unmatched_row_count, r.validation]
    );
    return rows[0];
  },
  async getUpload(id) {
    const { rows } = await db.query('SELECT * FROM data_uploads WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async listUploads() {
    const { rows } = await db.query(
      `SELECT id, filename, indicator_type, source, period, uploaded_by, valid_row_count, invalid_row_count,
              unmatched_row_count, status, published_at, created_at FROM data_uploads ORDER BY created_at DESC LIMIT 200`
    );
    return rows;
  },
  async updateUpload(id, patch) {
    const cols = Object.keys(patch);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const { rows } = await db.query(
      `UPDATE data_uploads SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...cols.map((c) => patch[c])]
    );
    return rows[0] || null;
  },

  async saveSawRun({ period, weights, weight_version, created_by, ranking }) {
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO saw_runs (period, weights, weight_version, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
        [period, weights, weight_version, created_by]
      );
      const run = rows[0];
      for (const r of ranking) {
        await client.query(
          `INSERT INTO saw_results (run_id, area_id, period, stunting_score, welfare_score, food_score, water_score,
                                    condition_score, intervention_score, rank, priority_level, weight_version)
           SELECT $1, a.id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12 FROM administrative_areas a WHERE a.area_code = $2`,
          [run.id, r.area_id, period, r.normalized.stunting, r.normalized.kemiskinan, r.normalized.pangan, r.normalized.air,
            r.condition_score, r.intervention_score, r.rank, r.priority_level, weight_version]
        );
      }
      await client.query('COMMIT');
      return run;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  async getLatestSawRun(period) {
    const { rows } = await db.query(
      `SELECT * FROM saw_runs ${period ? 'WHERE period = $1' : ''} ORDER BY created_at DESC LIMIT 1`,
      period ? [period] : []
    );
    return rows[0] || null;
  },

  async addAuditLog({ user_id, action, resource, resource_id, metadata }) {
    await db.query('INSERT INTO audit_logs (user_id, action, resource, resource_id, metadata) VALUES ($1, $2, $3, $4, $5)', [
      user_id || null, action, resource, resource_id ? String(resource_id) : null, metadata || null,
    ]);
  },
  async listAuditLogs({ limit = 100 } = {}) {
    const { rows } = await db.query(
      `SELECT l.*, u.email AS user_email, u.name AS user_name, u.role AS user_role
       FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC LIMIT $1`,
      [limit]
    );
    return rows;
  },
};
