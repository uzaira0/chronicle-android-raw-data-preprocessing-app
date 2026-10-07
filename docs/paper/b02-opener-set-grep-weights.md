# `delivery:B02` opener-set research preflight

Status: hypothesis inventory only; not source evidence

Date: 2026-08-11

Target baseline: private-preview commit `312ef636e3bd03d63bc5d8b2fd84b86fa5251cbc`

This preflight freezes recalled possibilities and search terms before external discovery. The
canonical delivery requirement remains
[delivery:B02](delivery-axis-ledger.yaml): make the interaction/event set that can open usage
credit an independent, persisted, Rust-reachable axis with receipt evidence. Historical B02
commits and WASM bytes were not recovered, so none of the candidates below may be described as
the recovered implementation.

## 1. Disambiguation

The decision is the semantics and vocabulary of `opener_set`, not its UI plumbing.

Plausible interpretations:

1. **App-episode candidate opener:** which raw rows may begin an app-usage episode. This is the
   primary interpretation because the existing B01 retention and reconstruction axes feed the
   app-usage pipeline and because the recovered requirement says “open usage credit.”
2. **Device-use-session opener:** screen-on, unlock, keyguard-hidden, or startup rows that begin a
   device session. This is related but belongs to screen-session construction unless the source
   method explicitly attributes such a row to an app.
3. **Strategy-native start classification:** preserve each reconstruction strategy's own start
   rule. This is necessary as the compatibility default, but by itself is not an independently
   varied scientific axis.
4. **Arbitrary user-authored event list:** technically general, but it would weaken provenance and
   could create unreviewed methods that look published.

Names that can be confused: Android `MOVE_TO_FOREGROUND` and `ACTIVITY_RESUMED`; screen-on and
unlock; an event being retained by B01 and being eligible to open under B02; an opener predicate
and a complete reconstruction strategy.

## 2. Canonical answer from prior knowledge

High-confidence primitives:

- The default must preserve every current strategy's byte behavior. A new enum cannot silently
  reinterpret existing saved configurations.
- B01 runs first: a row absent from the retained stream cannot open under B02.
- B02 must change only opener eligibility. It must not silently change closer, repair, timeout,
  device-state, grouping, or cleaning semantics.
- Every strategy must either consume the selected opener set or explicitly refuse the crossing;
  silently ignoring B02 is not acceptable.
- A device-wide event cannot become app usage without a declared package-attribution rule.

Medium-confidence composition hypothesis:

- Use a baseline-preserving `strategy_defined` value plus a small set of source-backed named
  opener predicates.
- `activity_resumed_only` is likely the first portable explicit arm.
- A wider published/tutorial start-event set may be a second explicit arm only if its exact
  membership and app-attribution semantics are verified from primary code or documentation.
- Screen/keyguard-only candidates may need explicit refusal rather than executable app-credit
  arms when Chronicle supplies no defensible app identity on those rows.

Assumptions requiring verification:

- Whether Chronicle normalizes deprecated foreground labels into `Activity Resumed`.
- Whether published screen-on/keyguard-hidden start rules construct device sessions rather than
  app episodes.
- Whether the existing GESIS-derived start set assigns app identity from each start row, carries
  a prior app forward, or uses a different object than Chronicle app usage.
- Whether source-faithful fixed reconstruction strategies permit an externally crossed opener
  predicate without ceasing to represent that source method.

## 3. Adjacent and competing options

