# Product Requirements Document: Production Staging Timeline

> **MVP scope update (July 24, 2026):** The active MVP is limited to Production creation/persistence, timed Segments, Lanes and Activities, the Timeline, and the chronological Run of Show (T01–T05). All other requirements in this document are retained as a future product backlog, not current release commitments. See [`VERTICAL-SLICE-PLAN.md`](VERTICAL-SLICE-PLAN.md) for the authoritative delivery scope and verification gate.

## Problem Statement

The current Staging Gantt Chart works as an editable matrix of teams and colored cells, but it does not yet behave like a complete stage-production planning tool. A stage manager can indicate that a team is active during a broad production segment, but cannot reliably answer the operational questions that matter during rehearsals and a live show:

- What happens next on stage, and at exactly what time?
- What is entering, active, transitioning, or exiting?
- Who owns each activity or cue?
- Which people, equipment, or stage zones are double-booked?
- How does a delayed activity affect the remaining run of show?
- What view should performers, technical teams, and stage management receive?

The existing cell-painting model also makes duration and sequence implicit. Adding or removing columns changes meaning, times are stored as free text, activities cannot span precise intervals, and production transitions are not first-class records. This limits the chart's usefulness as the source of truth for planning and operating a production.

The application should evolve from a colored spreadsheet into a production-specific timeline editor: a full run-of-show and staging layout that communicates sequential stage activity clearly before and during a production.

## Solution

Build a React and TypeScript production timeline application with a purpose-built Gantt-style layout. The horizontal axis represents real production time. The vertical axis represents configurable stage lanes such as performances, people, departments, equipment, and stage zones. Each scheduled activity appears as a draggable and resizable timeline block with a name, start, duration, owner, status, color, notes, and optional dependencies.

The primary planning object is a **Production**. A Production contains a **Run of Show**, divided into **Segments** such as Opening, Praise & Worship, Choir Production, Preaching, Awarding, and End Production. Each Segment contains **Stage Activities** and **Transitions**. Activities are assigned to one or more **Lanes** and may reference **Resources**, **Stage Zones**, and **Cues**.

The editor will offer two synchronized ways to understand the production:

1. **Timeline view** for spatial planning across lanes and time.
2. **Sequence view** for a chronological run sheet showing what is happening now, next, and later.

The first release will prioritize reliable planning, fast editing, conflict visibility, autosave, responsive viewing, and printable/exportable output. Live show execution, advanced collaboration, and venue floor-plan drawing can follow after the planning model is stable.

### Goals

- Make the complete sequence of stage activity understandable at a glance.
- Represent real start times, end times, durations, transitions, and overlaps.
- Give the stage manager one authoritative production plan.
- Surface scheduling conflicts before rehearsal or show time.
- Support fast editing without sacrificing data integrity.
- Provide useful views and exports for production, technical, and performance teams.
- Migrate existing chart data without silently losing content.

### Success Measures

- A stage manager can create a representative two-hour production plan in 30 minutes or less.
- A user can identify the current and next activity within five seconds in Sequence view.
- All overlapping assignments for the same exclusive resource or stage zone are visibly flagged.
- Timeline edits persist through reload and can be undone and redone.
- A production with at least 150 activities and 50 lanes remains responsive during scroll, zoom, drag, and resize on a typical laptop.
- Printable and PDF/PNG exports include the complete selected time range without clipped labels or timeline blocks.
- Existing saved charts can be imported with a migration summary and without deleting the original data.

## User Stories

