const { ZodError } = require('zod');

function prepare(req, res, methods) {
  res.setHeader('Allow', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  if (!methods.includes(req.method)) { res.status(405).json({ error: 'Method not allowed.' }); return false; }
  return true;
}

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
}

function failure(res, error, fallback) {
  if (error.code === 'PERSISTENCE_UNAVAILABLE') return res.status(503).json({ error: error.message });
  if (error.code === 'REVISION_CONFLICT') return res.status(409).json({ error: error.message });
  if (error instanceof ZodError || error instanceof SyntaxError) return res.status(400).json({ error: error.issues?.[0]?.message || fallback });
  return res.status(500).json({ error: 'The Production service is temporarily unavailable.' });
}

module.exports = { bodyOf, failure, prepare };