| Candidate | Relationship | Likely strength | Likely limitation | Recall confidence | Decisive check |
|---|---|---|---|---|---|
| `strategy_defined` | Compatibility default | Preserves all existing arms | Not independently informative | High | Default golden and omitted-JSON parity |
| `activity_resumed_only` | Explicit app opener | Direct app/package identity | May be equivalent to several strategies | High | Android event semantics and fixed fixture |
| foreground/move-to-foreground-only | Legacy/deprecated alias candidate | Matches older terminology | May be numerically identical to resumed and absent as a distinct Chronicle label | Medium | Official Android constants and Chronicle vocabulary |
| wide published start-event set | Named source-backed set | Produces a meaningful cross-axis contrast | May mix device events with app events | Medium | Original/reference implementation |
| screen-interactive-only | Device-state opener | Represents screen-session literature | App attribution may be indefensible | Medium | Paper unit-of-analysis and row package semantics |
| keyguard-hidden-only | Unlock opener | Represents unlock-bounded device use | Not necessarily an app opener | Medium | Paper/reference implementation |
| startup-inclusive set | Reboot/session opener | Represents some repair algorithms | Startup may be a boundary, not usage | Low | Source algorithm and shutdown/startup policy |
| arbitrary custom event list | User-defined generalization | Maximum flexibility | Unbounded, hard to certify, unsafe persisted values | High | Product/scientific scope decision |
| independent boolean per event | Factorial primitive | Exact low-level control | Explodes configuration space and loses named-source provenance | High | Admissibility and combinatorial budget |
| opener embedded in strategy | Current baseline | Source methods remain coherent | Fails the independent-axis requirement | High | Recovered acceptance requirement |

## 4. Commonly confused items

- **B01 retention versus B02 opener eligibility:** retained non-openers may still close, bound,
  censor, or explain an episode.
- **Opener set versus reconstruction strategy:** an opener predicate does not specify pairing,
  repair, unmatched-open handling, or device-state segmentation.
- **Screen-session opener versus app opener:** screen-on or unlock can start device use without
  identifying an application.
- **`MOVE_TO_FOREGROUND` versus `ACTIVITY_RESUMED`:** Android may expose these as deprecated and
  current names for the same numeric event type; a label difference is not automatically a
  distinct observable arm.
- **Filtered resume versus a different opener:** the baseline masks filtered rows to canonical
  activity labels before reconstruction, so provenance and behavior can diverge if B02 is applied
  at the wrong stage.
- **GESIS “start” versus Chronicle usage credit:** a tutorial classifier may use start/stop labels
  for a different intermediate object or repair procedure.

## 5. Fuzzy or uncertain recall

- Android `UsageEvents.Event.MOVE_TO_FOREGROUND` being an alias of event type 1 and deprecated in
  favor of `ACTIVITY_RESUMED`: remembered claim needs official source.
- Screen-interactive, keyguard-hidden, startup, and several activity transitions appearing in a
  GESIS tutorial start set: exact labels and applicability need source verification.
- Schoedel-style app episodes beginning on an app launch and ending on next launch or screen-off:
  paper identity and exact inclusivity need source verification.
- Some device-use methods using unlock or screen-on as session starts rather than app openers:
  applicability uncertain.
- Chronicle rows for screen/keyguard events carrying `android`, an empty package, or the last app:
  dataset behavior uncertain and must be decided from approved public/synthetic evidence, not
  private participant exports.

## 6. Best traps

- Add a selector that only changes the fused matcher while fixed published strategies ignore it.
- Treat screen/keyguard rows as app starts without a package-attribution contract.
- Invent separate arms for deprecated aliases that are observationally identical after ingest.
- Filter rows to implement B02, accidentally deleting rows needed as closers or state boundaries.
- Apply B02 after building cached matcher indexes, causing warm/cold disagreement or stale reuse.
- Call a crossed perturbation a published method even when it changes that method's fixed opener.
- Let unknown persisted strings reach Rust and silently select an unintended restrictive set.
- Expand the multiverse without including B01×B02 interaction or arm identity in workspace keys.
- Claim source fidelity from a local transcription without primary/reference conformance.

## 7. Historical and dead ends

- The reported `f581581` / `90ae834` implementation and corresponding WASM are historical but
  unavailable; hashes alone cannot recover semantics and must not be imitated as evidence.
- Keeping opener logic bundled inside each strategy is informative baseline behavior but is not a
  completed B02 axis.
