import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ZodError } from 'zod';
import {
  activityStatuses,
  activityTypes,
  endOf,
  isoToTime,
  productionRepository,
  RequestError,
  timeToIso,
  uniqueId,
  wallTimeToIso,
  type Activity,
  type Lane,
  type Production,
  type ProductionMetadata,
  type ProductionSummary,
  type Segment,
} from './production';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'loaded'; value: T }
  | { status: 'error'; message: string; statusCode?: number };

type EditorMode = 'timeline' | 'sequence';
type EditorPanel = 'segment' | 'lane' | 'activity' | 'floor-directors' | null;

const buttonPrimary = 'rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300';
const buttonSecondary = 'rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300';
const buttonDanger = 'rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300';
const fieldClass = 'mt-1 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-300';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

function formatDate(date: string) {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function formatTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  }).format(new Date(iso));
}

function errorMessage(error: unknown) {
  if (error instanceof ZodError) return 'The Production data is invalid.';
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function navigate(productionId?: string, created = false) {
  const url = productionId ? `/app/?production=${encodeURIComponent(productionId)}${created ? '&created=1' : ''}` : '/app/';
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function App() {
  const [route, setRoute] = useState(() => new URLSearchParams(window.location.search).get('production'));

  useEffect(() => {
    const onRoute = () => setRoute(new URLSearchParams(window.location.search).get('production'));
    window.addEventListener('popstate', onRoute);
    return () => window.removeEventListener('popstate', onRoute);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <a className="sr-only fixed left-3 top-3 z-50 rounded bg-emerald-300 px-3 py-2 font-semibold text-slate-950 focus:not-sr-only" href="#main-content">Skip to production</a>
      <AppHeader inEditor={Boolean(route)} />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1600px] px-4 py-7 outline-none sm:px-7 sm:py-10">
        {route ? <ProductionEditor productionId={route} /> : <ProductionHome />}
      </main>
    </div>
  );
}

function AppHeader({ inEditor }: { inEditor: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-7">
        <button className="rounded-sm text-sm font-bold tracking-[0.18em] text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" onClick={() => navigate()} type="button">STAGEFLOW</button>
        <nav aria-label="Application" className="flex items-center gap-2">
          {inEditor && <a className={buttonSecondary} href="/app/">All productions</a>}
          <a className={buttonSecondary} href="/staging_gantt-chart.html">Open legacy Gantt chart</a>
        </nav>
      </div>
    </header>
  );
}

function ProductionHome() {
  const [state, setState] = useState<LoadState<ProductionSummary[]>>({ status: 'loading' });
  const [creating, setCreating] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = () => {
    controller.current?.abort();
    controller.current = new AbortController();
    setState({ status: 'loading' });
    productionRepository.list(controller.current.signal)
      .then((value) => setState({ status: 'loaded', value }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error', message: errorMessage(error), statusCode: error instanceof RequestError ? error.status : undefined });
      });
  };

  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, []);

  return (
    <>
      <section className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Production workspace</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Run every show from one timeline.</h1>
          <p className="mt-4 max-w-2xl text-slate-400">Create a Production, map its Segments, place stage Activities, then read the complete Run of Show.</p>
        </div>
        <button className={buttonPrimary} type="button" onClick={() => setCreating(true)}>New production</button>
      </section>

      {state.status === 'loading' && <Loading label="Loading productions..." />}
      {state.status === 'error' && (state.statusCode === 404 ? <ApiUnavailableState retry={load} /> : <ErrorState message={state.message} retry={load} />)}
      {state.status === 'loaded' && (
        <section aria-labelledby="productions-title" className="mt-10">
          <h2 id="productions-title" className="text-lg font-semibold">Productions</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {state.value.map((production) => (
              <a key={production.id} className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:-translate-y-0.5 hover:border-emerald-300/40 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" href={`/app/?production=${encodeURIComponent(production.id)}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-semibold group-hover:text-emerald-200">{production.title}</h3>
                    <p className="mt-1 text-sm text-slate-400">{production.venue}</p>
                  </div>
                  <span aria-hidden="true" className="text-emerald-300">&#8594;</span>
                </div>
                <dl className="mt-6 text-sm">
                  <div><dt className="text-slate-500">Date</dt><dd className="mt-1">{formatDate(production.productionDate)}</dd></div>
                </dl>
              </a>
            ))}
          </div>
        </section>
      )}

      {creating && <CreateProductionPanel close={() => setCreating(false)} />}
    </>
  );
}

function CreateProductionPanel({ close }: { close: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get('date'));
    const start = String(form.get('start'));
    const end = String(form.get('end'));
    if (end <= start) {
      setError('Production end must be after its start.');
      return;
    }
    const timezone = String(form.get('timezone'));
    let metadata: ProductionMetadata;
    try {
      metadata = {
        title: String(form.get('title')).trim(),
        productionDate: date,
        venue: String(form.get('venue')).trim(),
        floorDirectors: String(form.get('floorDirectors')).split(/[,\n]/).map((name) => name.trim()).filter(Boolean),
        timezone,
        plannedStart: wallTimeToIso(date, start, timezone),
        plannedEnd: wallTimeToIso(date, end, timezone),
      };
    } catch (caught) {
      setError(errorMessage(caught));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const production = await productionRepository.create(metadata);
      navigate(production.id, true);
    } catch (caught) {
      setError(errorMessage(caught));
      setSaving(false);
    }
  };

  return (
    <Panel title="New production" close={close}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Production title"><input className={fieldClass} name="title" required /></Field>
        <Field label="Production date"><input className={fieldClass} name="date" type="date" required /></Field>
        <Field label="Venue"><input className={fieldClass} name="venue" required /></Field>
        <Field label="Floor Directors"><textarea className={fieldClass} name="floorDirectors" placeholder="Add names separated by commas" rows={2} /></Field>
        <details className="rounded-lg border border-slate-300 p-3"><summary className="cursor-pointer font-semibold">Optional timing</summary><div className="mt-3 space-y-3"><Field label="Timezone"><select className={fieldClass} name="timezone" defaultValue="Asia/Manila"><option>Asia/Manila</option><option>UTC</option><option>America/New_York</option><option>Europe/London</option></select></Field><div className="grid grid-cols-2 gap-3"><Field label="Planned start"><input className={fieldClass} defaultValue="08:00" name="start" type="time" required /></Field><Field label="Planned end"><input className={fieldClass} defaultValue="20:00" name="end" type="time" required /></Field></div></div></details>
        {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
        <button className={`${buttonPrimary} w-full`} disabled={saving} type="submit">{saving ? 'Creating...' : 'Create production'}</button>
      </form>
    </Panel>
  );
}

function ProductionEditor({ productionId }: { productionId: string }) {
  const savingRef = useRef(false);
  const [state, setState] = useState<LoadState<Production>>({ status: 'loading' });
  const [mode, setMode] = useState<EditorMode>(() => window.matchMedia('(max-width: 767px)').matches ? 'sequence' : 'timeline');
  const [panel, setPanel] = useState<EditorPanel>(null);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [activityPlacement, setActivityPlacement] = useState<{ segmentId: string; laneId: string } | null>(null);
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [segmentInsertAfterId, setSegmentInsertAfterId] = useState<string | null>(null);
  const [laneInsertAfterId, setLaneInsertAfterId] = useState<string | null>(null);
  const [collapsedSegments, setCollapsedSegments] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState(() => new URLSearchParams(window.location.search).get('created') === '1' ? 'Saved' : 'Production loaded');
  const [operationError, setOperationError] = useState('');
  const controller = useRef<AbortController | null>(null);

  const load = () => {
    controller.current?.abort();
    controller.current = new AbortController();
    setState({ status: 'loading' });
    productionRepository.get(productionId, controller.current.signal)
      .then((value) => setState({ status: 'loaded', value }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error', message: errorMessage(error), statusCode: error instanceof RequestError ? error.status : undefined });
      });
  };

  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, [productionId]);

  const persist = async (next: Production) => {
    if (savingRef.current) throw new Error('Another save is already in progress.');
    savingRef.current = true;
    setSaveState('Saving...');
    try {
      const saved = await productionRepository.save(next);
      setState({ status: 'loaded', value: saved });
      setSaveState('Saved');
      return saved;
    } catch (error) {
      setSaveState('Save failed');
      throw error;
    } finally {
      savingRef.current = false;
    }
  };

  if (state.status === 'loading') return <Loading label="Loading Production..." />;
  if (state.status === 'error') return state.statusCode === 404 ? <NotFoundState /> : <ErrorState message={state.message} retry={load} />;
  const production = state.value;

  const openActivity = (activity?: Activity, placement?: { segmentId: string; laneId: string }) => {
    setSelectedActivity(activity || null);
    setActivityPlacement(placement || null);
    setPanel('activity');
  };

  const addActivity = async () => {
    setOperationError('');
    let next = production;
    if (!next.segments.length) {
      next = {
        ...next,
        segments: [{
          id: uniqueId('segment'), label: 'Show', color: '#6cb87a', start: next.plannedStart,
          durationMinutes: Math.max(1, Math.floor((Date.parse(next.plannedEnd) - Date.parse(next.plannedStart)) / 60_000)),
          position: 0, notes: 'Starter Segment created for Activities.',
        }],
      };
    }
    if (!next.lanes.length) {
      next = {
        ...next,
        lanes: [{ id: uniqueId('lane'), label: 'General', group: 'Stage', color: '#6a9fd8', position: 0 }],
      };
    }
    try {
      if (next !== production) await persist(next);
      openActivity();
    } catch (caught) {
      setOperationError(errorMessage(caught));
    }
  };

  return (
    <>
      <section className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Production timeline</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-6xl">{production.title}</h1>
          <p className="mt-3 text-slate-600">{production.venue} / {formatDate(production.productionDate)}</p>
          <p className="mt-2 text-sm text-slate-600"><strong>Floor Directors:</strong> {production.floorDirectors.length ? production.floorDirectors.join(', ') : 'Not assigned'}</p>
        </div>
        <div className="flex items-center gap-2"><div aria-label="Save status" className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-200">{saveState}</div><button className={buttonPrimary} disabled={saveState === 'Saving...'} onClick={async () => { setOperationError(''); try { await persist(production); } catch (caught) { setOperationError(errorMessage(caught)); } }} type="button">Save now</button></div>
      </section>

      <dl aria-label="Production details" className="mt-7 grid gap-px overflow-hidden rounded-2xl border border-slate-300 bg-slate-300 sm:grid-cols-3">
        <Detail label="Date" value={formatDate(production.productionDate)} />
        <Detail label="Venue" value={production.venue} />
        <Detail label="Floor Directors" value={production.floorDirectors.join(', ') || 'Not assigned'} />
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <button className={buttonPrimary} type="button" onClick={() => { setEditingSegment(null); setSegmentInsertAfterId(null); setPanel('segment'); }}>Add segment</button>
        <button className={buttonSecondary} type="button" onClick={() => { setLaneInsertAfterId(null); setPanel('lane'); }}>Add lane</button>
        <button className={buttonSecondary} type="button" onClick={addActivity}>Add activity</button>
        <button className={buttonSecondary} type="button" onClick={() => setPanel('floor-directors')}>Edit Floor Directors</button>
        <div className="ml-auto flex rounded-lg border border-white/10 p-1" role="group" aria-label="Production view">
          <button aria-pressed={mode === 'timeline'} className={`rounded-md px-3 py-1.5 text-sm ${mode === 'timeline' ? 'bg-white/15 text-white' : 'text-slate-400'}`} onClick={() => setMode('timeline')} type="button">Timeline</button>
          <button aria-pressed={mode === 'sequence'} className={`rounded-md px-3 py-1.5 text-sm ${mode === 'sequence' ? 'bg-white/15 text-white' : 'text-slate-400'}`} onClick={() => setMode('sequence')} type="button">Run of Show</button>
        </div>
      </div>
      {operationError && <p className="mt-3 rounded-lg border border-red-300/20 bg-red-300/10 p-3 text-sm text-red-200" role="alert">{operationError}</p>}

      {mode === 'timeline' ? (
        <Timeline
          production={production}
          collapsed={collapsedSegments}
          editSegment={(segment) => { setEditingSegment(segment); setSegmentInsertAfterId(null); setPanel('segment'); }}
          moveSegment={async (id, direction) => {
            setOperationError('');
            try { await persist(reorderSegment(production, id, direction)); }
            catch (caught) { setOperationError(errorMessage(caught)); }
          }}
          toggleSegment={(id) => setCollapsedSegments((current) => {
            const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next;
          })}
          editActivity={openActivity}
          reorderSegments={async (sourceId, targetId) => {
            const ordered = [...production.segments].sort((a, b) => a.position - b.position);
            const sourceIndex = ordered.findIndex((segment) => segment.id === sourceId);
            const targetIndex = ordered.findIndex((segment) => segment.id === targetId);
            if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
            const [moved] = ordered.splice(sourceIndex, 1); ordered.splice(targetIndex, 0, moved);
            try { await persist({ ...production, segments: ordered.map((segment, position) => ({ ...segment, position })) }); }
            catch (caught) { setOperationError(errorMessage(caught)); }
          }}
          moveActivity={async (activityId, segmentId, laneId, beforeActivityId) => {
            const targetSegment = production.segments.find((item) => item.id === segmentId);
            const movedActivity = production.activities.find((item) => item.id === activityId);
            if (!targetSegment || !movedActivity) return;
            const sourceSegment = production.segments.find((item) => item.id === movedActivity.segmentId);
            const sourceOffset = sourceSegment ? Math.max(0, Date.parse(movedActivity.start) - Date.parse(sourceSegment.start)) : 0;
            const maximumOffset = Math.max(0, targetSegment.durationMinutes - 1) * 60_000;
            const start = movedActivity.segmentId === segmentId
              ? movedActivity.start
              : new Date(Date.parse(targetSegment.start) + Math.min(sourceOffset, maximumOffset)).toISOString();
            const durationMinutes = Math.min(movedActivity.durationMinutes, Math.max(1, Math.floor((Date.parse(production.plannedEnd) - Date.parse(start)) / 60_000)));
            const moved = { ...movedActivity, segmentId, laneId, start, durationMinutes };
            const activities = production.activities.filter((activity) => activity.id !== activityId);
            const beforeIndex = beforeActivityId ? activities.findIndex((activity) => activity.id === beforeActivityId) : -1;
            if (beforeIndex >= 0) activities.splice(beforeIndex, 0, moved);
            else {
              let insertIndex = activities.length;
              for (let index = activities.length - 1; index >= 0; index -= 1) {
                if (activities[index].segmentId === segmentId && activities[index].laneId === laneId) { insertIndex = index + 1; break; }
              }
              activities.splice(insertIndex, 0, moved);
            }
            try { await persist({ ...production, activities }); }
            catch (caught) { setOperationError(errorMessage(caught)); }
          }}
          resizeActivity={async (activityId, requestedDuration) => {
            const activity = production.activities.find((item) => item.id === activityId);
            if (!activity) return false;
            const maximumDuration = Math.max(1, Math.floor((Date.parse(production.plannedEnd) - Date.parse(activity.start)) / 60_000));
            const durationMinutes = Math.max(1, Math.min(requestedDuration, maximumDuration));
            try { await persist({ ...production, activities: production.activities.map((item) => item.id === activityId ? { ...item, durationMinutes } : item) }); return true; }
            catch (caught) { setOperationError(errorMessage(caught)); return false; }
          }}
          addActivityAt={(segmentId, laneId) => openActivity(undefined, { segmentId, laneId })}
          addLane={() => { setLaneInsertAfterId(null); setPanel('lane'); }}
          addLaneAfter={(laneId) => { setLaneInsertAfterId(laneId); setPanel('lane'); }}
          addSegment={() => { setEditingSegment(null); setSegmentInsertAfterId(null); setPanel('segment'); }}
          addSegmentAfter={(segmentId) => { setEditingSegment(null); setSegmentInsertAfterId(segmentId); setPanel('segment'); }}
          deleteLane={async (lane) => {
            const affected = production.activities.filter((activity) => activity.laneId === lane.id).length;
            if (!window.confirm(`Delete ${lane.label}? This will also delete ${affected} assigned ${affected === 1 ? 'Activity' : 'Activities'}.`)) return;
            setOperationError('');
            try { await persist({ ...production, lanes: production.lanes.filter((item) => item.id !== lane.id), activities: production.activities.filter((activity) => activity.laneId !== lane.id) }); }
            catch (caught) { setOperationError(errorMessage(caught)); }
          }}
        />
      ) : <SequenceView production={production} editActivity={openActivity} />}

      {panel === 'segment' && <SegmentPanel production={production} segment={editingSegment} insertAfterSegmentId={segmentInsertAfterId} close={() => { setSegmentInsertAfterId(null); setPanel(null); }} save={persist} deleteSegment={async (target) => {
        const affected = production.activities.filter((activity) => activity.segmentId === target.id).length;
        if (!window.confirm(`Delete ${target.label}? This will also delete ${affected} assigned ${affected === 1 ? 'Activity' : 'Activities'}.`)) return;
        await persist({
          ...production,
          segments: production.segments.filter((item) => item.id !== target.id),
          activities: production.activities.filter((activity) => activity.segmentId !== target.id),
        });
        setPanel(null);
      }} />}
      {panel === 'lane' && <LanePanel production={production} insertAfterLaneId={laneInsertAfterId} close={() => { setLaneInsertAfterId(null); setPanel(null); }} save={persist} />}
      {panel === 'floor-directors' && <FloorDirectorPanel production={production} close={() => setPanel(null)} save={persist} />}
      {panel === 'activity' && <ActivityPanel production={production} activity={selectedActivity} placement={activityPlacement} close={() => setPanel(null)} save={persist} deleteActivity={async (target) => {
        if (!window.confirm(`Delete ${target.label}?`)) return;
        await persist({ ...production, activities: production.activities.filter((item) => item.id !== target.id) });
        setPanel(null);
      }} />}
    </>
  );
}

