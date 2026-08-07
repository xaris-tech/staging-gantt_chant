import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toBlob } from 'html-to-image';
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
import { seedFromTemplate, TEMPLATE_SPAN_MINUTES } from './template';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'loaded'; value: T }
  | { status: 'error'; message: string; statusCode?: number };

type EditorMode = 'timeline' | 'sequence';
type EditorPanel = 'segment' | 'activity' | 'metadata' | null;
type LanePopoverState = { anchor: DOMRect; insertAfterLaneId: string | null; editingLaneId: string | null } | null;
type SegmentPopoverState = { anchor: DOMRect; insertAfterSegmentId: string | null } | null;
type ActivityPopoverState = { anchor: DOMRect; placement: { segmentId: string; laneId: string } | null } | null;
type ConfirmationState = { title: string; message: string; confirmLabel: string } | null;

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
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <a className="sr-only fixed left-3 top-3 z-50 rounded bg-emerald-300 px-3 py-2 font-semibold text-slate-950 focus:not-sr-only" href="#main-content">Skip to production</a>
      <AppHeader inEditor={Boolean(route)} />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-7 outline-none sm:px-7 sm:py-10">
        {route ? <ProductionEditor productionId={route} /> : <ProductionHome />}
      </main>
      <footer className="border-t border-white/10 px-4 py-5 text-center text-sm text-slate-400">© {new Date().getFullYear()} Xaris.tech. All rights reserved.</footer>
    </div>
  );
}

