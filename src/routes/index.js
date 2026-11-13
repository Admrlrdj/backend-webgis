const express = require('express');
const multer = require('multer');
const config = require('../config/env');
const pub = require('../controllers/publicController');
const docs = require('../controllers/docsController');
const auth = require('../controllers/authController');
const admin = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');
const repo = require('../repositories');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadMaxBytes, files: 1 } });

const router = express.Router();

// ---- Publik (read-only, tanpa akun) ----
router.get('/health', pub.health);
router.get('/areas', pub.listAreas);
router.get('/areas/:id', pub.getArea);
router.get('/indicators', pub.getIndicator);
router.get('/facilities', pub.listFacilities);
router.get('/rankings', pub.getRankings);
router.get('/metadata', pub.getMetadata);
router.get('/openapi.json', docs.getOpenApiJson);
router.get('/docs', docs.getSwaggerUi);

// Alias lama dari prototipe awal (GET /api/map/administrasi) agar klien lama tetap jalan
router.get('/map/administrasi', async (req, res) => {
  const { featureCollection } = await repo.getAreasGeoJSON({});
  res.json(featureCollection);
});

// ---- Auth ----
router.post('/auth/login', auth.login);
router.get('/auth/me', requireAuth, auth.me);

// ---- Admin (JWT + role) ----
const adminRouter = express.Router();
adminRouter.use(requireAuth, requireRole('admin'));
adminRouter.get('/uploads', admin.listUploads);
adminRouter.post('/uploads', upload.single('file'), admin.createUpload);
adminRouter.get('/uploads/:id/validation', admin.getUploadValidation);
adminRouter.post('/uploads/:id/publish', admin.publishUpload);
adminRouter.post('/uploads/:id/reject', admin.rejectUpload);
adminRouter.post('/saw/calculate', admin.calculateSaw);
adminRouter.get('/audit-logs', requireRole('superadmin'), admin.listAuditLogs);
router.use('/admin', adminRouter);

module.exports = router;