function Timeline({ production, collapsed, editSegment, moveSegment, toggleSegment, editActivity, deleteLane, reorderSegments, moveActivity, resizeActivity, addActivityAt, addLane, addLaneAfter, addSegment, addSegmentAfter }: {
  production: Production;
  collapsed: Set<string>;
  editSegment: (segment: Segment) => void;
  moveSegment: (id: string, direction: -1 | 1) => void;
  toggleSegment: (id: string) => void;
  editActivity: (activity: Activity) => void;
  deleteLane: (lane: Lane) => void;
  reorderSegments: (sourceId: string, targetId: string) => void;
  moveActivity: (activityId: string, segmentId: string, laneId: string, beforeActivityId?: string) => void;
  resizeActivity: (activityId: string, durationMinutes: number) => Promise<boolean>;
  addActivityAt: (segmentId: string, laneId: string) => void;
  addLane: () => void;
  addLaneAfter: (laneId: string) => void;
  addSegment: () => void;
  addSegmentAfter: (segmentId: string) => void;
}) {
  const segments = [...production.segments].sort((a, b) => a.position - b.position);

  return (
    <section aria-labelledby="timeline-title" className="mt-6 overflow-hidden rounded-xl border border-slate-400 bg-white shadow-sm">
      <div className="group/boardtools flex items-center justify-between gap-4 border-b border-slate-300 bg-slate-100 p-4" data-testid="board-add-controls"><div><h2 id="timeline-title" className="text-lg font-bold">Stage Sequence Board</h2><p className="text-sm text-slate-600">Drag colored Segments to reorder the show. Drag Activities into any Lane and Segment cell.</p></div><div className="flex shrink-0 gap-2 opacity-0 transition group-hover/boardtools:opacity-100 group-focus-within/boardtools:opacity-100" data-testid="board-add-buttons"><button aria-label="Create board lane" className="rounded-full border border-emerald-700 bg-white px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50" onClick={addLane} type="button">+ Lane</button><button aria-label="Create board column" className="rounded-full border border-emerald-700 bg-white px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50" onClick={addSegment} type="button">+ Segment</button></div></div>
      {!segments.length && <div className="border-b border-slate-300 p-5 text-center"><h3 className="font-semibold">Build the run of show</h3><p className="mt-1 text-sm text-slate-600">Add the first Segment. Existing Lanes remain available below.</p></div>}
      <div className="overflow-x-auto">
        <div className="min-w-[900px] pb-5 pr-8" style={{ minWidth: `${Math.max(900, 220 + segments.length * 190)}px` }}>
          <div className="grid border-b border-slate-400 bg-slate-200" style={{ gridTemplateColumns: `220px repeat(${Math.max(segments.length, 1)}, minmax(180px, 1fr))` }} data-testid="segment-header">
            <div className="sticky left-0 z-10 border-r border-slate-400 bg-slate-200 p-4 text-xs font-bold uppercase tracking-wider text-slate-700">Lane / Team</div>
            {segments.length ? (
              segments.map((segment, index) => (
                <div draggable key={segment.id} className="group/segment relative min-h-24 cursor-grab border-r border-black/30 p-3 text-slate-950 last:border-0" data-testid={`segment-column-header-${segment.id}`} onDragStart={(event) => event.dataTransfer.setData('application/x-stageflow-segment', segment.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('application/x-stageflow-segment'); if (sourceId) reorderSegments(sourceId, segment.id); }} style={{ backgroundColor: segment.color }}>
                  <button className="w-full text-left font-bold" data-segment-name onClick={() => editSegment(segment)} type="button">{segment.label}</button>
                  <p className="mt-1 text-xs font-medium opacity-75">Drag to reorder</p>
                  <div className="mt-2 flex gap-1">
                    <button aria-label={`Move ${segment.label} earlier`} disabled={index === 0} onClick={() => moveSegment(segment.id, -1)} type="button">&#8592;</button>
                    <button aria-label={`Move ${segment.label} later`} disabled={index === segments.length - 1} onClick={() => moveSegment(segment.id, 1)} type="button">&#8594;</button>
                    <button aria-label={`${collapsed.has(segment.id) ? 'Expand' : 'Collapse'} ${segment.label}`} onClick={() => toggleSegment(segment.id)} type="button">{collapsed.has(segment.id) ? '+' : '-'}</button>
                  </div>
                  <button aria-label={`Create column after ${segment.label}`} className="absolute right-0 top-1/2 z-20 -translate-y-1/2 translate-x-1/2 rounded-full border border-emerald-700 bg-white px-2 py-1 text-xs font-bold text-emerald-700 opacity-0 shadow transition hover:bg-emerald-50 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-700 group-hover/segment:opacity-100" onClick={(event) => { event.stopPropagation(); addSegmentAfter(segment.id); }} type="button">+ Column</button>
                </div>
              ))
            ) : <div className="p-4 text-sm text-slate-600">Add a Segment to begin.</div>}
          </div>

          {production.lanes.length ? [...production.lanes].sort((a, b) => a.position - b.position).map((lane) => (
            <div key={lane.id} className="grid min-h-28 border-b border-slate-300 last:border-0" style={{ gridTemplateColumns: `220px repeat(${Math.max(segments.length, 1)}, minmax(180px, 1fr))` }}>
              <div className="group/lanerow sticky left-0 z-10 border-r border-slate-400 bg-slate-100 p-4 hover:z-20 focus-within:z-20" data-testid={`lane-row-header-${lane.id}`}>
                <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{lane.label}</p><p className="text-xs text-slate-500">{lane.group}</p></div><button aria-label={`Delete lane ${lane.label}`} className="text-xs text-red-300 hover:text-red-200" onClick={() => deleteLane(lane)} type="button">Delete</button></div>
                <button aria-label={`Create row after ${lane.label}`} className="absolute bottom-0 left-1/2 z-20 -translate-x-1/2 translate-y-1/2 rounded-full border border-emerald-700 bg-white px-2 py-1 text-xs font-bold text-emerald-700 opacity-0 shadow transition hover:bg-emerald-50 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-700 group-hover/lanerow:opacity-100" onClick={() => addLaneAfter(lane.id)} type="button">+ Row</button>
              </div>
              {segments.map((segment) => <div aria-label={`${lane.label}, ${segment.label} drop zone`} key={segment.id} className="group/cell relative flex min-h-28 items-start gap-2 overflow-visible border-r border-slate-300 bg-white p-2 last:border-0" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const activityId = event.dataTransfer.getData('application/x-stageflow-activity'); if (activityId) moveActivity(activityId, segment.id, lane.id); }}>{!collapsed.has(segment.id) && production.activities.filter((activity) => activity.laneId === lane.id && activity.segmentId === segment.id).map((activity) => <ActivityCard activity={activity} editActivity={editActivity} key={activity.id} lane={lane} moveActivity={moveActivity} resizeActivity={resizeActivity} segment={segment} />)}<button aria-label={`Create activity in ${lane.label}, ${segment.label}`} className="sticky right-1 top-1 ml-auto h-8 w-8 flex-none rounded-full border border-emerald-700 bg-white text-lg font-bold text-emerald-700 opacity-0 shadow transition hover:bg-emerald-50 focus:opacity-100 group-hover/cell:opacity-100" onClick={() => addActivityAt(segment.id, lane.id)} type="button">+</button></div>)}
            </div>
          )) : <div className="p-8 text-center text-slate-400">Add a Lane to place Activities on the Timeline.</div>}
        </div>
      </div>
    </section>
  );
}

