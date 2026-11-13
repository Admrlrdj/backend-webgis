/**
 * Generator GeoJSON DUMMY untuk NutriMap Bogor.
 *
 * Batas kelurahan resmi masih disiapkan tim GIS. Sementara itu, script ini
 * membuat poligon Voronoi dari titik pusat 68 kelurahan, lalu memotongnya
 * dengan convex hull yang diperlebar. Hasilnya poligon yang saling bersambung
 * dan tidak bertumpuk, cukup untuk menguji choropleth di frontend.
 *
 * Output:
 *   data/dummy/kelurahan_dummy.geojson
 *   data/dummy/facilities_dummy.geojson
 *
 * Jalankan: npm run generate:dummy
 */
const fs = require('fs');
const path = require('path');

const DUMMY_DIR = path.join(__dirname, '..', 'data', 'dummy');
const seed = require(path.join(DUMMY_DIR, 'kelurahan_seed.json'));

const KODE_KECAMATAN = {
  'Bogor Selatan': '3271010',
  'Bogor Timur': '3271020',
  'Bogor Utara': '3271030',
  'Bogor Tengah': '3271040',
  'Bogor Barat': '3271050',
  'Tanah Sareal': '3271060',
};

// Koordinat kerja: [x=lng, y=lat]
const pts = seed.map((k) => [k.lng, k.lat]);

function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1)); // CCW
}

// Perlebar hull ke luar dari titik beratnya agar kelurahan tepi punya area wajar
function expand(poly, dist) {
  const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length;
  const cy = poly.reduce((s, q) => s + q[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * dist, y + (dy / len) * dist];
  });
}

