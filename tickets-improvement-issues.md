# Staging Gantt Chart — Improvements & Issues

## Bugs Fixed

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| B1 | Duplicate drag-drop function definitions — first set (lines 852-887) was dead code overwritten by second set (lines 889-925). Caused `dragSrcRi` variable to be unused and `rowDragStart` / `rowDrop` / `rowDragEnd` to have orphaned implementations. | High | Fixed |
| B2 | Missing CSS for `.dragging` and `.drag-over` classes — drag-to-reorder rows had zero visual feedback. | High | Fixed |
| B3 | No touch/pointer event handlers on task cells — paint mode didn't work on mobile/touchscreens. | High | Fixed |
| B4 | localStorage calls not wrapped in error handling — quota exceeded or corrupted data broke the app. | Medium | Fixed |
| B5 | `oldTagColors` in temporal dead zone (`const` used before declaration) caused JS to fail during page load. | High | Fixed |

## Changes Made (v2)

| # | Change | Description | Status |
|---|--------|-------------|--------|
| C1 | Removed quick-tag preset system | Removed `renderQuickTags()`, `defaultTagColors`, `tagColors`, `showTagColorModal()`, `tagPaint()`, `setPaintCursor()`. Removed all quick-tag CSS and HTML. Cells no longer carry preset tag values. | Done |
| C2 | Replaced with color-only paint mode | Added `<input type="color">` picker + toggle button in controls. Paint mode applies the selected hex color as cell background without changing cell text. Toggle On/Off button with visual indicator. | Done |
| C3 | Cell editing via click | Single click on any cell opens inline text input (max 10 chars). Previously required double-click. User types whatever text they want — no presets. | Done |
| C4 | New cell data model | Cells changed from strings to `{ t: 'text', b: '#hexcolor' }` objects. `''` for empty cells. Backward-compat migration from old saved data (v3). Exports/imports use new format. | Done |
| C5 | Removed time row from header | Second header row showing start times for each column removed. Header now has a single row. | Done |
| C6 | Storage version bump | Changed from `gantt_v3` to `gantt_v4`. Load function falls back to v3 and migrates data. | Done |

## Deployability

| # | Item | Description | Status |
|---|------|-------------|--------|
| D1 | PWA Manifest (`manifest.json`) | Full manifest with standalone display, theme color, maskable icon. | Done |
| D2 | Service Worker (`sw.js`) | Caches HTML, manifest, and icon for offline access. | Done |
| D3 | App Icon (`icon.svg`) | 512×512 SVG with colored gantt bars. | Done |
| D4 | PWA Meta Tags | `apple-mobile-web-app-capable`, viewport, manifest link, SVG favicon. | Done |
| D5 | Server Config | `npm run dev` / `npm start` launches `npx serve` on port 3000. | Done |
| D6 | localStorage Error Boundary | Wrapped in try/catch; corrupted data auto-detected and purged. | Done |

## Remaining Ideas (Future)

| # | Idea | Notes |
|---|------|-------|
| R1 | Export as Image/PDF | Canvas-based export of full chart as PNG or PDF. |
| R2 | Timeline Bars | Replace filled-cell approach with actual time-scaled horizontal bars. |
| R3 | Responsive Layout | Proper responsive breakpoints for narrow screens. |
| R4 | Multi-User / Firebase Sync | Cloud persistence for simultaneous editing. |
| R5 | Print Stylesheet | `@media print` rules for clean printable chart. |