- A generic string field without enum validation would recreate the recovered persistence defect.
- A TypeScript-side preprocessing predicate is rejected because Rust is the processing authority.
- A screen-on/keyguard-hidden app opener with implicit “current app” carry-forward is rejected
  unless a source and an observable carry-forward rule establish it.

## 8. Search handoff

### Proper nouns to verify later, not use for unbiased discovery

- Android `UsageEvents.Event`, `ACTIVITY_RESUMED`, `MOVE_TO_FOREGROUND`,
  `SCREEN_INTERACTIVE`, and `KEYGUARD_HIDDEN`
- GESIS / Zerrer start-stop repair tutorial and reference implementation
- Parry and Toth Android usage-event reconstruction
- Schoedel Android app-use reconstruction
- EYES final app usage
- Chronicle Android event vocabulary

### Generic discovery queries

1. raw Android usage-event algorithm which event types start application-use intervals
2. Android event-log reconstruction app episode start predicate reference implementation
3. smartphone passive sensing screen-on unlock app attribution algorithm
4. usage-event start stop repair package identity screen keyguard events
5. foreground transition deprecated alias resumed event type Android semantics
6. app-use interval reconstruction opener closer unmatched event conformance fixture
7. device-use session start screen interactive keyguard hidden difference
8. Android usage events reboot startup session boundary application interval
9. reproducible smartphone log preprocessing event-type inclusion start set
10. cross-method passive sensing preprocessing opener-set sensitivity analysis
11. public synthetic Android UsageEvents dataset screen keyguard package columns
12. reference code Android app usage session reconstruction eventType start list

### Discovery categories

1. Standards/specifications: Android event-type contract and deprecations.
2. Papers/reference algorithms: exact opener operators and unit of analysis.
3. Open-source implementations: original or author-linked code.
4. Fixtures/data: public or synthetic rows proving package semantics.
5. Platform/API: Android UsageEvents export meaning; browser target is not material here.
6. Adjacent fields: process-mining start-event classification and censoring.
7. Registries: publication/repository identifiers; package registries are not applicable.
8. Maintainer evidence: source issues/comments only when primary code is ambiguous.
9. Hardware/runtime: not applicable to opener semantics; WASM determinism is a later proof.
10. History/deprecation: foreground/resumed aliases and Android API evolution.

### Falsification questions

- Is every proposed non-default opener observable as a distinct Chronicle row after
  normalization?
- Does each source use the event as an app opener, rather than a device-session boundary?
- Is app/package identity explicit at the opener row?
- Can every supported reconstruction arm consume the predicate without changing unrelated source
  semantics, or must it refuse?
- Does varying only B02 produce a non-degenerate, warm/cold-identical output on a fixed fixture?
- Can a primary/reference oracle distinguish the proposed named sets?

### Do not search as discovery queries

To avoid anchoring, do not begin broad discovery with: GESIS, Zerrer, Parry, Toth, Schoedel,
EYES, Chronicle, Culverhouse, Draxler, Morrison, or Okoshi. Direct verification of a shortlisted
candidate may use these names after generic discovery.

### Prioritized verification queue

1. Official Android event constants, numeric aliases, and deprecations.
2. Local Chronicle normalization and public/synthetic package behavior.
3. Generic discovery for app-opener algorithms without recalled author names.
4. Primary paper/reference-code verification of the shortlisted start predicates.
5. A compatibility/refusal matrix across all seven current reconstruction strategies.

**Current best hypothesis:** build a project-owned `OpenerSetId` with a byte-preserving
`strategy_defined` default, one explicit activity-resume arm, and only those wider named sets whose
app attribution and exact membership survive primary-source verification. Refuse unsupported
crossings explicitly.

**Highest-risk unknowns:** the absent historical enum; device-event app attribution; whether wide
start sets are app openers or repair classifiers; and cross-strategy scientific admissibility.

**Search should change my mind if:** a primary/reference implementation supplies a complete,
package-attributed opener vocabulary that is observable in Chronicle and composes cleanly across
strategies, or proves that opener selection cannot be factored without misrepresenting the source
methods.
