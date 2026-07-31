const { test, expect } = require('@playwright/test');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

test('deployed Production API supports list, create, read, update, and stale-revision protection', async () => {
  const collectionHandler = require('../api/productions/index.js');
  const productionHandler = require('../api/productions/[productionId].js');

  const listResponse = responseRecorder();
  await collectionHandler({ method: 'GET', headers: {}, query: {} }, listResponse);
  expect(listResponse.statusCode).toBe(200);
  expect(listResponse.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'default', title: 'Sunday Revival' })]));

  const createResponse = responseRecorder();
  await collectionHandler({
    method: 'POST', headers: {}, query: {}, body: {
      title: 'Deployment Test Show', productionDate: '2026-08-16', venue: 'Main Stage', timezone: 'Asia/Manila',
      plannedStart: '2026-08-16T08:00:00+08:00', plannedEnd: '2026-08-16T12:00:00+08:00',
    },
  }, createResponse);
  expect(createResponse.statusCode).toBe(201);
  const created = createResponse.body;

  const getResponse = responseRecorder();
  await productionHandler({ method: 'GET', headers: {}, query: { productionId: created.id } }, getResponse);
  expect(getResponse.statusCode).toBe(200);
  expect(getResponse.body).toMatchObject({ id: created.id, title: 'Deployment Test Show', revision: 0 });

  const updateResponse = responseRecorder();
  await productionHandler({ method: 'PUT', headers: {}, query: { productionId: created.id }, body: { ...created, title: 'Updated Deployment Show' } }, updateResponse);
  expect(updateResponse.statusCode).toBe(200);
  expect(updateResponse.body).toMatchObject({ title: 'Updated Deployment Show', revision: 1 });

  const staleResponse = responseRecorder();
  await productionHandler({ method: 'PUT', headers: {}, query: { productionId: created.id }, body: created }, staleResponse);
  expect(staleResponse.statusCode).toBe(409);
});

test('deployed Production API atomically rejects one of two concurrent saves', async () => {
  const collectionHandler = require('../api/productions/index.js');
  const productionHandler = require('../api/productions/[productionId].js');
  const createResponse = responseRecorder();
  await collectionHandler({
    method: 'POST', headers: {}, query: {}, body: {
      title: 'Concurrent Save Show', productionDate: '2026-08-17', venue: 'Main Stage', timezone: 'Asia/Manila',
      plannedStart: '2026-08-17T08:00:00+08:00', plannedEnd: '2026-08-17T12:00:00+08:00',
    },
  }, createResponse);
  const created = createResponse.body;
  const first = responseRecorder();
  const second = responseRecorder();

  await Promise.all([
    productionHandler({ method: 'PUT', headers: {}, query: { productionId: created.id }, body: { ...created, title: 'First Save' } }, first),
    productionHandler({ method: 'PUT', headers: {}, query: { productionId: created.id }, body: { ...created, title: 'Second Save' } }, second),
  ]);

  expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
});

test('deployed Production API reports unexpected storage outages as server failures', async () => {
  const store = require('../api/_production-store');
  const collectionHandler = require('../api/productions/index.js');
  const originalList = store.list;
  store.list = async () => { throw new Error('private storage detail'); };
  try {
    const response = responseRecorder();
    await collectionHandler({ method: 'GET', headers: {}, query: {} }, response);
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'The Production service is temporarily unavailable.' });
  } finally {
    store.list = originalList;
  }
});

test('deployed Production API rejects malformed metadata with a client error', async () => {
  const collectionHandler = require('../api/productions/index.js');
  const response = responseRecorder();
  await collectionHandler({ method: 'POST', headers: {}, query: {}, body: { title: '' } }, response);
  expect(response.statusCode).toBe(400);
  expect(response.body.error).toBeTruthy();
});

test('deployed Production API treats Floor Directors and timezone as creation identity', async () => {
  const collectionHandler = require('../api/productions/index.js');
  const base = {
    title: `Director Identity ${crypto.randomUUID()}`, productionDate: '2026-08-20', venue: 'Main Stage',
    timezone: 'Asia/Manila', plannedStart: '2026-08-20T08:00:00+08:00', plannedEnd: '2026-08-20T12:00:00+08:00',
  };
  const first = responseRecorder(); const second = responseRecorder(); const third = responseRecorder();
  await collectionHandler({ method: 'POST', headers: {}, query: {}, body: { ...base, floorDirectors: ['Mia Santos'] } }, first);
  await collectionHandler({ method: 'POST', headers: {}, query: {}, body: { ...base, floorDirectors: ['Joel Cruz'] } }, second);
  await collectionHandler({ method: 'POST', headers: {}, query: {}, body: { ...base, timezone: 'UTC', floorDirectors: ['Mia Santos'] } }, third);
  expect(new Set([first.body.id, second.body.id, third.body.id]).size).toBe(3);
});

test('configured KV branch uses atomic allocation and compare-and-save contracts', async () => {
  const records = new Map();
  const calls = { nx: 0, eval: 0, scan: 0 };
  process.env.KV_REST_API_URL = 'https://mock.upstash.io';
  process.env.KV_REST_API_TOKEN = 'mock-token';
  globalThis.__STAGEFLOW_REDIS_CLIENT__ = {
    async *scanIterator({ match }) {
      calls.scan += 1;
      const prefix = match.replace('*', '');
      for (const key of records.keys()) if (key.startsWith(prefix)) yield key;
    },
    async get(key) { return records.get(key) || null; },
    async set(key, value, options = {}) {
      if (options.nx) {
        calls.nx += 1;
        if (records.has(key)) return null;
      }
      records.set(key, structuredClone(value));
      return 'OK';
    },
    async eval(script, keys, args) {
      calls.eval += 1;
      expect(script).toContain('document.revision');
      expect(keys).toHaveLength(1);
      const current = records.get(keys[0]);
      if (!current) return -1;
      if (current.revision !== Number(args[0])) return 0;
      records.set(keys[0], JSON.parse(args[1]));
      return 1;
    },
  };

  const storePath = require.resolve('../api/_production-store');
  const collectionPath = require.resolve('../api/productions/index.js');
  const detailPath = require.resolve('../api/productions/[productionId].js');
  delete require.cache[storePath]; delete require.cache[collectionPath]; delete require.cache[detailPath];
  const collectionHandler = require(collectionPath);
  const productionHandler = require(detailPath);
  try {
    const createdResponse = responseRecorder();
    await collectionHandler({ method: 'POST', headers: {}, query: {}, body: {
      title: 'KV Contract Show', productionDate: '2026-08-18', venue: 'Main Stage', timezone: 'Asia/Manila',
      plannedStart: '2026-08-18T08:00:00+08:00', plannedEnd: '2026-08-18T12:00:00+08:00',
    } }, createdResponse);
    expect(createdResponse.statusCode).toBe(201);
    const first = responseRecorder(); const second = responseRecorder();
    await Promise.all([
      productionHandler({ method: 'PUT', headers: {}, query: { productionId: createdResponse.body.id }, body: { ...createdResponse.body, title: 'KV First' } }, first),
      productionHandler({ method: 'PUT', headers: {}, query: { productionId: createdResponse.body.id }, body: { ...createdResponse.body, title: 'KV Second' } }, second),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect(calls).toMatchObject({ nx: 1, eval: 2 });
    expect(calls.scan).toBeGreaterThan(0);
  } finally {
    delete globalThis.__STAGEFLOW_REDIS_CLIENT__;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete require.cache[storePath]; delete require.cache[collectionPath]; delete require.cache[detailPath];
  }
});