1. As a stage manager, I want to create a production with a title, date, venue, timezone, and planned start time, so that the schedule has clear operational context.
2. As a stage manager, I want to duplicate a previous production, so that recurring events do not need to be rebuilt from scratch.
3. As a stage manager, I want to define the overall production start and end, so that the timeline is bounded to the actual show window.
4. As a stage manager, I want to divide the run of show into named and colored segments, so that major portions of the program are visually distinct.
5. As a stage manager, I want to reorder segments, so that program changes can be reflected quickly.
6. As a stage manager, I want segment boundaries to derive from real times, so that their widths accurately represent duration.
7. As a stage manager, I want to collapse a segment, so that I can focus on the part of the show I am editing.
8. As a stage manager, I want to add stage activities with a start, duration, and end, so that every event occupies an exact place in time.
9. As a stage manager, I want changing a start time or duration to update the end time automatically, so that timing remains consistent.
10. As a stage manager, I want to drag an activity along the timeline, so that I can reschedule it visually.
11. As a stage manager, I want to resize an activity from either edge, so that I can adjust its start, end, or duration directly.
12. As a stage manager, I want edits to snap to a configurable interval such as 1, 5, 10, or 15 minutes, so that the schedule matches the required precision.
13. As a stage manager, I want to enter exact times in an inspector, so that fine adjustments do not depend on dragging accuracy.
14. As a stage manager, I want to move multiple selected activities together, so that a program section can be shifted efficiently.
15. As a stage manager, I want to duplicate an activity, so that repeated program elements are quick to schedule.
16. As a stage manager, I want to split an activity, so that a break or interruption can be represented accurately.
17. As a stage manager, I want to mark activities as planned, confirmed, at risk, cancelled, or completed, so that readiness is visible.
18. As a stage manager, I want to attach notes and instructions to an activity, so that its operational details are not lost.
19. As a stage manager, I want to distinguish setup, entrance, performance, transition, exit, and teardown activity types, so that the flow of the stage is explicit.
20. As a stage manager, I want transitions to have their own durations, owners, and notes, so that changeovers are planned instead of assumed.
21. As a stage manager, I want to link activities with finish-to-start dependencies, so that essential sequencing is visible.
22. As a stage manager, I want a warning when a dependency is violated, so that impossible sequencing is caught early.
23. As a stage manager, I want to optionally shift downstream dependent activities after a timing change, so that I can update the run of show safely.
24. As a stage manager, I want to organize lanes into groups such as Program, Performers, Technical, Stage Zones, and Equipment, so that the chart reflects how the production team thinks.
25. As a stage manager, I want to add, rename, reorder, collapse, and archive lanes, so that the layout fits each production.
26. As a stage manager, I want to pin the lane labels while scrolling horizontally, so that I never lose row context.
27. As a stage manager, I want segment and time headers to stay visible while scrolling vertically, so that timing remains readable.
28. As a stage manager, I want to assign an activity to a person or department owner, so that responsibility is clear.
29. As a stage manager, I want to assign performers, equipment, and stage zones as resources, so that operational requirements are explicit.
30. As a stage manager, I want exclusive resources to reject or warn about overlapping assignments, so that double-bookings are found before the show.
31. As a stage manager, I want shareable resources to permit overlap, so that conflict warnings reflect real operating rules.
32. As a stage manager, I want to see conflicts both on the timeline and in a dedicated issue panel, so that none are hidden off-screen.
33. As a stage manager, I want conflicts grouped by severity and type, so that I can resolve the most important issues first.
34. As a stage manager, I want to dismiss an intentional overlap with a reason, so that accepted exceptions do not remain noisy.
35. As a stage manager, I want a chronological Sequence view, so that I can read the show from top to bottom like a run sheet.
36. As a stage manager, I want the Sequence view to show previous, current, next, and upcoming activities, so that live orientation is immediate.
37. As a stage manager, I want filters by segment, lane group, owner, resource, status, and activity type, so that I can focus on a team or show section.
38. As a stage manager, I want text search across activity names, owners, and notes, so that I can find an item quickly.
39. As a stage manager, I want to zoom between overview, 15-minute, 5-minute, and 1-minute scales, so that I can switch between whole-show planning and detailed cue work.
40. As a stage manager, I want a “fit production” control, so that the entire show can be framed in one action.
41. As a stage manager, I want a “jump to now” control, so that I can orient the timeline during a live production.
42. As a stage manager, I want a visible current-time line when the production is active, so that planned timing can be compared with clock time.
43. As a stage manager, I want all editing actions to support undo and redo, so that experimentation is safe.
44. As a stage manager, I want autosave with a clear saving, saved, offline, or error state, so that I know whether changes are protected.
45. As a stage manager, I want unsaved local changes preserved if connectivity fails, so that planning can continue offline.
46. As a stage manager, I want to be warned before replacing newer remote data, so that synchronization does not silently destroy work.
47. As a stage manager, I want a manual named snapshot, so that I can preserve an approved schedule before major edits.
48. As a stage manager, I want to import an existing chart and preview how its rows, segments, and cells will map to the new model, so that migration is understandable.
49. As a stage manager, I want the original imported file or saved chart left unchanged, so that migration is reversible.
50. As a stage manager, I want a migration report listing converted items and unresolved cells, so that I can complete cleanup intentionally.
51. As a stage manager, I want to export the complete production as JSON, so that it can be backed up or transferred.
52. As a stage manager, I want to export a selected timeline range as PNG or PDF, so that teams can receive a visual schedule.
53. As a stage manager, I want a print layout with repeated headers and controlled page breaks, so that large charts remain readable on paper.
54. As a stage manager, I want to export a chronological run sheet, so that crew members who do not need the full timeline have a concise operational document.
55. As a department lead, I want a filtered view of only my lanes and activities, so that I can prepare without unnecessary detail.
56. As a performer, I want a read-only schedule filtered to my appearances, entrances, and exits, so that I know when and where I am needed.
57. As a technical operator, I want cues and technical notes visible beside the related stage activity, so that operational timing stays aligned with the program.
58. As a production director, I want a whole-show overview with segment durations and unresolved conflicts, so that I can assess readiness.
59. As a viewer, I want links and exported views to preserve the production timezone, so that times are not misinterpreted.
60. As a keyboard user, I want all editor actions available without a mouse, so that the application is efficient and accessible.
61. As a screen-reader user, I want activities, times, conflicts, and editing controls to have meaningful labels, so that I can understand and operate the schedule.
62. As a touch-device user, I want a readable sequence-focused view and touch-safe controls, so that I can consult the plan backstage.
63. As a user, I want destructive actions to require confirmation and identify their impact, so that I do not accidentally delete production data.
64. As a user, I want consistent empty, loading, error, and offline states, so that the application always explains what is happening.
65. As an administrator, I want invalid chart identifiers and malformed payloads rejected, so that stored production data and server paths remain safe.

