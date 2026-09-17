const express = require('express');
const cors = require('cors');
require('dotenv').config();

const mapRoutes = require('./routes/mapRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); // Mengizinkan request dari frontend React
app.use(express.json());

// Route default untuk halaman utama
app.get('/', (req, res) => {
    res.send('Server Backend WebGIS berjalan dengan lancar!');
});

// Routes
app.use('/api/maps', mapRoutes);

// Jalankan Server
app.listen(PORT, () => {
    console.log(`Server WebGIS berjalan di http://localhost:${PORT}`);
});