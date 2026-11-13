/**
 * Import GeoJSON kelurahan (dan opsional fasilitas) ke PostGIS.
 *
 * Default memakai file dummy. Saat GeoJSON resmi dari tim GIS tersedia:
 *   node scripts/import-geojson.js --areas path/ke/kelurahan.geojson \
 *        --name-field wadmkd --kec-field wadmkc --code-field kode_desa --year 2025
 *
 * Opsi:
 *   --areas <file>        GeoJSON poligon kelurahan (EPSG:4326)
 *   --facilities <file>   GeoJSON titik fasilitas (opsional)
 *   --name-field <prop>   properti nama kelurahan     (default: nama)
 *   --kec-field <prop>    properti nama kecamatan     (default: kecamatan)
 *   --code-field <prop>   properti kode wilayah resmi (default: kode_wilayah)
 *   --id-field <prop>     properti id publik, mis. KEL-01 (default: id; jika kosong dibuat otomatis)
 *   --year <tahun>        tahun data indikator di properti (default: 2025)
 *   --source <teks>       sumber dataset
 *   --dummy               tandai baris sebagai dummy
 *
 * Kolom indikator (stunting, kemiskinan, kerentananPangan, airBersih) yang ada
 * di properti ikut diimport ke tabel indicators.
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/config/db');
const { INDICATORS } = require('../src/config/indicators');
const { normalizeWilayah } = require('../src/utils/normalize');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

const DUMMY_DIR = path.join(__dirname, '..', 'data', 'dummy');
const args = parseArgs(process.argv.slice(2));
const usingDefaults = !args.areas;
const opts = {
  areas: args.areas || path.join(DUMMY_DIR, 'kelurahan_dummy.geojson'),
  facilities: args.facilities || (usingDefaults ? path.join(DUMMY_DIR, 'facilities_dummy.geojson') : null),
  nameField: args['name-field'] || 'nama',
  kecField: args['kec-field'] || 'kecamatan',
  codeField: args['code-field'] || 'kode_wilayah',
  idField: args['id-field'] || 'id',
  year: Number(args.year) || 2025,
  source: args.source || (usingDefaults ? 'Data contoh NutriMap (dummy)' : 'Tim GIS NutriMap'),
  dummy: Boolean(args.dummy) || usingDefaults,
};

async function importAreas(client, fc) {
  let n = 0;
  for (const [idx, f] of fc.features.entries()) {
    const p = f.properties || {};
    const nama = p[opts.nameField];
    const kec = p[opts.kecField];
    if (!nama || !kec || !f.geometry) {
      console.warn(`  lewati feature #${idx}: nama/kecamatan/geometri kosong`);
      continue;
    }
    const areaCode = p[opts.idField] || `KEL-${String(idx + 1).padStart(2, '0')}`;
    const { rows } = await client.query(
      `INSERT INTO administrative_areas (area_code, kode_wilayah, nama_kelurahan, nama_kecamatan, nama_normalized, geom, source, year, is_dummy)
       VALUES ($1, $2, $3, $4, $5, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)), 3)), $7, $8, $9)
       ON CONFLICT (area_code) DO UPDATE SET kode_wilayah = EXCLUDED.kode_wilayah, nama_kelurahan = EXCLUDED.nama_kelurahan,
         nama_kecamatan = EXCLUDED.nama_kecamatan, nama_normalized = EXCLUDED.nama_normalized, geom = EXCLUDED.geom,
         source = EXCLUDED.source, year = EXCLUDED.year, is_dummy = EXCLUDED.is_dummy, updated_at = now()
       RETURNING id`,
      [areaCode, p[opts.codeField] || null, nama, kec, normalizeWilayah(nama), JSON.stringify(f.geometry), opts.source, opts.year, opts.dummy]
    );
    const areaId = rows[0].id;
    for (const [id, def] of Object.entries(INDICATORS)) {
      const v = Number(p[def.key]);
      if (p[def.key] === undefined || p[def.key] === null || !Number.isFinite(v)) continue;
      await client.query(
        `INSERT INTO indicators (area_id, indicator_type, value, unit, year, source, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (area_id, indicator_type, year) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = now()`,
        [areaId, id, v, def.unit, opts.year, opts.source, opts.dummy ? 'dummy' : 'published']
      );
    }
    n++;
  }
  return n;
}

async function importFacilities(client, fc) {
  let n = 0;
  for (const f of fc.features) {
    const p = f.properties || {};
    if (!f.geometry || f.geometry.type !== 'Point') continue;
    await client.query(
      `INSERT INTO facilities (facility_code, name, facility_type, address, area_id, geom, source, verification_status, year)
       SELECT $1, $2, $3, $4, (SELECT a.id FROM administrative_areas a WHERE ST_Contains(a.geom, g.pt) LIMIT 1), g.pt, $6, $7, $8
       FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($5), 4326) AS pt) g
       ON CONFLICT (facility_code) DO UPDATE SET name = EXCLUDED.name, facility_type = EXCLUDED.facility_type,
         address = EXCLUDED.address, area_id = EXCLUDED.area_id, geom = EXCLUDED.geom, source = EXCLUDED.source,
         verification_status = EXCLUDED.verification_status, year = EXCLUDED.year, updated_at = now()`,
      [p.id || null, p.name, p.facility_type, p.address || null, JSON.stringify(f.geometry), p.source || opts.source,
        p.verification_status || (opts.dummy ? 'dummy' : 'unverified'), p.year || opts.year]
    );
    n++;
  }
  return n;
}

async function main() {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const areas = JSON.parse(fs.readFileSync(opts.areas, 'utf8'));
    console.log(`Import wilayah dari ${opts.areas}`);
    console.log(`  ${await importAreas(client, areas)} kelurahan`);
    if (opts.facilities) {
      const fac = JSON.parse(fs.readFileSync(opts.facilities, 'utf8'));
      console.log(`Import fasilitas dari ${opts.facilities}`);
      console.log(`  ${await importFacilities(client, fac)} titik`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await db.getPool().end();
  }
}

main().catch((err) => {
  console.error('Import gagal:', err.message);
  process.exit(1);
});
