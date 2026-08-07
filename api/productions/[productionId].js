const store = require('../_production-store');
const { bodyOf, failure, prepare } = require('../_response');

module.exports = async function handler(req, res) {
  if (!prepare(req, res, ['GET', 'PUT', 'DELETE'])) return;
  const id = String(req.query.productionId || '');
  try {
    if (req.method === 'GET') {
      const production = await store.get(id);
      return production ? res.status(200).json(production) : res.status(404).json({ error: 'Production not found.' });
    }
    if (req.method === 'DELETE') {
      const deleted = await store.remove(id);
      return deleted ? res.status(200).json({ deleted: true }) : res.status(404).json({ error: 'Production not found.' });
    }
    const production = await store.save(id, bodyOf(req));
    return production ? res.status(200).json(production) : res.status(404).json({ error: 'Production not found.' });
  } catch (error) {
    return failure(res, error, 'Invalid Production document.');
  }
};
