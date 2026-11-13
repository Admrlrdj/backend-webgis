const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const routes = require('./routes');
const docs = require('./controllers/docsController');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigin === '*') return callback(null, true);
        const allowed = Array.isArray(config.corsOrigin) ? config.corsOrigin : [config.corsOrigin];
        if (allowed.includes(origin)) return callback(null, true);
        if (!config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} tidak diizinkan oleh CORS`));
      },
    })
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_req, res) =>
    res.json({
      name: 'NutriMap Bogor API',
      data_source: config.dataSource,
      openapi: '/openapi.json',
      docs: '/docs',
      health: '/api/health',
    })
  );
  app.get('/openapi.json', docs.getOpenApiJson);
  app.get('/docs', docs.getSwaggerUi);
  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