function ActivityCard({ activity, lane, segment, editActivity, moveActivity, resizeActivity }: { activity: Activity; lane: Lane; segment: Segment; editActivity: (activity: Activity) => void; moveActivity: (activityId: string, segmentId: string, laneId: string, beforeActivityId?: string) => void; resizeActivity: (activityId: string, durationMinutes: number) => Promise<boolean> }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState(180);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  useEffect(() => { const cell = cardRef.current?.parentElement; if (!cell) return; const update = () => setColumnWidth(Math.max(180, cell.getBoundingClientRect().width - 16)); update(); const observer = new ResizeObserver(update); observer.observe(cell); return () => observer.disconnect(); }, []);
  const width = Math.max(100, activity.durationMinutes / Math.max(1, segment.durationMinutes) * columnWidth);
  const resizeBy = async (minutes: number) => { if (resizing) return; setResizing(true); await resizeActivity(activity.id, Math.max(1, activity.durationMinutes + minutes)); setPreviewWidth(null); setResizing(false); };
  return <div className="relative z-10 flex-none" ref={cardRef} style={{ width: `${previewWidth ?? width}px` }}>
    <button aria-label={`${activity.label}, ${lane.label}, ${segment.label}, ${activity.status}`} draggable className="block w-full cursor-grab rounded-md border border-black/25 px-3 py-2 pr-7 text-left text-xs font-bold text-slate-950 shadow-sm" onClick={() => editActivity(activity)} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const activityId = event.dataTransfer.getData('application/x-stageflow-activity'); if (activityId && activityId !== activity.id) moveActivity(activityId, segment.id, lane.id, activity.id); }} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData('application/x-stageflow-activity', activity.id); }} style={{ backgroundColor: activity.color }} type="button"><span className="block">{activity.label}</span><span className="mt-1 block text-[10px] font-medium opacity-70">{activity.owner || activity.type}</span></button>
    <button aria-label={`Resize ${activity.label}`} className="absolute bottom-1 right-1 top-1 z-20 w-4 cursor-ew-resize rounded border border-black/30 bg-white/70 text-[10px] font-bold text-slate-700 opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-700" disabled={resizing} onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); void resizeBy(5); } if (event.key === 'ArrowLeft') { event.preventDefault(); void resizeBy(-5); } }} onMouseDown={(event) => { if (resizing) return; event.preventDefault(); event.stopPropagation(); const startX = event.clientX; const startDuration = activity.durationMinutes; const move = (mouseEvent: MouseEvent) => setPreviewWidth(Math.max(100, width + mouseEvent.clientX - startX)); const up = async (mouseEvent: MouseEvent) => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setResizing(true); const minutesPerPixel = Math.max(1, segment.durationMinutes) / columnWidth; await resizeActivity(activity.id, Math.max(1, Math.round(startDuration + (mouseEvent.clientX - startX) * minutesPerPixel))); setPreviewWidth(null); setResizing(false); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); }} type="button">&#8646;</button>
  </div>;
}

