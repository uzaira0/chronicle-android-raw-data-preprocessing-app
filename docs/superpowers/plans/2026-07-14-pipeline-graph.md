# Pipeline Graph + Feature Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a declared typed dependency graph the execution spine of the browser pipeline and wire in the research-pipeline-only features (screen-gated usage credit, study window, person attribution, compliance, day coverage) client-side.

**Architecture:** A pure graph engine (`pipelineGraph/`) with dirty-propagation + content-hash memoization executes node functions that wrap the existing stage functions of `browserPipeline.ts`; new Clean/Analyze nodes port the Python semantics from `docs/pipeline-graph/03-port-semantics.md`. A React Flow + dagre Graph tab renders the same declared graph with taxonomy-free path-query highlights. All new options/support files flow through the LinkML contract.

**Tech Stack:** TypeScript (strict), React 19, Vite 7, vitest, comlink worker, papaparse; new deps `@xyflow/react` ^12, `@dagrejs/dagre` ^3 (both MIT).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-pipeline-graph-design.md`; KB: `docs/pipeline-graph/` (esp. 03, 06, 08, 11, 12).
- Node ids/labels use the community vocabulary of doc 08 (`parse_events`, `device_state_timeline`, `effective_usage`, …). No internal decision-record numbers or engine jargon in ANY user-facing string.
- Derived layer: NO taxonomy names anywhere (no mediates/confounds/dominators). Only `affectedBy`/`builtFrom`/`sharedUpstream`/`mustPassThrough`/`joinPoints` + plain-English sentences.
- New number-changing steps are OPTIONAL and SIDE-BY-SIDE: credited output is a separate CSV; the headline app-usage output is never mutated in place.
- Existing outputs must stay byte-identical when all new options are off — `npm run test` (vitest) must stay green at every commit; `npm run typecheck` and `npm run check:contract` must pass before any push.
- All timestamps stay `bigint` nanoseconds end-to-end (no ms rounding in new code).
- Every new option/support file is declared in `web/schema/chronicle-local-contract.linkml.yaml` then `npm run generate:contract` — never hand-edit `generatedContract.ts`.
- Fail loud: coverage-invariant violations, unmatched shared devices, unmapped interaction labels are hard errors with actionable messages — never silent empties.
- Commits: conventional prefixes, one task per commit, no Co-Authored-By lines.

---

### Task 1: Graph types + engine (topo sort, dirty-propagation, memoization)

**Files:**
- Create: `web/src/lib/pipelineGraph/graphTypes.ts`
- Create: `web/src/lib/pipelineGraph/engine.ts`
- Test: `web/src/lib/pipelineGraph/engine.test.ts`

**Interfaces (Produces):**

```ts
// graphTypes.ts
export type Section = "preprocess" | "clean" | "analyze" | "output";
export type EdgeType = "feeds" | "gates" | "tunes";
export interface KnobBinding { optionKey: string; edge: "gates" | "tunes" }
export interface NodeDef<Ctx> {
  id: string;                       // doc-08 community name
  label: string;                    // UI label
  section: Section;
  inputs: string[];                 // upstream node ids ("feeds" edges)
  knobs: KnobBinding[];             // option bindings
  supportFiles?: string[];          // BrowserSupportFiles keys this node reads
  run: (ctx: Ctx, inputs: Record<string, unknown>) => Promise<unknown> | unknown;
}
export interface GraphDef<Ctx> { nodes: NodeDef<Ctx>[] }
export type NodeStatus = "cached" | "recomputed" | "dirty" | "error" | "skipped";
export interface RunReport { statuses: Record<string, NodeStatus>; errors: Record<string, string> }

