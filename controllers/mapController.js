// Contoh mengambil data lokasi
exports.getLocations = async (req, res) => {
    try {
        // Nanti bagian ini diganti dengan query ke PostgreSQL/MongoDB
        const geojsonData = {
            type: "FeatureCollection",
            features: [{
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [106.7973, -6.5971] // Koordinat contoh (Bogor)
                },
                properties: {
                    name: "Titik Lokasi Pemetaan",
                    description: "Deskripsi area spasial"
                }
            }]
        };

        res.status(200).json(geojsonData);
    } catch (error) {
        console.error("Error fetching map data:", error);
        res.status(500).json({
            message: "Terjadi kesalahan pada server"
        });
    }
};