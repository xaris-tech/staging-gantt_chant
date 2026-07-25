const store = require('../_production-store');
const { bodyOf, failure, prepare } = require('../_response');

module.exports = async function handler(req, res) {
  if (!prepare(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'GET') return res.status(200).json(await store.list());
    return res.status(201).json(await store.create(bodyOf(req)));
  } catch (error) {
    return failure(res, error, 'Invalid Production metadata.');
  }
};