function AppHeader({ inEditor }: { inEditor: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-7">
        <button className="flex items-center gap-3 rounded-md text-sm font-bold tracking-[0.16em] text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" onClick={() => navigate()} type="button"><img alt="" className="h-11 w-11 rounded-full object-cover" src="/app/sm-logo.png" /><span>STAGEFLOW</span></button>
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletionError, setDeletionError] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const controller = useRef<AbortController | null>(null);
  const confirmAction = (title: string, message: string, confirmLabel: string) => new Promise<boolean>((resolve) => { confirmationResolverRef.current = resolve; setConfirmation({ title, message, confirmLabel }); });

  const deleteProduction = async (production: ProductionSummary) => {
    if (!await confirmAction(`Delete ${production.title}?`, 'This permanently removes the production, including all segments, lanes, and activities.', 'Delete production')) return;
    setDeletingId(production.id); setDeletionError('');
    try {
      await productionRepository.delete(production.id);
      setState((current) => current.status === 'loaded' ? { status: 'loaded', value: current.value.filter((item) => item.id !== production.id) } : current);
    } catch (caught) { setDeletionError(errorMessage(caught)); }
    finally { setDeletingId(null); }
  };

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
      {deletionError && <p className="mt-6 rounded-lg border border-red-300/20 bg-red-300/10 p-3 text-sm text-red-200" role="alert">{deletionError}</p>}
      {state.status === 'loaded' && (
        <section aria-labelledby="productions-title" className="mt-10">
          <h2 id="productions-title" className="text-lg font-semibold">Productions</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {state.value.map((production) => (
              <article key={production.id} className="group relative rounded-2xl border border-white/10 bg-white/[0.04] transition hover:-translate-y-0.5 hover:border-emerald-300/40 hover:bg-white/[0.07]"><a className="block p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" href={`/app/?production=${encodeURIComponent(production.id)}`}>
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
              </a>{production.id !== 'default' && <button aria-label={`Delete production ${production.title}`} className="absolute bottom-4 right-4 rounded-lg border border-red-400/30 bg-slate-950/85 px-3 py-1.5 text-xs font-semibold text-red-300 opacity-0 transition hover:bg-red-950 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 group-hover:opacity-100" disabled={deletingId === production.id} onClick={() => void deleteProduction(production)} type="button">{deletingId === production.id ? 'Deleting...' : 'Delete'}</button>}</article>
            ))}
          </div>
        </section>
      )}
      {confirmation && <ConfirmationDialog title={confirmation.title} message={confirmation.message} confirmLabel={confirmation.confirmLabel} cancel={() => { confirmationResolverRef.current?.(false); confirmationResolverRef.current = null; setConfirmation(null); }} confirm={() => { confirmationResolverRef.current?.(true); confirmationResolverRef.current = null; setConfirmation(null); }} />}

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
    const fromTemplate = form.get('fromTemplate') === 'on';
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
    if (fromTemplate && Date.parse(metadata.plannedEnd) - Date.parse(metadata.plannedStart) < TEMPLATE_SPAN_MINUTES * 60_000) {
      setError(`The legacy template needs a planned run of at least ${TEMPLATE_SPAN_MINUTES / 60} hours (8 AM to 3 PM).`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const production = await productionRepository.create(metadata);
      if (fromTemplate) await productionRepository.save(seedFromTemplate(production));
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
        <label className="flex items-start gap-3 rounded-lg border border-white/15 bg-white/5 p-3 text-sm text-slate-200"><input className="mt-0.5 h-4 w-4 accent-emerald-300" name="fromTemplate" type="checkbox" />Start from the legacy Gantt chart template (teams, segments, and colors)</label>
        {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
        <button className={`${buttonPrimary} w-full`} disabled={saving} type="submit">{saving ? 'Creating...' : 'Create production'}</button>
      </form>
    </Panel>
  );
}

function ProductionEditor({ productionId }: { productionId: string }) {
  const savingRef = useRef(false);
  const undoStackRef = useRef<Production[]>([]);
  const redoStackRef = useRef<Production[]>([]);
  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [, refreshHistoryControls] = useState(0);
  const [state, setState] = useState<LoadState<Production>>({ status: 'loading' });
  const [mode, setMode] = useState<EditorMode>(() => window.matchMedia('(max-width: 767px)').matches ? 'sequence' : 'timeline');
  const [panel, setPanel] = useState<EditorPanel>(null);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [activityPlacement, setActivityPlacement] = useState<{ segmentId: string; laneId: string } | null>(null);
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [segmentInsertAfterId, setSegmentInsertAfterId] = useState<string | null>(null);
  const [lanePopover, setLanePopover] = useState<LanePopoverState>(null);
  const [segmentPopover, setSegmentPopover] = useState<SegmentPopoverState>(null);
  const [activityPopover, setActivityPopover] = useState<ActivityPopoverState>(null);
  const [floorDirectorAnchor, setFloorDirectorAnchor] = useState<DOMRect | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const [collapsedSegments, setCollapsedSegments] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState(() => new URLSearchParams(window.location.search).get('created') === '1' ? 'Saved' : 'Production loaded');
  const [operationError, setOperationError] = useState('');
  const [exporting, setExporting] = useState(false);
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

  const persist = async (next: Production, recordHistory = true) => {
    if (savingRef.current) throw new Error('Another save is already in progress.');
    const previous = state.status === 'loaded' ? state.value : null;
    savingRef.current = true;
    setSaveState('Saving...');
    try {
      const saved = await productionRepository.save(next);
      if (recordHistory && previous) {
        undoStackRef.current.push(previous);
        redoStackRef.current = [];
        refreshHistoryControls((version) => version + 1);
      }
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
  const confirmAction = (title: string, message: string, confirmLabel: string) => new Promise<boolean>((resolve) => { confirmationResolverRef.current = resolve; setConfirmation({ title, message, confirmLabel }); });

  const undo = async () => {
    const target = undoStackRef.current.at(-1);
    if (!target || savingRef.current) return;
    setOperationError('');
    try {
      await persist({ ...target, revision: production.revision }, false);
      undoStackRef.current.pop();
      redoStackRef.current.push(production);
      refreshHistoryControls((version) => version + 1);
    } catch (caught) { setOperationError(`Undo failed. ${errorMessage(caught)}`); }
  };

  const redo = async () => {
    const target = redoStackRef.current.at(-1);
    if (!target || savingRef.current) return;
    setOperationError('');
    try {
      await persist({ ...target, revision: production.revision }, false);
      redoStackRef.current.pop();
      undoStackRef.current.push(production);
      refreshHistoryControls((version) => version + 1);
    } catch (caught) { setOperationError(`Redo failed. ${errorMessage(caught)}`); }
  };

  const openLane = (anchor: HTMLElement, insertAfterLaneId: string | null = null, editingLaneId: string | null = null) => {
    setLanePopover({ anchor: anchor.getBoundingClientRect(), insertAfterLaneId, editingLaneId });
  };

  const openSegmentQuickAdd = (anchor: HTMLElement, insertAfterSegmentId: string | null = null) => {
    setSegmentPopover({ anchor: anchor.getBoundingClientRect(), insertAfterSegmentId });
  };

  const openActivity = (activity?: Activity, placement?: { segmentId: string; laneId: string }) => {
    setSelectedActivity(activity || null);
    setActivityPlacement(placement || null);
    setPanel('activity');
  };

  const addActivity = async (anchor: HTMLElement, placement?: { segmentId: string; laneId: string }) => {
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
      setActivityPopover({ anchor: anchor.getBoundingClientRect(), placement: placement || null });
    } catch (caught) {
      setOperationError(errorMessage(caught));
    }
  };

  const exportBoard = async () => {
    setOperationError(''); setExporting(true);
    const restoreMode = mode;
    let scroller: HTMLElement | null = null;
    let previousOverflow = '';
    let excludedElements: HTMLElement[] = [];
    let previousDisplays: string[] = [];
    let exportOnlyElements: HTMLElement[] = [];
    let previousExportOnlyDisplays: string[] = [];
    try {
      if (mode !== 'timeline') { setMode('timeline'); await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
      const board = document.getElementById('production-export-area');
      if (!board) throw new Error('The Stage Sequence Board is unavailable.');
      await document.fonts.ready;
      scroller = board.querySelector<HTMLElement>('[data-board-scroll]');
      if (scroller) { previousOverflow = scroller.style.overflow; scroller.style.overflow = 'visible'; }
      excludedElements = Array.from(board.querySelectorAll<HTMLElement>('[data-export-exclude="true"]'));
      previousDisplays = excludedElements.map((element) => element.style.display);
      excludedElements.forEach((element) => { element.style.display = 'none'; });
      exportOnlyElements = Array.from(board.querySelectorAll<HTMLElement>('[data-export-only="true"]'));
      previousExportOnlyDisplays = exportOnlyElements.map((element) => element.style.display);
      exportOnlyElements.forEach((element) => { element.style.display = 'block'; });
      const width = Math.max(board.scrollWidth, scroller?.scrollWidth || 0); const height = board.scrollHeight;
      const basePixels = width * height;
      const maximumOutputPixels = 16_000_000;
      if (width > 8_192 || height > 8_192 || basePixels > maximumOutputPixels) throw new Error('This board is too large for one safe image. Reduce its rows or columns and try again.');
      const pixelRatio = basePixels * 4 <= maximumOutputPixels ? 2 : 1;
      const isExportableContentButton = (node: HTMLButtonElement) => node.dataset.exportContent === 'true' || node.getAttribute('aria-label')?.startsWith('Edit lane ') || (node.parentElement?.classList.contains('absolute') && node === node.parentElement.firstElementChild);
      const blob = await toBlob(board, { backgroundColor: '#f0f0f0', cacheBust: true, height, pixelRatio, width, style: { overflow: 'visible' }, filter: (node) => !(node instanceof HTMLElement && (node.dataset.exportExclude === 'true' || (node instanceof HTMLButtonElement && !node.draggable && node.dataset.segmentName === undefined && !isExportableContentButton(node)))) });
      if (!blob) throw new Error('The browser could not create the PNG.');
      const image = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${production.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'production'}-stage-sequence.png`;
      link.href = image; link.click();
      setTimeout(() => URL.revokeObjectURL(image), 1_000);
    } catch (caught) { setOperationError(`Image export failed. ${errorMessage(caught)}`); }
    finally { exportOnlyElements.forEach((element, index) => { element.style.display = previousExportOnlyDisplays[index]; }); excludedElements.forEach((element, index) => { element.style.display = previousDisplays[index]; }); if (scroller) scroller.style.overflow = previousOverflow; if (restoreMode !== 'timeline') setMode(restoreMode); setExporting(false); }
  };

  return (
    <div id="production-export-area">
      <section className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end" data-export-exclude="true">
        <button className="rounded-xl p-2 text-left transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700" data-export-content="true" onClick={() => setPanel('metadata')} type="button">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Production timeline</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-6xl">{production.title}</h1>
          <p className="mt-3 text-slate-600">{production.venue} / {formatDate(production.productionDate)}</p>
          <p className="mt-2 text-sm text-slate-600"><strong>Floor Directors:</strong> {production.floorDirectors.length ? production.floorDirectors.join(', ') : 'Not assigned'}</p>
        </button>
        <div className="flex items-center gap-2" data-export-exclude="true"><div aria-label="Save status" className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-200">{saveState}</div><button className={buttonPrimary} disabled={exporting} onClick={exportBoard} type="button">{exporting ? 'Exporting...' : 'Export image'}</button></div>
      </section>

      <dl aria-label="Production details" className="mt-7 grid gap-px overflow-hidden rounded-2xl border border-slate-300 bg-slate-300 sm:grid-cols-3" data-export-exclude="true">
        <Detail label="Date" value={formatDate(production.productionDate)} />
        <Detail label="Venue" value={production.venue} />
        <Detail label="Floor Directors" value={production.floorDirectors.join(', ') || 'Not assigned'} />
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-export-exclude="true">
        <button className={buttonPrimary} type="button" onClick={(event) => openSegmentQuickAdd(event.currentTarget)}>Add segment</button>
        <button className={buttonSecondary} type="button" onClick={(event) => openLane(event.currentTarget)}>Add lane</button>
        <button className={buttonSecondary} type="button" onClick={(event) => void addActivity(event.currentTarget)}>Add activity</button>
        <button className={buttonSecondary} type="button" onClick={(event) => setFloorDirectorAnchor(event.currentTarget.getBoundingClientRect())}>Edit Floor Directors</button>
        <div className="flex rounded-lg border border-slate-300 bg-white p-1" role="group" aria-label="Edit history"><button aria-label="Undo last change" className="rounded-md px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35" disabled={!undoStackRef.current.length || saveState === 'Saving...'} onClick={() => void undo()} type="button">↶ Undo</button><button aria-label="Redo last undone change" className="rounded-md px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35" disabled={!redoStackRef.current.length || saveState === 'Saving...'} onClick={() => void redo()} type="button">↷ Redo</button></div>
        <div className="ml-auto flex rounded-lg border border-white/10 p-1" role="group" aria-label="Production view">
          <button aria-pressed={mode === 'timeline'} className={`rounded-md px-3 py-1.5 text-sm ${mode === 'timeline' ? 'bg-white/15 text-white' : 'text-slate-400'}`} onClick={() => setMode('timeline')} type="button">Timeline</button>
          <button aria-pressed={mode === 'sequence'} className={`rounded-md px-3 py-1.5 text-sm ${mode === 'sequence' ? 'bg-white/15 text-white' : 'text-slate-400'}`} onClick={() => setMode('sequence')} type="button">Run of Show</button>
        </div>
      </div>
      {operationError && <p className="mt-3 rounded-lg border border-red-300/20 bg-red-300/10 p-3 text-sm text-red-200" data-export-exclude="true" role="alert">{operationError}</p>}

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
          editLane={(lane, anchor) => openLane(anchor, null, lane.id)}
          reorderSegments={async (sourceId, targetId) => {
            const ordered = [...production.segments].sort((a, b) => a.position - b.position);
            const sourceIndex = ordered.findIndex((segment) => segment.id === sourceId);
            const targetIndex = ordered.findIndex((segment) => segment.id === targetId);
            if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
            const [moved] = ordered.splice(sourceIndex, 1); ordered.splice(targetIndex, 0, moved);
            try { await persist({ ...production, segments: ordered.map((segment, position) => ({ ...segment, position })) }); }
            catch (caught) { setOperationError(errorMessage(caught)); }
          }}
          moveActivity={async (activityId, segmentId, laneId, requestedStart) => {
            const targetSegment = production.segments.find((item) => item.id === segmentId);
            const movedActivity = production.activities.find((item) => item.id === activityId);
            if (!targetSegment || !movedActivity) return;
            const sourceSegment = production.segments.find((item) => item.id === movedActivity.segmentId);
            const sourceOffset = sourceSegment ? Math.max(0, Date.parse(movedActivity.start) - Date.parse(sourceSegment.start)) : 0;
            const maximumOffset = Math.max(0, targetSegment.durationMinutes - 1) * 60_000;
            const start = requestedStart ?? (movedActivity.segmentId === segmentId
              ? movedActivity.start
              : new Date(Date.parse(targetSegment.start) + Math.min(sourceOffset, maximumOffset)).toISOString());
            const durationMinutes = Math.min(movedActivity.durationMinutes, Math.max(1, Math.floor((Date.parse(production.plannedEnd) - Date.parse(start)) / 60_000)));
            const moved = { ...movedActivity, segmentId, laneId, start, durationMinutes };
            const activities = production.activities.filter((activity) => activity.id !== activityId);
            activities.push(moved);
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
          resizeActivityStart={async (activityId, requestedStart, requestedDuration) => {
            const activity = production.activities.find((item) => item.id === activityId);
            if (!activity) return false;
            const startMs = Math.max(Date.parse(production.plannedStart), Date.parse(requestedStart));
            const originalEndMs = Date.parse(activity.start) + activity.durationMinutes * 60_000;
            const durationMinutes = Math.max(1, Math.min(requestedDuration, Math.floor((originalEndMs - startMs) / 60_000)));
            const start = new Date(originalEndMs - durationMinutes * 60_000).toISOString();
            try { await persist({ ...production, activities: production.activities.map((item) => item.id === activityId ? { ...item, start, durationMinutes } : item) }); return true; }
            catch (caught) { setOperationError(errorMessage(caught)); return false; }
          }}
          addActivityAt={(segmentId, laneId, anchor) => void addActivity(anchor, { segmentId, laneId })}
          addLane={(anchor) => openLane(anchor)}
          addLaneAfter={(laneId, anchor) => openLane(anchor, laneId)}
          addSegment={(anchor) => openSegmentQuickAdd(anchor)}
          addSegmentAfter={(segmentId, anchor) => openSegmentQuickAdd(anchor, segmentId)}
          deleteLane={async (lane) => {
            const affected = production.activities.filter((activity) => activity.laneId === lane.id).length;
            if (!await confirmAction(`Delete ${lane.label}?`, `This will also delete ${affected} assigned ${affected === 1 ? 'activity' : 'activities'}.`, 'Delete lane')) return;
            setOperationError('');
            try { await persist({ ...production, lanes: production.lanes.filter((item) => item.id !== lane.id), activities: production.activities.filter((activity) => activity.laneId !== lane.id) }); }
            catch (caught) { setOperationError(errorMessage(caught)); }
          }}
        />
      ) : <SequenceView production={production} editActivity={openActivity} />}

      {panel === 'segment' && <SegmentPanel production={production} segment={editingSegment} insertAfterSegmentId={segmentInsertAfterId} close={() => { setSegmentInsertAfterId(null); setPanel(null); }} save={persist} deleteSegment={async (target) => {
        const affected = production.activities.filter((activity) => activity.segmentId === target.id).length;
        if (!await confirmAction(`Delete ${target.label}?`, `This will also delete ${affected} assigned ${affected === 1 ? 'activity' : 'activities'}.`, 'Delete segment')) return;
        await persist({
          ...production,
          segments: production.segments.filter((item) => item.id !== target.id),
          activities: production.activities.filter((activity) => activity.segmentId !== target.id),
        });
        setPanel(null);
      }} />}
      {panel === 'metadata' && <ProductionMetadataPanel production={production} close={() => setPanel(null)} save={persist} />}
      {lanePopover && <LaneQuickAdd anchor={lanePopover.anchor} production={production} editingLaneId={lanePopover.editingLaneId} insertAfterLaneId={lanePopover.insertAfterLaneId} close={() => setLanePopover(null)} save={persist} />}
      {segmentPopover && <SegmentQuickAdd anchor={segmentPopover.anchor} production={production} insertAfterSegmentId={segmentPopover.insertAfterSegmentId} close={() => setSegmentPopover(null)} save={persist} />}
      {activityPopover && <ActivityQuickAdd anchor={activityPopover.anchor} production={production} placement={activityPopover.placement} close={() => setActivityPopover(null)} save={persist} />}
      {floorDirectorAnchor && <FloorDirectorQuickEdit anchor={floorDirectorAnchor} production={production} close={() => setFloorDirectorAnchor(null)} save={persist} />}
      {panel === 'activity' && <ActivityPanel production={production} activity={selectedActivity} placement={activityPlacement} close={() => setPanel(null)} save={persist} deleteActivity={async (target) => {
        if (!await confirmAction(`Delete ${target.label}?`, 'This activity will be permanently removed from the timeline.', 'Delete activity')) return;
        await persist({ ...production, activities: production.activities.filter((item) => item.id !== target.id) });
        setPanel(null);
      }} />}
      {confirmation && <ConfirmationDialog title={confirmation.title} message={confirmation.message} confirmLabel={confirmation.confirmLabel} cancel={() => { confirmationResolverRef.current?.(false); confirmationResolverRef.current = null; setConfirmation(null); }} confirm={() => { confirmationResolverRef.current?.(true); confirmationResolverRef.current = null; setConfirmation(null); }} />}
    </div>
  );
}

function Timeline({ production, collapsed, editSegment, moveSegment, toggleSegment, editActivity, editLane, deleteLane, reorderSegments, moveActivity, resizeActivity, resizeActivityStart, addActivityAt, addLane, addLaneAfter, addSegment, addSegmentAfter }: {
  production: Production;
  collapsed: Set<string>;
  editSegment: (segment: Segment) => void;
  moveSegment: (id: string, direction: -1 | 1) => void;
  toggleSegment: (id: string) => void;
  editActivity: (activity: Activity) => void;
  editLane: (lane: Lane, anchor: HTMLElement) => void;
  deleteLane: (lane: Lane) => void;
  reorderSegments: (sourceId: string, targetId: string) => void;
  moveActivity: (activityId: string, segmentId: string, laneId: string, requestedStart?: string) => Promise<void>;
  resizeActivity: (activityId: string, durationMinutes: number) => Promise<boolean>;
  resizeActivityStart: (activityId: string, start: string, durationMinutes: number) => Promise<boolean>;
  addActivityAt: (segmentId: string, laneId: string, anchor: HTMLElement) => void;
  addLane: (anchor: HTMLElement) => void;
  addLaneAfter: (laneId: string, anchor: HTMLElement) => void;
  addSegment: (anchor: HTMLElement) => void;
  addSegmentAfter: (segmentId: string, anchor: HTMLElement) => void;
}) {
  const segments = [...production.segments].sort((a, b) => a.position - b.position);

  return (
    <section aria-labelledby="timeline-title" className="mt-6 overflow-hidden rounded-xl border border-slate-400 bg-white shadow-sm" id="stage-sequence-board">
      <div className="group/boardtools flex items-center justify-between gap-4 border-b border-slate-300 bg-slate-100 p-4" data-testid="board-add-controls">
        <div data-export-exclude="true"><h2 id="timeline-title" className="text-lg font-bold">Stage Sequence Board</h2><p className="text-sm text-slate-600">Drag colored Segments to reorder the show. Drag Activities into any Lane and Segment cell.</p></div><div className="flex-1 text-center" data-export-only="true" style={{ display: 'none' }}><h2 className="text-2xl font-bold">{production.title} <span className="font-normal text-slate-400">|</span> {production.venue} <span className="font-normal text-slate-400">-</span> {formatDate(production.productionDate)}</h2><p className="mt-1 text-sm text-slate-600"><strong>FD:</strong> {production.floorDirectors.join(', ') || 'Not assigned'}</p></div>
        <div className="flex shrink-0 gap-2 opacity-0 transition group-hover/boardtools:opacity-100 group-focus-within/boardtools:opacity-100" data-export-exclude="true" data-testid="board-add-buttons"><button aria-label="Create board lane" className="rounded-full border border-emerald-700 bg-white px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50" onClick={(event) => addLane(event.currentTarget)} type="button">+ Lane</button><button aria-label="Create board column" className="rounded-full border border-emerald-700 bg-white px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50" onClick={(event) => addSegment(event.currentTarget)} type="button">+ Segment</button></div>
      </div>
      {!segments.length && <div className="border-b border-slate-300 p-5 text-center"><h3 className="font-semibold">Build the run of show</h3><p className="mt-1 text-sm text-slate-600">Add the first Segment. Existing Lanes remain available below.</p></div>}
      <div className="overflow-x-auto" data-board-scroll>
        <div className="min-w-[900px] pb-5 pr-8" style={{ minWidth: `${Math.max(900, 220 + segments.length * 190)}px` }}>
          <div className="grid border-b border-slate-400 bg-slate-200" style={{ gridTemplateColumns: `220px repeat(${Math.max(segments.length, 1)}, minmax(180px, 1fr))` }} data-testid="segment-header">
            <div aria-hidden="true" className="sticky left-0 z-10 border-r border-slate-400 bg-slate-200" />
            {segments.length ? (
              segments.map((segment, index) => (
                <div draggable key={segment.id} className="group/segment relative min-h-24 cursor-grab border-r border-black/30 p-3 text-slate-950 last:border-0" data-testid={`segment-column-header-${segment.id}`} onDragStart={(event) => event.dataTransfer.setData('application/x-stageflow-segment', segment.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('application/x-stageflow-segment'); if (sourceId) reorderSegments(sourceId, segment.id); }} style={{ backgroundColor: segment.color }}>
                  <button className="w-full text-left font-bold" data-export-content="true" data-segment-name onClick={() => editSegment(segment)} type="button">{segment.label}</button>
                  <p className="mt-1 text-xs font-medium opacity-75" data-export-exclude="true">Drag to reorder</p>
                  <div className="mt-2 flex gap-1" data-export-exclude="true">
                    <button aria-label={`Move ${segment.label} earlier`} disabled={index === 0} onClick={() => moveSegment(segment.id, -1)} type="button">&#8592;</button>
                    <button aria-label={`Move ${segment.label} later`} disabled={index === segments.length - 1} onClick={() => moveSegment(segment.id, 1)} type="button">&#8594;</button>
                    <button aria-label={`${collapsed.has(segment.id) ? 'Show' : 'Hide'} ${segment.label}`} className="rounded p-1 transition hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900" onClick={() => toggleSegment(segment.id)} title={collapsed.has(segment.id) ? 'Show segment activities' : 'Hide segment activities'} type="button">{collapsed.has(segment.id) ? <svg aria-hidden="true" className="h-5 w-6" fill="none" viewBox="0 0 24 24"><path d="M2.5 12S6 6.5 12 6.5s9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /><circle cx="12" cy="12" r="2.7" stroke="currentColor" strokeWidth="1.8" /><path d="m4 4 16 16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg> : <svg aria-hidden="true" className="h-5 w-6" fill="none" viewBox="0 0 24 24"><path d="M2.5 12S6 6.5 12 6.5s9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /><ellipse cx="12" cy="12" rx="2.8" ry="3" fill="currentColor" /></svg>}</button>
                  </div>
                  <button aria-label={`Create column after ${segment.label}`} className="absolute right-0 top-1/2 z-20 -translate-y-1/2 translate-x-1/2 rounded-full border border-emerald-700 bg-white px-2 py-1 text-xs font-bold text-emerald-700 opacity-0 shadow transition hover:bg-emerald-50 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-700 group-hover/segment:opacity-100" onClick={(event) => { event.stopPropagation(); addSegmentAfter(segment.id, event.currentTarget); }} type="button">+ Column</button>
                </div>
              ))
            ) : <div className="p-4 text-sm text-slate-600">Add a Segment to begin.</div>}
          </div>

          {production.lanes.length ? [...production.lanes].sort((a, b) => a.position - b.position).map((lane) => (
            <div key={lane.id} className="grid min-h-16 border-b border-slate-300 last:border-0" style={{ gridTemplateColumns: `220px repeat(${Math.max(segments.length, 1)}, minmax(180px, 1fr))` }}>
              <div className="group/lanerow sticky left-0 z-10 border-r border-slate-400 bg-slate-100 px-4 py-2 hover:z-20 focus-within:z-20" data-testid={`lane-row-header-${lane.id}`}>
                <div className="flex items-start justify-between gap-2"><button aria-label={`Edit lane ${lane.label}`} className="min-w-0 flex-1 rounded text-left hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700" onClick={(event) => editLane(lane, event.currentTarget)} type="button"><span className="block truncate font-semibold">{lane.label}</span><span className="block text-xs text-slate-500">{lane.group}</span></button><button aria-label={`Delete lane ${lane.label}`} className="text-xs text-red-500 hover:text-red-700" onClick={() => deleteLane(lane)} type="button">Delete</button></div>
                <button aria-label={`Create row after ${lane.label}`} className="absolute bottom-0 left-1/2 z-20 -translate-x-1/2 translate-y-1/2 rounded-full border border-emerald-700 bg-white px-2 py-1 text-xs font-bold text-emerald-700 opacity-0 shadow transition hover:bg-emerald-50 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-700 group-hover/lanerow:opacity-100" onClick={(event) => addLaneAfter(lane.id, event.currentTarget)} type="button">+ Row</button>
              </div>
              {segments.map((segment) => <div aria-label={`${lane.label}, ${segment.label} drop zone`} data-lane-id={lane.id} data-segment-id={segment.id} data-timeline-drop-zone key={segment.id} className="group/cell relative min-h-16 overflow-visible border-r border-slate-300 bg-white p-2 last:border-0">{!collapsed.has(segment.id) && production.activities.filter((activity) => activity.laneId === lane.id && activity.segmentId === segment.id).map((activity) => <ActivityCard activity={activity} editActivity={editActivity} key={activity.id} lane={lane} moveActivity={moveActivity} resizeActivity={resizeActivity} resizeActivityStart={resizeActivityStart} segment={segment} segments={segments} />)}<button aria-label={`Create activity in ${lane.label}, ${segment.label}`} className="absolute right-1 top-1 z-30 h-8 w-8 rounded-full border border-emerald-700 bg-white text-lg font-bold text-emerald-700 opacity-0 shadow transition hover:bg-emerald-50 focus:opacity-100 group-hover/cell:opacity-100" onClick={(event) => addActivityAt(segment.id, lane.id, event.currentTarget)} type="button">+</button></div>)}
            </div>
          )) : <div className="p-8 text-center text-slate-400">Add a Lane to place Activities on the Timeline.</div>}
        </div>
      </div>
    </section>
  );
}

function ActivityCard({ activity, lane, segment, segments, editActivity, moveActivity, resizeActivity, resizeActivityStart }: { activity: Activity; lane: Lane; segment: Segment; segments: Segment[]; editActivity: (activity: Activity) => void; moveActivity: (activityId: string, segmentId: string, laneId: string, requestedStart?: string) => Promise<void>; resizeActivity: (activityId: string, durationMinutes: number) => Promise<boolean>; resizeActivityStart: (activityId: string, start: string, durationMinutes: number) => Promise<boolean> }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState(180);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [previewLeft, setPreviewLeft] = useState<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  useEffect(() => { const cell = cardRef.current?.parentElement; if (!cell) return; const update = () => setColumnWidth(Math.max(180, cell.getBoundingClientRect().width)); update(); const observer = new ResizeObserver(update); observer.observe(cell); return () => observer.disconnect(); }, []);
  const width = Math.max(100, activity.durationMinutes / Math.max(1, segment.durationMinutes) * columnWidth);
  const left = Math.max(0, (Date.parse(activity.start) - Date.parse(segment.start)) / 60_000 / Math.max(1, segment.durationMinutes) * columnWidth);
  const productionSegmentFromElement = (_element: HTMLElement, fallback: Segment, targetId?: string) => segments.find((item) => item.id === targetId) ?? fallback;
  const resizeBy = async (minutes: number) => { if (resizing) return; setResizing(true); await resizeActivity(activity.id, Math.max(1, activity.durationMinutes + minutes)); setPreviewWidth(null); setResizing(false); };
  return <div className={`absolute z-10 ${dragging ? 'z-50' : ''}`} ref={cardRef} style={{ left: `${previewLeft ?? left}px`, top: '8px', transform: `translateX(${dragOffsetX}px)`, width: `${previewWidth ?? width}px` }}>
    <button aria-label={`${activity.label}, ${lane.label}, ${segment.label}, ${activity.status}`} className={`block w-full touch-none rounded-md border border-black/25 px-5 py-2 text-left text-xs font-bold text-slate-950 shadow-sm ${dragging ? 'cursor-grabbing shadow-lg' : 'cursor-grab'}`} onPointerDown={(event) => { if (event.button !== 0 || resizing) return; event.preventDefault(); const startX = event.clientX; const cardRect = event.currentTarget.getBoundingClientRect(); const pointerInsideCard = event.clientX - cardRect.left; let moved = false; const move = (pointerEvent: PointerEvent) => { const delta = pointerEvent.clientX - startX; if (Math.abs(delta) > 3) moved = true; setDragging(moved); setDragOffsetX(delta); }; const up = async (pointerEvent: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (!moved) { setDragging(false); setDragOffsetX(0); editActivity(activity); return; } const intendedLeft = pointerEvent.clientX - pointerInsideCard; const dropZone = Array.from(document.querySelectorAll<HTMLElement>('[data-timeline-drop-zone]')).find((element) => { const bounds = element.getBoundingClientRect(); return intendedLeft >= bounds.left && intendedLeft <= bounds.right && pointerEvent.clientY >= bounds.top && pointerEvent.clientY <= bounds.bottom; }); if (!dropZone) { setDragging(false); setDragOffsetX(0); return; } const targetSegmentId = dropZone.dataset.segmentId; const targetLaneId = dropZone.dataset.laneId; const targetSegment = productionSegmentFromElement(dropZone, segment, targetSegmentId); if (!targetSegmentId || !targetLaneId || !targetSegment) { setDragging(false); setDragOffsetX(0); return; } const rect = dropZone.getBoundingClientRect(); const x = Math.max(0, Math.min(rect.width - 1, intendedLeft - rect.left)); const start = new Date(Date.parse(targetSegment.start) + x / Math.max(1, rect.width) * targetSegment.durationMinutes * 60_000).toISOString(); await moveActivity(activity.id, targetSegmentId, targetLaneId, start); setDragging(false); setDragOffsetX(0); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); }} style={{ backgroundColor: activity.color }} type="button"><span className="block">{activity.label}</span><span className="mt-1 block text-[10px] font-medium opacity-70">{activity.owner || activity.type}</span></button>
    <button aria-label={`Resize start of ${activity.label}`} className="absolute bottom-1 left-1 top-1 z-20 w-3 cursor-ew-resize rounded border border-black/30 bg-white/70 opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-700" disabled={resizing} onKeyDown={(event) => { const delta = event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0; if (!delta) return; event.preventDefault(); const duration = Math.max(1, activity.durationMinutes - delta); void resizeActivityStart(activity.id, new Date(Date.parse(activity.start) + (activity.durationMinutes - duration) * 60_000).toISOString(), duration); }} onMouseDown={(event) => { if (resizing) return; event.preventDefault(); event.stopPropagation(); const startX = event.clientX; const startDuration = activity.durationMinutes; const minutesPerPixel = Math.max(1, segment.durationMinutes) / columnWidth; const move = (mouseEvent: MouseEvent) => { const delta = Math.min(width - 20, mouseEvent.clientX - startX); setPreviewLeft(left + delta); setPreviewWidth(Math.max(20, width - delta)); }; const up = async (mouseEvent: MouseEvent) => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); const deltaMinutes = Math.min(startDuration - 1, Math.round((mouseEvent.clientX - startX) * minutesPerPixel)); setResizing(true); await resizeActivityStart(activity.id, new Date(Date.parse(activity.start) + deltaMinutes * 60_000).toISOString(), startDuration - deltaMinutes); setPreviewLeft(null); setPreviewWidth(null); setResizing(false); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); }} type="button" />
    <button aria-label={`Resize ${activity.label}`} className="absolute bottom-1 right-1 top-1 z-20 w-3 cursor-ew-resize rounded border border-black/30 bg-white/70 text-[10px] font-bold text-slate-700 opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-700" disabled={resizing} onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); void resizeBy(5); } if (event.key === 'ArrowLeft') { event.preventDefault(); void resizeBy(-5); } }} onMouseDown={(event) => { if (resizing) return; event.preventDefault(); event.stopPropagation(); const startX = event.clientX; const startDuration = activity.durationMinutes; const move = (mouseEvent: MouseEvent) => setPreviewWidth(Math.max(20, width + mouseEvent.clientX - startX)); const up = async (mouseEvent: MouseEvent) => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setResizing(true); const minutesPerPixel = Math.max(1, segment.durationMinutes) / columnWidth; await resizeActivity(activity.id, Math.max(1, Math.round(startDuration + (mouseEvent.clientX - startX) * minutesPerPixel))); setPreviewWidth(null); setResizing(false); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); }} type="button" />
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

function ProductionMetadataPanel({ production, close, save }: { production: Production; close: () => void; save: (next: Production) => Promise<Production> }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const productionDate = String(form.get('productionDate'));
    const moveToDate = (iso: string) => wallTimeToIso(productionDate, isoToTime(iso, production.timezone), production.timezone);
    const next: Production = {
      ...production,
      title: String(form.get('title')).trim(),
      venue: String(form.get('venue')).trim(),
      productionDate,
      plannedStart: moveToDate(production.plannedStart),
      plannedEnd: moveToDate(production.plannedEnd),
      segments: production.segments.map((segment) => ({ ...segment, start: moveToDate(segment.start) })),
      activities: production.activities.map((activity) => ({ ...activity, start: moveToDate(activity.start) })),
    };
    setSaving(true);
    try { await save(next); close(); } catch (caught) { setError(errorMessage(caught)); setSaving(false); }
  };
  return <Panel title="Edit production details" close={close}><form className="space-y-4" onSubmit={submit}><Field label="Production name"><input autoFocus className={fieldClass} defaultValue={production.title} name="title" required /></Field><Field label="Venue"><input className={fieldClass} defaultValue={production.venue} name="venue" required /></Field><Field label="Production date"><input className={fieldClass} defaultValue={production.productionDate} name="productionDate" required type="date" /></Field><p className="text-sm text-slate-400">Changing the date moves the complete timeline to that date while preserving every start time.</p>{error && <p className="text-sm text-red-300" role="alert">{error}</p>}<button className={`${buttonPrimary} w-full`} disabled={saving} type="submit">{saving ? 'Saving...' : 'Save production details'}</button></form></Panel>;
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
    <ColorPresetPicker defaultValue={segment?.color || '#6cb87a'} label="Segment color" name="color" theme="dark" />
    <details className="rounded-lg border border-slate-300 p-3"><summary className="cursor-pointer text-sm font-semibold">Optional timing</summary><div className="mt-3 grid grid-cols-2 gap-3"><Field label="Segment start"><input className={fieldClass} defaultValue={segment ? isoToTime(segment.start, production.timezone) : isoToTime(production.plannedStart, production.timezone)} name="start" type="time" required /></Field><Field label="Duration in minutes"><input className={fieldClass} defaultValue={segment?.durationMinutes || 30} min="1" name="duration" type="number" required /></Field></div></details>
    <Field label="Segment notes"><textarea className={fieldClass} defaultValue={segment?.notes} name="notes" rows={3} /></Field>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}<div className="flex gap-3">{segment && <button className={buttonDanger} disabled={deleting} onClick={remove} type="button">Delete segment</button>}<button className={`${buttonPrimary} flex-1`} type="submit">Save segment</button></div>
  </form></Panel>;
}

function QuickPopover({ anchor, title, close, children, width = 360, estimatedHeight = 420 }: { anchor: DOMRect; title: string; close: () => void; children: React.ReactNode; width?: number; estimatedHeight?: number }) {
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: MouseEvent) => { if (!popoverRef.current?.contains(event.target as Node)) close(); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const viewportChanged = () => close();
    document.addEventListener('mousedown', dismiss); window.addEventListener('keydown', keyboard); window.addEventListener('resize', viewportChanged);
    return () => { document.removeEventListener('mousedown', dismiss); window.removeEventListener('keydown', keyboard); window.removeEventListener('resize', viewportChanged); };
  }, [close]);
  const narrow = window.innerWidth < 640;
  const actualWidth = Math.min(width, window.innerWidth - 32);
  const left = Math.max(16, Math.min(anchor.left, window.innerWidth - actualWidth - 16));
  const opensAbove = anchor.bottom + estimatedHeight > window.innerHeight - 16;
  const position = narrow ? { bottom: 16, left: 16, width: actualWidth } : { left, top: opensAbove ? Math.max(16, anchor.top - estimatedHeight - 8) : anchor.bottom + 8, width: actualWidth };
  const titleId = `quick-popover-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return <div aria-labelledby={titleId} className="fixed z-50 max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl" ref={popoverRef} role="dialog" style={position}>
    <div className="mb-3 flex items-center justify-between gap-4"><h2 className="font-bold" id={titleId}>{title}</h2><button aria-label={`Close ${title.toLowerCase()} form`} className="rounded-md px-2 py-1 text-lg hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700" onClick={close} type="button">×</button></div>
    {children}
  </div>;
}

const quickFieldClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-emerald-700 focus:ring-1 focus:ring-emerald-700';
function QuickField({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700">{label}{children}</label>; }

const presetColors = ['#6cb87a', '#6ee7b7', '#6a9fd8', '#22d3ee', '#a78bfa', '#fbbf24', '#d96c4f', '#fb7185'];
function ColorPresetPicker({ label, name, defaultValue, theme = 'light' }: { label: string; name: string; defaultValue: string; theme?: 'light' | 'dark' }) {
  const [color, setColor] = useState(defaultValue);
  const [advanced, setAdvanced] = useState(false);
  const textClass = theme === 'dark' ? 'text-slate-300' : 'text-slate-700';
  const borderClass = theme === 'dark' ? 'border-white/15 bg-slate-950' : 'border-slate-300 bg-white';
  return <fieldset className={`rounded-xl border p-3 ${borderClass}`}><legend className={`px-1 text-sm font-medium ${textClass}`}>{label}</legend><input name={name} type="hidden" value={color} /><div className="grid grid-cols-4 gap-2">{presetColors.map((preset) => <button aria-label={`${label}: ${preset}`} aria-pressed={color.toLowerCase() === preset} className="h-8 w-full rounded-lg border-2 shadow-sm transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500" key={preset} onClick={() => setColor(preset)} style={{ backgroundColor: preset, borderColor: color.toLowerCase() === preset ? '#ffffff' : 'transparent', outline: color.toLowerCase() === preset ? '2px solid #047857' : 'none' }} type="button" />)}</div><button className={`mt-3 text-xs font-semibold underline underline-offset-2 ${textClass}`} onClick={() => setAdvanced((value) => !value)} type="button">{advanced ? 'Hide advanced' : 'Advanced'}</button>{advanced && <input aria-label={`${label} advanced`} className="mt-2 h-10 w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-1" onChange={(event) => setColor(event.target.value)} type="color" value={color} />}</fieldset>;
}

function ActivityTypeField({ defaultValue = 'performance', theme = 'light' }: { defaultValue?: string; theme?: 'light' | 'dark' }) {
  const isPreset = activityTypes.some((type) => type !== 'custom' && type === defaultValue);
  const [selection, setSelection] = useState(isPreset ? defaultValue : 'custom');
  const [customType, setCustomType] = useState(isPreset ? '' : defaultValue === 'custom' ? '' : defaultValue);
  const inputClass = theme === 'dark' ? fieldClass : quickFieldClass;
  const value = selection === 'custom' ? customType.trim() : selection;
  return <div><input name="type" type="hidden" value={value} /><label className={`block text-sm font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Activity type<select className={inputClass} onChange={(event) => setSelection(event.target.value)} value={selection}>{activityTypes.map((type) => <option key={type}>{type}</option>)}</select></label>{selection === 'custom' && <label className={`mt-2 block text-sm font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Custom activity type<input autoFocus className={inputClass} maxLength={80} onChange={(event) => setCustomType(event.target.value)} placeholder="Enter activity type" required value={customType} /></label>}</div>;
}

function LaneQuickAdd({ anchor, production, insertAfterLaneId, editingLaneId, close, save }: { anchor: DOMRect; production: Production; insertAfterLaneId: string | null; editingLaneId: string | null; close: () => void; save: (next: Production) => Promise<Production> }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const editingLane = production.lanes.find((lane) => lane.id === editingLaneId) ?? null;
  useEffect(() => {
    nameRef.current?.focus();
    const dismiss = (event: MouseEvent) => { if (!popoverRef.current?.contains(event.target as Node)) close(); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const viewportChanged = () => close();
    document.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', keyboard);
    window.addEventListener('resize', viewportChanged);
    window.addEventListener('scroll', viewportChanged, true);
    return () => { document.removeEventListener('mousedown', dismiss); window.removeEventListener('keydown', keyboard); window.removeEventListener('resize', viewportChanged); window.removeEventListener('scroll', viewportChanged, true); };
  }, [close]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const lane: Lane = { id: editingLane?.id || uniqueId('lane'), label: String(form.get('label')).trim(), group: String(form.get('group')).trim(), color: String(form.get('color')), position: editingLane?.position ?? production.lanes.length };
    const lanes = [...production.lanes].sort((a, b) => a.position - b.position);
    if (editingLane) lanes.splice(lanes.findIndex((item) => item.id === editingLane.id), 1, lane);
    else { const afterIndex = insertAfterLaneId ? lanes.findIndex((item) => item.id === insertAfterLaneId) : -1; lanes.splice(afterIndex >= 0 ? afterIndex + 1 : lanes.length, 0, lane); }
    setSaving(true);
    try { await save({ ...production, lanes: lanes.map((item, position) => ({ ...item, position })) }); close(); } catch (caught) { setError(errorMessage(caught)); setSaving(false); }
  };
  const narrow = window.innerWidth < 640;
  const width = Math.min(340, window.innerWidth - 32);
  const estimatedHeight = 310;
  const left = Math.max(16, Math.min(anchor.left, window.innerWidth - width - 16));
  const opensAbove = anchor.bottom + estimatedHeight > window.innerHeight - 16;
  const position = narrow
    ? { bottom: 16, left: 16, width }
    : { left, top: opensAbove ? Math.max(16, anchor.top - estimatedHeight - 8) : anchor.bottom + 8, width };
  return <div aria-labelledby="lane-quick-add-title" className="fixed z-50 rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl" ref={popoverRef} role="dialog" style={position}>
    <div className="mb-3 flex items-center justify-between gap-4"><h2 className="font-bold" id="lane-quick-add-title">Quick add</h2><button aria-label="Close lane form" className="rounded-md px-2 py-1 text-lg hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700" onClick={close} type="button">×</button></div>
    <form className="space-y-3" onSubmit={submit}>
      <label className="sr-only" htmlFor="lane-quick-name">Lane name</label><input className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-700 focus:ring-1 focus:ring-emerald-700" defaultValue={editingLane?.label} id="lane-quick-name" name="label" placeholder="Lane name" ref={nameRef} required />
      <div><label className="sr-only" htmlFor="lane-quick-group">Lane group</label><input className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-700 focus:ring-1 focus:ring-emerald-700" defaultValue={editingLane?.group || 'Program'} id="lane-quick-group" list="lane-group-options" name="group" required /><datalist id="lane-group-options"><option value="Program" /><option value="Technical" /><option value="Crew" /><option value="Stage" /></datalist></div><ColorPresetPicker defaultValue={editingLane?.color || '#6a9fd8'} label="Lane color" name="color" />
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <button className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 font-bold text-white transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2" disabled={saving} type="submit">{saving ? 'Saving...' : editingLane ? 'Save lane' : 'Add lane'}</button>
    </form>
    <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">Tip: type a name and press Enter</p>
  </div>;
}

function SegmentQuickAdd({ anchor, production, insertAfterSegmentId, close, save }: { anchor: DOMRect; production: Production; insertAfterSegmentId: string | null; close: () => void; save: (next: Production) => Promise<Production> }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const segment: Segment = { id: uniqueId('segment'), label: String(form.get('label')).trim(), color: String(form.get('color')), start: timeToIso(production, String(form.get('start'))), durationMinutes: Number(form.get('duration')), position: production.segments.length, notes: String(form.get('notes')).trim() };
    const end = Date.parse(segment.start) + segment.durationMinutes * 60_000;
    if (Date.parse(segment.start) < Date.parse(production.plannedStart) || end > Date.parse(production.plannedEnd)) { setError('Segment must stay within the Production planned run.'); return; }
    const segments = [...production.segments].sort((a, b) => a.position - b.position); const afterIndex = insertAfterSegmentId ? segments.findIndex((item) => item.id === insertAfterSegmentId) : -1;
    segments.splice(afterIndex >= 0 ? afterIndex + 1 : segments.length, 0, segment); setSaving(true);
    try { await save({ ...production, segments: segments.map((item, position) => ({ ...item, position })) }); close(); } catch (caught) { setError(errorMessage(caught)); setSaving(false); }
  };
  return <QuickPopover anchor={anchor} close={close} estimatedHeight={480} title="Quick add segment"><form className="space-y-3" onSubmit={submit}>
    <QuickField label="Segment name"><input autoFocus className={quickFieldClass} name="label" placeholder="Segment name" required /></QuickField>
    <QuickField label="Segment start"><input className={quickFieldClass} defaultValue={isoToTime(production.plannedStart, production.timezone)} name="start" type="time" required /></QuickField><ColorPresetPicker defaultValue="#6cb87a" label="Segment color" name="color" />
    <QuickField label="Duration in minutes"><input className={quickFieldClass} defaultValue="30" min="1" name="duration" type="number" required /></QuickField>
    <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Optional notes</summary><textarea className={quickFieldClass} name="notes" rows={2} /></details>
    {error && <p className="text-sm text-red-700" role="alert">{error}</p>}<button className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-600" disabled={saving} type="submit">{saving ? 'Adding...' : 'Add segment'}</button>
  </form><p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">Tip: press Enter to add the segment</p></QuickPopover>;
}

function availableActivityStart(production: Production, laneId: string, segmentId: string, durationMinutes: number) {
  const segment = production.segments.find((item) => item.id === segmentId);
  let candidate = Math.max(Date.parse(production.plannedStart), Date.parse(segment?.start || production.plannedStart));
  const required = Math.max(1, durationMinutes) * 60_000;
  const occupied = production.activities.filter((activity) => activity.laneId === laneId).map((activity) => ({ start: Date.parse(activity.start), end: Date.parse(activity.start) + activity.durationMinutes * 60_000 })).sort((a, b) => a.start - b.start);
  for (const slot of occupied) {
    if (slot.end <= candidate) continue;
    if (candidate + required <= slot.start) break;
    candidate = slot.end;
  }
  return candidate + required <= Date.parse(production.plannedEnd) ? new Date(candidate).toISOString() : null;
}

function ActivityQuickAdd({ anchor, production, placement, close, save }: { anchor: DOMRect; production: Production; placement: { segmentId: string; laneId: string } | null; close: () => void; save: (next: Production) => Promise<Production> }) {
  const placedSegment = production.segments.find((segment) => segment.id === placement?.segmentId);
  const initialSegmentId = placement?.segmentId || production.segments[0]?.id || '';
  const initialLaneId = placement?.laneId || production.lanes[0]?.id || '';
  const initialAvailableStart = availableActivityStart(production, initialLaneId, initialSegmentId, 5);
  const [selectedSegmentId, setSelectedSegmentId] = useState(initialSegmentId);
  const [selectedLaneId, setSelectedLaneId] = useState(initialLaneId);
  const [startTime, setStartTime] = useState(isoToTime(initialAvailableStart || placedSegment?.start || production.plannedStart, production.timezone));
  const [timingOverridden, setTimingOverridden] = useState(false);
  const [duration, setDuration] = useState(5); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const updateAutomaticStart = (laneId: string, segmentId: string, requestedDuration: number) => { if (timingOverridden) return; const available = availableActivityStart(production, laneId, segmentId, requestedDuration); if (available) setStartTime(isoToTime(available, production.timezone)); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const automaticStart = timingOverridden ? null : availableActivityStart(production, String(form.get('laneId')), String(form.get('segmentId')), Number(form.get('duration')));
    if (!timingOverridden && !automaticStart) { setError('There is no free space remaining on this lane for that duration.'); return; }
    const activity: Activity = { id: uniqueId('activity'), segmentId: String(form.get('segmentId')), laneId: String(form.get('laneId')), label: String(form.get('label')).trim(), type: String(form.get('type')) as Activity['type'], start: automaticStart || timeToIso(production, String(form.get('start'))), durationMinutes: Number(form.get('duration')), owner: String(form.get('owner')).trim(), status: String(form.get('status')) as Activity['status'], color: String(form.get('color')), notes: String(form.get('notes')).trim() };
    const end = Date.parse(activity.start) + activity.durationMinutes * 60_000;
    if (Date.parse(activity.start) < Date.parse(production.plannedStart) || end > Date.parse(production.plannedEnd)) { setError('Activity must stay within the Production planned run.'); return; }
    setSaving(true); try { await save({ ...production, activities: [...production.activities, activity] }); close(); } catch (caught) { setError(errorMessage(caught)); setSaving(false); }
  };
  return <QuickPopover anchor={anchor} close={close} estimatedHeight={620} title="Quick add activity" width={390}><form className="space-y-3" onSubmit={submit}>
    <QuickField label="Activity name"><input autoFocus className={quickFieldClass} name="label" placeholder="Activity name" required /></QuickField>
    <div className="grid grid-cols-2 gap-2"><QuickField label="Segment"><select className={quickFieldClass} name="segmentId" onChange={(event) => { setSelectedSegmentId(event.target.value); updateAutomaticStart(selectedLaneId, event.target.value, duration); }} value={selectedSegmentId}>{production.segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.label}</option>)}</select></QuickField><QuickField label="Lane"><select className={quickFieldClass} name="laneId" onChange={(event) => { setSelectedLaneId(event.target.value); updateAutomaticStart(event.target.value, selectedSegmentId, duration); }} value={selectedLaneId}>{production.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}</select></QuickField></div>
    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Automatically placed in the earliest free space on this lane.</p><details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Optional timing</summary><div className="mt-3 grid grid-cols-2 gap-2"><QuickField label="Activity start"><input className={quickFieldClass} name="start" onChange={(event) => { setTimingOverridden(true); setStartTime(event.target.value); }} type="time" value={startTime} required /></QuickField><QuickField label="Duration in minutes"><input className={quickFieldClass} min="1" name="duration" onChange={(event) => { const nextDuration = Number(event.target.value); setDuration(nextDuration); updateAutomaticStart(selectedLaneId, selectedSegmentId, nextDuration); }} type="number" value={duration} required /></QuickField></div></details>
    <div className="grid grid-cols-2 gap-2"><ActivityTypeField /><QuickField label="Activity status"><select className={quickFieldClass} defaultValue="planned" name="status">{activityStatuses.map((status) => <option key={status}>{status}</option>)}</select></QuickField></div>
    <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">More options</summary><div className="mt-3 space-y-3"><QuickField label="Owner"><input className={quickFieldClass} name="owner" /></QuickField><ColorPresetPicker defaultValue="#d96c4f" label="Activity color" name="color" /><QuickField label="Activity notes"><textarea className={quickFieldClass} name="notes" rows={2} /></QuickField></div></details>
    {error && <p className="text-sm text-red-700" role="alert">{error}</p>}<button className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-600" disabled={saving} type="submit">{saving ? 'Adding...' : 'Add activity'}</button>
  </form></QuickPopover>;
}

function FloorDirectorQuickEdit({ anchor, production, close, save }: { anchor: DOMRect; production: Production; close: () => void; save: (next: Production) => Promise<Production> }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const floorDirectors = String(form.get('floorDirectors')).split(/[,\n]/).map((name) => name.trim()).filter(Boolean); setSaving(true); try { await save({ ...production, floorDirectors }); close(); } catch (caught) { setError(errorMessage(caught)); setSaving(false); } };
  return <QuickPopover anchor={anchor} close={close} estimatedHeight={330} title="Edit Floor Directors"><form className="space-y-3" onSubmit={submit}><QuickField label="Floor Director names"><textarea autoFocus className={quickFieldClass} defaultValue={production.floorDirectors.join(', ')} name="floorDirectors" placeholder="Alex, Bea, Carlo" rows={3} /></QuickField><p className="text-xs text-slate-500">Separate names with commas or new lines.</p>{error && <p className="text-sm text-red-700" role="alert">{error}</p>}<button className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-600" disabled={saving} type="submit">{saving ? 'Saving...' : 'Save Floor Directors'}</button></form></QuickPopover>;
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
    <div className="grid grid-cols-2 gap-3"><ActivityTypeField defaultValue={activity?.type || 'performance'} theme="dark" /><Field label="Activity status"><select className={fieldClass} defaultValue={activity?.status || 'planned'} name="status">{activityStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field></div>
    <Field label="Owner"><input className={fieldClass} defaultValue={activity?.owner} name="owner" /></Field><ColorPresetPicker defaultValue={activity?.color || '#d96c4f'} label="Activity color" name="color" theme="dark" /><Field label="Activity notes"><textarea className={fieldClass} defaultValue={activity?.notes} name="notes" rows={3} /></Field>
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

function ConfirmationDialog({ title, message, confirmLabel, cancel, confirm }: { title: string; message: string; confirmLabel: string; cancel: () => void; confirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); }; window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard); }, [cancel]);
  return <div aria-labelledby="confirmation-title" aria-modal="true" className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog"><section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-xl text-red-700" aria-hidden="true">!</div><h2 className="mt-4 text-xl font-bold" id="confirmation-title">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{message}</p><div className="mt-6 flex justify-end gap-3"><button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={cancel} ref={cancelRef} type="button">Cancel</button><button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2" onClick={confirm} type="button">{confirmLabel}</button></div></section></div>;
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