## Implementation Decisions

- Migrate the frontend from a single HTML/CSS/JavaScript file to a Vite-powered React application using TypeScript and Tailwind CSS. React supplies composable editor views, TypeScript formalizes the production model, and Tailwind supplies a consistent responsive design system.
- Keep the existing Express and serverless API behavior initially, but introduce a typed repository boundary between UI state and persistence. The UI must not call storage APIs directly.
- Use a purpose-built timeline renderer rather than adopting a project-management Gantt component as the core domain. Typical Gantt packages center on project tasks, percentage completion, and business-day dependencies; this product needs minute-level show timing, stage lanes, transitions, cues, and resource conflicts.
- Build the timeline from synchronized layers: a sticky lane-header pane, a scrollable time grid, absolute-positioned activity blocks, an SVG overlay for dependencies and current-time markers, and a shared scroll/zoom controller.
- Use a headless virtualization utility for large lane lists once dataset thresholds require it. The rendering contract must preserve full control over markup, accessibility, sticky panes, and production-specific visuals.
- Use an accessible drag-and-drop abstraction for reordering lanes and keyboard movement. Timeline drag and resize calculations remain in a dedicated scheduling engine because they require time-to-pixel conversion, snapping, collision detection, and multi-selection.
- Represent time internally as integer milliseconds from a canonical production start instant. Store the Production timezone as an IANA timezone name and render wall-clock labels in that timezone. Durations are integer milliseconds and must be positive.
- Treat calculated end time as `start + duration`; do not persist independently editable start, duration, and end values that can disagree.
- Define stable identifiers for every Production, Segment, Lane, Activity, Resource, Cue, and Snapshot. Ordering uses explicit sortable positions rather than identifier naming conventions such as `SEG1` and `SEG2`.
- Define the initial domain model as:
  - Production: identity, metadata, timezone, planned interval, settings, segments, lanes, activities, resources, cues, revision metadata.
  - Segment: identity, label, color, planned interval, position, notes.
  - Lane: identity, group, label, color, position, visibility, archived state, optional linked resource.
  - Activity: identity, segment, lane assignments, label, type, start, duration, owner, status, color, notes, resource assignments, stage zones, dependencies.
  - Resource: identity, category, label, exclusivity rule, availability notes.
  - Cue: identity, activity, department, sequence number, trigger, action, standby text, notes.
  - Snapshot: identity, label, production revision, creator metadata, created time.
