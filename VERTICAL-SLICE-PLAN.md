# MVP Vertical Tracer-Bullet Plan

## Goal

Ship the smallest useful Production Staging Timeline: a stage manager can create a Production, divide it into timed Segments, schedule Activities in Lanes, and read the same schedule as a chronological Run of Show.

This document is the active delivery plan. The broader ideas in `PRD.md` are product backlog, not MVP commitments.

## MVP Success Test

The MVP is complete when a stage manager can complete this flow without editing JSON:

1. Create and reopen a Production with date, venue, timezone, start, and end.
2. Add ordered, timed Segments.
3. Add Lanes and timed Activities with operational details.
4. Edit or delete those records and retain changes after reload.
5. Switch between the visual Timeline and chronological Run of Show.
6. Use the Run of Show on a narrow backstage screen and identify what is previous, current, and next.

## Scope Guardrails

- Build only the five tracers below.
- Use React, TypeScript, Tailwind CSS, the existing Express API, and flat-file persistence.
- Keep Activities as the single source of truth for Timeline and Run-of-Show projections.
- Use exact form-based time editing for MVP; direct drag and resize are deferred.
- Keep the legacy chart available as a fallback while the MVP is evaluated.
- Reject invalid data at both UI and API boundaries.
- A tracer is done only after typecheck, production build, browser/API tests, and visible UI verification pass.

## MVP Tracer Map

| Tracer | User-visible outcome | Dependency | Status |
|---|---|---|---|
| T01 | Open a persisted Production in the React shell | None | Verified |
| T02 | Create, save, list, and reopen a Production | T01 | Verified |
| T03 | Add, edit, reorder, collapse, and delete timed Segments | T02 | Verified |
| T04 | Add, edit, and delete Lanes and timed Activities | T03 | Verified |
| T05 | Read the same schedule as a chronological Run of Show | T04 | Verified |

## T01 — React Production Shell

**Outcome:** A versioned sample Production loads through the API and renders its metadata and empty Timeline state in a responsive React interface.

**Included:**

- React, TypeScript, Tailwind, and Vite application shell.
- Versioned runtime-validated Production schema.
- API/repository read path with loading, empty, invalid-data, and connection-error states.
- Accessible primary regions and legacy fallback link.

**Proof:** Browser/API acceptance tests, production build, and desktop/mobile inspection.

## T02 — Production Creation and Persistence

**Outcome:** A stage manager can create a Production and reopen the same persisted record from Production Home.

**Included:**

- Title, date, venue, IANA timezone, planned start/end, revision, and timestamps.
- Create and list APIs with idempotent creation and stale-revision protection.
- Canonical instant storage and Production-timezone display.
- Validation for required data, valid time ranges, and DST gaps/folds.

**Proof:** Create, reload, list, reopen, invalid-range, timezone, duplicate-submit, and stale-revision tests.

## T03 — Timed Segments

**Outcome:** A Production can be divided into ordered, colored, proportional stage-program Segments.

**Included:**

- Segment label, color, start, duration, position, and notes.
- Create, edit, reorder, collapse, and delete controls.
- Absolute scaling against the complete Production interval.
- Production-bound and no-overlap validation.

**Proof:** Add/edit/reorder/delete, invalid timing, scaling, and reload-persistence tests.

## T04 — Lanes and Activities

**Outcome:** A stage manager can build the actual stage schedule with department/performer Lanes and precisely timed Activities.

**Included:**

- Lane creation and confirmed deletion with Activity cascade.
- Activity creation, editing, and deletion through an Inspector.
- Activity label, start, duration, calculated end, owner, type, status, color, and notes.
- Production-bound and Segment-relation validation.
- Proportional Timeline blocks with meaningful accessible labels.

**Proof:** Lane and Activity CRUD, validation, calculated end, cascade delete, accessibility, and reload-persistence tests.

## T05 — Chronological Run of Show

**Outcome:** The same Activities are readable as a backstage-friendly chronological sequence.

**Included:**

- Timeline/Run-of-Show view switching over the same records.
- Stable chronological ordering by start and identity.
- Segment separators and Activity operational details.
- Previous, simultaneous current, next, and upcoming presentation from a live clock.
- Run of Show as the default narrow-screen view.

**Proof:** Controlled-clock ordering tests for before, during, and after the Production plus mobile visual verification.

## Explicitly Deferred After MVP

The following are not required to ship or evaluate the MVP:

- Timeline drag/resize, snapping, multi-select, undo/redo, and duplication.
- Lane groups, pinning, advanced reordering, search, filters, zoom, minimap, and jump-to-now.
- Transitions as a special workflow, dependencies, resources, stage zones, conflict detection, and issue management.
- Autosave queues, offline recovery, snapshots, and multi-user collaboration.
- Legacy import/migration and JSON, PNG, PDF, print, or run-sheet export.
- Advanced keyboard shortcuts, virtualization, performance-scale targets, PWA work, and legacy retirement.
- Authentication, hosted database migration, public sharing, cue calling, equipment integrations, and AI scheduling.

Deferred work must be reconsidered from observed MVP usage rather than automatically resumed in the old T06–T17 order.

## MVP Verification Gate

The release candidate passes only when all of these are true:

- `npm run typecheck` passes.
- The production build completes.
- All browser/API acceptance tests pass from a clean test data directory.
- Dependency audit reports no production vulnerabilities.
- Desktop Timeline and mobile Run-of-Show views are visually checked.
- Creation, editing, deletion, reload persistence, timezone behavior, error recovery, and keyboard panel behavior are confirmed.

## Current Result

T01–T05 are implemented and verified. The final feedback loop passes typecheck, production build, 30 browser/API acceptance tests, production dependency audit, and diff validation. Wave 1 is now the complete MVP rather than the first wave of a mandatory 17-tracer build. Product work should pause here for real stage-manager feedback before any deferred capability is selected.
