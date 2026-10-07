# `delivery:B03`–`delivery:B05` proof-obligation matrix

**Status:** frozen acceptance contract; no implementation is accepted until every required row is
green or has the exact typed refusal recorded here

**Prepared:** 2026-08-11

**Scientific-output compatibility baseline:**
`080801a0232a6a2c97daba0c986094f6cf48fe08`

**Decision record:**
[`b03-b05-foundational-semantics-research-decision.md`](b03-b05-foundational-semantics-research-decision.md)

This matrix proves the new axes as independent measurement decisions. Passing one source fixture
does not certify a complete published method, and regenerating a golden after unexplained default
drift is prohibited.

## Matrix

| ID | Obligation | Minimal input / transition | Required result | Evidence surface |
|---|---|---|---|---|
| `axis_domain_closure` | LinkML, generated browser domains, Rust enums, UI values, applicability, workflow fields, and campaign representatives close over exactly the same canonical values and order | Enumerate every domain on every surface | Exact set/order equality; no orphaned or silently unreachable arm | Schema-generation tests, Rust ontology closure, browser generated-contract tests |
| `old_envelope_defaults` | Missing B03/B04/B05 fields preserve the pre-axis behavior | Old persisted settings, project, last run, import, share URL, and direct Rust JSON | B03=`none`; B04 comparator=`strict_lt`, disposition=`chronicle_blank_keep_row`; B05=`chronicle_screen_interactive_v1` | Persistence/store/runtime-request tests |
| `malformed_browser_fallback` | Browser persistence/import cannot retain invalid values | Unknown string, wrong JSON type, null, array, object for each new field | Safe generated default; no partially accepted vector | Sanitizer, project, last-run, shared-config tests |
| `malformed_runtime_rejection` | Schema-invalid direct runtime requests fail closed | Non-string enum, non-finite/negative threshold | Typed schema/config error before reconstruction; unknown strings use documented safe default only where explicitly allowed | Native/WASM preflight and request tests |
| `detached_default_app_oracle` | Omitted new fields preserve every app scientific output from detached `080801a` | One branch-activating fixture for every app reconstruction strategy, with B02 arms represented | Exact length+SHA-256 for app CSV, review JSON, visualization JSON, aggregate manifest, and lineage before explicit-default equality | Rust detached-oracle test |
| `detached_default_screen_oracle` | Omitted B05 preserves every single-participant screen scientific output from detached `080801a` | Duplicate start, orphan stop, valid close, right-edge missing stop, reboot | Exact length+SHA-256 for screen CSV, review/visualization rows, aggregate manifest, and lineage; multi-participant contamination is tested separately as an intentional repair | Rust detached-oracle test |
| `b03_boundary` | Okoshi comparator is integer-exact strict `<5 s` | Episodes at `0`, `5s−1ns`, `5s`, `5s+1ns`, plus unbounded episode | `not_classifiable`, `micro_use`, `not_micro_use`, `not_micro_use`, `not_classifiable`; no row, duration, boundary, inclusion, or aggregate changes | Focused Rust + CSV/receipt test |
| `b03_pairing_independence` | B03 classifies the selected reconstruction's result rather than silently reconstructing Okoshi pairs itself | Same raw events under all executable reconstruction strategies | Each output is classified from its own raw reconstructed duration; requested/effective policy remains visible | All-strategy Rust matrix |
| `b03_output_contract` | Classification is exposed without changing default CSV shape | `none` then `okoshi_lt_5s` | Default column set byte-identical; non-default app CSV/SAV/review/visualization exposes canonical classification or an explicit not-applicable projection | Output-schema, CSV/SAV, browser authority tests |
| `b03_receipt` | Requested/effective policy, source pin, comparator, threshold, checkpoint, and class counts are committed | A→B→A policy transition | Exact receipt/artifact/semantic-index agreement; A receipts restored byte-for-byte; B options digest distinct | Kernel/runtime/semantic-index tests |
| `b04_comparator` | Strict and inclusive comparisons are exact | `T−1ns`, `T`, `T+1ns` under `strict_lt` and `inclusive_le` | Strict qualifies first only; inclusive qualifies first and equality; integer nanosecond arithmetic only | Focused Rust table test |
| `b04_legacy_boundary` | Default 60-second blanking is exact | `59.999999999s`, `60s`, `60.000000001s` | First keeps row/bounds and blanks duration; equality and above retain duration; exact detached bytes | Rust compatibility test |
| `b04_disposition_fanout` | One qualification result drives four distinct dispositions | Same threshold triplet under all dispositions | Raw counts/durations identical in receipt; credited/excluded/dropped counts differ exactly; zero is never fabricated | Rust row/aggregate/artifact test |
| `b04_retain_and_credit` | Below-threshold diagnostic does not change measure | One qualifying and one nonqualifying episode | Both durations and totals retained; status/receipt identifies qualifier | CSV + aggregate + receipt test |
| `b04_retain_but_exclude` | Audit row survives while headline denominator changes | Same input | Raw duration/bounds remain; explicit eligibility false; headline aggregate excludes exactly one | CSV + aggregate + common-support test |
| `b04_drop_lineage` | Destructive exclusion remains recoverable | One qualifying episode with two source rows | App row absent; excluded-lineage artifact contains exact source ranges, raw bounds/duration, reason, and digest; attrition counts agree | Kernel/runtime artifact/semantic-index test |
| `b03_b04_orthogonality` | Classification and exclusion are independent | Four-second and six-second episodes; B03 `<5s`; B04 floor 5s | Four-second row is micro-use and B04-qualified; six-second row is non-micro and included. Toggling B03 changes no inclusion/output total | 2×2 Rust and runtime matrix |
| `zero_artifact_separation` | Exact zero cleanup is not B03 or B04 | Zero-duration artifact plus valid one-second episode | Zero filter affects only exact zero when selected; B03/B04 receipts classify/qualify independently | Focused Rust test |
| `pre_concurrency_checkpoint` | B04 evaluates once at declared episode checkpoint | One 12s episode later split into 4s+8s | Pre-concurrency B04 sees 12s once; post-split floor applies only when its existing separate option is true; receipts name both stages | Incremental query-influence test |
| `no_double_floor` | Changing unrelated cleaning/grouping cannot silently reapply B04 | B04 A→cleaning/grouping B→A | B04 receipt/checkpoint stable; only declared downstream stage recomputes | Tracked query/influence test |
| `b05_participant_isolation` | Screen state never crosses participants | Interleaved participant events | Same result as separately processed participant streams; distinct interval IDs | Rust all-strategy test |
| `b05_raw_order_seam` | Source-sensitive screen builders use an unfiltered, order-faithful raw branch | Full raw rows with equal-time app resume/pause and screen/keyguard events; blank timestamp; arbitrary interaction remap; nonmonotone physical timestamp | P&T/Zhu branch from decode before missing-row removal/B01/filter/dedupe/correction/remap/handover rank; blank=`unorderable_full_stream_row`; nonmonotone exact refusal; user remap cannot synthesize capability; baseline detached chain/bytes stay fixed | Workflow exact-read + Rust order test |
| `b05_neighborhood_scope` | P&T screen-only adjacency and Zhu full-log adjacency remain distinct | Insert an irrelevant app row between Interactive and Hidden, while their relative order in the screen-only projection is unchanged | P&T classification is unchanged because app rows are absent from its screen-only `lag/lead`; Zhu emits no session because Hidden is not the immediately next full-log row | Rust paired fixture + receipt test |
| `b05_unlock_changes_start` | Three strategies differ on user-present start | Interactive@0, KeyguardHidden@1, KeyguardShown@9, NonInteractive@10 | Chronicle `[0,10]`; Parry–Toth session `[0,10]`; Zhu `[1,10]` | Rust strategy matrix + screen CSV |
| `b05_locked_glance` | Glance distinction is observable | Interactive@0, NonInteractive@2, no keyguard rows | Chronicle interval `[0,2]`; Parry–Toth kind=`glance`; Zhu typed no-session result | Rust strategy matrix + receipt |
| `b05_oem_reversed_order` | Source order and adjacency are explicit | KeyguardHidden@0, Interactive@1, NonInteractive@9, KeyguardShown@10 | Parry–Toth emits exactly `session [1,9]`; Zhu emits no session; no timestamp/event-priority sort rewrites either | Rust fixture permutations |
| `b05_orphans_duplicates_tail` | Every failure disposition is pinned | NonInteractive@0, Interactive@1, Interactive@2, NonInteractive@3, Interactive@4 | Chronicle exact detached legacy output; Parry–Toth emits only `glance [2,3]`; drops @0=`unmatched_glance_stop_no_previous_start`, @1=`unmatched_glance_start_next_not_stop`, @4=`unmatched_glance_start_no_next_stop`; Zhu emits no session | Rust + receipt counts |
| `b05_reboot` | Shutdown/startup behavior cannot span silently | Bare `Shutdown@5,Startup@20`; bounded `Interactive@0,Hidden@1,Shutdown@5,Startup@20,NonInteractive@30,Shown@31`; then add `Interactive@21,Hidden@22` | P&T: bare=no interval; bounded=`session [0,5]` + `[20,30]`; added start=`[0,5]` + `[21,30]` and startup@20 dropped. Zhu closes on shutdown and reopens only after a valid interactive→hidden adjacency. Chronicle exact legacy bytes/reasons preserved | Rust strategy matrix |
| `b05_equal_time_order` | Source-sensitive arms refuse or use preserved source order | At t=0: H/I/N/S; I/N/H/S; I/N; N/I, where H=Hidden,I=Interactive,N=NonInteractive,S=Shown | Parry–Toth outputs respectively `session [0,0]`, `glance [0,0]`, `glance [0,0]`, and none. A consequential tie with lost order refuses `ambiguous_equal_timestamp`; zero removal remains downstream | Preflight + Rust permutations |
| `b05_combined_label_refusal` | Parry–Toth is not silently run on fused 15/17 or 16/18 rows | Combined Chronicle label fixture | Exact `combined_event_representation` refusal; no inferred expansion, fallback, or empty success | Native/WASM preflight tests |
| `b05_api_signal_refusal` | Instrument capability and ordinary no-event observations remain distinct | Missing sidecar; bound signal state absent; bound signal state unknown; `capable` with no matching raw row | Respectively `input_capability_evidence_absent`, `missing_required_signal`, `required_signal_capability_unknown`, and executable `capable_no_row`; no case falls back to Chronicle | Applicability receipt tests |
| `b05_capability_evidence_validation` | Capability claims have one typed, provenance-bound input contract | Missing CSV; exact/wildcard rows; valid assertion; wrong header/schema/type/key; duplicate; malformed digest; valid foreign digest only; invalid conditional field; unknown; absent; observed contradiction; changed bytes | Exact parse/refusal codes and PHI-safe row numbers; exact participant overrides wildcard; zero current-digest rows=`capability_evidence_not_bound_to_input`; foreign rows are ignored for resolution but remain assignment-bound; assertions never become verified evidence; changes invalidate B05/Schoedel only | Browser support-role, Rust/WASM parser, cache, provenance, semantic-index tests |
| `b05_capable_no_event` | A capable stream with no occurrence is not treated as an incapable instrument | Valid bound evidence declares every required signal/order property `capable`, while participant rows contain no keyguard event | Source arm executes with disposition `capable_no_row` and manifest evidence basis; it does not refuse or fall back | Native/WASM applicability and receipt test |
| `b05_lineage` | Every interval carries exact construction evidence | One valid interval per arm | Stable interval ID; start/end source ranges; strategy; kind; close reason; censor flags; receipt counts agree | CSV/review/manifest/semantic-index tests |
| `schoedel_distinctness` | Requested prose arm differs from next-foreground pairing | Within one screen block: A resume@1, pause@2, resume@3, B resume@5, pause@7, off@8 | Schoedel A `[1,3]`, B `[5,7]`; ordinary forward pairing differs; all rows carry screen interval ID | Rust reconstruction matrix |
| `schoedel_singleton_completion` | Added derivative semantics are explicit | A type-1@1 only, then B type-1@5, screen end@8 | Materialize A `[1,1]` with `singleton_zero_length`; B opens at 5. B03=`not_classifiable`; positive B04 floor qualifies A; each B04 disposition and zero-filter-on/off outcome is exact and removal is counted once | Rust focused 4×2 test |
| `schoedel_equal_time_screen_edge` | Boundary membership consumes the pipeline's established timestamp correction | App rows and different-app/screen-end rows share timestamps under priority/source-order permutations, with correction on and off | With correction on, Resume → neutral → configured stop ordering is materialized at 1 μs spacing and Schoedel sees zero equal-time groups; equal-priority rows retain physical order. With correction off, lexicographic `(timestamp,source_row)` applies and a consequential tie with missing order refuses `ambiguous_equal_timestamp`; no boundary row is borrowed as app evidence | Rust permutation + applicability test |
| `schoedel_right_censor` | Query edge is not silently treated as screen-off | B05 interval opens, A type-1 occurs, no observed B05 end | Emit unbounded evidence row with `right_censored_screen_interval`, no headline credit; B03 not-classifiable and B04 not-qualified; no query-end duration is invented | Rust output/receipt test |
| `schoedel_b05_dependency` | App arm consumes selected B05 output rather than rebuilding it | Same app events crossed with executable B05 arms | Each app row references exact screen interval ID; changing B05 invalidates Schoedel query only through declared dependency | Workflow/query-influence test |
| `schoedel_hidden_screen_output` | Disabling publication of the screen CSV does not remove the app arm's scientific input | Same Schoedel vector with `process_screen_usage` on then off | B05 intervals are still computed as an internal declared dependency; Schoedel app rows, interval IDs, and receipts are identical; only the separately requested screen product is omitted | Workflow exact-read + runtime artifact test |
| `schoedel_full_refusal` | Full OSF binding cannot silently approximate ordinary Chronicle input | Omit PhoneStudy screen vocabulary, call spans, category table, client IDs/names, context rows | Typed `schoedel_full_osf_missing_prerequisites`; no reconstruction run or empty success | Applicability registry/runtime test |
| `participant_partition_equivalence` | Stateful methods are serial within participant and parallel only across complete participants | Two interleaved participants in one raw artifact, then one complete artifact and digest-bound sidecar per participant | Multi-participant result equals stable concatenation of the two independent complete-participant results, including receipts and lineage; no state crosses participant IDs | Native/tracked partition test |
| `within_participant_chunk_refusal` | No state is silently lost at file/chunk boundaries | Split one participant between an opener and closer without serialized carry state | Top-level `unsupported_input_chunk`, detail `participant_stream_fragmented`; no close-at-chunk, restart, empty success, or strategy fallback | Native/WASM preflight test |
| `eyes_tagged_fau` | Full evidence and credited view remain distinct | Resume@0, IDLE[40,60], observed stop@100 | Tagged FAU=`ACTIVE[0,40], IDLE[40,60], ACTIVE[60,100]`; credited view first/last only | EYES core + runtime artifact test |
| `eyes_trailing_reason_observed` | Natural chunk endpoint keeps app close provenance in tagged evidence | Same fixture | Every credited ACTIVE fragment, including the natural trailing fragment, is `EyesDeviceStateBoundary`/`eyes-device-state-boundary` and CSV `device_powered_off_or_idle`; tagged endpoint evidence selects `observed_stop` | Kernel CSV + receipt test |
| `eyes_trailing_reason_repaired` | Repaired natural endpoint remains evidence-only | Same shape with foreign resume/MST end | Every credited ACTIVE fragment remains `EyesDeviceStateBoundary`/`device_powered_off_or_idle`; tagged endpoint evidence alone carries the exact repaired inference (for this fixture, `missing_stop`) | Kernel test |
| `eyes_merged_endpoint_tie` | A merged chunk's natural end is attributed deterministically | Same-package episodes `[0,100]` observed and `[40,100]` repaired, plus a same-resume/source-index tie permutation | Endpoint candidates are exactly recorded; greatest resume wins, then greatest preserved episode index; selected inference remains evidence-only; every credited CSV fragment remains `device_powered_off_or_idle` | EYES core + kernel permutation test |
| `eyes_partial_receipt` | Product cannot self-certify complete EYES | Any EYES run | Receipt pins source SHA/version/license unresolved, effective options, repair IDs `stale_predecessor_after_forward_reboot_gap`, `non_monotonic_gap_emission`, `nested_block_cursor_reset`, ACTIVE-only headline, full-FAU evidence, concurrency/pickup limitations, status=`partial_replay` | Runtime/semantic-index test |
| `eyes_no_aggregate_drift` | Evidence-only full FAU does not change headline output | Toggle evidence artifact emission | App CSV and aggregates identical; only evidence artifact/manifest changes | Runtime digest test |
| `tracked_cold_matrix` | Every executable new arm is cache-honest | Prime one tracked engine; A→B→A over B03, B04 comparator/disposition, B05, Schoedel, and EYES repair | Each run equals a fresh sequential oracle; identical repeat uses zero computational queries; refusal strings/receipts exact | Kernel incremental tests |
| `persisted_base_identity` | Durable reconstruction cannot reuse incompatible post-reconstruction evidence | Persist/restore across each new option | Base key/protocol commits every relevant field/receipt or safely recomputes; warm/cold evidence equal | Persisted-base tests |
| `workflow_exact_reads` | Each field invalidates only its actual computational readers plus receipt assembly | One-field transitions | Workflow contract direct reads, query digests, dependency certificate, and measured influence agree; no unbound computational key | Workflow/evidence gates |
| `options_and_provenance_identity` | Complete vectors remain distinguishable even when published rows converge | Two equivalent-output vectors differing only in requested B03/B04/B05 ID | Distinct options/config/receipt digests; exactly one JSON-LD binding per option; no RDF subject collision | Runtime/provenance/semantic-index tests |
| `configuration_campaign` | New axes participate in systematic evidence | Generated t-wise and influence campaigns | Every computational value represented; typed refusals disjoint from structural invalids; no silently ignored axis | Combinatorial/tomography ledgers |
| `wasm_boundary` | Browser uses generated, rebuilt Rust authority | Non-default browser run and typed refusal | Generated exports/types agree; runtime and semantic WASM contain no host paths; receipts decode without casts | Boundary/privacy/build checks |
| `browser_reachability` | Researchers can select, persist, inspect, and reset every arm | UI interactions and reload | Correct labels/tooltips, modified state, search result, old-value fallback, refusal explanation, result receipt | Vitest + Playwright Chromium/Firefox |
| `scientific_fixture_report` | Synthetic evidence cannot be mistaken for a headline empirical result | Run committed synthetic fixture | Exact fixture hash, arm vector, outcomes/refusals, limitations, and no real-data magnitude claim | Versioned JSON/Markdown report |