// Potong poligon dengan half-plane: titik X yang memenuhi (X - m) · n <= 0
function clipHalfPlane(poly, m, n) {
  const out = [];
  const side = (q) => (q[0] - m[0]) * n[0] + (q[1] - m[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa <= 0) !== (sb <= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

const boundary = expand(convexHull(pts), 0.012);
const round = (v) => Number(v.toFixed(6));

function voronoiCell(i) {
  // Mulai dari batas kota (hull konveks) lalu potong dengan bisektor terhadap setiap titik lain
  let cell = boundary.slice();
  const p = pts[i];
  for (let j = 0; j < pts.length && cell.length; j++) {
    if (i === j) continue;
    const q = pts[j];
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const n = [q[0] - p[0], q[1] - p[1]];
    cell = clipHalfPlane(cell, m, n);
  }
  const ring = cell.map(([x, y]) => [round(x), round(y)]);
  ring.push(ring[0]);
  return ring;
}

const features = seed.map((k, i) => {
  const urut = String(seed.filter((s, idx) => idx <= i && s.kecamatan === k.kecamatan).length).padStart(3, '0');
  const kodeKec = KODE_KECAMATAN[k.kecamatan];
  return {
    type: 'Feature',
    id: k.id,
    properties: {
      id: k.id,
      kode_wilayah: `${kodeKec}${urut}`,
      nama: k.nama,
      kecamatan: k.kecamatan,
      kode_kecamatan: kodeKec,
      stunting: k.stunting,
      kemiskinan: k.kemiskinan,
      kerentananPangan: k.kerentananPangan,
      airBersih: k.airBersih,
      lat: k.lat,
      lng: k.lng,
      year: 2025,
      is_dummy: true,
    },
    geometry: { type: 'Polygon', coordinates: [voronoiCell(i)] },
  };
});

const kelurahanFC = {
  type: 'FeatureCollection',
  name: 'kelurahan_dummy',
  metadata: {
    nama_dataset: 'Batas Kelurahan Kota Bogor (DUMMY)',
    sumber: 'Dibangkitkan otomatis (Voronoi dari titik pusat kelurahan) - bukan batas resmi',
    periode: 2025,
    unit_wilayah: 'kelurahan',
    crs: 'EPSG:4326',
    status_validasi: 'dummy',
    catatan: 'Ganti dengan GeoJSON resmi dari tim GIS. Nilai indikator juga data contoh.',
    generated_at: new Date().toISOString(),
  },
  features,
};

// Fasilitas dummy: diletakkan dekat titik pusat beberapa kelurahan
const FACILITY_SEED = [
  { name: 'Pasar Bogor (contoh)', type: 'market', kel: 'Babakan Pasar', d: [0.0012, 0.0008] },
  { name: 'Pasar Anyar (contoh)', type: 'market', kel: 'Kebon Kelapa', d: [-0.001, 0.0012] },
  { name: 'Pasar Gunung Batu (contoh)', type: 'market', kel: 'Gunungbatu', d: [0.0009, -0.0007] },
  { name: 'Pasar Jambu Dua (contoh)', type: 'market', kel: 'Tanahsareal', d: [0.0015, 0.0011] },
  { name: 'Pasar Merdeka (contoh)', type: 'market', kel: 'Ciwaringin', d: [-0.0008, -0.0006] },
  { name: 'Pasar Sukasari (contoh)', type: 'market', kel: 'Sukasari', d: [0.0007, 0.001] },
  { name: 'Pasar Cumpok (contoh)', type: 'market', kel: 'Batutulis', d: [-0.0012, 0.0005] },
  { name: 'Pasar Kebon Pedes (contoh)', type: 'market', kel: 'Kebonpedes', d: [0.0006, -0.0012] },
  { name: 'Instalasi Pengolahan Air (contoh)', type: 'water_facility', kel: 'Katulampa', d: [0.0011, 0.0004] },
  { name: 'Reservoir Air (contoh)', type: 'water_facility', kel: 'Pakuan', d: [-0.0006, 0.0009] },
  { name: 'Kantor Layanan Air (contoh)', type: 'water_facility', kel: 'Tegallega', d: [0.0005, -0.0008] },
  { name: 'Hidran Umum (contoh)', type: 'water_facility', kel: 'Mulyaharja', d: [0.0013, 0.0013] },
  { name: 'Hidran Umum (contoh)', type: 'water_facility', kel: 'Situgede', d: [-0.001, 0.0006] },
  { name: 'Puskesmas (contoh)', type: 'puskesmas', kel: 'Bojongkerta', d: [0.0004, 0.0004] },
  { name: 'Puskesmas (contoh)', type: 'puskesmas', kel: 'Cimahpar', d: [-0.0006, 0.0003] },
  { name: 'Puskesmas (contoh)', type: 'puskesmas', kel: 'Pasirjaya', d: [0.0008, -0.0004] },
];

const facilityFeatures = FACILITY_SEED.map((f, i) => {
  const kel = seed.find((k) => k.nama === f.kel);
  if (!kel) throw new Error(`Kelurahan tidak ditemukan: ${f.kel}`);
  return {
    type: 'Feature',
    id: `FAC-${String(i + 1).padStart(3, '0')}`,
    properties: {
      id: `FAC-${String(i + 1).padStart(3, '0')}`,
      name: f.name,
      facility_type: f.type,
      kelurahan: kel.nama,
      kecamatan: kel.kecamatan,
      address: `Kel. ${kel.nama}, Kec. ${kel.kecamatan}`,
      source: 'Data contoh (dummy)',
      verification_status: 'dummy',
      year: 2025,
      is_dummy: true,
    },
    geometry: { type: 'Point', coordinates: [round(kel.lng + f.d[0]), round(kel.lat + f.d[1])] },
  };
});

const facilitiesFC = {
  type: 'FeatureCollection',
  name: 'facilities_dummy',
  metadata: {
    nama_dataset: 'Fasilitas Pendukung (DUMMY)',
    sumber: 'Titik contoh di sekitar pusat kelurahan - bukan lokasi terverifikasi',
    status_validasi: 'dummy',
    generated_at: new Date().toISOString(),
  },
  features: facilityFeatures,
};

fs.writeFileSync(path.join(DUMMY_DIR, 'kelurahan_dummy.geojson'), JSON.stringify(kelurahanFC));
fs.writeFileSync(path.join(DUMMY_DIR, 'facilities_dummy.geojson'), JSON.stringify(facilitiesFC, null, 2));

const empty = features.filter((f) => f.geometry.coordinates[0].length < 4);
console.log(`Kelurahan: ${features.length} poligon (${empty.length} kosong)`);
console.log(`Fasilitas: ${facilityFeatures.length} titik`);