function SequenceView({ production, editActivity }: { production: Production; editActivity: (activity: Activity) => void }) {
  const segmentPositions = new Map(production.segments.map((segment) => [segment.id, segment.position]));
  const sourcePositions = new Map(production.activities.map((activity, index) => [activity.id, index]));
  const sorted = [...production.activities].sort((a, b) => (segmentPositions.get(a.segmentId) ?? 0) - (segmentPositions.get(b.segmentId) ?? 0) || (sourcePositions.get(a.id) ?? 0) - (sourcePositions.get(b.id) ?? 0));
  const laneMap = new Map(production.lanes.map((lane) => [lane.id, lane]));
  const segmentMap = new Map(production.segments.map((segment) => [segment.id, segment]));

  if (!sorted.length) return <EmptyState title="No Activities in the Run of Show" body="Add a Lane and Activity to create the chronological sequence." />;

  let previousSegment = '';
  return (
    <section aria-labelledby="sequence-title" className="mx-auto mt-6 max-w-4xl">
      <h2 id="sequence-title" className="text-2xl font-semibold">Run of Show</h2>
      <p className="mt-2 text-sm text-slate-600">Activities follow the draggable Segment order. No clock timing is required.</p>
      <ol className="mt-5 space-y-3">
        {sorted.map((activity) => {
          const segment = segmentMap.get(activity.segmentId);
          const lane = laneMap.get(activity.laneId);
          const showSegment = activity.segmentId !== previousSegment;
          previousSegment = activity.segmentId;
          return <li key={activity.id}>
            {showSegment && <div className="mb-3 mt-7 flex items-center gap-3"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: segment?.color }} /><h3 className="font-semibold text-slate-300">{segment?.label || 'Unassigned Segment'}</h3></div>}
            <button aria-label={`Edit ${activity.label}`} className="grid w-full gap-4 rounded-xl border border-slate-300 bg-white p-4 text-left transition sm:grid-cols-[1fr_auto]" onClick={() => editActivity(activity)} type="button">
              <div><p className="font-semibold">{activity.label}</p><p className="mt-1 text-sm text-slate-400">{lane?.label} / {activity.owner || 'Unassigned'} / {activity.type}</p>{activity.notes && <p className="mt-2 text-sm text-slate-500">{activity.notes}</p>}</div>
              <div className="flex items-start gap-2"><span className="rounded-full border border-slate-300 px-2 py-1 text-xs capitalize">{activity.status}</span></div>
            </button>
          </li>;
        })}
      </ol>
    </section>
  );
}

