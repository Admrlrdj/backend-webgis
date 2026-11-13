# NutriMap Bogor — Backend API

Express.js REST API untuk WebGIS NutriMap Bogor. Mendukung dua sumber data:

| `DATA_SOURCE` | Keterangan |
|---|---|
| `dummy` (default) | Membaca `data/dummy/*.geojson`. Tanpa database. Upload/publish/SAW disimpan di memori (hilang saat restart). |
| `postgis` | PostgreSQL + PostGIS lewat `DATABASE_URL`. Schema di `db/schema.sql`. |

> Batas kelurahan di `data/dummy` adalah **poligon Voronoi buatan** dari titik pusat kelurahan, bukan batas resmi. Nilai indikatornya juga data contoh. Ganti dengan GeoJSON dari tim GIS begitu tersedia (lihat bagian di bawah).

## Menjalankan

```bash
npm install
cp .env.example .env   # lalu isi JWT_SECRET dan password admin
npm run dev            # http://localhost:5000
npm test
```

Frontend (`frontend-webgis`, `npm run dev`) mem-proxy `/api` ke port 5000. Jika backend mati, peta otomatis memakai GeoJSON prototipe lokal.

## Endpoint

Semua respons publik berbentuk `{ data, meta }`; `meta.is_dummy` menandai data contoh.

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/health` | Status server dan sumber data |
| GET | `/api/areas?kecamatan=&year=` | FeatureCollection kelurahan + 4 indikator |
| GET | `/api/areas/:id` | Satu kelurahan (`KEL-01` atau kode wilayah) |
| GET | `/api/indicators?type=stunting&year=2025` | Choropleth satu indikator + sumber, periode, statistik. `type`: `stunting`, `kemiskinan`, `pangan`, `air` |
| GET | `/api/facilities?type=market` | Titik fasilitas. `type`: `market`, `water_facility`, `puskesmas`, `posyandu`, `agricultural_area` |
| GET | `/api/rankings?year=&w_stunting=&w_kemiskinan=&w_pangan=&w_air=` | Ranking SAW (bobot opsional) |
| GET | `/api/metadata` | Daftar indikator, tahun, dataset, kecamatan, bobot default |
| POST | `/api/auth/login` | `{ email, password }` → JWT |
| GET | `/api/auth/me` | Profil dari token |
| POST | `/api/admin/uploads` | multipart: `file` (CSV), `indicator_type`, `year`, `source` → validasi, status `pending` |
| GET | `/api/admin/uploads` | Riwayat upload |
| GET | `/api/admin/uploads/:id/validation` | Detail hasil validasi |
| POST | `/api/admin/uploads/:id/publish` | Terapkan baris valid ke data produksi |
| POST | `/api/admin/uploads/:id/reject` | Tolak upload |
| POST | `/api/admin/saw/calculate` | `{ year, weights, weight_version }` → simpan hasil SAW |
| GET | `/api/admin/audit-logs` | Khusus superadmin |
| GET | `/api/map/administrasi` | Alias lama, mengembalikan FeatureCollection langsung |

Endpoint `/api/admin/*` butuh header `Authorization: Bearer <token>`.

### Format CSV upload

Header tidak case-sensitive. Minimal satu kolom wilayah dan satu kolom nilai:

```csv
kelurahan,kecamatan,value
Babakan,Bogor Tengah,7.2
Kel. Tanah Sareal,Tanah Sareal,10.6
```

Kolom wilayah: `kelurahan`, `nama_kelurahan`, `wadmkd`, `kode_wilayah`, atau `id`. Kolom nilai: `value`, `nilai`, atau nama indikator. Nama wilayah dinormalisasi (kapital, spasi, awalan "Kel.") sebelum dicocokkan. Validasi melaporkan baris valid, invalid (bukan angka, di luar 0–100, duplikat), tidak cocok, dan kelurahan yang belum terisi.

### SAW

- `intervention_score` (dipakai untuk ranking): stunting, kemiskinan, kerentanan pangan sebagai *benefit* (x/max); akses air bersih sebagai *cost* (min/x).
- `condition_score`: kebalikannya (makin tinggi makin baik).
- Bobot default sama dengan UI: stunting 0,40 · kemiskinan 0,25 · pangan 0,20 · air 0,15. Bobot dinormalisasi otomatis (boleh persen atau desimal).
- Zona: 25% teratas `tinggi`, 40% berikutnya `sedang`, sisanya `rendah`.

## Pindah ke PostGIS + data resmi

1. `npm run db:configure` — menanyakan user/password PostgreSQL (password tidak ditampilkan) lalu menulis `DATABASE_URL` dan `DATA_SOURCE=postgis` ke `.env`. Bisa juga diisi manual.
2. `npm run db:init` — membuat database (jika belum ada), tabel, index GIST, dan akun admin dari `.env`.
3. Import GeoJSON:
   ```bash
   # data dummy
   npm run db:import
   # GeoJSON resmi dari tim GIS (EPSG:4326)
   node scripts/import-geojson.js --areas path/kelurahan.geojson --name-field wadmkd --kec-field wadmkc --code-field kode_desa --year 2025
   ```
   Geometri diperbaiki dengan `ST_MakeValid` dan disimpan sebagai MultiPolygon. Properti indikator (`stunting`, `kemiskinan`, `kerentananPangan`, `airBersih`) yang ada ikut diimport.

Untuk tetap di mode dummy tapi memakai GeoJSON baru, ganti `data/dummy/kelurahan_dummy.geojson` (properti `id`, `nama`, `kecamatan`, dan 4 indikator), atau ubah `data/dummy/kelurahan_seed.json` lalu jalankan `npm run generate:dummy`.

## Struktur

```text
server.js                 entry point
src/app.js                Express app (dipakai juga oleh test)
src/config/               env, koneksi db, katalog indikator
src/routes/               definisi endpoint
src/controllers/          public, auth, admin
src/services/             SAW, validasi CSV
src/repositories/         dummy (file) dan postgis, interface sama
src/middleware/           JWT/role, error handler
db/schema.sql             schema PostGIS
scripts/                  generate dummy, db:init, import GeoJSON
data/dummy/               GeoJSON contoh
test/                     node:test
```
