const crypto = require('crypto');
const defaultProduction = require('../seed/productions/default.json');
const { createProductionSchema, productionSchema } = require('../production-repository');
const { client: supabaseClient } = require('./_supabase');

const memoryStore = globalThis.__STAGEFLOW_PRODUCTIONS__ || new Map();
globalThis.__STAGEFLOW_PRODUCTIONS__ = memoryStore;

function useMemory() {
  return process.env.NODE_ENV === 'test' || process.env.STAGEFLOW_USE_MEMORY_STORE === '1';
}

function database() {
  const configured = supabaseClient();
  if (configured) return configured;
  if (useMemory()) return null;
  throw new Error('Supabase storage is not configured.');
}

function rowOf(production) {
  return {
    id: production.id,
    title: production.title,
    production_date: production.productionDate,
    revision: production.revision,
    document: production,
    created_at: production.createdAt,
    updated_at: production.updatedAt,
  };
}

function storageError(error) {
  const wrapped = new Error('Supabase storage request failed.');
  wrapped.cause = error;
  return wrapped;
}

async function storedRecords() {
  const db = database();
  if (!db) return [...memoryStore.values()].map((value) => productionSchema.parse(value));
  const { data, error } = await db.from('productions').select('document').order('production_date').order('title');
  if (error) throw storageError(error);
  return data.map(({ document }) => productionSchema.parse(document));
}

async function get(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const db = database();
  if (!db) {
    if (id === 'default') return productionSchema.parse(memoryStore.get(id) || defaultProduction);
    const value = memoryStore.get(id);
    return value ? productionSchema.parse(value) : null;
  }
  const { data, error } = await db.from('productions').select('document').eq('id', id).maybeSingle();
  if (error) throw storageError(error);
  if (!data && id === 'default') return productionSchema.parse(defaultProduction);
  return data ? productionSchema.parse(data.document) : null;
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
    const db = database();
    if (!db) {
      const existing = memoryStore.get(id);
      if (!existing) { memoryStore.set(id, production); return production; }
      if (metadataMatches(existing, metadata)) return productionSchema.parse(existing);
    } else {
      const { data, error } = await db.from('productions').insert(rowOf(production)).select('document').maybeSingle();
      if (!error && data) return productionSchema.parse(data.document);
      if (error && error.code !== '23505') throw storageError(error);
      const existing = await get(id);
      if (existing && metadataMatches(existing, metadata)) return existing;
    }
  }
  throw new Error('A unique Production identifier could not be allocated.');
}

async function save(id, input) {
  if (!/^[A-Za-z0-9_-]+$/.test(id) || input.id !== id) return null;
  const parsedInput = productionSchema.parse(input);
  const db = database();
  if (!db) {
    const current = memoryStore.get(id) || (id === 'default' ? productionSchema.parse(defaultProduction) : null);
    if (!current) return null;
    if (parsedInput.revision !== current.revision) throw revisionConflict();
    const updated = productionSchema.parse({ ...parsedInput, createdAt: current.createdAt, updatedAt: new Date().toISOString(), revision: current.revision + 1 });
    memoryStore.set(id, updated);
    return updated;
  }

  if (id === 'default') {
    const seeded = productionSchema.parse(defaultProduction);
    const { error } = await db.from('productions').insert(rowOf(seeded));
    if (error && error.code !== '23505') throw storageError(error);
  }
  const current = await get(id);
  if (!current) return null;
  if (parsedInput.revision !== current.revision) throw revisionConflict();
  const updated = productionSchema.parse({ ...parsedInput, createdAt: current.createdAt, updatedAt: new Date().toISOString(), revision: current.revision + 1 });
  const { data, error } = await db.from('productions').update(rowOf(updated)).eq('id', id).eq('revision', current.revision).select('document').maybeSingle();
  if (error) throw storageError(error);
  if (!data) throw revisionConflict();
  return productionSchema.parse(data.document);
}

async function remove(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id) || id === 'default') return false;
  const db = database();
  if (!db) return memoryStore.delete(id);
  const { data, error } = await db.from('productions').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw storageError(error);
  return Boolean(data);
}

function revisionConflict() {
  const error = new Error('This Production has a newer revision. Reload before saving.');
  error.code = 'REVISION_CONFLICT';
  return error;
}

module.exports = { create, get, list, remove, save };
