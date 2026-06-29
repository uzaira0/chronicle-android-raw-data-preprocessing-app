# View Tab → Review & Compare Explorer — Design

**Date:** 2026-06-19
**Status:** Approved design, pending implementation plan
**Surface:** web (`web/`) only — no Python/Rust/parity changes

## 1. Goal

Replace the current View tab (a bare per-participant waterfall timeline, only populated when the
HTML-export toggle is on) with a **post-processing review surface** modeled on the
`chronicle-knob-explorer` in `/home/opt/research-pipeline`. After processing, the user lands on a
tab where they can:

1. **Review what they just processed** (always available) — participants, an interactive timeline,
   per-run and per-day metrics, and a summary of the settings/outputs that produced the run.
2. **Optionally compare** the run against a **second config** (Arm B) — the same uploaded files
   re-processed in-browser with different options, diffed against the first run (Arm A).

The reference tool is the visual/interaction target. We reproduce its three-pane layout and A/B model
using this app's existing building blocks rather than porting its Python server.

## 2. Scope & non-goals

**In scope:** a redesigned View tab (review + compare), the four-list browser, and decoupling the
in-app review data from the HTML-export toggle.

**Explicitly out of scope / deferred:**
- No change to preprocessing semantics, the matcher, Rust, or Python. **No new processing option** is
  introduced. The cross-surface parity fixture (`scripts/run_deterministic_web_parity.py`) is
  untouched and stays green — this is web-only UI over already-produced results plus an in-browser
  re-run using *existing* options.
- Device-state underlay and raw-event tick overlays (reference `ov-states` / `ov-ticks`) — **deferred**;
  this app does not currently expose raw per-event streams to the View layer.
- Deep-link hash state for the comparison — **deferred** to a follow-up (the app already has a
  shared-config URL mechanism we can extend later).
- Compliance-based flags — included **only if** a compliance metric already exists in results;
  otherwise flags are limited to signals the pipeline already produces (data-time gaps, long-duration,
  no-usage days). See §6.4.

## 3. Reference → this app mapping

| Reference (`chronicle-knob-explorer`) | This app |
|---|---|
| Left rail: participant list, search, flag chips, Δ sort | `ReviewParticipantRail` — participants derived from results; reuse `Combobox` search; Δ sort + flags in Phase 2 |
| Center: A/B waterfall canvas (amber A / teal B + Δ strip) | Extend the existing `InteractiveScene`; Phase 2 adds a combined A/B scene from `plotGenerator` |
| `CONFIG ▾` knob drawer (changed-highlight, reset, presets) | Reuse `SettingsField`/`ToggleField` (already do `modified` highlight + `onReset`) inside a `CompareConfigDrawer` |
| `RUN B` (server engine rerun) | Re-run the in-browser pipeline (`processRawCsv` / `processRawCsvBytesViaPool`) on retained `uploadedFiles` with Arm B options |
| Right rail: A / B / Δ metric cards, day table, day detail | `ReviewMetricsPanel`, fed by a new `reviewMetrics` adapter over `aggregations.ts` |
| APP LISTS subview (4 CSVs + codebook search + TRY IN B) | `AppListsPanel` over the bundled `web/src/assets/defaults/*.csv` |
| Colors: amber `#c66a00` (A), teal `#0b7d8e` (B), green Δ `#178a4c`, red `#c43d38` | Same accent palette, expressed via existing CSS variables |

## 4. Architecture

```
App.tsx (view tab)
└─ ViewPanel                      orchestrator: selected file+participant, compare on/off, Arm B options
   ├─ ReviewParticipantRail       left: participant list + search (+ Δ sort, flag chips in P2)
   ├─ ReviewCenter                center
   │  ├─ ReviewToolbar            arm tags, filtered-usage toggle, "Compare" entry (P2: B preset + Run)
   │  ├─ CompareConfigDrawer (P2) Arm B editor — composes existing settings cards
   │  └─ InteractiveScene         waterfall (single-arm P1; combined A/B scene P2)
   ├─ ReviewMetricsPanel          right: metric cards (A; +B/Δ in P2), day table, day detail
   └─ AppListsPanel               "APP LISTS" subview (toggled from the toolbar like the reference)
```

**Data flow.** `App.tsx` already holds `results: ProcessedFileResult[]`, the live `options`, and
`uploadedFiles: File[]` (retained in memory post-run). `ViewPanel` receives all three.

- **Review data (Arm A)** is derived from `results` — no recompute of the pipeline. A new
  `lib/reviewModel.ts` builds, per participant: the timeline `Scene` (from `result.timelineView`,
  see §5), per-day metrics + totals (via `aggregations.ts`), and top-apps-per-day (for day detail).
