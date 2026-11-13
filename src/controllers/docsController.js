const openapiSpec = require('../docs/openapi.json');

function getOpenApiJson(req, res) {
  const host = req.get('host');
  const spec = host
    ? { ...openapiSpec, servers: [{ url: `${req.protocol}://${host}`, description: 'Current Server' }] }
    : openapiSpec;
  res.json(spec);
}

function getSwaggerUi(_req, res) {
  const html = `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NutriMap Bogor API Docs (OpenAPI)</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; font-family: system-ui, -apple-system, sans-serif; }
      .topbar-note {
        background: #0f172a; color: #e2e8f0; padding: 10px 24px; font-size: 13px;
        display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
      }
      .topbar-note a { color: #38bdf8; text-decoration: none; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="topbar-note">
      <span><strong>NutriMap Bogor API</strong> — OpenAPI 3.0.3 Documentation</span>
      <a href="/api/openapi.json" target="_blank" rel="noreferrer">Download / View openapi.json</a>
    </div>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.addEventListener('load', function () {
        if (window.SwaggerUIBundle) {
          window.SwaggerUIBundle({
            url: '/api/openapi.json',
            dom_id: '#swagger-ui',
            deepLinking: true,
            presets: [window.SwaggerUIBundle.presets.apis]
          });
        } else {
          document.getElementById('swagger-ui').innerHTML =
            '<p style="padding:24px">Gagal memuat Swagger UI CDN. Buka <a href="/api/openapi.json">/api/openapi.json</a> untuk melihat spesifikasi OpenAPI JSON secara langsung.</p>';
        }
      });
    </script>
  </body>
</html>`;
  res.type('html').send(html);
}

module.exports = { getOpenApiJson, getSwaggerUi };
