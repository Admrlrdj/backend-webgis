const openapiSpec = require('../docs/openapi.json');

function getOpenApiJson(req, res) {
  const host = req.get('host');
  const spec = host
    ? { ...openapiSpec, servers: [{ url: `${req.protocol}://${host}`, description: 'Current Server' }] }
    : openapiSpec;
  res.json(spec);
}

function getSwaggerUi(req, res) {
  const isApiPrefix = req.originalUrl.startsWith('/api/');
  const specUrl = isApiPrefix ? '/api/openapi.json' : '/openapi.json';

  const html = `<!DOCTYPE html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link type="text/css" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <title>${openapiSpec.info.title} - Swagger UI</title>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      const ui = SwaggerUIBundle({
        url: '${specUrl}',
        dom_id: '#swagger-ui',
        layout: 'BaseLayout',
        deepLinking: true,
        showExtensions: true,
        showCommonExtensions: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ]
      });
    </script>
  </body>
</html>`;
  res.type('html').send(html);
}

module.exports = { getOpenApiJson, getSwaggerUi };
