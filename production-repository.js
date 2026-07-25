const fs = require('fs');
const path = require('path');
const { z } = require('zod');

const activityTypes = ['setup', 'entrance', 'performance', 'transition', 'exit', 'teardown', 'hold', 'custom'];
const activityStatuses = ['planned', 'confirmed', 'at-risk', 'cancelled', 'completed'];

function isTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const segmentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  start: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  notes: z.string(),
});

const laneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  group: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  position: z.number().int().nonnegative(),
});

const activitySchema = z.object({
  id: z.string().min(1),
  segmentId: z.string().min(1),
  laneId: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(activityTypes),
  start: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().positive(),
  owner: z.string(),
  status: z.enum(activityStatuses),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  notes: z.string(),
});

const productionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    title: z.string().min(1),
    productionDate: z.iso.date(),
    venue: z.string().min(1),
    floorDirectors: z.array(z.string().min(1)).default([]),
    timezone: z.string().min(1).refine(isTimezone),
    plannedStart: z.iso.datetime({ offset: true }),
    plannedEnd: z.iso.datetime({ offset: true }),
    revision: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    segments: z.array(segmentSchema),
    lanes: z.array(laneSchema),
    activities: z.array(activitySchema),
  })
  .refine((value) => Date.parse(value.plannedEnd) > Date.parse(value.plannedStart), {
    path: ['plannedEnd'],
  })
  .superRefine((value, context) => {
    const productionStart = Date.parse(value.plannedStart);
    const productionEnd = Date.parse(value.plannedEnd);
    const segmentIds = new Set();
    const laneIds = new Set();
    for (const segment of value.segments) {
      const start = Date.parse(segment.start);
      const end = start + segment.durationMinutes * 60_000;
      if (segmentIds.has(segment.id)) context.addIssue({ code: 'custom', message: 'Segment identifiers must be unique.' });
      segmentIds.add(segment.id);
      if (start < productionStart || end > productionEnd) context.addIssue({ code: 'custom', message: 'Segment must stay within the Production planned run.' });
    }
    for (const lane of value.lanes) {
      if (laneIds.has(lane.id)) context.addIssue({ code: 'custom', message: 'Lane identifiers must be unique.' });
      laneIds.add(lane.id);
    }
    const activityIds = new Set();
    for (const activity of value.activities) {
      if (activityIds.has(activity.id)) context.addIssue({ code: 'custom', message: 'Activity identifiers must be unique.' });
      activityIds.add(activity.id);
      const segment = value.segments.find((item) => item.id === activity.segmentId);
      const start = Date.parse(activity.start);
      const end = start + activity.durationMinutes * 60_000;
      if (!segment || !laneIds.has(activity.laneId)) context.addIssue({ code: 'custom', message: 'Activity must reference an existing Segment and Lane.' });
      if (start < productionStart || end > productionEnd) context.addIssue({ code: 'custom', message: 'Activity must stay within the Production planned run.' });
    }
  });

const createProductionSchema = z
  .object({
    title: z.string().trim().min(1),
    productionDate: z.iso.date(),
    venue: z.string().trim().min(1),
    floorDirectors: z.array(z.string().trim().min(1)).default([]),
    timezone: z.string().min(1).refine(isTimezone),
    plannedStart: z.iso.datetime({ offset: true }),
    plannedEnd: z.iso.datetime({ offset: true }),
  })
  .refine((value) => Date.parse(value.plannedEnd) > Date.parse(value.plannedStart), {
    message: 'Production end must be after its start.',
    path: ['plannedEnd'],
  });

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'production';
}

function metadataMatches(record, metadata) {
  return record.title === metadata.title && record.productionDate === metadata.productionDate &&
    record.venue === metadata.venue && record.timezone === metadata.timezone &&
    record.plannedStart === metadata.plannedStart && record.plannedEnd === metadata.plannedEnd &&
    JSON.stringify(record.floorDirectors || []) === JSON.stringify(metadata.floorDirectors);
}

function createProductionRepository({ dataDir, seedDir }) {
  const productionPath = (id) => path.join(dataDir, `production-${id}.json`);
  const read = (filePath) => productionSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  const write = (production) => {
    const parsed = productionSchema.parse(production);
    fs.writeFileSync(productionPath(parsed.id), JSON.stringify(parsed, null, 2));
    return parsed;
  };

  return {
    list() {
      const records = [];
      const defaultPersisted = productionPath('default');
      const defaultSeed = path.join(seedDir, 'default.json');
      records.push(read(fs.existsSync(defaultPersisted) ? defaultPersisted : defaultSeed));

      for (const name of fs.readdirSync(dataDir)) {
        if (!/^production-[A-Za-z0-9_-]+\.json$/.test(name) || name === 'production-default.json') continue;
        try {
          records.push(read(path.join(dataDir, name)));
        } catch {
          // Invalid documents are excluded from summaries and still fail when opened directly.
        }
      }
      return records
        .map(({ id, title, productionDate, venue, floorDirectors, timezone, plannedStart, plannedEnd, revision, createdAt, updatedAt }) => ({
          id, title, productionDate, venue, floorDirectors, timezone, plannedStart, plannedEnd, revision, createdAt, updatedAt,
        }))
        .sort((a, b) => a.productionDate.localeCompare(b.productionDate) || a.title.localeCompare(b.title));
    },

    get(id) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
      const persistedPath = productionPath(id);
      if (fs.existsSync(persistedPath)) return read(persistedPath);
      if (id === 'default') return read(path.join(seedDir, 'default.json'));
      return null;
    },

    create(input) {
      const metadata = createProductionSchema.parse(input);
      const duplicate = this.list().find((item) => metadataMatches(item, metadata));
      if (duplicate) return this.get(duplicate.id);
      const base = slugify(metadata.title);
      let id = base;
      let suffix = 2;
      while (this.get(id)) id = `${base}-${suffix++}`;
      const now = new Date().toISOString();
      return write({
        schemaVersion: 1,
        id,
        ...metadata,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        segments: [],
        lanes: [],
        activities: [],
      });
    },

    save(id, input) {
      if (!/^[A-Za-z0-9_-]+$/.test(id) || input.id !== id) return null;
      const current = this.get(id);
      if (!current) return null;
      if (input.revision !== current.revision) {
        const conflict = new Error('This Production has a newer revision. Reload before saving.');
        conflict.code = 'REVISION_CONFLICT';
        throw conflict;
      }
      return write({ ...input, createdAt: current.createdAt, updatedAt: new Date().toISOString(), revision: current.revision + 1 });
    },
  };
}

module.exports = {
  activitySchema,
  createProductionRepository,
  createProductionSchema,
  laneSchema,
  productionSchema,
  segmentSchema,
};