- **Compare data (Arm B)** is produced by re-running the pipeline on `uploadedFiles` with Arm B
  options, scoped to the file of the currently-selected participant (matching the reference's
  per-participant on-demand run, keeping cost bounded). Output flows through the same `reviewModel`.

Each unit has one job and a typed interface: the rail emits a selection; `reviewModel` turns results
into a `ReviewModel`; `ReviewMetricsPanel` renders a `ReviewModel` (and an optional B `ReviewModel`);
`InteractiveScene` renders a `Scene`. None reads another's internals.

## 5. Decoupling review data from the export toggle

Today `browserPipeline.ts:2632` builds `timelineView` only when `enableInteractiveTimeline` is true,
and the self-contained HTML file (`buildTimelineViewerHtml`) is produced from it. Decision (chosen):
**always build the in-app `timelineView`; keep the HTML *file* export gated** behind
`enableInteractiveTimeline`.

- Build `timelineView` whenever a run yields app or screen rows (independent of the toggle).
- Only emit the downloadable timeline HTML output when `enableInteractiveTimeline` is on.
- The View tab therefore works after *every* run.

Performance note (per project norm of profiling new work): scene construction is bounded by
participants × days and is cheap relative to matching, but we will measure it on the pathological
fixture; if it ever dominates, it becomes a lazy build inside `reviewModel` without changing the
public shape. Tracked as a follow-up, not a blocker.

## 6. Phase 1 — Review surface (always-on)