- Make activities the source of truth. Timeline blocks, sequence rows, counts, segment summaries, and exports are projections of the same activity records.
- Allow an activity to appear on multiple lanes without duplicating the activity. Each rendered block instance references the same activity identity.
- Classify stage activity as setup, entrance, performance, transition, exit, teardown, hold, or custom. Status is planned, confirmed, at risk, cancelled, or completed.
- Start with finish-to-start dependencies. Other dependency types and lag/lead offsets are deferred until a validated production need exists.
- Evaluate conflicts deterministically in a pure scheduling module. Initial rules cover overlapping exclusive resources, overlapping exclusive stage zones, dependency violations, activity outside its segment or production bounds, and invalid duration.
- Treat warnings as derived state, not persisted state. Persist only explicit user acknowledgements for accepted exceptions, including reason and revision context.
- Centralize all chart mutations in a command/reducer layer. Commands return the next state and an inverse operation or snapshot, enabling consistent undo/redo, autosave, conflict recalculation, and testability.
- Debounce autosave after local edits and flush on explicit save or page lifecycle events when supported. Expose saved, saving, offline, and failed states. Never claim remote persistence after only a local write.
- Add optimistic concurrency to the API using a revision number or ETag. A write based on an obsolete revision returns a conflict response rather than silently overwriting newer data.
- Validate import and API payloads at runtime against a versioned schema. Validation errors must identify affected records and must not partially replace current production state.
- Version the persisted document format. Migration executes from one version to the next and remains independently testable.
- Migrate legacy segments into timed Segments distributed across the imported production window. Migrate each legacy row into a Lane. Merge contiguous painted cells with equivalent content/color into Activities. Ask the user to review inferred times and unresolved empty-text colored ranges in the migration preview.
- Maintain local offline recovery through an indexed browser store rather than relying only on localStorage for growing production documents and revision metadata.
- Preserve JSON import/export. Generate PNG/PDF and printable run-sheet exports from a dedicated presentation model so editor-only controls never appear in output.
- Use responsive behavior based on task context: full Timeline view on desktop/tablet landscape; Sequence view as the default narrow-screen experience; optional horizontal timeline consultation on mobile rather than full precision editing.
- Establish a design system with semantic color tokens for canvas, lanes, segments, activities, statuses, selection, conflicts, and focus. Custom activity colors must still meet text contrast requirements or receive an automatically selected foreground treatment.
- Keep toolbar actions grouped as Production, Edit, View, Insert, and Export. Move record-specific fields into a right-side Inspector rather than accumulating modal dialogs and top-level buttons.
- Add keyboard commands for undo/redo, save, delete, duplicate, nudge earlier/later, change duration, zoom, search, and escape/cancel. Display shortcuts in tooltips and a keyboard-help panel.
- Sanitize chart identifiers and stop deriving filesystem paths directly from untrusted query parameters. Enforce server-side payload limits, schema validation, allowed origins, and bounded rate limiting.
- Preserve PWA installability only after the new app shell and offline recovery behavior are stable. Service-worker updates must avoid serving an incompatible cached application against newer document schemas.
- Implement incrementally behind a new document version: foundation and read-only renderer; core editing; sequencing and conflicts; persistence and migration; export and polish. Keep the legacy editor available as a read-only/migration fallback until migrated documents are verified.

### Primary Screens and Layout

- **Production home:** recent Productions, create, duplicate, import, archive, and connection state.
- **Timeline editor:** application header, grouped toolbar, production/segment header, sticky lane pane, time canvas, minimap or overview strip, issue drawer, and activity Inspector.
- **Sequence view:** chronologically ordered activity cards/rows with segment separators, times, duration, lane, owner, status, cues, and previous/current/next emphasis.
- **Resource view:** resource list, assignments, availability, and conflicts.
- **Print/export preview:** paper size, orientation, time range, filters, scale, legends, repeated headers, and page boundaries.

### API Contract Direction

- `GET /api/productions` returns production summaries available to the current deployment or user scope.
- `POST /api/productions` creates a versioned Production document.
- `GET /api/productions/:productionId` returns the complete document plus revision metadata.
- `PUT /api/productions/:productionId` replaces a document only when the supplied base revision matches.
- `POST /api/productions/:productionId/snapshots` creates a named immutable snapshot.
- The existing `GET/PUT /api/data?chart=` contract remains temporarily available for legacy documents and migration.
- Authentication and organization-level authorization are not required for the first local/single-team release, but repository and API interfaces must not assume anonymous global access permanently.

### Delivery Phases

