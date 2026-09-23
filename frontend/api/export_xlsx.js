// Vercel serverless function. vercel.json rewrites /export_xlsx.php -> /api/export_xlsx
import { handleXlsx, safe } from '../server/exports.js';

export default function handler(req, res) {
  return safe(handleXlsx, req, res);
}