function SegmentPanel({ production, segment, insertAfterSegmentId, close, save, deleteSegment }: { production: Production; segment: Segment | null; insertAfterSegmentId: string | null; close: () => void; save: (next: Production) => Promise<Production>; deleteSegment: (segment: Segment) => Promise<void> }) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextSegment: Segment = {
      id: segment?.id || uniqueId('segment'),
      label: String(form.get('label')).trim(),
      color: String(form.get('color')),
      start: timeToIso(production, String(form.get('start'))),
      durationMinutes: Number(form.get('duration')),
      position: segment?.position ?? production.segments.length,
      notes: String(form.get('notes')).trim(),
    };
    const end = Date.parse(nextSegment.start) + nextSegment.durationMinutes * 60_000;
    if (Date.parse(nextSegment.start) < Date.parse(production.plannedStart) || end > Date.parse(production.plannedEnd)) {
      setError('Segment must stay within the Production planned run.'); return;
    }
    try {
      let segments: Segment[];
      if (segment) segments = production.segments.map((item) => item.id === segment.id ? nextSegment : item);
      else {
        segments = [...production.segments].sort((a, b) => a.position - b.position);
        const afterIndex = insertAfterSegmentId ? segments.findIndex((item) => item.id === insertAfterSegmentId) : -1;
        segments.splice(afterIndex >= 0 ? afterIndex + 1 : segments.length, 0, nextSegment);
        segments = segments.map((item, position) => ({ ...item, position }));
      }
      await save({ ...production, segments }); close();
    } catch (caught) { setError(errorMessage(caught)); }
  };
  const remove = async () => {
    if (!segment) return;
    setDeleting(true); setError('');
    try { await deleteSegment(segment); setDeleting(false); }
    catch (caught) { setError(errorMessage(caught)); setDeleting(false); }
  };
  return <Panel title={segment ? 'Edit segment' : 'Add segment'} close={close}><form className="space-y-4" onSubmit={submit}>
    <Field label="Segment name"><input className={fieldClass} defaultValue={segment?.label} name="label" required /></Field>
    <Field label="Segment color"><input className={`${fieldClass} h-12`} defaultValue={segment?.color || '#6cb87a'} name="color" type="color" /></Field>
    <details className="rounded-lg border border-slate-300 p-3"><summary className="cursor-pointer text-sm font-semibold">Optional timing</summary><div className="mt-3 grid grid-cols-2 gap-3"><Field label="Segment start"><input className={fieldClass} defaultValue={segment ? isoToTime(segment.start, production.timezone) : isoToTime(production.plannedStart, production.timezone)} name="start" type="time" required /></Field><Field label="Duration in minutes"><input className={fieldClass} defaultValue={segment?.durationMinutes || 30} min="1" name="duration" type="number" required /></Field></div></details>
    <Field label="Segment notes"><textarea className={fieldClass} defaultValue={segment?.notes} name="notes" rows={3} /></Field>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}<div className="flex gap-3">{segment && <button className={buttonDanger} disabled={deleting} onClick={remove} type="button">Delete segment</button>}<button className={`${buttonPrimary} flex-1`} type="submit">Save segment</button></div>
  </form></Panel>;
}

