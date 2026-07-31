const express = require('express');
const fs = require('fs');
const path = require('path');
const { createProductionRepository } = require('./production-repository');

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes('*')) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const rateLimit = {};
const RATE_WINDOW = 1000;
const RATE_MAX = Number(process.env.RATE_MAX || 60);
app.use('/api', (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  if (!rateLimit[ip] || now - rateLimit[ip].start > RATE_WINDOW) {
    rateLimit[ip] = { start: now, count: 1 };
    return next();
  }
  rateLimit[ip].count++;
  if (rateLimit[ip].count > RATE_MAX) {
    return res.status(429).json({ error: 'Too many requests. Slow down.' });
  }
  next();
});

function getChartId(req) {
  return req.query.chart || 'default';
}

const dataDir = process.env.PRODUCTION_DATA_DIR
  ? path.resolve(process.env.PRODUCTION_DATA_DIR)
  : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const productionRepository = createProductionRepository({
  dataDir,
  seedDir: path.join(__dirname, 'seed', 'productions'),
});

app.use('/api/data', (req, res, next) => {
  const chartId = req.query.chart;
  if (chartId !== undefined && !/^[A-Za-z0-9_-]+$/.test(chartId)) {
    return res.status(400).json({ error: 'Invalid chart identifier.' });
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/productions/default', (_req, res) => {
  try {
    res.json(productionRepository.get('default'));
  } catch {
    res.status(500).json({ error: 'The default Production is missing or invalid.' });
  }
});

app.get('/api/productions', (_req, res) => {
  try {
    res.json(productionRepository.list());
  } catch {
    res.status(500).json({ error: 'Productions could not be listed.' });
  }
});

app.post('/api/productions', (req, res) => {
  try {
    res.status(201).json(productionRepository.create(req.body));
  } catch (error) {
    res.status(400).json({ error: error.issues?.[0]?.message || 'Invalid Production metadata.' });
  }
});

app.get('/api/productions/:productionId', (req, res) => {
  try {
    const production = productionRepository.get(req.params.productionId);
    if (!production) return res.status(404).json({ error: 'Production not found.' });
    res.json(production);
  } catch {
    res.status(500).json({ error: 'The Production is invalid or could not be read.' });
  }
});

app.put('/api/productions/:productionId', (req, res) => {
  try {
    const production = productionRepository.save(req.params.productionId, req.body);
    if (!production) return res.status(404).json({ error: 'Production not found.' });
    res.json(production);
  } catch (error) {
    if (error.code === 'REVISION_CONFLICT') return res.status(409).json({ error: error.message });
    res.status(400).json({ error: error.issues?.[0]?.message || 'Invalid Production document.' });
  }
});

app.get('/api/data', (req, res) => {
  const chartId = getChartId(req);
  const filePath = path.join(dataDir, `gantt-${chartId}.json`);
  if (!fs.existsSync(filePath)) {
    return res.json({ rows: [], segments: {}, chartTitle: '', updatedAt: 0 });
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    res.json(JSON.parse(raw));
  } catch {
    res.json({ rows: [], segments: {}, chartTitle: '', updatedAt: 0 });
  }
});

app.put('/api/data', (req, res) => {
  const chartId = getChartId(req);
  const filePath = path.join(dataDir, `gantt-${chartId}.json`);
  const body = req.body;
  body.updatedAt = Date.now();
  fs.writeFileSync(filePath, JSON.stringify(body, null, 2));
  res.json({ ok: true, updatedAt: body.updatedAt });
});

const appDist = path.join(__dirname, 'dist');
app.use('/app', express.static(appDist));
app.get('/app/*path', (_req, res) => {
  res.sendFile(path.join(appDist, 'index.html'));
});

const publicDir = path.join(__dirname, 'public');
const publicFiles = new Map([
  ['/staging_gantt-chart.html', 'staging_gantt-chart.html'],
  ['/manifest.json', 'manifest.json'],
  ['/icon.svg', 'icon.svg'],
  ['/sw.js', 'sw.js'],
]);

app.get([...publicFiles.keys()], (req, res) => {
  res.sendFile(path.join(publicDir, publicFiles.get(req.path)));
});

app.get('/', (_req, res) => {
  res.redirect('/app/');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`CORS origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'same-origin only'}`);
});
