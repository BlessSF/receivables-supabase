// Vercel serverless function. vercel.json rewrites /export_csv.php -> /api/export_csv
import { handleCsv, safe } from '../server/exports.js';

export default function handler(req, res) {
  return safe(handleCsv, req, res);
}
