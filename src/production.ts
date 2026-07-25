import { z } from 'zod';

export const activityTypes = ['setup', 'entrance', 'performance', 'transition', 'exit', 'teardown', 'hold', 'custom'] as const;
export const activityStatuses = ['planned', 'confirmed', 'at-risk', 'cancelled', 'completed'] as const;

function isTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const segmentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  start: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  notes: z.string(),
});

export const laneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  group: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  position: z.number().int().nonnegative(),
});

export const activitySchema = z.object({
  id: z.string().min(1),
  segmentId: z.string().min(1),
  laneId: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(activityTypes),
  start: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().positive(),
  owner: z.string(),
  status: z.enum(activityStatuses),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  notes: z.string(),
});

export const productionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    title: z.string().min(1),
    productionDate: z.string().date(),
    venue: z.string().min(1),
    floorDirectors: z.array(z.string().min(1)).default([]),
    timezone: z.string().min(1).refine(isTimezone, 'Invalid IANA timezone.'),
    plannedStart: z.string().datetime({ offset: true }),
    plannedEnd: z.string().datetime({ offset: true }),
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    segments: z.array(segmentSchema),
    lanes: z.array(laneSchema),
    activities: z.array(activitySchema),
  })
  .refine((value) => Date.parse(value.plannedEnd) > Date.parse(value.plannedStart), {
    message: 'Production end must be after its start.',
    path: ['plannedEnd'],
  })
  .superRefine((value, context) => {
    const productionStart = Date.parse(value.plannedStart);
    const productionEnd = Date.parse(value.plannedEnd);
    const segmentIds = new Set<string>();
    const laneIds = new Set<string>();
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
    const activityIds = new Set<string>();
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

export type Segment = z.infer<typeof segmentSchema>;
export type Lane = z.infer<typeof laneSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Production = z.infer<typeof productionSchema>;
export type ProductionSummary = Pick<Production, 'id' | 'title' | 'productionDate' | 'venue' | 'floorDirectors' | 'timezone' | 'plannedStart' | 'plannedEnd' | 'revision' | 'createdAt' | 'updatedAt'>;
export type ProductionMetadata = Pick<Production, 'title' | 'productionDate' | 'venue' | 'floorDirectors' | 'timezone' | 'plannedStart' | 'plannedEnd'>;

export class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'RequestError';
  }
}

async function requestJson<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers },
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status >= 500) {
      throw new RequestError('The Production could not be loaded. Check your connection and try again.', response.status);
    }
    const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : `Request failed with ${response.status}.`;
    throw new RequestError(message, response.status);
  }
  return schema.parse(data);
}

const summarySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  title: z.string().min(1),
  productionDate: z.string().date(),
  venue: z.string().min(1),
  floorDirectors: z.array(z.string()).default([]),
  timezone: z.string().min(1).refine(isTimezone),
  plannedStart: z.string().datetime({ offset: true }),
  plannedEnd: z.string().datetime({ offset: true }),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const productionRepository = {
  list(signal?: AbortSignal) {
    return requestJson('/api/productions', z.array(summarySchema), { signal });
  },
  get(id: string, signal?: AbortSignal) {
    return requestJson(`/api/productions/${encodeURIComponent(id)}`, productionSchema, { signal });
  },
  create(metadata: ProductionMetadata) {
    return requestJson('/api/productions', productionSchema, { method: 'POST', body: JSON.stringify(metadata) });
  },
  save(production: Production) {
    return requestJson(`/api/productions/${encodeURIComponent(production.id)}`, productionSchema, {
      method: 'PUT',
      body: JSON.stringify(production),
    });
  },
};

export function endOf(start: string, durationMinutes: number) {
  return new Date(Date.parse(start) + durationMinutes * 60_000).toISOString();
}

export function timeToIso(production: Production, time: string) {
  return wallTimeToIso(production.productionDate, time, production.timezone);
}

export function wallTimeToIso(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = desiredWallTime;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const representedWallTime = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const correction = desiredWallTime - representedWallTime;
    instant += correction;
    if (correction === 0) break;
  }
  const desiredKey = `${date}T${time}:00`;
  const roundTripKey = (candidate: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const candidates = [
    instant - 2 * 60 * 60_000,
    instant - 60 * 60_000,
    instant - 30 * 60_000,
    instant,
    instant + 30 * 60_000,
    instant + 60 * 60_000,
    instant + 2 * 60 * 60_000,
  ].filter((candidate, index, all) => all.indexOf(candidate) === index && roundTripKey(candidate) === desiredKey);
  if (!candidates.length) {
    throw new RangeError(`The wall-clock time ${date} ${time} does not exist in ${timezone}.`);
  }
  return new Date(Math.min(...candidates)).toISOString();
}

export function isoToTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone,
  }).format(new Date(iso));
}

export function uniqueId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
