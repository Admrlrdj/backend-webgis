const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const wkt = require('wellknown');

exports.getStuntingMap = (req, res) => {
    const results = [];
    const csvFilePath = path.join(__dirname, '../data/peta_tingkat_persentase_balita_dengan_tinggi_badan_dibawah_stan.csv');

    fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (data) => {
            try {
                // Konversi string WKT dari kolom 'geom' menjadi objek Geometry GeoJSON
                const geometry = data.geom ? wkt(data.geom) : null;

                // Memasukkan fitur hanya jika data geometrinya valid
                if (geometry) {
                    results.push({
                        type: "Feature",
                        geometry: geometry,
                        properties: {
                            kecamatan: data.nama_kecam || data.wadmkc,
                            kelurahan: data.wadmkd || data.nama_desa_,
                            ikp_score: parseFloat(data.ikp),
                            rank: parseInt(data.rank),
                            indikator_1: parseInt(data.f1__priori)
                            // Kamu bisa menambahkan kolom "f2__priori", dll sesuai kebutuhan visualisasi QGIS
                        }
                    });
                }
            } catch (err) {
                console.error("Gagal melakukan parsing pada baris:", err);
            }
        })
        .on('end', () => {
            res.status(200).json({
                type: "FeatureCollection",
                features: results
            });
        })
        .on('error', (error) => {
            console.error("Error saat membaca CSV:", error);
            res.status(500).json({
                message: "Gagal memproses data Stunting Kota Bogor"
            });
        });
};