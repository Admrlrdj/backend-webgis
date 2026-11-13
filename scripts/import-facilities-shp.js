/**
 * Konversi shapefile titik fasilitas (Kesehatan, Rumah Sakit, Niaga) dari Satu Peta RBI 1:25.000
 * menjadi GeoJSON terstruktur dan import ke tabel PostGIS `facilities`.
 *
 * Sumber default:
 *   ../frontend-webgis/sumber data/01_Bahan_Mentah_Satu_Peta/{KESEHATAN,RUMAHSAKIT,NIAGA}_PT_25K.{shp,dbf}
 * Output GeoJSON:
 *   data/sig/facilities_satupeta.geojson
 *
 * Jalankan: npm run db:import:facilities
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/config/db');

const DEFAULT_SHP_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'frontend-webgis',
  'sumber data',
  '01_Bahan_Mentah_Satu_Peta'
);
const SHP_DIR = process.env.SHP_DIR ? path.resolve(process.env.SHP_DIR) : DEFAULT_SHP_DIR;
const OUT_GEOJSON = path.join(__dirname, '..', 'data', 'sig', 'facilities_satupeta.geojson');

const FACILITY_LAYERS = [
  {
    layer: 'KESEHATAN_PT_25K',
    facilityType: 'puskesmas',
    fallbackPrefix: 'Fasilitas Kesehatan RBI',
  },
  {
    layer: 'RUMAHSAKIT_PT_25K',
    facilityType: 'puskesmas',
    fallbackPrefix: 'Rumah Sakit RBI',
  },
  {
    layer: 'NIAGA_PT_25K',
    facilityType: 'market',
    fallbackPrefix: 'Sentra Niaga / Pasar RBI',
  },
];

function readPointShapefile(shpPath) {
  const buf = fs.readFileSync(shpPath);
  const fileLengthBytes = buf.readInt32BE(24) * 2;
  const points = [];
  let offset = 100;

  while (offset + 8 <= fileLengthBytes && offset + 8 <= buf.length) {
    const contentLengthWords = buf.readInt32BE(offset + 4);
    const contentOffset = offset + 8;
    const contentBytes = contentLengthWords * 2;
    const shapeType = buf.readInt32LE(contentOffset);

    if (shapeType === 0) {
      points.push(null);
    } else if (shapeType === 1 || shapeType === 11 || shapeType === 21) {
      const lng = buf.readDoubleLE(contentOffset + 4);
      const lat = buf.readDoubleLE(contentOffset + 12);
      points.push({ lng: Number(lng.toFixed(7)), lat: Number(lat.toFixed(7)) });
    } else {
      throw new Error(`Tipe geometri shapefile tidak didukung (${shapeType}) di ${path.basename(shpPath)}`);
    }

    offset = contentOffset + contentBytes;
  }

  return points;
}

function readDbfRecords(dbfPath) {
  const buf = fs.readFileSync(dbfPath);
  const recordCount = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);

  const fields = [];
  let pos = 32;
  while (pos < headerLength - 1 && buf[pos] !== 0x0d) {
    const name = buf.subarray(pos, pos + 11).toString('ascii').replace(/\0.*$/, '').trim();
    const type = String.fromCharCode(buf[pos + 11]);
    const length = buf[pos + 16];
    fields.push({ name, type, length });
    pos += 32;
  }

  const records = [];
  for (let i = 0; i < recordCount; i++) {
    const recStart = headerLength + i * recordLength;
    if (recStart + recordLength > buf.length) break;
    const deleted = buf[recStart] === 0x2a;
    let fieldOffset = recStart + 1;
    const row = { _deleted: deleted };

    for (const f of fields) {
      const raw = buf.subarray(fieldOffset, fieldOffset + f.length).toString('utf8').trim();
      row[f.name] = raw;
      fieldOffset += f.length;
    }
    if (!deleted) {
      records.push(row);
    }
  }

  return records;
}

function loadLayerFeatures(config, startSeq) {
  const shpPath = path.join(SHP_DIR, `${config.layer}.shp`);
  const dbfPath = path.join(SHP_DIR, `${config.layer}.dbf`);

  if (!fs.existsSync(shpPath) || !fs.existsSync(dbfPath)) {
    throw new Error(`Shapefile/DBF tidak ditemukan untuk layer ${config.layer} di ${SHP_DIR}`);
  }

  const points = readPointShapefile(shpPath);
  const records = readDbfRecords(dbfPath);

  if (points.length !== records.length) {
    throw new Error(`Jumlah geometri (${points.length}) != atribut DBF (${records.length}) pada ${config.layer}`);
  }

  const features = [];
  let seq = startSeq;
  let layerIdx = 0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const rec = records[i];
    if (!pt || !Number.isFinite(pt.lng) || !Number.isFinite(pt.lat)) continue;

    seq += 1;
    layerIdx += 1;

    const cleanName = (rec.NAMOBJ || '').trim();
    const remark = (rec.REMARK || '').trim();
    const name = cleanName || `${config.fallbackPrefix} #${layerIdx}`;
    const facilityCode = `FAC-RBI-${String(seq).padStart(2, '0')}`;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [pt.lng, pt.lat],
      },
      properties: {
        id: facilityCode,
        facility_code: facilityCode,
        name,
        facility_type: config.facilityType,
        address: remark ? `${remark}, Kota Bogor` : 'Kota Bogor',
        source: 'Peta RBI Kota Bogor 1:25.000 (Satu Peta)',
        verification_status: 'verified',
        year: 2025,
        layer: config.layer,
        remark: remark || null,
        lcode: (rec.LCODE || '').trim() || null,
      },
    });
  }

  return { features, nextSeq: seq };
}

async function main() {
  const allFeatures = [];
  let seq = 0;

  for (const cfg of FACILITY_LAYERS) {
    const res = loadLayerFeatures(cfg, seq);
    allFeatures.push(...res.features);
    seq = res.nextSeq;
  }

  const client = await db.getPool().connect();
  let importedCount = 0;
  let matchedAreaCount = 0;

  try {
    await client.query('BEGIN');

    for (const feature of allFeatures) {
      const p = feature.properties;
      const [lng, lat] = feature.geometry.coordinates;

      const areaRes = await client.query(
        `SELECT id, nama_kelurahan, nama_kecamatan
         FROM administrative_areas
         WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326), 0.005)
         ORDER BY ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) DESC,
                  ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) ASC
         LIMIT 1`,
        [lng, lat]
      );

      const matched = areaRes.rows[0] || null;
      const areaId = matched ? matched.id : null;
      if (areaId) matchedAreaCount += 1;

      const fullAddress = matched
        ? `Kel. ${matched.nama_kelurahan}, Kec. ${matched.nama_kecamatan}, Kota Bogor`
        : p.address;

      p.address = fullAddress;
      if (matched) {
        p.kelurahan = matched.nama_kelurahan;
        p.kecamatan = matched.nama_kecamatan;
      }

      await client.query(
        `INSERT INTO facilities
           (facility_code, name, facility_type, address, area_id, geom, source, verification_status, year)
         VALUES
           ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, $10)
         ON CONFLICT (facility_code) DO UPDATE SET
           name = EXCLUDED.name,
           facility_type = EXCLUDED.facility_type,
           address = EXCLUDED.address,
           area_id = EXCLUDED.area_id,
           geom = EXCLUDED.geom,
           source = EXCLUDED.source,
           verification_status = EXCLUDED.verification_status,
           year = EXCLUDED.year`,
        [
          p.facility_code,
          p.name,
          p.facility_type,
          fullAddress,
          areaId,
          lng,
          lat,
          p.source,
          p.verification_status,
          p.year,
        ]
      );
      importedCount += 1;
    }

    await client.query('COMMIT');

    fs.mkdirSync(path.dirname(OUT_GEOJSON), { recursive: true });
    fs.writeFileSync(
      OUT_GEOJSON,
      JSON.stringify(
        {
          type: 'FeatureCollection',
          name: 'facilities_satupeta_kota_bogor',
          features: allFeatures,
        },
        null,
        2
      ),
      'utf8'
    );

    console.log(
      `Import fasilitas Satu Peta selesai: ${importedCount} titik (${matchedAreaCount} cocok ke kelurahan) disimpan ke Supabase & ${path.relative(
        path.join(__dirname, '..'),
        OUT_GEOJSON
      )}.`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await db.getPool().end();
  }
}

main().catch((err) => {
  console.error('Import fasilitas gagal:', err.message);
  process.exit(1);
});
