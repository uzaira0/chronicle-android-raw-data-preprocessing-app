# `delivery:B02` opener-set research and decision record

Status: frozen implementation decision; current product status is recorded in the campaign handoff

Date: 2026-08-11

Target baseline: private-preview commit `312ef636e3bd03d63bc5d8b2fd84b86fa5251cbc`

Delivery authority: [`delivery:B02`](delivery-axis-ledger.yaml)

Preflight: [opener-set grep-weights](b02-opener-set-grep-weights.md)

Proof obligations: [opener-set test-obligation matrix](b02-opener-set-proof-matrix.md)

This record closes the research-before-building gate for `delivery:B02`. It authorizes a fresh
implementation after the documented failure to recover the historical commits and WASM artifact.
It is not the current implementation-status authority, does not certify a published method, and
does not claim that the new code recreates the unavailable historical bytes.

## 1. Scope and local baseline

The frozen requirement is:

> Make the interaction/event set that can open usage credit an independent, persisted,
> Rust-reachable measurement axis with receipt evidence.

The baseline has five event-retention sets, seven reconstruction strategies, seven grouping
policies, and two interval-quality policies, but no `OpenerSetId`, `opener_set` browser option,
Rust enum, selector, cache identity, receipt binding, or multiverse dimension.

Current opener behavior is bundled into reconstruction:

- the fused matcher and Parry–Toth arm read the matcher's `resumed` flag;
- EYES builds app blocks from activity lifecycle events;
- the GESIS arm classifies a wider hard-coded start list;
- foreground/background, Draxler, and Morrison scan for `Activity Resumed` directly.

There is also a second hard-coded seam after matching: baseline duration classification turns only
an `Activity Resumed` start row into `App Usage`. A wider matcher start can receive bounds yet fail
to become a scientific app-usage row. B02 is incomplete unless selected non-resume starts are
materialized and classified deliberately.

Changing only `MatcherInput.resumed` would therefore create a selector that several strategies
silently ignore. The implementation must centralize opener eligibility or refuse an incompatible
crossing explicitly.

`delivery:B01` remains upstream. A row removed by event retention cannot open under B02, and every
receipt and multiverse arm must identify both settings.

## 2. Recalled possibilities and grep-weights

The pre-search hypothesis inventory, disambiguation, generic queries, exclusions, and
falsification questions are frozen in
[`b02-opener-set-grep-weights.md`](b02-opener-set-grep-weights.md). The search did not begin with
recalled author or project names. Named-source checks happened only after the generic discovery
pass identified Android lifecycle, screen-state, keyguard, reboot, and app-attribution as the
decisive categories.

## 3. Discovery scope and exclusions

The generic discovery pass covered:

1. Android platform event semantics and deprecated aliases;
2. app-episode reconstruction algorithms and reference implementations;
3. screen/unlock device-session construction;
4. start/stop repair and missing-event handling;
5. public or synthetic evidence for package attribution;
6. reproducibility and sensitivity-analysis uses of alternative opener predicates.

Excluded from candidate status:

- a remembered label without a primary or pinned implementation;
- a device-state row with no explicit app-attribution rule;
- an observational alias that Chronicle normalizes to an existing value;
- an arbitrary event list or independent Boolean per event;
- a value that only one runtime path reads silently;
- the unavailable historical `f581581` / `90ae834` work or its absent WASM artifact.

Search stopped when primary Android semantics, author code for the narrow app opener, and pinned
GESIS code converged, and no additional independent package-attributed app opener survived the
generic discovery pass.

The exact generic query set, copied here as well as preserved in the preflight, was:

1. `raw Android usage-event algorithm which event types start application-use intervals`
2. `Android event-log reconstruction app episode start predicate reference implementation`
3. `smartphone passive sensing screen-on unlock app attribution algorithm`
4. `usage-event start stop repair package identity screen keyguard events`
5. `foreground transition deprecated alias resumed event type Android semantics`
6. `app-use interval reconstruction opener closer unmatched event conformance fixture`
7. `device-use session start screen interactive keyguard hidden difference`
8. `Android usage events reboot startup session boundary application interval`
9. `reproducible smartphone log preprocessing event-type inclusion start set`
10. `cross-method passive sensing preprocessing opener-set sensitivity analysis`
11. `public synthetic Android UsageEvents dataset screen keyguard package columns`
12. `reference code Android app usage session reconstruction eventType start list`