## Required fixture identities

Committed fixtures must be synthetic, participant-isolated, and hash-pinned. At minimum provide:

1. `b03-b04-duration-boundaries.csv` — threshold triplets, orthogonality, zero artifact, and
   pre/post-concurrency split witness.
2. `b05-screen-construction.csv` — unlock-start, locked glance, reversed keyguard, orphan/duplicate
   tail, reboot, equal-time permutations, and combined-label refusal witnesses.
3. `schoedel-prose-reconstruction.csv` — A/A/B last-event-before-boundary witness and singleton
   completion case.
4. `eyes-fau-close-provenance.csv` — ACTIVE–IDLE–ACTIVE with observed and repaired natural
   endpoints.
5. `b05-input-capability-evidence.csv` — hash-pinned valid bound capability evidence plus
   generated malformed/unknown/not-observable variants.

Every proof-mode command must verify the exact committed fixture SHA-256 before attaching its
scientific label. Fixture-specific assertions must be opt-in and must not make general campaign
commands reject valid zero-output or source-sparse real data.

## Applicability and relation closure

The implementation must expose one generated applicability/compatibility decision before
execution. At minimum it carries:

```text
requestedId
effectiveId
relation
executable
refusalReason
requiredSignals
missingSignals
optionsDigest
```

Allowed relations are exactly:

```text
baseline_native
baseline_equivalent
source_native
source_equivalent
source_aligned_adapter
controlled_derivative
partial_replay
refused
```

This is the additive shared domain used by B02 and later axes. B02 continues to emit its existing
subset; adding `source_native` and `partial_replay` does not reinterpret an accepted B02 receipt.
Relations are per component, and the crossing table in the decision record is normative.

Refused and structurally invalid cells are disjoint. Refusals never invoke the expensive
reconstruction path. A general runtime error never counts as a scientific refusal.

## Repository-native run order

Run heavy gates serially after source work is stable. The intended order is:

1. `git diff --check`
2. schema/domain assertions and focused generator tests
3. `cd web && npm run generate:contract`
4. `cd web && npm run generate:workflow`
5. repository semantic-inventory/schema generation targets required by changed authorities
6. `cargo fmt --check` for changed crates
7. focused matcher/kernel B03–B05/Schoedel/EYES tests
8. full changed-crate native suites and Clippy where required
9. `cd web && npm run lint && npm run typecheck`
10. focused Vitest persistence/UI/runtime-boundary tests
11. regenerate/check the runtime boundary TypeScript from stable Rust source; do not independently
    rebuild the final WASM package before the dependency-evidence bootstrap/final cycle
12. run `make dependency-evidence` after final workflow/Rust source is stable; this reseals the
    final fail-closed runtime and semantic-index WASM plus the dependency certificate
