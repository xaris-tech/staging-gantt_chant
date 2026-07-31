const crypto = require('crypto');
const defaultProduction = require('../seed/productions/default.json');
const { createProductionSchema, productionSchema } = require('../production-repository');
const { client: kvClient } = require('./_kv');

const KEY_PREFIX = 'stageflow:production:v1:';
const memoryStore = globalThis.__STAGEFLOW_PRODUCTIONS__ || new Map();
globalThis.__STAGEFLOW_PRODUCTIONS__ = memoryStore;

function useMemory() {
  return !kvClient();
}

function keyOf(id) {
  return `${KEY_PREFIX}${id}`;
}

async function storedRecords() {
  if (useMemory()) return [...memoryStore.values()].map((value) => productionSchema.parse(value));
  const records = [];
  for await (const key of kvClient().scanIterator({ match: `${KEY_PREFIX}*`, count: 100 })) {
    const value = await kvClient().get(key);
    if (value) records.push(productionSchema.parse(value));
  }
  return records;
}

async function get(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  if (useMemory()) {
    if (id === 'default') return productionSchema.parse(memoryStore.get(keyOf(id)) || defaultProduction);
    const value = memoryStore.get(keyOf(id));
    return value ? productionSchema.parse(value) : null;
  }
  if (id === 'default') {
    const persisted = await kvClient().get(keyOf(id));
    return productionSchema.parse(persisted || defaultProduction);
  }
  const value = await kvClient().get(keyOf(id));
  return value ? productionSchema.parse(value) : null;
}

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'production';
}

function metadataMatches(record, metadata) {
  return record.title === metadata.title && record.productionDate === metadata.productionDate &&
    record.venue === metadata.venue && record.timezone === metadata.timezone &&
    record.plannedStart === metadata.plannedStart && record.plannedEnd === metadata.plannedEnd &&
    JSON.stringify(record.floorDirectors || []) === JSON.stringify(metadata.floorDirectors);
}

function summary({ id, title, productionDate, venue, floorDirectors, timezone, plannedStart, plannedEnd, revision, createdAt, updatedAt }) {
  return { id, title, productionDate, venue, floorDirectors, timezone, plannedStart, plannedEnd, revision, createdAt, updatedAt };
}

async function list() {
  const records = await storedRecords();
  if (!records.some((record) => record.id === 'default')) records.unshift(productionSchema.parse(defaultProduction));
  return records.map(summary).sort((a, b) => a.productionDate.localeCompare(b.productionDate) || a.title.localeCompare(b.title));
}

async function create(input) {
  const metadata = createProductionSchema.parse(input);
  const duplicate = (await storedRecords()).find((record) => metadataMatches(record, metadata));
  if (duplicate) return duplicate;

  const base = slugify(metadata.title);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex').slice(0, 8);
  const candidates = [base, `${base}-${fingerprint}`];
  for (const id of candidates) {
    const now = new Date().toISOString();
    const production = productionSchema.parse({ schemaVersion: 1, id, ...metadata, revision: 0, createdAt: now, updatedAt: now, segments: [], lanes: [], activities: [] });
    if (useMemory()) {
      const existing = memoryStore.get(keyOf(id));
      if (!existing) { memoryStore.set(keyOf(id), production); return production; }
      if (metadataMatches(existing, metadata)) return productionSchema.parse(existing);
    } else {
      const created = await kvClient().set(keyOf(id), production, { nx: true });
      if (created) return production;
      const existing = await kvClient().get(keyOf(id));
      if (existing && metadataMatches(existing, metadata)) return productionSchema.parse(existing);
    }
  }
  throw new Error('A unique Production identifier could not be allocated.');
}

async function save(id, input) {
  if (!/^[A-Za-z0-9_-]+$/.test(id) || input.id !== id) return null;
  const parsedInput = productionSchema.parse(input);
  if (useMemory()) {
    const current = memoryStore.get(keyOf(id)) || (id === 'default' ? productionSchema.parse(defaultProduction) : null);
    if (!current) return null;
    if (parsedInput.revision !== current.revision) throw revisionConflict();
    const updated = productionSchema.parse({ ...parsedInput, createdAt: current.createdAt, updatedAt: new Date().toISOString(), revision: current.revision + 1 });
    memoryStore.set(keyOf(id), updated);
    return updated;
  }

  if (id === 'default') await kvClient().set(keyOf(id), productionSchema.parse(defaultProduction), { nx: true });
  const current = await get(id);
  if (!current) return null;
  const updated = productionSchema.parse({ ...parsedInput, createdAt: current.createdAt, updatedAt: new Date().toISOString(), revision: current.revision + 1 });
  const result = await kvClient().eval(
    'local current = redis.call("GET", KEYS[1]); if not current then return -1 end; local document = cjson.decode(current); if tonumber(document.revision) ~= tonumber(ARGV[1]) then return 0 end; redis.call("SET", KEYS[1], ARGV[2]); return 1',
    [keyOf(id)],
    [String(parsedInput.revision), JSON.stringify(updated)],
  );
  if (Number(result) === -1) return null;
  if (Number(result) !== 1) throw revisionConflict();
  return updated;
}

function revisionConflict() {
  const error = new Error('This Production has a newer revision. Reload before saving.');
  error.code = 'REVISION_CONFLICT';
  return error;
}

module.exports = { create, get, list, save };