function LanePanel({ production, insertAfterLaneId, close, save }: { production: Production; insertAfterLaneId: string | null; close: () => void; save: (next: Production) => Promise<Production> }) {
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const lane: Lane = { id: uniqueId('lane'), label: String(form.get('label')).trim(), group: String(form.get('group')).trim(), color: String(form.get('color')), position: production.lanes.length };
    const lanes = [...production.lanes].sort((a, b) => a.position - b.position);
    const afterIndex = insertAfterLaneId ? lanes.findIndex((item) => item.id === insertAfterLaneId) : -1;
    lanes.splice(afterIndex >= 0 ? afterIndex + 1 : lanes.length, 0, lane);
    try { await save({ ...production, lanes: lanes.map((item, position) => ({ ...item, position })) }); close(); } catch (caught) { setError(errorMessage(caught)); }
  };
  return <Panel title="Add lane" close={close}><form className="space-y-4" onSubmit={submit}>
    <Field label="Lane name"><input className={fieldClass} name="label" required /></Field><Field label="Lane group"><input className={fieldClass} defaultValue="Program" name="group" required /></Field><Field label="Lane color"><input className={`${fieldClass} h-12`} defaultValue="#6a9fd8" name="color" type="color" /></Field>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}<button className={`${buttonPrimary} w-full`} type="submit">Save lane</button>
  </form></Panel>;
}