13. generate and check the committed synthetic proof reports in proof mode against that exact
    resealed runtime/certificate identity
14. rerun focused and full Rust/WASM suites against the sealed certificate
15. run combinatorial/tomography campaigns and deterministic non-update replay
16. run contract, boundary, semantic-closure, WASM-export/privacy, and published-figure checks
17. run supported-browser Playwright smoke, then full Chromium/Firefox E2E
18. exact-commit `make web`, followed by exact-commit `make all` within the campaign compute cap

Do not update goldens to make an unexplained compatibility failure disappear. Diagnose the source
or identity drift first. Do not run dependency-evidence while another process edits Rust, workflow,
campaign, or generated authority files.

## Acceptance rule

`delivery:B03`–`delivery:B05` plus the bounded Schoedel/EYES milestone is accepted only when:

- every matrix row is green on a stable tree;
- every refusal has the exact expected reason and receipt;
- detached default scientific outputs match before explicit-default comparisons;
- every new option is visible in UI, persistence, runtime, workflow, provenance, semantic index,
  cache identity, and evidence campaigns;
- dropped/excluded episodes and screen intervals retain exact source lineage;
- EYES is still labeled `partial_replay` and full Schoedel remains refused on ordinary input;
- generated contracts, WASM, dependency evidence, semantic closure, and committed reports are
  resealed together;
- no private paths, participant data, credentials, or public-repository mutations enter the diff;
- an independent review finds no silent source, fidelity, default, cache, or denominator claim.