1. **Foundation:** React/TypeScript/Tailwind setup, versioned domain schema, sample Production, read-only timeline and sequence projections, design tokens, and migration boundary.
2. **Core editor:** segments, lanes, activities, Inspector, drag/resize, snapping, selection, undo/redo, filtering, zooming, sticky headers, and keyboard support.
3. **Production intelligence:** transitions, resources, stage zones, dependencies, deterministic conflict engine, issue drawer, and acknowledgements.
4. **Persistence:** typed repository, autosave state, revision conflicts, offline recovery, legacy import preview, migration report, and snapshots.
5. **Sharing and polish:** run-sheet view, print/PDF/PNG/JSON exports, responsive backstage views, accessibility audit, performance tuning, and legacy fallback retirement criteria.

## Testing Decisions

- The primary acceptance seam is the running browser application backed by the public API. Playwright tests should exercise complete user outcomes: create/load a Production, arrange activities, observe conflicts, save, reload, switch views, migrate legacy data, and export. Tests must assert user-visible state rather than component implementation.
- Reuse the existing Playwright browser test approach, replacing brittle button-text and global-function access with role-based selectors, stable accessible names, and seeded API fixtures.
- Add one lower pure-domain seam for scheduling behavior that would be expensive or ambiguous to cover only through the browser. This seam tests time conversion, snapping, activity moves/resizes, downstream shifts, conflict detection, ordering, and inverse undo commands without rendering React.
- Test the versioned schema and every migration step with fixture documents. Include malformed input, unknown fields, missing records, discontinuous legacy cells, daylight-saving boundaries, and migration idempotence.
- Test optimistic concurrency at the API boundary: successful write, stale revision rejection, retry after refresh, offline queue recovery, and no false “saved” status.
- Test export behavior through its presentation model plus a small number of browser-level visual or snapshot checks. Verify selected time range, filters, repeated headers, legends, page boundaries, and no clipped activities.
- Test accessibility through keyboard-only Playwright flows and automated accessibility checks for the Timeline, Sequence view, Inspector, modal dialogs, issue drawer, and export preview.
- Test responsive behavior at narrow mobile, tablet landscape, laptop, and wide desktop viewports. Narrow screens must default to a usable Sequence view and must not require precision dragging.
- Add performance fixtures for at least 50 lanes, 150 activities, 20 segments, and 300 resource assignments. Measure interaction latency for scroll, zoom, drag, and resize; avoid timing assertions that are too environment-sensitive in normal CI.
- Include focused regression tests for existing capabilities that remain promised: add/reorder/delete lanes, segment editing, undo/redo, offline recovery, JSON import/export, chart title/metadata editing, and multi-production isolation.
- A good test describes externally meaningful behavior, controls time and identifiers, uses realistic production fixtures, and remains valid if internal React components or state libraries change.
- The proposed seams are an implementation assumption for review: one high browser/API acceptance seam and one pure scheduling-domain seam. No component-level test suite should be added unless a component contains independently meaningful behavior that cannot be observed reliably at those seams.

## Out of Scope

- Real-time simultaneous multi-user cursor presence and field-level collaborative editing.
- User accounts, organization management, granular roles, and approval workflows.
- Live calling of cues, headset communication, countdown timers, and show-control system integration.
- Automated schedule generation or AI optimization.
- Venue CAD, 2D/3D floor-plan drawing, and physical blocking diagrams.
- Payroll, attendance, ticketing, budgeting, inventory purchasing, and transport logistics.
- SMPTE timecode, MIDI, OSC, lighting-console, audio-console, or video-playback integration.
- Native iOS or Android applications.
- Advanced dependency types, resource leveling, critical-path analysis, and percentage-complete project management features.
- Public anonymous sharing links until authentication and access rules are designed.
- Replacing the persistence backend with a specific hosted database in the first frontend migration phase.

## Further Notes

- “Gantt” is useful visual language, but “Production Timeline” or “Run of Show” should be the product-facing terminology. It better matches minute-by-minute stage operations and avoids implying a conventional project-management tool.
- The framework recommendation is deliberately hybrid: React handles application composition, a headless virtualizer can keep large timelines responsive, and a custom scheduling/layout engine preserves production-specific behavior. A prebuilt enterprise Gantt may shorten an initial demo but is likely to constrain stage lanes, transitions, cue presentation, responsive Sequence view, and licensing.
- React officially supports TypeScript-based component development, Tailwind supplies responsive and container-query tools, and TanStack Virtual provides headless vertical/horizontal virtualization while leaving markup and styling under product control.
- The current repository contains substantial unrelated and renamed working-tree changes. Implementation must preserve those changes and establish the intended application root before scaffolding or moving files.
- This PRD does not publish or commit changes. It is ready for product review before being decomposed into implementation tickets.
