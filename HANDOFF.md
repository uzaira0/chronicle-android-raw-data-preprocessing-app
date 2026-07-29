# Handoff — Interactive timeline "waterfall" redesign

> **Historical handoff only.** This records the June 2026 UI work and is not a
> current architecture or implementation guide. The TypeScript/Python engines
> and paths named below were subsequently retired. Current authority is the
> 55-step Rust/Salsa runtime described in `CLAUDE.md`, `README.md`, and
> `docs/semantic-federation/55-step-incremental-rust-plan.md`.

**Date:** 2026-06-05
**Repo:** `/home/opt/chronicle-android-raw-data-preprocessing-app` (web app under `web/`)
**Live site:** https://uzaira0.github.io/chronicle-android-raw-data-preprocessing-app/
**`main` tip at handoff:** `139ec57` (PR #43)

---

## 1. What this handoff is for

The **next task is not yet started**: redesign the *interactive* timeline surfaces
(the **View** tab and the **exported HTML viewer**) into a bare, full-width,
vertically-scrolling **"waterfall"**. Everything before it (below, §3) is **done,
verified, and deployed**. This doc is the complete context to execute the waterfall
task without rediscovery.

---

## 2. The task (verbatim intent)

> "have the plots take up the full width of the screen as much as possible and be
> zoomed to fit, flush with the edges, with the dates still padding of course; we
> don't need the title or subtitle or grid or whatever; and be able to scroll down
> to see more dates rather than this zoom and pan thing — like a waterfall."

Concretely, for the **View tab** and the **exported HTML viewer** (NOT the PNG/SVG
image exports — those stay as full plots for reports):

- **Full width, fit-to-width, flush to edges.** Bars span the available width; only
  a **left gutter remains for the date labels** ("dates still padding").
- **Strip all chrome:** no title, no subtitle, no legend, no axis, no grid /
  row-separators. Just date-labelled rows of coloured bars (+ faint gap bands).
- **Vertical scroll** through days ("waterfall") — **replace the current
  wheel-zoom / drag-pan** interaction entirely.
- **Keep hover tooltips** (they were just added — see §3 — and must survive): app
  bar → package / category / "X min · type" / `YYYY-MM-DD HH:MM:SS → HH:MM:SS`;
  screen bar → reason / duration / time range; gap band → "No device events · <dur>"
  + range.
- Keep the **File** dropdown and **App / Screen** dropdown; render one waterfall per
  participant.

### Open product choices (confirm with user; defaults in **bold**)
- Hour/time reference: user said "no grid/axis", so **default = fully bare**, rely on
  hover. (Alternative they might want later: a subtle *sticky* hour ruler at the top —
  not a grid through the data.)
- Apply to **both** View tab and exported HTML for consistency: **yes** (the "zoom and
  pan thing" exists in both).
- Row height / density: **~24–28 px/day** at base scale; pick what looks clean.

---

## 3. What is already DONE and deployed (do not redo)

Recent merged PRs (all squash-merged to `main`, deployed, verified on the live bundle):

- **PR #41** `fix/interactive-timeline-viewer-html` — the exported `Timeline
  Viewer.html` became genuinely interactive (embeds the same scene/region JSON as the
  View tab + an inlined vanilla-JS runtime with zoom/pan/hover; opens offline from
  `file://`). Replaced the old static-PNG-with-tabs export.
- **PR #42** `feat/timeline-tooltips-times-and-gaps` — tooltips now include the exact
  **start → stop** time on every session bar, and **data-gap bands got hover tooltips**.
- **PR #43** `fix/dynamic-build-stamp` — the footer build date + version are now
  injected at build time (`git short sha` + build date) and update every deploy:
  footer reads `Version 1.0.0+<sha> · Build <date>`; plot subtitles gained
  `· build <sha> (<date>)`. Also renamed the gap tooltip wording
  **"No device activity" → "No device events"**.

These are live: verified the deployed bundle carries the merge-commit sha and the new
gap wording.

---

## 4. Architecture you need (the shared Scene model)

Rendering is a **resolution-independent scene model** so raster (PNG/canvas) and
vector (SVG) outputs can't drift. The same model now feeds the interactive surfaces.

- **`web/src/lib/plotScene.ts`**
  - `Scene = { width, height, primitives: Primitive[] }`; `Primitive` =
    `rect | text | line | poly`.
  - `SceneRegion = { x, y, w, h, title: string, lines: string[] }` — a hover hit-box
    in scene coords carrying the tooltip text.
  - `renderSceneToSvg(scene)` / `sceneToSvgBlob(scene)` (vector path).

- **`web/src/lib/plotGenerator.ts`** (the big one)
  - Layout constants (module-level): `CANVAS_WIDTH = 1800`, `ROW_HEIGHT = 28`,
    `MARGIN = { top:60, right:260, left:160, bottom:60 }`. `hoursToX(h)` / `plotWidth()`
    are computed from these. **These are hardcoded to the chrome layout** — that's why
    the waterfall should get its **own** geometry (see §5).
  - Helpers reusable by the waterfall: `nsToClock(fmt, ns)` → "HH:MM:SS",
    `formatSessionRange(fmt, startIso, startNs, stopIso, stopNs)` → the
    "start → stop" line, `formatDateLabel(iso)`, `dateSerial(iso)`,
    `getHoursFormatter(tz)`, `getDateFormatter(tz)`, `FONT_SMALL`,
    `CATEGORY_COLORS`, `SCREEN_REASON_COLORS`, `SCREEN_REASON_LABELS`.
  - `buildTimelineScene(participantId, rows, tz, options, version, dateStr,
    preAlgoEventNs?, regionsOut?)` — **app, WITH chrome**. The bar loop pushes a
    `SceneRegion` per bar when `regionsOut` is passed (title=package, lines=[category,
    "X min · type", time-range]).
  - `buildScreenScene(...)` — **screen, WITH chrome** (bars coloured by
    `screen_usage_end_reason`).
  - `computeDataGapRects(allEventNs, dateToY, nsToLocalHours, nsToIso, regionsOut?,
    nsToClock?)` — gap-band geometry **using the module-level chrome layout**
    (`hoursToX`, `plotWidth`, `MARGIN`, `ROW_HEIGHT`). Emits gap `SceneRegion`s
    (title "Data gap", lines ["No device events · <dur>", range]) when `regionsOut` +
    `nsToClock` passed. Gap regions are appended to `regionsOut` AFTER the bar regions
    so a bar wins the hover hit-test on overlap. **Unit-tested** — don't change its
    geometry; it serves the PNG/SVG plots. (This coupling is the reason to write a
    separate waterfall builder rather than parameterize it.)
  - `buildAppTimelineViews(...)` / `buildScreenTimelineViews(...)` → return
    `ParticipantTimelineView[]` = `{ participantId, scene, regions }`. **These are the
    functions that feed the interactive surfaces** — currently they call the *chrome*
    builders. **This is the main switch point: point them at the new waterfall builder.**
  - PNG/SVG image exports (`generateAllPlots`, `generateAllScreenPlots`,
    `generateAllPlotSvgs`, `generateAllScreenPlotSvgs`, `generateAllHeatmaps`,
    `generateAllHeatmapSvgs`) call the **chrome** builders + `sceneToPngBlob` /
    `sceneToSvgBlob`. **Leave these untouched** — reports want title/legend/axis.

- **`web/src/components/TimelineViewPanel.tsx`** — the **View** tab.
  - `InteractiveScene` = a canvas with **wheel-zoom (about cursor), drag-pan, hover
    hit-test → tooltip**, auto-fit-to-width until touched, DPR-aware. Local
    `renderScene(ctx, scene)` mirrors the export renderers. Fit/Zoom buttons + a
    "Scroll to zoom · drag to pan · hover" hint. **This is the "zoom and pan thing" to
    replace** with fit-to-width + vertical scroll.
  - File dropdown (`timeline-view-file`), App/Screen dropdown (`timeline-view-type`),
    empty state (`timeline-view-empty`), one `InteractiveScene` per participant.

- **`web/src/lib/timelineViewer.ts`** — `buildTimelineViewerHtml({ fileName, timezone,
  app, screen })` builds a self-contained HTML string: embeds `{app, screen}` scene +
  region JSON in `<script type="application/json" id="tv-data">` (with `<` escaped to
  `\u003c`), and inlines the runtime via `import runtimeJs from
  "@/lib/timelineViewerRuntime.js?raw"`. App/Screen tabs, per-participant `<figure>`
  scaffolding (`.tv-scene[data-tv-type][data-tv-index]`, `.tv-canvas`, `.tv-tooltip`).

- **`web/src/lib/timelineViewerRuntime.js`** — the vanilla-JS **twin** of
  `InteractiveScene`, inlined verbatim into the exported HTML (classic-script IIFE, runs
  from `file://`). Per-canvas closure state; `renderScene`, wheel-zoom, drag-pan, hover,
  lazy-sizing of canvases in hidden tab panels. **Apply the same waterfall change here**
  so the export matches the View tab. Kept as a real `.js` file so `node --check` works
  and the e2e can execute it.

- **`web/src/lib/browserPipeline.ts`** (≈ line 2628, `if (options.enableInteractiveTimeline)`):
  computes `appViews`/`screenViews` **once** via `buildAppTimelineViews` /
  `buildScreenTimelineViews`, then feeds BOTH `timelineView` (the View-tab payload on
  `ProcessedFileResult`) AND `buildTimelineViewerHtml(...)` (the HTML output). So the
  two interactive surfaces share identical data — **changing the builder updates both.**
  Runs in the **worker**; the scene/region objects are plain JSON shipped to the main
  thread. (The on-demand PNG generation that used to feed the old HTML was removed in
  #41; `appPlotBlobs`/`screenPlotBlobs` are block-local `const` in the `enablePlotting`
  blocks.)

- **`web/src/lib/types.ts`** — `TimelineParticipantView = { participantId, scene,
  regions }`, `TimelineViewData = { timezone, app[], screen[] }`, `timelineView?` on
  `ProcessedFileResult`.

### Data flow (one line)
worker `processRawCsvContent` → `buildAppTimelineViews`/`buildScreenTimelineViews`
→ `timelineView` (to View tab) **and** `buildTimelineViewerHtml` (to HTML download).

---

## 5. Recommended implementation plan

Goal: a **decoupled, self-contained** waterfall builder so the stable PNG/SVG chrome
path and its tested `computeDataGapRects` geometry are untouched.

1. **New `buildWaterfallScene` in `plotGenerator.ts`** (bare layout). Suggested shape:
   ```ts
   const WF = { width: 1440, gutter: 104, padRight: 18, padTop: 6, padBottom: 10, rowH: 26 };
   const wfHoursToX = (h: number) => WF.gutter + (h / 24) * (WF.width - WF.gutter - WF.padRight);
   export type WaterfallSession = { startNs: bigint; stopNs: bigint; color: string; title: string; detail: string[] };
   export function buildWaterfallScene(
     sessions: WaterfallSession[], allEventNs: bigint[], timezone: string, regionsOut?: SceneRegion[],
   ): Scene
   ```
   - Days = union of each session's start..stop ISO days (mirror chrome behaviour:
     days come from sessions, gaps drawn only on existing day rows).
   - `height = WF.padTop + nDays*WF.rowH + WF.padBottom`; `dateToY` per day.
   - Primitives: white background; date label per row (anchor "end" at `gutter-10`,
     `FONT_SMALL`); **inline** gap-band rects (faint grey, `alpha 0.35`) using
     `wfHoursToX` + `dateToY` + `WF.rowH` (re-derive the >1h gap loop; ~25 lines — do
     NOT reuse `computeDataGapRects`, it's chrome-geometry-bound); coloured session
     bars (height `0.7*rowH`, centred). Push bar `SceneRegion`s during the bar loop
     (lines = `[...session.detail, formatSessionRange(hoursFmt, startIso, startNs,
     stopIso, stopNs)]`); push gap regions into a local array and append AFTER bars.
   - **No** title/subtitle/legend/axis/separators.
   - Base width is fixed (1440) — fit-to-width on the client scales uniformly, so a
     fixed base looks identical at any container width.
   - Empty `sessions` → `{ width:1, height:1, primitives:[] }` (match existing builders).

2. **Point the interactive wrappers at it.** In `buildAppTimelineViews`, map each app
   `PlotRow` (where `interaction_type ∈ {App Usage, Filtered App Usage}` and start/stop
   non-null) → `WaterfallSession` (color from `CATEGORY_COLORS[broad_app_category ??
   "Unknown"]`, title=`app_package_name||"(app)"`, detail=`[category, "X min · type"]`)
   and call `buildWaterfallScene(sessions, allEventNs, tz, regions)`. Same for
   `buildScreenTimelineViews` (color from `SCREEN_REASON_COLORS`, title "Screen",
   detail=`[SCREEN_REASON_LABELS[reason]??reason, "X min"]`). `allEventNs` =
   `preAlgoTsByParticipant?.get(pid) ?? pRows.map(r => r.event_timestamp_ns)`.

3. **View tab — replace `InteractiveScene`** with a fit-to-width, vertical-scroll
   renderer:
   - `scale = boxW / scene.width`; canvas CSS width = `boxW`, CSS height =
     `scene.height * scale`; backing store ×DPR; `ctx.setTransform(dpr*scale,0,0,
     dpr*scale,0,0)`; `renderScene`. **No tx/ty pan, no wheel zoom.**
   - The canvas is full height; the panel/page scrolls vertically (native). Keep a
     responsive `ResizeObserver` on width.
   - Hover: `sceneX = localX / scale`, `sceneY = localY / scale`; hit-test regions;
     position tooltip. (No pan term.)
   - Remove Fit/Zoom buttons and the zoom/pan hint; update hint to e.g. "Hover a bar
     for details · scroll for more days".

4. **HTML runtime — mirror the change** in `timelineViewerRuntime.js`: fit-to-width,
   tall canvas inside a scrollable wrapper, hover only, drop wheel/drag/zoom-buttons
   and the `activate()` zoom state. Keep per-canvas closure + lazy-sizing on tab show.
   (`timelineViewer.ts` scaffolding can stay; maybe drop the `data-tv-act` buttons +
   the "scroll to zoom" hint text.)

5. **Tests to update**
   - `web/src/lib/sceneBuilders.test.ts` — the current tests target `buildTimelineScene`/
     `buildScreenScene` (chrome) and still pass (those are unchanged). **Add** a
     `buildWaterfallScene` test: bars carry title + time-range line; gap region present;
     bar precedes gap in `regions`. (The chrome builders are still exercised by the
     PNG/SVG paths, so keep their tests.)
   - `web/src/lib/browserPipeline.test.ts` — the timelineView test asserts
     `region.title === "com.example.chat"` and `regions.length > 0`; ensure the
     waterfall builder still yields a bar region with that title (it should). The HTML
     viewer test asserts interactive content (`id="tv-data"`, `class="tv-canvas"`,
     `"participantId":"P01"`, `"primitives"`, `addEventListener`) — keep those true.
  - `web/e2e/app.spec.ts` — the `@smoke` "exported HTML … interactivity offline" test
    currently hovers a bar and expects the tooltip + `→`; update its hover-coordinate
    math (transform is now fit-to-width: `sceneX*scale`, no pan) and **drop any
    zoom/pan assumptions**. The current "View tab …" test only checks that the panel,
    dropdowns, and canvas appear, so add matching View-tab hover coverage plus a
    vertical-scroll sanity check if useful. Keep "no script errors on load" + tooltip
    + tab toggle.

---

## 6. Validation gates (run from `web/`)

```
cd web
npm run typecheck                      # 3 tsc projects (root + tsconfig.node.json + tsconfig.mjs.json)
rtk proxy npx vitest run               # 167 unit tests currently
npm run build                          # also proves Vite ?raw inline + build-stamp define
rtk proxy npx playwright test          # e2e (Chromium); -g "<name>" to filter
```
Full local gate (from repo root): `make all` (= ci + web + parity + e2e smoke +
deploy-artifact). The **deploy workflow runs NO tests remotely** — `make all` locally is
the gate. The waterfall's e2e should be `@smoke`-tagged so it runs in the `e2e` phase.

Definition of done: typecheck + vitest + build + the timeline e2e green; a fresh
independent code review finds nothing serious.

---

## 7. Deploy flow

`main` is protected (0 required approvals, `enforce_admins`, linear history) → **must**
go through a PR + **squash-merge** (no direct push).

```
git checkout -b <feature-branch>          # NEVER commit on main; branch first
# ... edits + validation ...
git add <paths> && git commit             # NO Co-Authored-By, NO --author (see §8)
git push -u origin <feature-branch>
gh pr create --base main --head <branch> --title "..." --body "...🤖 Generated with [Claude Code]..."
gh pr merge <#> --squash --delete-branch
# merge to main triggers .github/workflows/web-pwa-deploy.yml (runs `npm run build` +
# prepare:github-pages → GitHub Pages). Watch it:
gh run watch <run-id> --exit-status
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://uzaira0.github.io/chronicle-android-raw-data-preprocessing-app/
```
After deploy: **hard-refresh** (the PWA service worker serves the old bundle for one
load). The footer build stamp shows the **merge-commit's** sha + deploy date — use that
to confirm the deploy landed.

---

## 8. Constraints & gotchas (from CLAUDE.md + this session)

- **Commits:** NO `Co-Authored-By`, NO `--author`, NO `GIT_AUTHOR_*`/`GIT_COMMITTER_*`,
  NO `git config user.*`. Use the user's identity as-is. **PR bodies** DO end with the
  `🤖 Generated with [Claude Code]` line; commit messages do NOT.
- **Never** run `git stash` (any subcommand). **Never** quote durations or call work
  hard/big/significant. Branch before committing if on `main`.
- **cwd resets to repo root** after a `cd /home/opt/... && ...` command (shell state
  doesn't persist) — always `cd web` (or use repo-relative paths) for npm/playwright, or
  the run fails with `package.json not found` / "No tests found".
- Prefer `rg` for repo search. It works in this checkout and is much faster than
  `grep`; if a future environment rewrites or breaks it, fall back to `grep -rn`.
- **`?raw` inline:** `vite/client` types `*?raw`; `tsconfig.node.json` was extended to
  include `src/vite-env.d.ts` so the build-stamp ambient (`__BUILD_SHA__`/`__BUILD_DATE__`)
  resolves for the scripts' import chain. Build-stamp injection lives in `vite.config.ts`
  (`define`) → `src/lib/buildInfo.ts` (`BUILD_SHA`/`BUILD_DATE`/`BUILD_LABEL`).
- **Canvas height limit (~32k px):** a very tall waterfall (years of days × rowH) could
  exceed browser canvas limits → blank/clipped. For typical study spans (weeks–months)
  it's fine. If large spans are expected, consider DOM-windowing the rows or chunking the
  canvas — note it, don't gold-plate now.
- **Web-first:** new options default to a no-op on the single-participant parity fixture
  so the cross-surface parity gate stays green untouched. The interactive timeline is
  opt-in (`enableInteractiveTimeline`) and not in the parity fixture.

---

## 9. Suggested first step

Build `buildWaterfallScene` + repoint the two `build*TimelineViews` wrappers, add the
unit test, and eyeball the View tab locally (`cd web && npm run dev`) before touching the
HTML runtime and e2e. Get one surface right, then mirror to the other.