Discovery-category disposition was explicit: standards/specifications, papers/reference
algorithms, open-source implementations, fixtures/data, platform/API, adjacent process-mining
work, registries, maintainer evidence, and history/deprecation were searched or evaluated;
hardware/runtime was `N/A` to source semantics and reserved for the later WASM proof. Package
registries were also `N/A`; publication/repository identifiers were used instead. The linked
preflight preserves the proper-noun exclusion list and the per-category rationale verbatim.

## 4. New discoveries

### Android foreground names are one observable event

Pinned AOSP source defines `MOVE_TO_FOREGROUND = 1` and
`ACTIVITY_RESUMED = MOVE_TO_FOREGROUND`. The event carries package and class identity and
corresponds to activity `onResume()`. Chronicle also normalizes both `Move to Foreground` and raw
type 1 to `Activity Resumed`. A legacy-name arm would therefore be a duplicate label, not an
independent measurement choice.

### Screen, keyguard, and startup rows do not identify an app

AOSP assigns device-level events the pseudo-package `android`. Screen-interactive, keyguard-hidden,
and device-startup describe device state, unlock, and runtime startup. Startup also marks a reboot
discontinuity across which unmatched open events have unknown closing times. None supplies a
defensible application identity.

Parry and Toth's author code confirms the unit distinction: it retains types
`{1,15,16,17,18,26,27}`, but splits device/session events `{15,16,17,18,26,27}` from app episodes;
app episodes use type 1 and exclude package `android`. Their seven-event retention set is not a
seven-event app-opener set.

### The GESIS nine-member list requires an attribution predicate

Pinned GESIS tutorial code classifies starts as `{1,4,11,14,15,18,19,22,27}`, stops as
`{2,3,10,13,16,17,20,23,24,25,26}`, and the remaining listed types as meta/configuration. Its app
branch then excludes localized Android-System app names and joins by the same app name. A separate
screen branch selects the Android-System rows.

Consequently, the nine-member list alone is not an app-opener method. Its defensible Chronicle
adapter begins with the exact numeric membership, maps it to canonical labels, and intersects it
with app-scoped event semantics. Device-scoped types 15, 18, and 27 remain in the source classifier
but can never open app credit, even if malformed input assigns them another package. The effective
B02 set is therefore `{1,4,11,14,19,22}`; its genuinely wider part beyond resumed-only is types 4,
11, 14, 19, and 22. Package exclusion is not part of B02: each reconstruction's existing package
guard and the later `delivery:B10` package-policy axis remain authoritative. The source-aligned
GESIS binding composes this B02 set with the GESIS strategy's existing `android` guard.

The baseline already normalizes all nine numeric types to canonical labels, despite a stale GESIS
comment saying several are never exported. The explicit B02 arm must use the canonical vocabulary,
not preserve that comment as a false input limitation.

The baseline GESIS path is source-partial in two independent ways: its matcher list omits types 4,
11, 14, 19, and 22, and its downstream classifier recognizes only `Activity Resumed` as an
app-usage start. `strategy_defined` must preserve those legacy bytes; the explicit GESIS-derived
arm is a controlled activation/materialization adapter and must not be presented as certification
of the complete tutorial method or its still-partial closer vocabulary.

The pinned public tutorial sample supplies a non-vacuous witness. In `red_data.rds`, type 14 has
22 non-`android` rows and type 19 has 3,862; types 15, 18, and 27 have zero non-`android` rows and
3,288, 1,629, and 8 `android` rows respectively. These counts are discovery evidence, not an
empirical Chronicle result, but they prove that the wider guarded arm is observable without
assigning device events to an app.

## 5. Verified candidate matrix

`N/A` means the attribute does not apply to an invented or duplicate candidate; it never means
that an unread source was silently treated as absent.