### 6.1 Participant rail (`ReviewParticipantRail`)
- Lists every participant across `results` (each `TimelineParticipantView.participantId`), grouped by
  source file with a file filter (reuse `Combobox`, mirroring today's file selector).
- A live search box filters by participant id (reference `#pid-search`).
- Selecting a participant drives the center + metrics panels. `j`/`k` keyboard nav (reference parity).
- Respects demo masking (`DemoDisplayMasker`) exactly as `TimelineViewPanel` does today.

### 6.2 Center waterfall (`ReviewCenter` + `InteractiveScene`)
- Phase 1 renders the existing single-arm waterfall for the selected participant — same canvas,
  shift-scroll zoom, drag-pan, double-click reset, hover tooltips (kept verbatim from
  `TimelineViewPanel`).
- Toolbar carries: app/screen view switch, filtered-usage toggle (existing), and an APP LISTS
  view switch (reference `view-tabs`).

### 6.3 Metric cards + day table + day detail (`ReviewMetricsPanel`)
- A new `lib/reviewMetrics.ts` adapts `aggregations.ts` (`computePeriodSummaries`, `computeTopApps`)
  into: per-run **totals** and a **per-day** array for the selected participant.
- **Metric card (A):** target min, non-target min, filtered min, sessions, screen-session min, days
  with usage / total days — the subset of the reference's rows this app can source. Rows that have no
  source are omitted, not faked.
- **Day table:** one row per day — `DAY | A | (B) | Δ | flags`. Click a day to focus it on the canvas
  and populate day detail (reference behavior).
- **Day detail:** top apps for the focused day with category swatches + minutes (reference
  `renderDayDetail`).

### 6.4 Flags
- Derive a modest flag set from signals the pipeline already produces: data-time-gap days,
  long-duration-flagged days, no-usage days. Render as the reference's colored chips/dots.
- Compliance-based flags (`compliance_lt70`) are included only if a compliance value already exists on
  results; otherwise omitted (see §2). No new compliance computation in this work.

### 6.5 Settings / output summary (`ReviewSettingsSummary`)
- A compact panel: which non-default settings produced this run (reuse `isOptionDefault` to list only
  changed options) and the output files generated (kinds, row counts) — sourced from `result.outputs`,
  overlapping intentionally with `ResultPanel` data but presented as "this is what you ran."

### 6.6 APP LISTS subview (`AppListsPanel`)
- Four cards over the bundled `assets/defaults/*.csv`: `apps_to_filter`, `background_apps`,
  `apps_forcing_screen_open`, `app_codebook` — each with the reference's explanatory note, a table,
  and (codebook) a client-side search box over the bundled CSV.
- Phase 1: read-only browse/search. The "TRY IN B" staging buttons activate in Phase 2.

## 7. Phase 2 — A/B compare

### 7.1 Arm B config (`CompareConfigDrawer`)
- A drawer that **composes the existing settings card components** (the same controls used in the
  Settings tab), seeded from the current `options`. Changed-from-A fields already render highlighted
  via `modified`, with per-field `onReset` — this is the reference's `changed` + RESET behavior for
  free. A "Reset all to A" clears overrides.
- Optional: seed Arm B from a preset/saved project (IndexedDB `projectsStore`) — the reference's preset
  dropdown analogue. Falls back to "start from current config."

### 7.2 Running Arm B
- "Run comparison" re-invokes the pipeline on the selected participant's source file via
  `processRawCsvBytesViaPool` (or `processRawCsv`) with the Arm B options, reusing the same support
  files. Result is fed through `reviewModel` to produce Arm B's scene + metrics.
- Status line mirrors the reference ("running… / done"). Re-run failures surface a toast and leave
  Arm A intact (§9).

### 7.3 Comparison rendering
- **Waterfall:** a new `buildComparisonWaterfallScene(aRows, bRows)` in `plotGenerator.ts` emits, per
  day, an **A lane (amber)**, a **B lane (teal)**, and a **Δ strip** (green B>A / red B<A) — directly
  reproducing the reference's `drawLane` + delta strip, expressed as Scene primitives so canvas/SVG
  cannot drift (consistent with the project's Scene-model rule).
- **Metric cards:** add **B** and **Δ (B − A)** cards (reference `renderMetrics`), green/red signed.
- **Day table:** B and Δ columns populate; Δ cells colored by sign.
- **Rail:** sort participants by |Δ target min| (reference's biggest-difference-first) and show a
  per-participant Δ badge.

### 7.4 APP LISTS "TRY IN B"
- The staging buttons set the corresponding Arm B flag (`useBackgroundAppsFile`,
  `useAppsForcingScreenOpenFile`, `useFilterFile`) and open the config drawer — the reference's
  `data-knob` / `data-extra` staging.

## 8. Component / file inventory

**New (`web/src/`):**
- `components/ViewPanel.tsx` — tab orchestrator (replaces `TimelineViewPanel` as the tab root)
- `components/review/ReviewParticipantRail.tsx`
- `components/review/ReviewCenter.tsx` (+ reuse existing `InteractiveScene`, extracted from
  `TimelineViewPanel.tsx` into `components/review/InteractiveScene.tsx`)
- `components/review/ReviewMetricsPanel.tsx`
- `components/review/ReviewSettingsSummary.tsx`
- `components/review/AppListsPanel.tsx`
- `components/review/CompareConfigDrawer.tsx` (Phase 2)
- `lib/reviewModel.ts` — results → `ReviewModel` (scene + per-day metrics + top apps)
- `lib/reviewMetrics.ts` — `aggregations.ts` → totals + per-day rows + flags

**Modified:**
- `lib/browserPipeline.ts` — always build `timelineView`; gate only the HTML file export
- `lib/plotGenerator.ts` — add `buildComparisonWaterfallScene` (Phase 2)
- `App.tsx` — render `ViewPanel`, pass `uploadedFiles` + `options` + re-run handle
- `TimelineViewPanel.tsx` — `InteractiveScene` extracted out; file retired or thinned

## 9. Error handling
- **No retained files** (tab reopened, `uploadedFiles` cleared): review still works from `results`;
  the compare action is disabled with a hint to re-add files. No crash.
- **Arm B re-run fails:** toast the error, keep Arm A and the existing B (if any) intact; never blank
  the panel (mirrors reference `loadArms` catch).
- **Empty/zero-row participant:** day table/detail show "no sessions"; metric cards show em-dashes.
- **Demo mode:** all participant ids, file names, dates, and tooltips pass through `DemoDisplayMasker`
  as today.

## 10. Testing
- **Unit (`vitest`):** `reviewMetrics` totals/per-day/Δ math from fixture rows; flag derivation;
  `reviewModel` shape; `buildComparisonWaterfallScene` primitive counts (A lane + B lane + Δ per day).
- **Component:** rail selection drives center+metrics; day-click focuses + fills detail; compare
  toggle adds B/Δ; re-run failure preserves A.
- **E2E smoke (`@smoke`):** process a fixture → View tab shows participants + metrics without enabling
  the HTML-export toggle (verifies the §5 decoupling).
- **Parity:** `make parity` must remain green untouched — asserts no semantic change. `make web`
  (typecheck + unit + contract) is the gate; `npm run check:contract` confirms no contract drift (no
  new options were added).

## 11. Open questions / risks
- **Compliance metric availability** decides whether `compliance_lt70` flags + the day-table CMP
  column appear; confirm during Phase 1 §6.4 by inspecting results/aggregations. If absent, those are
  cleanly omitted.
- **Always-build cost** (§5) on large batches — measure on the pathological fixture; lazy-build is the
  fallback if profiling flags it.
- **`ResultPanel` overlap** — the settings/output summary intentionally restates some `ResultPanel`
  data. Decide during Phase 1 whether `ResultPanel` stays in the Process tab (recommended) or its
  download actions migrate into the review; default: leave `ResultPanel` as-is to keep scope bounded.
