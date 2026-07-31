import { uniqueId, type Activity, type Lane, type Production, type Segment } from './production';

type LegacyCell = { t: string; b: string } | string | '';

type LegacySegment = {
  label: string;
  start: string;
  end: string;
  cols: number;
};

type LegacyRow = {
  task: string;
  oic: string;
  start: string;
  appearances: string;
  cells: LegacyCell[];
};

export const TEMPLATE_SPAN_MINUTES = 420;

const legacySegments: LegacySegment[] = [
  { label: 'PRAISE & WORSHIP', start: '8AM', end: '9AM', cols: 4 },
  { label: 'CHOIR PRODUCTION', start: '9AM', end: '10AM', cols: 5 },
  { label: 'DANCE PRODUCTION', start: '10AM', end: '11AM', cols: 5 },
  { label: 'AWARDING', start: '11AM', end: '12PM', cols: 4 },
  { label: 'PREACHING PROPER', start: '12PM', end: '2PM', cols: 6 },
  { label: 'END PROD', start: '2PM', end: '3PM', cols: 4 },
];

const textColors: Record<string, string> = {
  Band: '#4a148c',
  Choir: '#6a1b9a',
  Dance: '#e65100',
  SM: '#283593',
  Dir: '#c62828',
  Run: '#00838f',
  Full: '#2e7d32',
};

const tagTypes: Record<string, Activity['type']> = {
  Band: 'performance',
  Choir: 'performance',
  Dance: 'performance',
  SM: 'custom',
  Dir: 'performance',
  Run: 'setup',
  Full: 'setup',
};

const segmentColors = ['#6cb87a', '#7cc5d9', '#e0b25c', '#b08fd9', '#8bc07a', '#d9a5b0'];

const legacyRows: LegacyRow[] = [
  { task: 'BAND / MUSICIANS', oic: 'JOMER', start: '8AM', appearances: '6', cells: ['Band', 'Band', 'Band', 'Band', 'Band', 'Band', 'Band', 'Band', 'Band', '', '', '', '', '', '', '', '', 'Band', 'Band', 'Band', 'Band', 'Band', 'Band', 'Band', 'Band', 'Band', 'Band'] },
  { task: 'CHOIR', oic: 'NIKKA', start: '9AM', appearances: '4', cells: ['', '', '', '', 'Choir', 'Choir', 'Choir', 'Choir', 'Choir', 'Choir', 'Choir', 'Choir', 'Choir', 'Choir', '', '', '', '', '', '', '', '', '', '', '', '', '', ''] },
  { task: 'DANCERS', oic: 'MIKAS', start: '10AM', appearances: '3', cells: ['', '', '', '', '', '', '', '', '', 'Dance', 'Dance', 'Dance', 'Dance', 'Dance', 'Dance', 'Dance', 'Dance', 'Dance', '', '', '', '', '', '', '', '', '', ''] },
  { task: 'LIGHTS', oic: 'KIM', start: '8AM', appearances: '7', cells: ['Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run'] },
  { task: 'SOUND', oic: 'HANS', start: '8AM', appearances: '7', cells: ['Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run'] },
  { task: 'SCREEN / LED', oic: 'JAJA', start: '8AM', appearances: '7', cells: ['Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run', 'Run'] },
  { task: 'STAGE / SET', oic: 'ELLA', start: '8AM', appearances: '7', cells: ['Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full'] },
  { task: 'PRODUCTION', oic: 'MITCH', start: '8AM', appearances: '7', cells: ['SM', 'SM', 'SM', 'SM', 'SM', 'SM', 'SM', 'SM', 'SM', 'SM', 'SM', 'SM', 'SM', 'SM', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir', 'Dir'] },
];

function parseLegacyTime(value: string): number {
  const match = /^(\d{1,2})(AM|PM)$/i.exec(value.trim());
  if (!match) throw new Error(`Unknown legacy time: ${value}`);
  let hour = Number(match[1]);
  if (match[2].toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (match[2].toUpperCase() === 'AM' && hour === 12) hour = 0;
  return hour * 60;
}

function cellText(cell: LegacyCell): string {
  if (!cell) return '';
  return typeof cell === 'string' ? cell : cell.t || '';
}

export function seedFromTemplate(production: Production): Production {
  const startMs = Date.parse(production.plannedStart);
  let cursor = startMs;

  const segments: Segment[] = legacySegments.map((legacy, position) => {
    const durationMinutes = parseLegacyTime(legacy.end) - parseLegacyTime(legacy.start);
    const segment: Segment = {
      id: uniqueId('segment'),
      label: legacy.label,
      color: segmentColors[position % segmentColors.length],
      start: new Date(cursor).toISOString(),
      durationMinutes,
      position,
      notes: '',
    };
    cursor += durationMinutes * 60_000;
    return segment;
  });

  const lanes: Lane[] = legacyRows.map((row, position) => ({
    id: uniqueId('lane'),
    label: row.task,
    group: 'Team',
    color: '#6a9fd8',
    position,
  }));

  const activities: Activity[] = [];
  legacyRows.forEach((row, rowIndex) => {
    let column = 0;
    legacySegments.forEach((legacy, segmentIndex) => {
      const segment = segments[segmentIndex];
      const segmentStartMs = Date.parse(segment.start);
      const columnDurationMs = (segment.durationMinutes * 60_000) / legacy.cols;
      const slice = row.cells.slice(column, column + legacy.cols);
      const blocks: Array<{ tag: string; startOffset: number; count: number }> = [];
      slice.forEach((cell, offset) => {
        const tag = cellText(cell);
        if (!tag) return;
        const previous = blocks[blocks.length - 1];
        if (previous && previous.tag === tag) previous.count += 1;
        else blocks.push({ tag, startOffset: offset, count: 1 });
      });
      for (const block of blocks) {
        const { tag } = block;
        activities.push({
          id: uniqueId('activity'),
          segmentId: segment.id,
          laneId: lanes[rowIndex].id,
          label: tag,
          type: tagTypes[tag] || 'custom',
          start: new Date(segmentStartMs + block.startOffset * columnDurationMs).toISOString(),
          durationMinutes: Math.max(1, Math.round((block.count * columnDurationMs) / 60_000)),
          owner: row.oic,
          status: 'planned',
          color: textColors[tag] || '#d96c4f',
          notes: '',
        });
      }
      column += legacy.cols;
    });
  });

  return { ...production, segments, lanes, activities };
}
