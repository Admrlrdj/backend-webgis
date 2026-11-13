const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const routes = require('./routes');
const docs = require('./controllers/docsController');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
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
