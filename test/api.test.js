// Uji API dalam mode dummy. Jalankan: npm test
process.env.DATA_SOURCE = 'dummy';
process.env.ADMIN_EMAIL = 'tester@nutrimap.test';
process.env.ADMIN_PASSWORD = 'test-password-123';
process.env.SUPERADMIN_EMAIL = '';
process.env.SUPERADMIN_PASSWORD = '';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const saw = require('../src/services/sawService');

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json() }));
const post = (p, body, token) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

async function login() {
  const r = await post('/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(r.status, 200);
  return r.body.token;
}

test('health menyebut mode dummy', async () => {
  const r = await get('/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.data_source, 'dummy');
});

test('GET /areas mengembalikan 68 poligon dengan indikator', async () => {
  const r = await get('/areas');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.type, 'FeatureCollection');
  assert.equal(r.body.data.features.length, 68);
  const p = r.body.data.features[0].properties;
  for (const k of ['id', 'nama', 'kecamatan', 'stunting', 'kemiskinan', 'kerentananPangan', 'airBersih']) assert.ok(k in p, k);
  assert.equal(r.body.meta.is_dummy, true);
});

test('GET /areas?kecamatan= memfilter', async () => {
  const r = await get('/areas?kecamatan=Bogor%20Timur');
  assert.equal(r.body.data.features.length, 6);
});

test('GET /areas/:id dan 404', async () => {
  assert.equal((await get('/areas/KEL-01')).body.data.properties.nama, 'Babakan');
  assert.equal((await get('/areas/TIDAK-ADA')).status, 404);
});

test('GET /indicators memvalidasi type dan mengembalikan value', async () => {
  assert.equal((await get('/indicators?type=salah')).status, 400);
  assert.equal((await get('/indicators?type=stunting&year=abc')).status, 400);
  const r = await get('/indicators?type=stunting');
  assert.equal(r.status, 200);
  assert.equal(r.body.indicator, 'stunting');
  assert.equal(r.body.year, 2025);
  assert.equal(typeof r.body.data.features[0].properties.value, 'number');
  assert.equal(r.body.stats.count, 68);
});

test('GET /facilities memfilter type', async () => {
  const r = await get('/facilities?type=market');
  assert.ok(r.body.data.features.length > 0);
  assert.ok(r.body.data.features.every((f) => f.properties.facility_type === 'market'));
  assert.equal((await get('/facilities?type=bandara')).status, 400);
});

test('GET /rankings terurut dan memakai bobot query', async () => {
  const r = await get('/rankings');
  const scores = r.body.data.map((d) => d.intervention_score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.equal(r.body.data[0].rank, 1);
  assert.equal(r.body.summary.total_areas, 68);

  const onlyAir = await get('/rankings?w_stunting=0&w_kemiskinan=0&w_pangan=0&w_air=1');
  const minAir = Math.min(...onlyAir.body.data.map((d) => d.values.air));
  assert.equal(onlyAir.body.data[0].values.air, minAir, 'akses air terendah harus paling prioritas');
});

test('SAW: benefit x/max, cost min/x', () => {
  const rows = [
    { id: 'A', nama: 'A', stunting: 20, kemiskinan: 10, kerentananPangan: 50, airBersih: 80 },
    { id: 'B', nama: 'B', stunting: 10, kemiskinan: 5, kerentananPangan: 25, airBersih: 100 },
  ];
  const r = saw.calculate(rows, { stunting: 1, kemiskinan: 1, pangan: 1, air: 1 });
  assert.equal(r.ranking[0].area_id, 'A');
  assert.equal(r.ranking[0].intervention_score, 1);
  assert.equal(r.ranking[1].intervention_score, 0.575); // (0.5+0.5+0.5+0.8)/4
  assert.throws(() => saw.calculate(rows, { stunting: -1 }));
});

test('endpoint admin butuh token', async () => {
  assert.equal((await post('/admin/saw/calculate', {})).status, 401);
  assert.equal((await post('/auth/login', { email: process.env.ADMIN_EMAIL, password: 'salah' })).status, 401);
});

test('alur upload CSV: validasi -> publish -> data berubah', async () => {
  const token = await login();
  const csv = [
    'kelurahan,kecamatan,value',
    'Kel. Babakan,Bogor Tengah,30.5', // valid (awalan dinormalisasi)
    'TANAH SAREAL,Tanah Sareal,11', // valid (spasi & kapital)
    'Babakan,Bogor Tengah,12', // duplikat
    'Sempur,Bogor Tengah,150', // di luar rentang
    'Sempur,Bogor Tengah,', // kosong
    'Atlantis,Entah,10', // tidak cocok
  ].join('\n');

  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'stunting_2025.csv');
  form.append('indicator_type', 'stunting');
  form.append('year', '2025');
  form.append('source', 'Uji otomatis');
  const up = await fetch(`${base}/admin/uploads`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const upBody = await up.json();
  assert.equal(up.status, 201, JSON.stringify(upBody));
  assert.equal(upBody.validation.summary.valid_row_count, 2);
  assert.equal(upBody.validation.summary.invalid_row_count, 3);
  assert.equal(upBody.validation.summary.unmatched_row_count, 1);

  // Belum dipublikasikan -> data lama tetap
  assert.notEqual((await get('/areas/KEL-01')).body.data.properties.stunting, 30.5);

  const pub = await post(`/admin/uploads/${upBody.data.id}/publish`, {}, token);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.published_rows, 2);
  assert.equal((await get('/areas/KEL-01')).body.data.properties.stunting, 30.5);
  assert.equal((await get('/indicators?type=stunting')).body.source, 'Uji otomatis');

  // Publish ulang ditolak
  assert.equal((await post(`/admin/uploads/${upBody.data.id}/publish`, {}, token)).status, 409);
});

test('POST /admin/saw/calculate menyimpan run', async () => {
  const token = await login();
  const r = await post('/admin/saw/calculate', { year: 2025, weights: { stunting: 50, kemiskinan: 20, pangan: 20, air: 10 } }, token);
  assert.equal(r.status, 201);
  assert.ok(r.body.run.id);
  assert.equal(r.body.weights.stunting, 0.5);
  assert.equal(r.body.ranking.length, 68);
});

test('audit log hanya untuk superadmin', async () => {
  const token = await login();
  const r = await fetch(`${base}/admin/audit-logs`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 403);
});
