const { test, expect } = require('@playwright/test');

process.env.STAGEFLOW_USE_MEMORY_STORE = '1';

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

test('deployed Production API supports list, create, read, update, delete, and stale-revision protection', async () => {
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

  const deleteResponse = responseRecorder();
  await productionHandler({ method: 'DELETE', headers: {}, query: { productionId: created.id } }, deleteResponse);
  expect(deleteResponse.statusCode).toBe(200);
  expect(deleteResponse.body).toEqual({ deleted: true });

  const deletedGetResponse = responseRecorder();
  await productionHandler({ method: 'GET', headers: {}, query: { productionId: created.id } }, deletedGetResponse);
  expect(deletedGetResponse.statusCode).toBe(404);
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

test('configured Supabase branch uses unique inserts and conditional revision updates', async () => {
  const records = new Map();
  const calls = { inserts: 0, conditionalUpdates: 0 };

  class Query {
    constructor() { this.operation = 'select'; this.filters = []; this.value = null; }
    select() { return this; }
    order() { return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    insert(value) { this.operation = 'insert'; this.value = structuredClone(value); return this; }
    update(value) { this.operation = 'update'; this.value = structuredClone(value); return this; }
    maybeSingle() { return Promise.resolve(this.execute(true)); }
    then(resolve, reject) { return Promise.resolve(this.execute(false)).then(resolve, reject); }
    execute(single) {
      const matches = (row) => this.filters.every(([column, value]) => row[column] === value);
      if (this.operation === 'insert') {
        calls.inserts += 1;
        if (records.has(this.value.id)) return { data: null, error: { code: '23505' } };
        records.set(this.value.id, this.value);
        return { data: single ? structuredClone(this.value) : [structuredClone(this.value)], error: null };
      }
      if (this.operation === 'update') {
        if (this.filters.some(([column]) => column === 'revision')) calls.conditionalUpdates += 1;
        const current = [...records.values()].find(matches);
        if (!current) return { data: single ? null : [], error: null };
        records.set(this.value.id, this.value);
        return { data: single ? structuredClone(this.value) : [structuredClone(this.value)], error: null };
      }
      const selected = [...records.values()].filter(matches).map((row) => ({ document: structuredClone(row.document) }));
      return { data: single ? selected[0] || null : selected, error: null };
    }
  }

  globalThis.__STAGEFLOW_SUPABASE_CLIENT__ = {
    from(table) { expect(table).toBe('productions'); return new Query(); },
  };

  const storePath = require.resolve('../api/_production-store');
  const supabasePath = require.resolve('../api/_supabase');
  const collectionPath = require.resolve('../api/productions/index.js');
  const detailPath = require.resolve('../api/productions/[productionId].js');
  delete process.env.STAGEFLOW_USE_MEMORY_STORE;
  delete require.cache[storePath]; delete require.cache[supabasePath]; delete require.cache[collectionPath]; delete require.cache[detailPath];
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
    expect(calls).toMatchObject({ inserts: 1, conditionalUpdates: 2 });
  } finally {
    delete globalThis.__STAGEFLOW_SUPABASE_CLIENT__;
    process.env.STAGEFLOW_USE_MEMORY_STORE = '1';
    delete require.cache[storePath]; delete require.cache[supabasePath]; delete require.cache[collectionPath]; delete require.cache[detailPath];
  }
});