| Candidate | Origin/version | License | Maintenance | Exact semantics / observability | Decision | Confidence | Open question |
|---|---|---|---|---|---|---|---|
| `strategy_defined` | Chronicle private-preview `312ef636` (2026-08-10) | GPL-3.0 | Active campaign baseline | Preserve the selected strategy's exact baseline opener and materializer behavior; observable | Adopt as compatibility default | High | Can every legacy strategy golden remain byte-exact after plumbing? |
| `activity_resumed_only` | AOSP `1cdfff5`; Parry–Toth `rcode.R` revision 2, SHA-256 `99787f1c01499dfe335283eff4bc067a4da0246475cc3238ffe80fc5cfff792f` | Apache-2.0; OSF code license undeclared | AOSP active; OSF revision pinned 2025-02-25 | Canonical Android type 1, including Chronicle's filtered equivalent; package policy inherited from the strategy/B10; observable | Adopt as portable explicit arm | High | How often does the explicit arm differ only in receipt rather than output? |
| `gesis_app_scoped_starts` | GESIS tutorial commit `0561e0c`; public `red_data.rds` at same commit | MIT | Pinned repository active 2026-05 | Source starts `{1,4,11,14,15,18,19,22,27}` intersected with app-scoped event types; effective `{1,4,11,14,19,22}`; package policy inherited; observable types 14/19 in public sample | Adopt as named GESIS-derived adapter | High for membership; medium for cross-strategy behavior | How many non-resume starts survive each strategy's closer rule? |
| `move_to_foreground_only` | AOSP `1cdfff5` + Chronicle normalizer | Apache-2.0 / GPL-3.0 | Active | Deprecated name for numeric type 1; not distinct after ingest | Reject as degenerate alias | High | N/A |
| Parry–Toth seven as openers | `rcode.R` revision 2, pinned hash above | License undeclared | Pinned 2025-02-25 | Retention `{1,15,16,17,18,26,27}` splits device/session rows from type-1 app episodes | Reject; mixed units, not an opener set | High | N/A |
| Screen-only | AOSP `1cdfff5` | Apache-2.0 | Active | Type 15, device-scoped; observable but no app opener semantics | Refuse for app credit | High | N/A until a separate attribution signal exists |
| Unlock-only | AOSP `1cdfff5` | Apache-2.0 | Active | Type 18, device-scoped; observable but no app opener semantics | Refuse for app credit | High | N/A until a separate attribution signal exists |
| Startup-only | AOSP `1cdfff5` | Apache-2.0 | Active | Type 27, device-scoped reboot boundary | Refuse for app credit | High | N/A until a separate attribution signal exists |
| Arbitrary list | Project invention | N/A | N/A | Unbounded strings and provenance | Reject | High | N/A |
| Boolean per type | Project invention | N/A | N/A | Unbounded factorial controls | Reject | High | N/A |
| No openers | Project diagnostic | GPL-3.0 if implemented | N/A | Empty set, observable only as all-zero/failed app reconstruction | Do not ship; keep as internal assertions | High | N/A |

## 6. What to adopt

Add exactly three canonical values:

1. `strategy_defined` — required default. It delegates opener eligibility to the current
   reconstruction implementation and preserves every existing strategy's behavior, including the
   baseline GESIS match/materialization limitations just described.
2. `activity_resumed_only` — canonical type 1 after normalization, including
   `Filtered App Resumed` where it has not yet been unmasked. Existing strategy/package-policy
   guards remain unchanged.
3. `gesis_app_scoped_starts` — exact GESIS start membership
   `{1,4,11,14,15,18,19,22,27}`, represented by Chronicle canonical labels, intersected with
   app-scoped Android event semantics. Its effective B02 set is `{1,4,11,14,19,22}`; package
   handling stays with the selected strategy and `delivery:B10`.

Unknown persisted values must widen to `strategy_defined`; they must never silently narrow the
stream. Direct Rust JSON uses the same safe default for backward compatibility. The selected
canonical value must remain visible in configuration, parameter bindings, runtime receipts,
manifest, and export even when it is equivalent to a strategy's native rule.

