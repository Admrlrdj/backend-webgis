const multer = require('multer');
const { HttpError } = require('../utils/httpError');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { status: 404, message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan` } });
}

// Express mengenali error handler dari jumlah argumen (4), jadi _next harus tetap ada
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: { status: 400, message: `Upload gagal: ${err.message}` } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { status: 400, message: 'Body JSON tidak valid' } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { status: err.status, message: err.message, details: err.details } });
  }
  console.error('[error]', req.method, req.originalUrl, err);
  return res.status(500).json({ error: { status: 500, message: 'Terjadi kesalahan pada server' } });
}

module.exports = { errorHandler, notFoundHandler };
