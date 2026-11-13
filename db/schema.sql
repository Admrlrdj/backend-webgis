-- NutriMap Bogor - schema PostgreSQL + PostGIS
-- Jalankan lewat: npm run db:init  (idempotent, aman dijalankan ulang)

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS administrative_areas (
  id              SERIAL PRIMARY KEY,
  area_code       TEXT NOT NULL UNIQUE,          -- id publik yang dipakai frontend, mis. KEL-01
  kode_wilayah    TEXT UNIQUE,                   -- kode resmi (Kemendagri/BPS) jika tersedia
  nama_kelurahan  TEXT NOT NULL,
  nama_kecamatan  TEXT NOT NULL,
  nama_normalized TEXT NOT NULL,                 -- hasil normalizeWilayah(), dipakai saat join CSV
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  source          TEXT,
  year            INTEGER,
  is_dummy        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT administrative_areas_geom_valid CHECK (ST_IsValid(geom))
);
CREATE INDEX IF NOT EXISTS administrative_areas_geom_gix ON administrative_areas USING GIST (geom);
CREATE INDEX IF NOT EXISTS administrative_areas_kec_idx ON administrative_areas (nama_kecamatan);
CREATE INDEX IF NOT EXISTS administrative_areas_norm_idx ON administrative_areas (nama_normalized);

CREATE TABLE IF NOT EXISTS indicators (
  id                SERIAL PRIMARY KEY,
  area_id           INTEGER NOT NULL REFERENCES administrative_areas(id) ON DELETE CASCADE,
  indicator_type    TEXT NOT NULL CHECK (indicator_type IN ('stunting', 'kemiskinan', 'pangan', 'air')),
  value             NUMERIC(10, 3) NOT NULL,
  unit              TEXT,
  year              INTEGER NOT NULL,
  source            TEXT,
  validation_status TEXT NOT NULL DEFAULT 'published',
  upload_id         UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (area_id, indicator_type, year)
);
CREATE INDEX IF NOT EXISTS indicators_type_year_idx ON indicators (indicator_type, year);

CREATE TABLE IF NOT EXISTS facilities (
  id                  SERIAL PRIMARY KEY,
  facility_code       TEXT UNIQUE,
  name                TEXT NOT NULL,
  facility_type       TEXT NOT NULL CHECK (facility_type IN ('market', 'water_facility', 'puskesmas', 'posyandu', 'agricultural_area')),
  address             TEXT,
  area_id             INTEGER REFERENCES administrative_areas(id) ON DELETE SET NULL,
  geom                geometry(Point, 4326) NOT NULL,
  source              TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  year                INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_geom_gix ON facilities USING GIST (geom);
CREATE INDEX IF NOT EXISTS facilities_type_idx ON facilities (facility_type);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'superadmin')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_uploads (
  id                UUID PRIMARY KEY,
  filename          TEXT NOT NULL,
  indicator_type    TEXT NOT NULL,
  source            TEXT,
  period            INTEGER NOT NULL,
  uploaded_by       INTEGER REFERENCES users(id),
  valid_row_count   INTEGER NOT NULL DEFAULT 0,
  invalid_row_count INTEGER NOT NULL DEFAULT 0,
  unmatched_row_count INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  validation        JSONB,                       -- hasil validasi lengkap untuk preview
  published_by      INTEGER REFERENCES users(id),
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saw_runs (
  id             SERIAL PRIMARY KEY,
  period         INTEGER NOT NULL,
  weights        JSONB NOT NULL,
  weight_version TEXT NOT NULL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saw_results (
  id                 SERIAL PRIMARY KEY,
  run_id             INTEGER NOT NULL REFERENCES saw_runs(id) ON DELETE CASCADE,
  area_id            INTEGER NOT NULL REFERENCES administrative_areas(id) ON DELETE CASCADE,
  period             INTEGER NOT NULL,
  stunting_score     NUMERIC(8, 4),
  welfare_score      NUMERIC(8, 4),
  food_score         NUMERIC(8, 4),
  water_score        NUMERIC(8, 4),
  condition_score    NUMERIC(8, 4) NOT NULL,
  intervention_score NUMERIC(8, 4) NOT NULL,
  rank               INTEGER NOT NULL,
  priority_level     TEXT NOT NULL,
  weight_version     TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saw_results_run_idx ON saw_results (run_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  resource    TEXT NOT NULL,
  resource_id TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