For every run, receipt evidence must include requested and effective opener IDs, the
baseline/source/derivative/refusal relation, suppressed device-opener count, and materialized
opener-type counts. Row lineage must continue to point to the original start row after its display
classification becomes `App Usage`.

## 7. What to compose

Compose the new axis with existing mechanisms rather than duplicating them:

- B01 performs row retention; B02 only marks retained rows as opener-eligible.
- Reconstruction owns pairing, closer selection, repair, timeout, and unmatched-open behavior.
- AOSP event scope and the existing package pseudo-system guard jointly supply the attribution
  boundary; neither may be weakened to infer an app from a device event.
- Generated LinkML vocabulary supplies TypeScript selectors and validation domains.
- The existing settings, preset, import/export, project, and share pipelines carry the generated
  field after explicit enum sanitization.
- Existing Salsa query identities, reconstruction-base persistence, workflow bindings, and
  options digests must incorporate the selected value.
- Existing provenance and export machinery must carry one canonical B02 parameter binding.

B02 must never be implemented by deleting non-opener rows: those rows may still close, bound,
explain, or censor an episode.

## 8. What to adapt

`gesis_app_scoped_starts` is an adapter, not a verbatim source method. The source's top-level start
classifier mixes app- and device-scoped types, then its app branch filters localized Android-System
names. Chronicle factors those decisions: B02 admits only app-scoped members, while the selected
strategy and `delivery:B10` own package handling. Receipts must identify this adaptation and its
exact scope boundary.

Crossing the GESIS opener set with a non-GESIS reconstruction retains the other strategy's closer
and pairing rules. That is a controlled component perturbation, not a newly faithful version of
Parry–Toth, EYES, foreground/background, Draxler, or Morrison.

Use this compatibility vocabulary:

- `baseline_native`: the default preserves the current implementation, without certifying it;
- `baseline_equivalent`: an explicit arm is behaviorally equal to the baseline opener component;
- `source_equivalent`: the selected explicit set is behaviorally the same as its native rule;
- `source_aligned_adapter`: source membership is preserved through a declared input adapter;
- `controlled_derivative`: executable one-component perturbation with the published-method claim
  withdrawn;
- `refused`: the strategy cannot vary only the opener predicate without changing a larger
  structural algorithm.

| Reconstruction strategy | `strategy_defined` | `activity_resumed_only` | `gesis_app_scoped_starts` |
|---|---|---|---|
| Fused matcher | `baseline_native` | `baseline_equivalent` | `controlled_derivative` |
| Parry–Toth forward pairing | `baseline_native` | `source_equivalent` at B02 | `controlled_derivative` |
| EYES complement | `baseline_native` | `source_equivalent` at B02 | `refused` |
| GESIS start/stop repair | `baseline_native` (source-partial vocabulary) | `controlled_derivative` | `source_aligned_adapter` at B02 |
| Foreground/background pairing | `baseline_native` | `source_equivalent` at B02 | `controlled_derivative` |
| Draxler interruption-aware | `baseline_native` | `source_equivalent` at B02 | `controlled_derivative` |
| Morrison lock-tolerant | `baseline_native` | `source_equivalent` at B02 | `controlled_derivative` |

EYES refuses the wider set because its app blocks are structurally built from resume/pause/stop
events. Recasting service, standby, slice, or device events would change more than B02. Refusal must
be typed and receipted before expensive reconstruction; it may not fall back silently.

## 9. What genuinely must be built

The smallest complete implementation surface is:

1. `OpenerSetId` in the research ontology and `opener_set` in the local LinkML contract;
2. generated TypeScript/OpenAPI/contract/METHODS artifacts;
3. generated-value UI selector, search routing, reset and modified state;
4. strict browser persistence validation and old-envelope defaulting;
5. browser-to-Rust snake-case projection;
6. Rust enum, canonical parser, default, eligibility predicate, and applicability result;
7. one opener slice consumed by every compatible reconstruction path;
8. typed EYES refusal for the GESIS-derived crossing;
9. generic episode materialization/classification driven by selected start indices rather than an
   `Activity Resumed` string check for explicit opener arms, while retaining the legacy default
   path and preserving the source row in lineage;
