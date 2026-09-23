// Local backend for development: `npm run api` (port 8000).
// Serves the same /api.php, /export_csv.php and /export_xlsx.php paths the
// old PHP server did, so the Vite proxy in vite.config.js keeps working.
import http from 'node:http';
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const { default: handleApi } = await import('./server/api.js');
const { handleCsv, handleXlsx, safe } = await import('./server/exports.js');

const PORT = Number(process.env.API_PORT || 8000);

http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api.php') return handleApi(req, res);
  if (path === '/export_csv.php') return safe(handleCsv, req, res);
  if (path === '/export_xlsx.php') return safe(handleXlsx, req, res);
  res.statusCode = 404;
  res.end('Not found');
}).listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}  (try /api.php?action=me)`);
});