function FloorDirectorPanel({ production, close, save }: { production: Production; close: () => void; save: (next: Production) => Promise<Production> }) {
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const floorDirectors = String(form.get('floorDirectors')).split(/[,\n]/).map((name) => name.trim()).filter(Boolean);
    try { await save({ ...production, floorDirectors }); close(); }
    catch (caught) { setError(errorMessage(caught)); }
  };
  return <Panel title="Floor Directors" close={close}><form className="space-y-4" onSubmit={submit}><Field label="Floor Director names"><textarea className={fieldClass} defaultValue={production.floorDirectors.join(', ')} name="floorDirectors" placeholder="Alex, Bea, Carlo" rows={4} /></Field><p className="text-sm text-slate-600">Separate names with commas or new lines.</p>{error && <p className="text-sm text-red-700" role="alert">{error}</p>}<button className={`${buttonPrimary} w-full`} type="submit">Save Floor Directors</button></form></Panel>;
}

function ActivityPanel({ production, activity, placement, close, save, deleteActivity }: { production: Production; activity: Activity | null; placement: { segmentId: string; laneId: string } | null; close: () => void; save: (next: Production) => Promise<Production>; deleteActivity: (activity: Activity) => Promise<void> }) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const placedSegment = production.segments.find((segment) => segment.id === placement?.segmentId);
  const initialStart = activity ? isoToTime(activity.start, production.timezone) : placedSegment ? isoToTime(placedSegment.start, production.timezone) : production.segments[0] ? isoToTime(production.segments[0].start, production.timezone) : isoToTime(production.plannedStart, production.timezone);
  const [startTime, setStartTime] = useState(initialStart);
  const [duration, setDuration] = useState(activity?.durationMinutes || 5);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const nextActivity: Activity = {
      id: activity?.id || uniqueId('activity'), segmentId: String(form.get('segmentId')), laneId: String(form.get('laneId')),
      label: String(form.get('label')).trim(), type: String(form.get('type')) as Activity['type'], start: timeToIso(production, String(form.get('start'))),
      durationMinutes: Number(form.get('duration')), owner: String(form.get('owner')).trim(), status: String(form.get('status')) as Activity['status'], color: String(form.get('color')), notes: String(form.get('notes')).trim(),
    };
    const activityEnd = Date.parse(nextActivity.start) + nextActivity.durationMinutes * 60_000;
    if (Date.parse(nextActivity.start) < Date.parse(production.plannedStart) || activityEnd > Date.parse(production.plannedEnd)) { setError('Activity must stay within the Production planned run.'); return; }
    try { const activities = activity ? production.activities.map((item) => item.id === activity.id ? nextActivity : item) : [...production.activities, nextActivity]; await save({ ...production, activities }); close(); } catch (caught) { setError(errorMessage(caught)); }
  };
  const remove = async () => {
    if (!activity) return;
    setDeleting(true); setError('');
    try { await deleteActivity(activity); setDeleting(false); }
    catch (caught) { setError(errorMessage(caught)); setDeleting(false); }
  };
  const defaultSegment = activity?.segmentId || placement?.segmentId || production.segments[0]?.id;
  const calculatedEnd = formatTime(endOf(timeToIso(production, startTime), duration), production.timezone);
  return <Panel title={activity ? 'Activity inspector' : 'Add activity'} close={close}><form className="space-y-4" onSubmit={submit}>
    <Field label="Activity name"><input className={fieldClass} defaultValue={activity?.label} name="label" required /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Segment"><select className={fieldClass} defaultValue={defaultSegment} name="segmentId">{production.segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.label}</option>)}</select></Field><Field label="Lane"><select className={fieldClass} defaultValue={activity?.laneId || placement?.laneId || production.lanes[0]?.id} name="laneId">{production.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}</select></Field></div>
    <details className="rounded-lg border border-slate-300 p-3"><summary className="cursor-pointer text-sm font-semibold">Optional timing</summary><div className="mt-3 grid grid-cols-2 gap-3"><Field label="Activity start"><input className={fieldClass} name="start" onChange={(event) => setStartTime(event.target.value)} type="time" value={startTime} required /></Field><Field label="Duration in minutes"><input className={fieldClass} min="1" name="duration" onChange={(event) => setDuration(Number(event.target.value))} type="number" value={duration} required /></Field></div><p className="mt-2 text-sm text-slate-600">Calculated end: <strong>{calculatedEnd}</strong></p></details>
    <div className="grid grid-cols-2 gap-3"><Field label="Activity type"><select className={fieldClass} defaultValue={activity?.type || 'performance'} name="type">{activityTypes.map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Activity status"><select className={fieldClass} defaultValue={activity?.status || 'planned'} name="status">{activityStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field></div>
    <Field label="Owner"><input className={fieldClass} defaultValue={activity?.owner} name="owner" /></Field><Field label="Activity color"><input className={`${fieldClass} h-12`} defaultValue={activity?.color || '#d96c4f'} name="color" type="color" /></Field><Field label="Activity notes"><textarea className={fieldClass} defaultValue={activity?.notes} name="notes" rows={3} /></Field>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}<div className="flex gap-3">{activity && <button className={buttonDanger} disabled={deleting} onClick={remove} type="button">Delete activity</button>}<button className={`${buttonPrimary} flex-1`} type="submit">Save activity</button></div>
  </form></Panel>;
}