10. incremental query input, alternation/cache key, reconstruction-base identity, and protocol
   update where serialization changes;
11. workflow dependencies, options identity, parameter binding, manifest, JSON-LD, and ZIP receipt;
12. B01 × B02 × reconstruction × quality multiverse enumeration with applicability recorded;
13. configuration campaign classes, transition/influence evidence, WASM rebuild, and browser E2E.

No TypeScript preprocessing predicate is permitted. Rust remains the processing authority.

## 10. Rejected and historical options

- The unavailable historical B02 commits and WASM remain a recovery record, not a design source.
- `MOVE_TO_FOREGROUND` is an alias, not an independent arm.
- Screen-on, unlock, and startup are device/session evidence and cannot inherit the previous or
  next app implicitly.
- Parry–Toth's seven retained types cannot be renamed as seven app openers.
- Raw GESIS-nine without a system guard is incomplete and must not ship.
- Arbitrary custom lists and per-event Booleans are outside the bounded scientific vocabulary.
- A public `none` arm would be a diagnostic dressed as a measurement choice; do not ship it.
- Bundling B02 back into reconstruction fails the independent-axis requirement.

## 11. Decision ledger

| Capability | Candidate | Origin/evidence | Status | Why | Risks | Required verification | Open question |
|---|---|---|---|---|---|---|---|
| Compatibility default | `strategy_defined` | Current runtime at `312ef636` | Adopt | Exact backward behavior | Could hide legacy source gaps | Omitted/default scientific-output byte comparison for every strategy | Which equivalence cells can later be collapsed without hiding requested values? |
| Portable opener | `activity_resumed_only` | AOSP `1cdfff5`; Parry–Toth revision 2/hash pinned above | Adopt | Only cross-method app opener with native event-level app identity | Equivalent in six arms | Full strategy matrix, inherited package-policy proof, and explicit equivalence receipt | Does any accepted input make a nominally equivalent strategy differ? |
| Project-owned B02 abstraction | `OpenerSetId`, eligibility vector, applicability result, and explicit-start materializer | Chronicle design against the frozen source decision | Build | No existing abstraction can vary openers independently or materialize selected non-resume starts | A parallel predicate could drift from strategy consumers | One centralized vector consumed or refused by every strategy; exact default compatibility and lineage proof | Can later delivery axes reuse the applicability/result vocabulary without coupling their predicates? |
| Cross-surface integration | Contract field through generated browser surfaces, Rust/WASM, query identity, workflow, provenance, and multiverse | Existing Chronicle schema-generation and execution architecture | Compose | B02 is only real when the same canonical value crosses every existing boundary | Generated artifacts or caches may omit the field | Contract closure, persistence, request, cache, receipt, WASM, and multiverse obligations in the proof matrix | Which existing generated projections require no hand-authored adapter? |
| Wider source classifier | `gesis_app_scoped_starts` wrapper over the project-owned B02 abstraction | GESIS `0561e0c`; AOSP event scope | Adapt | Supplies a source-backed positive contrast without admitting device types while preserving Chronicle's factored package boundary | Mixes lifecycle/service/standby/slice phenomena and is not a complete GESIS preset | GESIS type19/20 witness; per-strategy branch witnesses; source/adaptation receipt | How many effective wider starts remain unmatched under each closer rule? |
| EYES wider crossing | GESIS-derived opener | EYES local/reference structure | Refuse | Not a one-component opener change | Silent fallback would falsify method identity | Typed refusal through Rust, browser, multiverse, and export | Reopen only if EYES exposes a separately sourced start-classifier seam |
| Device-only opening | screen/keyguard/startup | AOSP `1cdfff5` | Refuse | Device-scoped types do not identify an app | Accidental carry-forward, including malformed package text | Type-scope negative fixture with both `android` and deliberately malformed packages | Reopen only if a separate observable attribution signal is approved |
| Legacy alias | move-to-foreground | AOSP + Chronicle normalizer | Reject | Observational duplicate of type 1 | Inflated configuration space | Normalization equivalence test | N/A |
| Parry–Toth seven as openers | Author `rcode.R` revision 2/hash pinned above | Reject | Source separates six device/session types from type-1 app episodes | False unit conflation | Source-code assertion and ontology wording | N/A |
| Raw GESIS nine | GESIS `0561e0c` | Reject | Source classifier requires a later app/device split | Device events could be credited as apps | Event-scope closure test | N/A |
| Open-ended custom set | Arbitrary string list | Reject | Cannot certify or bound | Unsafe persistence; combinatorial explosion | Closed-schema test | N/A |
| Per-event controls | Independent Booleans | Reject | Destroys named-set provenance and expands the campaign unboundedly | Uninterpretable cells | Closed-schema test | N/A |
| Empty public arm | `no_app_openers` | Project diagnostic | Reject from public enum | Kill switch is not a defensible measurement binding | Duplicated all-zero cells mistaken for science | Internal mask/property assertions only | N/A |
| Bundled-only behavior | Opener inside strategy | Baseline design | Reject as completion | Fails the independent-axis requirement | Selector/provenance absence | Cross-surface field and Rust-reachability proofs | N/A |
| Historical bytes | `f581581` / `90ae834` / missing WASM | Recovery ledger | Unavailable; do not imitate | No object or bytes recovered | False provenance | Reopen recovery if original artifact appears | Whether an offline endpoint later yields the original bytes |

