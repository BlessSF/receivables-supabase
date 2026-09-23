// Vercel serverless function. vercel.json rewrites /api.php -> /api/app
import handleApi from '../server/api.js';

export default function handler(req, res) {
  return handleApi(req, res);
}
