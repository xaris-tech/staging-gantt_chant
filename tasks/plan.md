# Legacy Plan: Stage Manager Gantt Chart

> **Archived:** This describes the original painted-cell application and is not the active delivery plan. The current MVP scope and verification gate are defined in [`../VERTICAL-SLICE-PLAN.md`](../VERTICAL-SLICE-PLAN.md). Do not treat the tasks below as current commitments.

## Overview

A single-page gantt chart application for stage managers to track what's on stage during production segments. Supports real-time multi-user collaboration via a REST backend, unlimited segments, cell painting, undo/redo, and PNG export.

---

## Architecture

```
┌─────────────┐     PUT/GET /api/data     ┌──────────────┐
│  Browser A   │ ◄──────────────────────► │              │
│  (localStorage│                          │  Express.js  │
│   + fetch)   │                          │  (server.js) │
├─────────────┤                          │              │
│  Browser B   │ ◄──────────────────────► │ data/        │
│              │                          │  gantt.json  │
└─────────────┘                          └──────────────┘
```

### Stack
- **Frontend**: Vanilla HTML/CSS/JS (single file: `staging_gantt-chart.html`)
- **Backend**: Express.js (Node) with flat-file JSON storage
- **Offline**: localStorage fallback + PWA service worker
- **Export**: html2canvas (CDN)

### Data Model

```
Cell  → '' | { t: string, b: '#hex' }
Row   → { task, oic, start, appearances, cells: Cell[] }
Seg   → { cols: number, start: string, end: string, label: string, color: '#hex' }
State → { rows: Row[], segments: { [key: string]: Seg }, chartTitle: string, updatedAt: number }
```

---

## Tasks

### I. Core Chart (Done)

| # | Task | Acceptance |
|---|------|------------|
| 1 | Cell text editing | Click cell → inline input → blur/Enter saves text |
| 2 | Paint mode | Toggle button + color picker; click/drag paints cell background via color picker |
| 3 | Erase mode | Toggle clears both text (`t`) and color (`b`) from cells |
| 4 | Segment add/remove/rename | Modal with color picker; inline click-to-edit label; rename preserves cells |
| 5 | Column sizing | Segment `cols` property; add/remove columns splices at correct index |
| 6 | Undo/redo | Ctrl+Z/Y; saves snapshots; re-entrancy guard (`rendering` flag) |
| 7 | Row management | Add row, drag-drop reorder, delete |
| 8 | Keyboard shortcuts | Ctrl+Z (undo), Ctrl+Y (redo), Ctrl+S (save), ESC (exit paint/erase) |
| 9 | Export | PNG via html2canvas (2x, full chart + title) and JSON download |
| 10 | Import | File picker → parse JSON → render |
| 11 | Clear all | Confirm → reset to single default segment + row |
| 12 | PWA | manifest.json, sw.js, icon.svg, offline cache |

### II. Multi-User Backend (Done)

| # | Task | Acceptance |
|---|------|------------|
| 13 | Express server | Serves static files + API on configurable port |
| 14 | GET /api/data | Returns saved JSON; default empty data on first boot |
| 15 | PUT /api/data | Writes JSON; responds `{ ok: true }` |
| 16 | Frontend sync | Loads from API first; falls back to localStorage |
| 17 | On-save push | Every `saveToStorage` also fires PUT to API (async) |
| 18 | Periodic poll | Every 30s checks remote `updatedAt`; prompts to reload if newer |
| 19 | Sync indicator | Colored dot showing synced / offline / local-only |
| 20 | Error boundary | If server unreachable, works locally and reconnects on next write |

### III. Deployment (Done)

| # | Task | Acceptance |
|---|------|------------|
| 21 | Production hosting | Server deployed to Vercel (Node.js) or Render |
| 22 | Persistent storage | Bind-mounted volume or DB for `data/gantt.json` on Render; Vercel requires external DB (Supabase/Upstash) |
| 23 | CORS hardening | Restrict origins in production |
| 24 | Rate limiting | Prevent accidental spam from rapid paint-drags |

### IV. Polish (Done)

| # | Task | Acceptance |
|---|------|------------|
| 25 | Mobile layout | Responsive table with horizontal scroll on small screens |
| 26 | Loading state | Skeleton or spinner during API fetch on initial load |
| 27 | Multi-chart support | URL param `?chart=my-id` scopes the `data/gantt-{id}.json` file |

---

## Dependency Graph

```
[ 1-12 Core Chart ] ──► [ 13-20 Multi-User Backend ] ──► [ 21-24 Deployment ]
                                                              │
                                              [ 25-27 Polish ]◄┘
```

All sections are complete.

---

## Verification

1. `node server.js` → visit `http://localhost:3000` → chart loads
2. Open two browser tabs → edit in one → wait 30s → other tab prompts to sync
3. Kill server → edits work locally → restart → next save syncs to server
4. `Ctrl+Z`/`Ctrl+Y` after any edit sequence → state rolls back correctly
5. PNG export captures full chart uncropped
6. Service worker caches page for offline reload