function reorderSegment(production: Production, id: string, direction: -1 | 1) {
  const ordered = [...production.segments].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((segment) => segment.id === id); const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return production;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return { ...production, segments: ordered.map((segment, position) => ({ ...segment, position })) };
}

function Panel({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')];
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/65" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section ref={panelRef} aria-labelledby="panel-title" className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-slate-900 p-6 shadow-2xl" onKeyDown={handleKeyDown} role="dialog" aria-modal="true"><div className="mb-6 flex items-center justify-between gap-4"><h2 id="panel-title" className="text-2xl font-semibold">{title}</h2><button ref={closeRef} aria-label="Close panel" className={buttonSecondary} onClick={close} type="button">Close</button></div>{children}</section></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-300">{label}{children}</label>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="bg-slate-900 p-5"><dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</dt><dd className="mt-2 font-medium">{value}</dd></div>; }
function Loading({ label }: { label: string }) { return <section aria-live="polite" className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-8"><h1 className="text-2xl font-semibold">{label}</h1><div className="mt-7 h-32 animate-pulse rounded-xl bg-white/5" /></section>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <section role="alert" className="mt-8 rounded-2xl border border-red-400/30 bg-red-950/30 p-8"><h1 className="text-3xl font-semibold">We couldn't load this timeline.</h1><p className="mt-3 text-red-100/80">{message}</p><button className={`${buttonPrimary} mt-6`} onClick={retry} type="button">Try again</button></section>; }
function NotFoundState() { return <section role="alert" className="mt-8 rounded-2xl border border-amber-300/30 bg-amber-950/20 p-8"><h1 className="text-3xl font-semibold">Production not found</h1><p className="mt-3 text-amber-100/80">This Production may have been deleted or opened from an old link.</p><button className={`${buttonPrimary} mt-6`} onClick={() => navigate()} type="button">Back to productions</button></section>; }
function ApiUnavailableState({ retry }: { retry: () => void }) { return <section role="alert" className="mt-8 rounded-2xl border border-amber-300/30 bg-amber-950/20 p-8"><h2 className="text-3xl font-semibold">Production API unavailable</h2><p className="mt-3 text-amber-100/80">The interface loaded, but its Production service did not. Start this app with <code>npm run dev</code> from the <code>staging-gantt_chant</code> folder.</p><button className={`${buttonPrimary} mt-6`} onClick={retry} type="button">Try API again</button></section>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <section className="mt-6 rounded-2xl border border-dashed border-white/15 p-12 text-center"><h2 className="text-2xl font-semibold">{title}</h2><p className="mt-3 text-slate-400">{body}</p></section>; }
