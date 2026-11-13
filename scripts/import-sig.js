/**
 * Import data SIG resmi hasil olahan tim GIS (Nabil) ke PostGIS.
 *
 * Sumber input di data/sig/:
 *   - nutrimap_kelurahan.geojson          (68 MultiPolygon batas kelurahan + stunting_pct + ikp)
 *   - FSVA_Bogor_68_Kelurahan.csv         (kesejahteraan rendah & rumah tangga tanpa air bersih, 2025)
 *   - Stunting_Kota_Bogor_68_Kelurahan.csv (prevalensi stunting balita, 2024)
 *
 * Jalankan: npm run db:import:sig
 */
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('../src/config/db');
const { INDICATORS } = require('../src/config/indicators');
const { normalizeWilayah } = require('../src/utils/normalize');

const SIG_DIR = path.join(__dirname, '..', 'data', 'sig');
const SEED_PATH = path.join(__dirname, '..', 'data', 'dummy', 'kelurahan_seed.json');

const round2 = (v) => Number(Number(v).toFixed(2));

function readCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim() }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function formatKecamatan(raw) {
  return String(raw || '')
    .replace(/^\s*(kecamatan|kec\.?)\s+/i, '')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function formatKelurahan(raw) {
  return String(raw || '')
    .replace(/^\s*(kelurahan|kel\.?)\s+/i, '')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

async function main() {
  const geoPath = path.join(SIG_DIR, 'nutrimap_kelurahan.geojson');
  const fsvaPath = path.join(SIG_DIR, 'FSVA_Bogor_68_Kelurahan.csv');
  const stuntPath = path.join(SIG_DIR, 'Stunting_Kota_Bogor_68_Kelurahan.csv');

  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
  const [fsvaRows, stuntRows] = await Promise.all([readCsvFile(fsvaPath), readCsvFile(stuntPath)]);
  const seed = fs.existsSync(SEED_PATH) ? JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) : [];

  const fsvaByCode = new Map(fsvaRows.map((r) => [r.kode_kelurahan.trim(), r]));
  const stuntByCode = new Map(stuntRows.map((r) => [r.kode_kelurahan.trim(), r]));
  const seedByNorm = new Map(seed.map((s) => [normalizeWilayah(s.nama), s]));

  const client = await db.getPool().connect();
  let importedAreas = 0;
  let importedIndicators = 0;
  let removedDummyRows = 0;

  try {
    await client.query('BEGIN');

    for (const [idx, feature] of geo.features.entries()) {
      const p = feature.properties || {};
      const kodeWilayah = String(p.kode_kelurahan || '').trim();
      const fsva = fsvaByCode.get(kodeWilayah);
      const stunt = stuntByCode.get(kodeWilayah);

      if (!kodeWilayah || !feature.geometry || !fsva || !stunt) {
        throw new Error(`Data tidak lengkap pada feature #${idx} (${p.kelurahan || kodeWilayah})`);
      }

      const normKey = normalizeWilayah(p.kelurahan);
      const seedMatch = seedByNorm.get(normKey);
      const areaCode = seedMatch?.id || `KEL-${String(idx + 1).padStart(2, '0')}`;
      const namaKel = (fsva.nama_fsva || stunt.label_grafik || formatKelurahan(p.kelurahan)).trim();
      const namaKec = formatKecamatan(fsva.kecamatan || p.kecamatan);

      const { rows } = await client.query(
        `INSERT INTO administrative_areas
           (area_code, kode_wilayah, nama_kelurahan, nama_kecamatan, nama_normalized, geom, source, year, is_dummy)
         VALUES
           ($1, $2, $3, $4, $5, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)), 3)), $7, $8, FALSE)
         ON CONFLICT (area_code) DO UPDATE SET
           kode_wilayah = EXCLUDED.kode_wilayah,
           nama_kelurahan = EXCLUDED.nama_kelurahan,
           nama_kecamatan = EXCLUDED.nama_kecamatan,
           nama_normalized = EXCLUDED.nama_normalized,
           geom = EXCLUDED.geom,
           source = EXCLUDED.source,
           year = EXCLUDED.year,
           is_dummy = FALSE,
           updated_at = now()
         RETURNING id`,
        [
          areaCode,
          kodeWilayah,
          namaKel,
          namaKec,
          normalizeWilayah(namaKel),
          JSON.stringify(feature.geometry),
          p.sumber_batas || 'Bappeda Kota Bogor, 2014',
          Number(p.tahun_laporan_fsva) || 2025,
        ]
      );
      const areaId = rows[0].id;
      importedAreas++;

      const delRes = await client.query(
        `DELETE FROM indicators WHERE area_id = $1 AND validation_status = 'dummy'`,
        [areaId]
      );
      removedDummyRows += delRes.rowCount;

      const stuntingVal = round2(stunt.stunting_pct ?? p.stunting_pct);
      const kemiskinanVal = round2((Number(fsva.jml_kesejahteraan_rendah_lamp1) / Number(fsva.penduduk_lamp2)) * 100);
      const kerentananVal = round2(100 - Number(p.ikp));

      let airBersihVal;
      if (fsva.cek_air === 'dalam_rentang' && fsva.persen_tanpa_air_hitung !== '') {
        airBersihVal = round2(100 - Number(fsva.persen_tanpa_air_hitung));
      } else if (fsva.cek_air === 'negatif') {
        airBersihVal = 100;
      } else if (fsva.cek_air === 'melebihi_total_rt') {
        airBersihVal = 0;
      } else {
        throw new Error(`Status cek_air tidak dikenali untuk ${namaKel}: ${fsva.cek_air}`);
      }

      const fsvaYear = Number(fsva.tahun_laporan || p.tahun_laporan_fsva) || 2025;
      const stuntYear = Number(stunt.tahun_paparan || p.tahun_paparan_stunting) || 2024;
      const fsvaSrc = fsva.sumber || p.sumber_fsva || 'FSVA Kota Bogor 2025';
      const stuntSrc = stunt.sumber || p.sumber_stunting || 'Aksi Konvergensi Stunting 2024';

      const records = [
        { type: 'stunting', value: stuntingVal, year: stuntYear, source: stuntSrc },
        { type: 'kemiskinan', value: kemiskinanVal, year: fsvaYear, source: `${fsvaSrc} (persentase kesejahteraan rendah)` },
        { type: 'pangan', value: kerentananVal, year: fsvaYear, source: `${fsvaSrc} (skor kerentanan = 100 - IKP)` },
        { type: 'air', value: airBersihVal, year: fsvaYear, source: `${fsvaSrc} (100% - RT tanpa air bersih)` },
      ];

      for (const rec of records) {
        if (!Number.isFinite(rec.value)) {
          throw new Error(`Nilai tidak valid untuk ${namaKel} (${rec.type}): ${rec.value}`);
        }
        await client.query(
          `INSERT INTO indicators (area_id, indicator_type, value, unit, year, source, validation_status)
           VALUES ($1, $2, $3, $4, $5, $6, 'published')
           ON CONFLICT (area_id, indicator_type, year) DO UPDATE SET
             value = EXCLUDED.value,
             unit = EXCLUDED.unit,
             source = EXCLUDED.source,
             validation_status = 'published',
             updated_at = now()`,
          [areaId, rec.type, rec.value, INDICATORS[rec.type].unit, rec.year, rec.source]
        );
        importedIndicators++;
      }
    }

    await client.query('COMMIT');
    console.log(`Import SIG selesai: ${importedAreas} kelurahan resmi, ${importedIndicators} baris indikator, ${removedDummyRows} baris indikator dummy dihapus.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await db.getPool().end();
  }
}

main().catch((err) => {
  console.error('Import SIG gagal:', err.message);
  process.exit(1);
});