Chronicle's maintainers own the new abstraction, wrapper, and cross-surface integration. The
ongoing maintenance cost is one closed enum in source LinkML plus the Rust semantic
implementation, regeneration of contract/workflow/browser artifacts whenever the enum changes,
and a rebuilt and reverified WASM artifact for every Rust change. The pinned source membership,
adapter receipt, fixtures, query/cache identity, and multiverse enumeration must be reviewed
together; this is continuing project maintenance, not a one-off vendor fork.

## 12. Smoke and proof plan

The canonical surface-by-surface matrix and run order are frozen in
[`b02-opener-set-proof-matrix.md`](b02-opener-set-proof-matrix.md). The decisive minimum is
summarized below.

### Decisive semantic fixtures

1. **Alias equivalence:** otherwise identical `Move to Foreground`, `Unknown importance: 1`, and
   `Activity Resumed` inputs produce identical normalized rows, scientific outputs, and effective
   opener evidence.
2. **Filtered-resume transport:** a package selected by the app filter is first represented as
   `Filtered App Resumed`, remains discoverable by `resolve_excluded_packages`, is unmasked to
   canonical type 1 before B01/B02 matching, and opens the same bounds under
   `activity_resumed_only` as an otherwise identical unfiltered control. The final row must still
   follow the existing package inclusion/exclusion policy, proving that B02 neither bypasses that
   policy nor mistakes its transport label for a different opener.
3. **No device attribution:** types 15, 18, and 27, placed between real app resumes, never open app
   usage or inherit either app, both with package `android` and with deliberately malformed package
   text.
4. **Non-degenerate wider arm:** a package-attributed type 19/type 20 pair plus a normal type 1/type
   2 control produces the additional episode only under `gesis_app_scoped_starts` with
   `gesis_start_stop_repair`.
5. **Consume or refuse:** all seven strategies × all three values return a declared applicability
   classification; every executable wider crossing has a strategy-appropriate closer witness and
   effective-count proof; EYES × GESIS-derived is a typed refusal; no cell silently ignores B02.

### Cross-surface obligations

- exact ontology/generated/UI/Rust enum closure and a valid declared default;
- valid, missing, wrong-type, and unknown persistence inputs across settings, presets, imports,
  share URLs, projects, and last-run records;
- a non-default exact value observed in the Rust request and in changed compiled-WASM output;
- cold, warm, repeated, A→B→A, and persisted-base behavior for every executable arm;
- options digest, cache identity, workflow binding, manifest, JSON-LD, and ZIP agreement;
- full B01 × B02 tuple enumeration and uniqueness in the binding multiverse;
- default scientific outputs unchanged, while contract/provenance/options/WASM artifacts are
  expected to change because the option surface changes.