// engine.ts
export function topoSort(def: GraphDef<unknown>): string[];            // throws on cycle/unknown input
export function hashValue(value: unknown): string;                     // stable FNV-1a over JSON w/ bigint support
export class GraphEngine<Ctx> {
  constructor(def: GraphDef<Ctx>);
  run(ctx: Ctx, keys: { options: Record<string, unknown>; supportFileHashes: Record<string, string>; inputHash: string }): Promise<{ outputs: Map<string, unknown>; report: RunReport }>;
  invalidateAll(): void;
}
```

Cache key per node = `hashValue([inputHash-or-upstream-output-hashes, bound option values, support-file hashes])`. Node errors are caught, recorded in `report.errors[nodeId]`, and every downstream node becomes `skipped` (fail loud per node, run continues for independent branches).

- [ ] Write failing tests: topo order respects `inputs`; cycle throws; unchanged keys ⇒ all `cached` on second run; changing one bound option dirties exactly the bound node + downstream cone; upstream error ⇒ downstream `skipped` with error preserved; bigint values hash without throwing.
- [ ] Implement `graphTypes.ts` + `engine.ts` (FNV-1a string hash; JSON.stringify replacer for bigint/Map/Set; per-node output-hash memo so downstream cache keys use upstream OUTPUT hashes, not re-hash of large arrays — store hash alongside cached value).
- [ ] `npx vitest run src/lib/pipelineGraph/engine.test.ts` → PASS; `npm run typecheck`.
- [ ] Commit: `feat(graph): pure graph engine — topo sort, dirty propagation, content-hash memoization`

### Task 2: Path queries (analysis.ts)

**Files:**
- Create: `web/src/lib/pipelineGraph/analysis.ts`
- Test: `web/src/lib/pipelineGraph/analysis.test.ts`

**Interfaces (Produces):**

```ts
export function affectedBy(def: GraphDef<unknown>, source: string): string[];        // downstream cone (node id OR optionKey)
export function builtFrom(def: GraphDef<unknown>, nodeId: string): string[];          // upstream cone incl. option keys
export function sharedUpstream(def: GraphDef<unknown>, a: string, b: string): string[];
export function mustPassThrough(def: GraphDef<unknown>, source: string, target: string): string[]; // on EVERY path
export function joinPoints(def: GraphDef<unknown>): string[];                          // ≥2 disjoint upstream paths merge
export function sentenceFor(query: "affectedBy"|"sharedUpstream"|"mustPassThrough"|"joinPoint", args: Record<string, string | number>): string; // plain-English, no jargon
```

- [ ] Failing tests on a fixture diamond graph (a→b→d, a→c→d, knob k tunes b): `affectedBy("k") = [b,d]`; `sharedUpstream(b,c) = [a]`; `mustPassThrough(a,d) = []` and `mustPassThrough(k,d) = [b]`; `joinPoints() = [d]`; sentences contain no taxonomy words.
- [ ] Implement (BFS/DFS set ops; mustPassThrough = nodes whose removal disconnects source from target, computed by path-enumeration on the small static graph).
- [ ] Tests pass; commit: `feat(graph): derived path queries with plain-English sentences (no taxonomy)`

### Task 3: graphDef over the existing stages; engine becomes the spine

**Files:**
- Create: `web/src/lib/pipelineGraph/graphDef.ts`
- Modify: `web/src/lib/browserPipeline.ts` (processRawCsvContent body; stage fns get exported where not yet)
- Test: `web/src/lib/pipelineGraph/graphDef.test.ts` + existing `browserPipeline.test.ts` must stay green

**Interfaces:**
- Consumes: Task 1 engine, existing stage functions (`parseRawRows`, `applyTimezoneHandling`, `dedupeExactRows`, `unalignDuplicateTimestamps`, `markDataTimeGaps`, `labelFilteredApps`, `deriveScreenUsageSessions`, `runAppUsageAlgorithm`, `enrichWithCodebookData`, …).
- Produces: `buildChronicleGraph(): GraphDef<PipelineCtx>` with nodes `parse_events, normalize_timezones, dedup_and_order, app_policy, device_state_timeline, reconstruct_episodes, categorize_apps, interval_quality, effective_usage (stub id present, gated off), observation_window, attribute_person, score_compliance, day_coverage, outputs`; `PipelineCtx = { options, supportData, runtime, runMatcher, runSplitter, emit }`.

Node bodies wrap the existing calls 1:1 (doc 12 column A defines which options bind where). `processRawCsvContent` builds ctx, runs the engine, then assembles `ProcessedFileResult` from node outputs exactly as today (plots/exports read the same arrays). Support files are pre-loaded into `supportData` before the run (async fetch stays outside node bodies so nodes stay deterministic).

- [ ] graphDef test: every option key in `DEFAULT_BROWSER_OPTIONS` that is pipeline-semantic is bound to ≥1 node (assert against an explicit allowlist of runtime/presentation keys — `parallelProcessing`, `parallelMaxWorkers`, plot/export toggles); topoSort succeeds; section metadata matches doc 02 (preprocess/clean/analyze).
- [ ] Rewire `processRawCsvContent` through `GraphEngine.run`; keep `emit` progress mapping (node id → existing ProgressStepKind).
- [ ] Full suite: `npm run test` → green (byte-identical outputs); `npm run typecheck`.
- [ ] Commit: `refactor(pipeline): graph engine is now the execution spine (outputs unchanged)`

### Task 4: Contract — new options + support files

**Files:**
- Modify: `web/schema/chronicle-local-contract.linkml.yaml`
- Regenerate: `npm run generate:contract` (updates `web/src/lib/generatedContract.ts`, `web/openapi/chronicle-local-api.yaml`)
- Modify: `web/src/lib/optionDefaults.ts`, `web/src/lib/types.ts` (support-file plumbing), `web/src/workers/chronicle-worker.ts`
- Test: `web/src/lib/generatedContract.test.ts` extension

New slots (all default-off/neutral; snake_case in schema):
`enable_screen_gated_crediting` (bool, false) · `credited_session_cap_minutes` (int, 360) · `device_liveness_gap_tolerance_minutes` (int, 120) · `auto_lock_bridge_seconds` (int, 120) · `no_witness_min_day_apps` (int, 2) · `enable_study_window_filter` (bool, false) · `enable_person_attribution` (bool, false) · `enable_compliance_scoring` (bool, false) · `compliance_threshold_percent` (float, 70) · `enable_day_coverage` (bool, false).
New support-file slots on `BrowserSupportFiles`: `study_dates_file`, `device_sharing_file`, `survey_attribution_file`, `enrolled_devices_file`.

- [ ] Add slots with full titles/descriptions (user-facing copy: community vocabulary; e.g. title "Screen-gated usage credit", description explains screen-ON ∩ device-alive with truncation).
- [ ] `npm run generate:contract` && `npm run check:contract` → clean.
- [ ] Thread the four new support files through `BrowserSupportFiles` type, worker transfer, `FilesAndInputsCard` upload slots (Task 8 does UI polish; here just the type/transfer path).
- [ ] Commit: `feat(contract): options + support files for credit/window/attribution/compliance/coverage`

### Task 5: `effective_usage` — screen-gated usage credit port (parity-tested)

**Files:**
- Create: `web/src/lib/stages/effectiveUsage.ts`
- Create: `web/src/lib/stages/effectiveUsage.test.ts`
- Create: `web/src/lib/stages/__fixtures__/screen_gated_credit/*.json` (golden, generated from Python)
- Create (monorepo, not committed here): fixture generator script run via the research-pipeline venv

**Interfaces (Produces):**

```ts
export interface CreditOptions { capMinutes: number; livenessToleranceMinutes: number; autoLockBridgeSeconds: number; noWitnessMinDayApps: number }
export interface CreditResult { creditedRows: CanonicalRow[]; report: { sessions: number; credited: number; truncated: number; fullyDead: number; noWitnessFallbacks: number; screenIncapableParticipants: string[] } }
export function applyScreenGatedCredit(
  appRows: CanonicalRow[],          // engine output sessions (App Usage rows)
  rawEvents: CanonicalRow[],        // canonicalized pre-engine events (all types)
  timezone: string,
  opts: CreditOptions,
): CreditResult;
```

Algorithm = doc 03 §1 verbatim: per session [s, e=min(e_raw, s+CAP)]: screen-state changepoints (ON_WITNESS = Screen Interactive, User Interaction, Shortcut Invocation, Keyguard Hidden, User Unlocked, Chooser Action; OFF_WITNESS = Screen Non-Interactive, Device Shutdown; heartbeats don't move state); ON intervals bridged across OFF < autoLock; alive chains under liveness tol broken by Device Startup in-gap (10 s epsilon), bracketing events outside window count; credit = ON ∩ alive; no-witness fallback iff participant-day distinct apps ≥ min; screen-incapable participants (never both an ON and an OFF witness) get full-window credit; only sessions with duration > 0 are credited; recompute calendar columns (date/day/weekday variants/hour) from each credited interval's LOCAL start via the same helpers `browserPipeline.ts` uses; a fully-dead session emits no rows.

- [ ] Generate golden fixtures: synthetic raw CSV (5 participants covering: cross-midnight session, boot-in-gap, autolock blip, no-witness day with 1 vs 3 apps, screen-incapable device, >6 h truncate) → run the Python `apply_s14_credit` via the research-pipeline venv → dump input/expected JSON (no real data; synthetic only) into `__fixtures__/screen_gated_credit/`.
- [ ] Failing vitest: fixture parity (row-level: start/stop/duration/date/hour per credited row) + unit tests per edge case listed above.
- [ ] Implement `effectiveUsage.ts` (pure; bigint ns arithmetic; no Date except for calendar recompute via existing tz helpers).
- [ ] Parity + unit tests pass. Commit: `feat(clean): screen-gated usage credit (effective_usage) with Python-parity fixtures`

### Task 6: Analyze nodes — observation window, attribution, compliance, day coverage

**Files:**
- Create: `web/src/lib/stages/observationWindow.ts` + `.test.ts`
- Create: `web/src/lib/stages/attributePerson.ts` + `.test.ts`
- Create: `web/src/lib/stages/scoreCompliance.ts` + `.test.ts`
- Create: `web/src/lib/stages/dayCoverage.ts` + `.test.ts`
- Create: `web/src/lib/stages/studySupportFiles.ts` + `.test.ts` (CSV parsers for the four support files)

**Interfaces (Produces):**

```ts
// studySupportFiles.ts — tolerant header-mapped CSV parsers, hard error on missing required columns
export interface StudyWindow { participantId: string; startDate: string; endDate: string }        // ISO dates, inclusive
export interface SharingEntry { deviceParticipantId: string; users: string[]; targetUser: string } // target first-class
export interface SurveyAnswer { participantId: string; eventTimestampNs: bigint; username: string }
export interface EnrolledDevice { participantId: string; deviceCount: number }
export function parseStudyDates(csv: string): StudyWindow[];
export function parseDeviceSharing(csv: string): SharingEntry[];
export function parseSurveyAttribution(csv: string): SurveyAnswer[];
export function parseEnrolledDevices(csv: string): EnrolledDevice[];

// observationWindow.ts
export function applyObservationWindow(rows: CanonicalRow[], windows: StudyWindow[], timezone: string):
  { rows: CanonicalRow[]; dropped: number; participantsWithoutWindow: string[] };   // local-calendar-date inclusion

// attributePerson.ts
export function attributePerson(rows: CanonicalRow[], sharing: SharingEntry[], survey: SurveyAnswer[]):
  { rows: CanonicalRow[]; report: { surveyRelabels: number; nonTargetRows: number; unmatchedSharedDevices: string[] } };
  // exact participant match, NO numerical-id-prefix fallback; unmatched shared device ⇒ hard error entry;
  // non-target usage relabeled interaction_type = "Non-Target Child App Usage"

// scoreCompliance.ts
export interface ComplianceDay { participantId: string; date: string; knownMinutes: number; unknownMinutes: number; compliancePercent: number; zeroRealUsage: boolean }
export function scoreCompliance(rows: CanonicalRow[], sharing: SharingEntry[], thresholdPercent: number):
  { days: ComplianceDay[]; validDays: number; invalidDays: number };  // non-shared device-days = 100; zero-usage kept at 100 but flagged

// dayCoverage.ts
export function buildDayCoverage(rows: CanonicalRow[], windows: StudyWindow[], rawEventDates: Map<string, Set<string>>, timezone: string):
  { placeholderRows: CanonicalRow[]; coverage: { participantId: string; date: string; status: "usage" | "no_activity" | "no_data" }[] };
  // No Activity = raw events that day but no usage; No Data = silent; throws CoverageInvariantError if any windowed day ends uncovered
```

- [ ] TDD each module in order (parsers → window → attribution → compliance → coverage); tests cover doc-03 §4-6 rules incl. the wrong-attribution bug class (numerical-id fallback must NOT happen), zero-usage-flagged-not-dropped, coverage hard error.
- [ ] Commit per module (5 commits, `feat(analyze): …`).

### Task 7: Wire new nodes into graphDef + outputs

**Files:**
- Modify: `web/src/lib/pipelineGraph/graphDef.ts` (bind Task 4 options/gates; feeds: `effective_usage` ← {reconstruct_episodes, raw events}; `observation_window` ← categorize_apps output; chain per spec §4)
- Modify: `web/src/lib/browserPipeline.ts` (new outputs: `" Credited App Usage.csv"` (kind "app"), `" Compliance Report.csv"`, `" Day Coverage.csv"` (kind "aggregate"); result fields for the reports)
- Test: extend `browserPipeline.test.ts` — all-off run byte-identical; credit-on run produces the side-by-side CSV without touching the headline CSV; window+coverage run emits placeholders and hard-errors on synthetic gap.

- [ ] Failing integration tests → implement → green. `npm run test && npm run typecheck && npm run check:contract`.
- [ ] Commit: `feat(pipeline): clean/analyze nodes wired — credited output side-by-side, compliance + coverage reports`

### Task 8: UI — sections, Study Inputs, settings cards

**Files:**
- Modify: `web/src/components/ProcessPanel.tsx` (Preprocess/Clean/Analyze section headers per doc 02 mapping)
- Create: `web/src/components/StudyInputsCard.tsx` (four new uploads, per-file status, "needs input" state)
- Create: `web/src/components/AnalyzeSettingsCard.tsx` (new toggles/knobs with tooltips in community vocabulary)
- Modify: `web/src/components/FilesAndInputsCard.tsx`, `web/src/App.tsx`, settings persistence
- Test: component tests where the repo has them; `npm run lint`; Playwright smoke extension in Task 10

- [ ] Implement; absent support file + enabled dependent option ⇒ inline "needs input" warning, node renders skipped (not an error).
- [ ] Commit: `feat(ui): Preprocess/Clean/Analyze sections + Study Inputs card + analyze settings`

### Task 9: Graph tab (React Flow + dagre)

**Files:**
- Modify: `web/package.json` (add `@xyflow/react`, `@dagrejs/dagre`)
- Create: `web/src/components/GraphPanel/GraphPanel.tsx`, `web/src/components/GraphPanel/graphLayout.ts`, `web/src/components/GraphPanel/SentenceBar.tsx`
- Modify: `web/src/components/WorkflowNav.tsx` + `web/src/App.tsx` (new "Graph" tab)
- Test: `web/src/components/GraphPanel/graphLayout.test.ts` (dagre layout produces positions for every node; section lanes ordered preprocess→clean→analyze→output)

Behavior: nodes colored by section, badges from last `RunReport` (cached/recomputed/dirty/error/skipped); click → `affectedBy` cone highlight + sentence; second click on another node → `sharedUpstream` pulse + sentence; hover with a selection → `mustPassThrough` emphasis; `joinPoints` badge. No taxonomy words in any copy.

- [ ] `npm install` the two deps; implement; layout test green; lint/typecheck green.
- [ ] Commit: `feat(ui): interactive Graph tab — dagre layout, status badges, path-query highlights`

### Task 10: E2E + docs + final gates

**Files:**
- Modify: `web/e2e/` add smoke: upload demo CSV → toggle credit on → run → credited CSV present in outputs, Graph tab renders, no console errors
- Modify: `docs/pipeline-graph/07-design-draft.md` (status: implemented ph. 1-2-4 subset), `web/README.md` if present

- [ ] `npm run test && npm run typecheck && npm run lint && npm run check:contract` all green; `npm run test:e2e:smoke` green.
- [ ] Commit: `test(e2e): graph tab + credited-output smoke; docs status update`

## Deferred (explicitly OUT of this implementation push, tracked in doc 07)

Factored-state `device_state_timeline` internals + `validate_clock` node (phase 3), lineage ledger, `eyes_triplet_v1` / `parry_toth_forward_pair_2025` strategies + conformance fixtures, ordered app-policy rule schema + `interval_quality` as separate node (current long-flag/min-duration knobs remain where they execute), multi-stream witnesses. Rationale: user priority = wire the missing features into the app; the graph spine + ports above deliver that with the ontology's names and section boundaries so the deferred pieces slot in without renames.

## Self-review notes

Spec coverage: §2 (Tasks 1-3), §3 (Task 2), §4 (Tasks 3/7), §6-8 partial-by-design (see Deferred), §9 (Tasks 8-9), §10 (Tasks 1-10 tests; conformance deferred with strategies), §11 (engine per-node errors, coverage invariant, needs-input), §12 (Task 9), §13 phases 1/2/4 in scope. Type names consistent across tasks (CreditResult/StudyWindow/SharingEntry used in Tasks 5-7). No placeholders.
