const { client: kvClient } = require('./_kv');

const memoryData = globalThis.__STAGEFLOW_CHART_DATA__ || new Map();
globalThis.__STAGEFLOW_CHART_DATA__ = memoryData;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const chartId = req.query.chart || 'default';
  const storeKey = `gantt_${chartId}`;

  if (req.method === 'GET') {
    try {
      let data = null;
      const client = kvClient();
      if (client) {
        data = await client.get(storeKey);
      }
      if (!data) data = memoryData.get(storeKey);
      return res.status(200).json(data || { rows: [], segments: {}, chartTitle: 'DAY-0 GANTT CHART' });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read data', detail: err.message });
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
      body.updatedAt = Date.now();
      const client = kvClient();
      if (client) {
        await client.set(storeKey, body);
      }
      memoryData.set(storeKey, body);
      return res.status(200).json({ ok: true, updatedAt: body.updatedAt });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save data', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