Focused tests run before broad gates; configuration influence and compiled-WASM tests are separate
because ordinary Vitest excludes the heavy campaigns. Python parity is not applicable in this
preview baseline because the Python engine and cross-engine target were removed.

## 13. Recommended architecture

Add one Rust `OpenerSet` enum and one centralized eligibility/applicability layer:

```text
retained rows (B01)
        |
        v
opener eligibility (B02) -----> applicability / typed refusal
        |
        v
strategy pairing + closer + repair
        |
        v
materialization -> cleaning -> aggregation -> provenance/export
```

The eligibility layer receives canonical interaction type, package, selected opener set, and
strategy. It returns the opener Boolean plus an applicability classification determined once per
configuration. Compatible strategies consume the same Boolean vector; strategy-native behavior is
used only for `strategy_defined`. EYES rejects the one structurally incompatible crossing.

The vector, applicability, and adapter identity must be part of the query input and receipt. A
configuration with a controlled derivative remains executable but cannot retain the named
published-method fidelity label.

## 14. Risks, unknowns, and change triggers

Known risks:

- the GESIS source filters localized `app_name`, while Chronicle's adapter uses both AOSP event
  scope and package `android`; this is explicit adaptation, not proven identity;
- some vendor exports may mislabel device rows with a non-`android` package;
- the baseline materializer recognizes only `Activity Resumed` as an app-usage start, so the wider
  positive arm is not complete until materialization and duration classification use explicit
  matched start indices without losing source-row lineage;
- non-GESIS wider crossings may create many unmatched opens because their closers stay fixed;
- B01 alternatives can remove B02-eligible rows, making some combinations equivalent;
- a selector can appear wired while cached reconstruction still reuses another opener value;
- the historical B02 artifact may later reappear with a different vocabulary.

Open but non-blocking questions are measured rather than guessed: empirical frequency of types
4/11/14/19/22 in authorized data, vendor deviations from the AOSP pseudo-package, and the number of
structurally equivalent multiverse cells.

Reopen this decision if a primary implementation supplies another package-attributed app opener,
if Chronicle gains a declared device-event-to-app attribution signal, if the historical artifact
is recovered, or if a fixture disproves the centralized predicate's ability to preserve a
strategy's non-opener semantics.

## Sources

All sources were accessed 2026-08-11.

- Android Open Source Project, Apache-2.0,
  [`UsageEvents.Event` pinned at `1cdfff555f4a21f71ccc978290e2e212e2f8b168`](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/core/java/android/app/usage/UsageEvents.java)
  and the pinned
  [`UserUsageStatsService` global-state dispatch](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/services/usage/java/com/android/server/usage/UserUsageStatsService.java).
- Parry and Toth, author
  [`rcode.R` revision 2](https://osf.io/download/bjh9r/?revision=2), SHA-256
  `99787f1c01499dfe335283eff4bc067a4da0246475cc3238ffe80fc5cfff792f`, with
  [OSF version metadata](https://api.osf.io/v2/files/bjh9r/versions/2/) and
  [project](https://osf.io/5bekx/); the project exposes no code license. The article is CC BY:
  [DOI 10.5117/CCR2025.1.8.PARR](https://doi.org/10.5117/CCR2025.1.8.PARR).
- Zerrer, *How to work with Android App Logging Data*, MIT,
  [`readme.qmd` pinned at `0561e0c4f0e0fbd094d5ec6ef005819affbbe762`](https://github.com/patrickzerrer/How-to-work-with-Android-App-Logging-Data/blob/0561e0c4f0e0fbd094d5ec6ef005819affbbe762/readme.qmd)
  plus the pinned public
  [`red_data.rds` sample](https://github.com/patrickzerrer/How-to-work-with-Android-App-Logging-Data/blob/0561e0c4f0e0fbd094d5ec6ef005819affbbe762/data/red_data.rds)
  and [license](https://github.com/patrickzerrer/How-to-work-with-Android-App-Logging-Data/blob/0561e0c4f0e0fbd094d5ec6ef005819affbbe762/LICENSE).
