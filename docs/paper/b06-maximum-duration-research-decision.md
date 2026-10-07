# `delivery:B06` maximum-duration policy — research and decision record

**Status:** decided and **implemented** (2026-08-17, branch `codex/b06-maximum-duration`).
Source freeze: commit `fe3ec9b024065411e24e609bc52ae05a8f7f2ebc`. Kernel authority:
`rust/chronicle_chrono_kernel_wasm/src/b06_maximum_duration.rs` (`select_shape`,
`resolve_maximum_duration`, `build_evidence`); row stage
`pipeline_v2_incremental::apply_maximum_duration_to_row`; browser vector
`web/src/lib/maximumDurationVector.ts`; contract keys in
`web/schema/chronicle-local-contract.linkml.yaml`; refusable preflight
`maximum_duration_applicability_json`; receipt on the runtime and review manifests.

**Sources accessed:** 2026-08-11. **Baseline observed at:** `7093e7bf20a568fdb970fc485d219ca3334384c9`.

**Companion documents:**
[pre-search freeze](b06-maximum-duration-grep-weights.md) ·
[proof obligations](b06-maximum-duration-proof-matrix.md) ·
[`delivery:B06` ledger](delivery-axis-ledger.yaml)

## 1. What a researcher gets

Today Chronicle has exactly one maximum-duration behavior and it is invisible: the fused matcher
reads `long_duration_threshold_hours` (default 12) and **rejects** any observed close whose implied
duration exceeds it, without consuming the opener. Because a monotone stream cannot later offer a
shorter close, the practical result is an `End of Usage Missing` row — no stop, no duration, close
reason `Unobserved`, lineage reason `no-qualifying-stop`. The published evidence therefore cannot
distinguish *"an observed close was rejected for exceeding the threshold"* from *"no candidate close
was ever observed."* That is the defect B06 exists to fix. After B06 a researcher can state a
maximum explicitly, choose what happens to a session that exceeds it, and apply it **after**
reconstruction rather than inside candidate matching — so a long session is truncated, flagged,
excluded, or dropped on the record instead of silently disappearing into missingness. In the output
CSV, nothing changes unless B06 is requested: with the keys omitted, every app/screen/credited row
is byte-identical to today. With `post_reconstruction_strict_max_v1` selected, a qualifying row is
either kept with a flag, kept but marked headline-ineligible, truncated (stop rewritten to
`raw start + T`, with the raw bounds retained in lineage), or removed from `app.csv` with its raw
bounds preserved in excluded lineage. A new nullable `effective_endpoint_reason` column reports why
a published stop differs from the reconstructed one.

## 2. The five option keys

| Browser key | Native key | Domain | Default |
|---|---|---|---|
| `maximumDurationPolicy` | `maximum_duration_policy` | `strategy_native` \| `chronicle_observed_close_rejection_v1` \| `post_reconstruction_strict_max_v1` | absent (`strategy_native`) |
| `maximumDurationDisposition` | `maximum_duration_disposition` | `not_applicable` \| `flag_and_retain` \| `retain_but_exclude` \| `truncate_to_threshold` \| `drop_row` | absent (`not_applicable`) |
| `maximumDurationThresholdSource` | `maximum_duration_threshold_source` | `strategy_native` \| `chronicle_legacy_config` \| `fixed_parameter` \| `b12_adaptive_participant` | absent (`strategy_native`) |
| `maximumDurationThresholdNs` | `maximum_duration_threshold_ns` | canonical ASCII `[1-9][0-9]{0,18}`, numerically ≤ `9223372036854775807` | absent (null) |
| `longDurationThresholdHoursExplicit` | `long_duration_threshold_explicit` | Boolean `true` only; absence is the canonical false | absent |

CamelCase never appears in native JSON; snake_case never appears in the durable browser options.
Presence is tested by own-property membership, never by comparing a value against a default. The
fifth key is not a fifth policy selector: it records whether the legacy hours value was chosen by a
user or inherited as the default, which is what separates explicit 12 from implicit 12.

**Policy meanings.** `strategy_native` delegates to whatever the selected reconstruction strategy
already does (fused candidate-close admissibility, the GESIS 600 s fallback timeout, the Draxler
inactivity closer, EYES device-state blocks, or no maximum at all).
`chronicle_observed_close_rejection_v1` names today's fused rule explicitly; it is executable only
with `fused_matcher` and refuses elsewhere with
`maximum_duration_policy_incompatible_with_reconstruction_strategy`.
`post_reconstruction_strict_max_v1` is a project-owned rule over already-bounded episodes with its
own nanosecond threshold and disposition; its relation is always `controlled_derivative`, even when
the threshold happens to equal 600 s, 30 min, 2 h, 5 h, 6 h, or 12 h — a matching number transfers
no source identity. Of the threshold sources, `strategy_native` and `chronicle_legacy_config` take
no explicit threshold, `fixed_parameter` reads `maximum_duration_threshold_ns`, and
`b12_adaptive_participant` always refuses in v1 (§4).

**Where a refusal surfaces.** Both strategy/provider refusals are typed preflight data
(`maximum_duration_applicability_json` → `status: refused` + `reasonCode`) and an execution-time
rejection (`pipeline_options_invalid:b06=<reason>`) before any tracked query. They are *not*
invalid-request errors on the opener-set preflight, which the product and the campaign harnesses
run first: `validate_pipeline_v2_options_with(MaximumDurationValidation::MalformedOnly)` lets a
legal-but-refused vector through so the B06 preflight can report it, while a malformed vector
(shape, threshold grammar, legacy companions) stays an invalid request on every surface that
judges it. The interaction-tomography campaign found the earlier conflation (2026-08-17).

**The five legal presence shapes** (counting only the four selection keys):

| Selection | Present | Absent |
|---|---|---|
| omitted legacy behavior | none | all four |
| explicit `strategy_native` | policy, disposition=`not_applicable`, source=`strategy_native` | threshold |
| explicit Chronicle rejection | policy, disposition=`not_applicable`, source=`chronicle_legacy_config` | threshold |
| explicit generic fixed | policy, one active disposition, source=`fixed_parameter`, threshold | none |
| explicit generic adaptive | policy, one active disposition, source=`b12_adaptive_participant` | threshold |

No missing sibling is filled in to make a partial set valid. If any selection key is present and the
four-key shape is invalid, the browser sanitizer deletes all four **and** the legacy-origin marker in
one atomic update, reports `invalid_present_b06_vector_sanitized_to_omission`, and returns to
omission — it never upgrades an old omission into an explicit `strategy_native`. Direct native/WASM
JSON is not sanitized; it refuses with a typed error before reconstruction. "Reset B06 to legacy
omission" removes all five keys together.

The threshold crosses JSON as a canonical decimal **string**, never a JavaScript `Number`: the
browser control is `<input type="text" inputMode="numeric" maxLength={19}>` and stores the string
it was given. WebAssembly Core supplies the `i64` execution type and the JS Interface maps a direct
Wasm `i64` to `BigInt`, but neither makes a BigInt JSON-serializable, so the string is the wire.

## 3. Qualification and dispositions

For an accepted bounded episode with i64 raw start `s`, raw stop `e`, and validated raw duration `d`:

```text
qualifies = d > maximum_duration_threshold_ns
```

`T−1 ns` does not qualify; exactly `T` does not qualify (equality is retained); `T+1 ns` qualifies.
A zero-duration row is valid input and cannot qualify against a positive `T`. An unbounded or
right-censored episode has no invented duration: it is not qualified, truncated, excluded, or
dropped, and B06 never uses query end, last row, midnight, or `start+T` to bound it.

| Disposition | Published row | Raw bounds | Effective bounds | Headline aggregate |
|---|---|---|---|---|
| `flag_and_retain` | retained | preserved | unchanged | credited |
| `retain_but_exclude` | retained | preserved | unchanged | ineligible, with an explicit exclusion reason |
| `truncate_to_threshold` | retained | preserved in lineage | stop = `s.checked_add(T)`, duration = `T` | credits `T` |
| `drop_row` | removed from `app.csv` | preserved in excluded lineage | none published | ineligible |

`effective_endpoint_reason` is `MaximumDurationEffectiveEndpointReasonId | null`. It is non-null and
exactly `maximum_duration_truncation_boundary` only on a published truncated row, and JSON `null`
everywhere else — including dropped rows, which have no published effective endpoint to type.
Truncation does not assert that a stop was observed at the synthetic bound; raw stop provenance
stays `observed` or `source_synthesized` and the effective row never masquerades as the raw
reconstruction in lineage.

Truncation uses `checked_add`. For a qualifying row with i64 endpoints, `s+T < e ≤ i64::MAX` is
guaranteed, so the check can only fire on corrupt internal state; if it does, the whole run refuses
with `maximum_duration_effective_endpoint_unrepresentable` rather than saturating, wrapping, or
falling back to another disposition. `T = i64::MAX` is legal for all four dispositions but no
accepted row can exceed it, so every action is structurally unreachable at that value.

"Blank the duration while keeping an unmodified stop" is deliberately **not** a v1 disposition (§5).

## 4. Relationship to `long_duration_threshold_hours`

**Preserved verbatim under omission.** The 12-hour default; the browser 1–48 h half-step control;
the binary64 multiplication by `3_600_000_000_000` at the TypeScript boundary; consumption by
`fused_matcher` only (the seven other strategies never read the scalar); and the strict `>` candidate
rejection that produces `End of Usage Missing`. With the B06 keys omitted, every researcher-visible
scientific value — app/screen/credited CSV cells, review, aggregates, lineage — stays length- and
SHA-256-identical. Build, contract, manifest, cache, and archive identities are expected to change,
because they commit to the implementation; whole-archive byte equality is therefore not a valid
omission check.

**The persistence domain is wider than the UI.** At the pinned baseline `sanitizeOptions` keeps
`longDurationThresholdHours` iff `typeof value === "number" && Number.isFinite(value)`. There is no
positivity, no 1–48 range check, and no half-step check. Values below 1, above 48, and off-grid such
as `1.25` all survive; only missing, non-number, `null`, `NaN`, and infinities fall back to 12. The
1–48/.5 control is an **authoring** domain, not the stored domain, and B06 must not retroactively
clamp or round historical values.

**Explicit B06 canonicalization.** Any explicit selection converts the stored binary64 hours to an
exact integer nanosecond value through this frozen, total order:

1. If `L` is bound (fused, or the Chronicle arm) and the value is `≤ 0` including either sign of
   zero, refuse `maximum_duration_legacy_threshold_nonpositive`. An unbound non-fused vector skips
   only this step.
2. Canonicalize the number with ECMAScript `Number::toString` base 10 and expand any exponent to a
   plain decimal (`canonical_legacy_hours_from_binary64_v1`): no `+`, no exponent, no redundant
   leading zero, no trailing fractional zero, no point when integral, `-0` → `0`.
3. Parse that spelling as exact coefficient `C` and scale `k`; compute
   `N = C * 3_600_000_000_000 / 10^k` in checked arbitrary-width integer arithmetic — never
   binary64, `Math.round`, truncation, or epsilon. A non-integer rational refuses
   `maximum_duration_legacy_threshold_not_integer_ns`.
4. Require `N` within signed i64, else `maximum_duration_legacy_threshold_overflow`. Then compute the
   legacy product `M = value * 3_600_000_000_000` purely as a compatibility check: it must be finite
   and integral and `BigInt(M)` must equal `N`, else
   `maximum_duration_legacy_threshold_binary64_mapping_mismatch`. `Number.isSafeInteger` is
   deliberately *not* the test — an above-2^53 integer such as 2502 h is still exact.
5. Emit `b06_legacy_threshold_hours_canonical` (plain decimal) and
   `b06_legacy_threshold_ns_canonical` (`0|-?[1-9][0-9]{0,18}`, narrowed to positive when `L` binds).
   A direct native caller that supplies them must have them agree with the reparse and with
   `long_duration_threshold_ns`; this rejects a longer noncanonical spelling such as
   `1.2500000000000001` even though it parses to the same binary64 as `1.25`.
6. A missing or mismatched companion refuses `maximum_duration_legacy_threshold_canonicalization_mismatch`.
   No case clamps to 1/48, snaps to a half-step, rounds nanoseconds, or silently selects 12.

Worked results over the historical domain:

| Stored hours | Explicit-B06 result when `L` is needed |
|---|---|
| `1.25` | hours `"1.25"`, ns `"4500000000000"` — **accepted** despite being off the UI grid |
| `0.25` | hours `"0.25"`, ns `"900000000000"` — accepted despite being below the UI minimum |
| `49` | hours `"49"`, ns `"176400000000000"` — accepted despite being above the UI maximum |
| `5e-12` | hours `"0.000000000005"`, ns `"18"` — accepted |
| `2500` | ns `"9000000000000000"` — accepted (largest listed safe-product control) |
| `2502` | ns `"9007200000000000"` — accepted; `M` is exact above 2^53 |
| `1.1` | exact decimal ns is `3960000000000`, but the legacy binary64 product is non-integral — **refused**, `binary64_mapping_mismatch` |
| `1.2500000000000002` | exact product has a fractional nanosecond — refused, `not_integer_ns` |
| `5e-324` (`Number.MIN_VALUE`) | canonical 326-byte string; product below 1 ns — refused, `not_integer_ns` |
| `1.7976931348623157e308` (`Number.MAX_VALUE`) | 309-digit canonical string; product exceeds i64 — refused, overflow |
| `3000000` | exact product exceeds i64 — **refused**, overflow |
| `0`, `-0`, any negative | when `L` binds, the nonpositive refusal wins before all of the above |

**Explicit-native vs omission.** Selecting `strategy_native` explicitly produces scientifically
identical rows to omitting the keys, but it is not the same thing: the explicit form emits a
standalone B06 receipt, a scoped ParameterSet, a semantic assertion, and a distinct configuration
identity. Presence is a deliberate assertion about how the run was configured and may never pose as
omission-level byte identity. The same distinction is why the legacy-origin marker exists: implicit
12 and explicit 12 produce identical rows but must select different provenance
(`chronicle_legacy_default_v1` vs `chronicle_legacy_explicit_v1`).

**`b12_adaptive_participant` always refuses in v1** with
`adaptive_maximum_threshold_provider_unavailable`, before reconstruction. It never fits a value
inside B06, never falls back to the fixed or default threshold, and never fabricates a binding. A
future B12 provider may make it executable only by supplying an immutable versioned derivation
receipt plus a complete participant→threshold map derived from a pre-B06 scope; a dependency edge
from that provider to any B06-mutated output refuses `adaptive_maximum_threshold_feedback_dependency`.

**Checked i128 before use.** Every explicit B06 selection activates
`chronicle_explicit_b06_checked_i128_preflight_v1`. Before *any* reachable gap, proximity, candidate,
reconstruction, classification, or B06 consumer subtracts two timestamps, it must compute
`delta = i128::from(right) - i128::from(left)`. No explicit-B06 path may evaluate `i64 - i64`, take
an i64 absolute value, or cast a wrapped difference afterwards; a consumer that must materialize an
i64 field range-checks first. `delta > i64::MAX` refuses the whole request with
`maximum_duration_raw_duration_unrepresentable` before publishing anything. The inventory explicitly
includes the pre-reconstruction duplicate-timestamp adjustment in
`pipeline_v2.rs::unalign_duplicate_timestamps`, which may not run its unchecked
`event_timestamp_ns -= offset`: it computes the rank delta and offset in i128, range-checks, and
materializes i64 once. Two distinct rows tied at `i64::MIN` cannot be nudged earlier and must produce
`maximum_duration_duplicate_timestamp_adjustment_unrepresentable` identically in debug and release —
never a debug panic, never a release wrap, never partial output. The versioned GESIS adapter remains
the one deliberate saturating exception: it records the mathematical i128 value first, then applies
its pinned `saturating_sub`/`saturating_add`, and never reports a saturated result as exact source
`start + 600 s`. Omission does not activate the B06 span/endpoint arithmetic (no B06 difference is
evaluated, no receipt is built) and keeps the legacy output bytes exactly for every representable
input. The duplicate-timestamp nudge is the one place the checked class runs unconditionally
(`pipeline_v2::unalign_duplicate_timestamps` reads no B06 option): a tie within a few microseconds
of `i64::MIN` refuses with the typed token instead of wrapping or panicking whether or not a policy
is selected. That input is unreachable from real wall-clock exports, so the omitted golden bytes are
unchanged; the class of failure it replaces was a debug panic / release wrap, not a published row.

## 5. Decision log

| Decision | Choice | Rationale |
|---|---|---|
| A universal source-branded maximum | **Rejected** | No source supplies a universal target/stage/action. Recalled thresholds ran 600 s → 6 h+ but are not comparable without their method tuples; a source-branded dropdown of numbers would be false precision |
| Omission default | `strategy_native`, no new fields | Only value that preserves every strategy's behavior and the frozen scientific output |
| Explicit `strategy_native` | Adopted, with its own receipt/ParameterSet/identity | Presence is a configuration assertion and cannot pose as omission |
| Explicit Chronicle rejection arm | Adopted, fused-only | Makes the existing hidden close-rejection behavior honest and auditable |
| Generic post-reconstruction maximum | Adopted as `controlled_derivative` | Enables explicit sensitivity analysis without claiming source identity |
| Comparator | Frozen strict `>`, equality retained | Matches the current Chronicle intervention and several executable precedents |
| Dispositions | Four closed values | Separates diagnosis, exclusion, truncation, and destructive deletion |
| Blank-duration disposition | **Rejected for v1** | The closest precedent (Schoedel `App_summary.R` rev. 1) assigns `NA` above strictly 6 h and then unconditionally recomputes `duration = difftime(end,start)`, overwriting it — the deposited function does not return the null it appears to write. A blank without an eligibility/bounds contract also recreates the ambiguity B04 removes |
| GESIS 600 s as a preset | **Rejected** | It is a *fallback* timeout, not a maximum: the first branch accepts a same-package candidate whenever `events_between <= 10` with no duration check, so an original episode may exceed 600 s. At exactly 600 s the next-global branch is `activity_based`; above it, `timeout` |
| UsageLogger 2 h as a preset | **Rejected** | It deletes mixed retained *event rows* whose next-row delta exceeds 7200 s, after its own source-specific retention and cleaning — not a completed app episode |
| ActivityWatch `1 s < d < 4 h` as a preset | **Rejected** | The bound lives inside its foreground state machine; a 4 h session is excluded at equality by that construction, not by a portable rule |
| Geyer 30 min / 1.5 h | **Investigate**, execution refused | A real app-level precedent (named non-interactive apps >30 min; uninterrupted use 1.5 h) but the article exposes no equality operator, row mechanics, code, or fixture. Origin stays `RECALLED`: the generic pass rediscovered it rather than creating a false new-candidate claim |
| Toth–Trifonova 5 h | **Investigate**, execution refused | Comparator, per-row action, and equality are underdetermined; no executable artifact found |
| Culverhouse trim-and-log | **Rejected as B06** | Already a separate, richer interval-quality program: flags at `>=3 h`/`>=6 h`, acts only `>6 h`, and truncates to **10 min** by default — not to 6 h |
| Screen-level methods (Karas, Katapally, Andrews) | **Rejected as app presets** | Wrong target. Retained as sensitivity evidence: Karas et al. report 106.1 min and 133.5 min mean daily-total differences for 6 h-cap and no-cap comparators against a 30 min imputed method, and state no principled optimal cap is known. Andrews et al. deliberately *retain* device uses above 5 h because true use could not be distinguished from logger failure |
| Ochoa–Revilla multiverse | **Composed, not ported** | Their 10,080 operationalizations justify crossing thresholds and dispositions; they deliberately apply no maximum to app visits because those may legitimately be long |
| Legacy hours domain | Preserve every finite binary64 value | Persistence accepts far more than the 1–48/.5 UI; clamping or rounding would rewrite historical science |
| Legacy-origin marker | Adopted as an independent fifth key | Explicit 12 and implicit 12 need different provenance and cannot be told apart from the numeric value |
| Effective endpoint reason | Adopted as a nullable typed field | A truncation boundary is neither an observed nor a source-synthesized reconstruction stop |
| Checked i128 before use | Adopted, including the duplicate-timestamp decrement | Guards a real debug-panic / release-wrap class at `i64::MIN` ties, and an unrepresentable raw duration must refuse before publication rather than after |
| `b12_adaptive_participant` in v1 | **Refused**, no fallback | The provider does not exist; fitting a threshold inside B06 would create feedback and hidden provenance |
| Stage identity | Two independent fields (`b06_effective_stage`, `reconstruction_native_stage`) | A generic post-reconstruction comparator must not be projected onto a native timeout or construction stage |

Later review passes added, in order: 2026-08-12 — explicit-native evidence must be distinguishable
from omission, and the browser↔native key mapping is frozen (freeze 6); 2026-08-12 — the fifth
legacy-origin key is added and `effective_endpoint_reason` is typed nullable, and the
duplicate-timestamp decrement is brought inside the checked-arithmetic prerequisite (freeze 7).
Freeze 5 contributed the i128-before-use requirement on explicit-B06 timestamp subtraction. Freezes
8–10 introduced no researcher-facing behavior and are not recorded as decisions.

**Change this decision only if** a primary source publishes a reusable app-episode policy with
target, stage, comparator, disposition, code, license, and conformance data; a correction resolves
the Schoedel overwrite or the Geyer/Toth ambiguity; proof shows omission cannot preserve the frozen
scientific output; or a later delivery-axis decision explicitly merges B06 with interval quality,
screen gating, B12 adaptation, or B14 day/timezone semantics.

## Sources

- [GESIS tutorial at `0561e0c`](https://github.com/patrickzerrer/How-to-work-with-Android-App-Logging-Data/blob/0561e0c4f0e0fbd094d5ec6ef005819affbbe762/readme.qmd) (MIT root / CC0 `CITATION.cff` conflict retained)
- [UsageLogger article](https://link.springer.com/article/10.3758/s13428-021-01585-7) · [cleaning script at `150e765`](https://github.com/davidaellis/UsageLoggerPublished/blob/150e765a387eaf5ce97e52c856501f4be8740624/sample%20data%20and%20scripts/R/past_usage_analysis.R)
- [Geyer et al. 2021, IJERPH 18(7):3702](https://pmc.ncbi.nlm.nih.gov/articles/PMC8037484/)
- [Toth & Trifonova, CHBR 4:100142](https://refubium.fu-berlin.de/bitstream/fub188/33964/1/Somebody_is_watching_me.pdf)
- [Andrews et al. 2015, PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0139004)
- [Schoedel et al. 2026](https://www.cambridge.org/core/journals/psychometrika/article/from-digital-data-to-psychological-insights-making-sense-of-mobilesensing-data-through-integrative-preprocessing-pipelines/00A9F0AC082318C4EDC1CE1099E33E96) · [`App_summary.R` rev. 1](https://osf.io/download/6928d7500778a58bcc7703de/?revision=1) (code unlicensed)
- [Culverhouse cleaner at `de7f39c`](https://github.com/joshculverhouse/chronicle-preprocessed-cleaning/blob/de7f39c7f2690da0eb9076884749678172e49a9b/clean_preprocessed.R) (no license)
- [Karas et al. 2024, JMIR](https://mhealth.jmir.org/2024/1/e57439) · [Beiwe repo at `179125f`](https://github.com/onnela-lab/stb-beiwe-screen-time/tree/179125fa6b8e638a6727bc6f3c7fb9238c1e7c31)
- [Katapally & Chu 2019, IJERPH 16:2275](https://pmc.ncbi.nlm.nih.gov/articles/PMC6651165/)
- [Ochoa & Revilla 2025, PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0338894)
- [Android `UsageEvents.Event`](https://developer.android.com/reference/android/app/usage/UsageEvents.Event) (live reference, no immutable revision)
- [ActivityWatch `SessionParser.kt` at `a21b48c`](https://github.com/ActivityWatch/aw-android/blob/a21b48cedc40c091c82a48e1396cdd1d9ad8363f/mobile/src/main/java/net/activitywatch/android/parser/SessionParser.kt)
- [WebAssembly Core, W3C CRD 2026-07-28](https://www.w3.org/TR/2026/CRD-wasm-core-2-20260728/) · [Wasm JS Interface, W3C CRD 2026-07-28](https://www.w3.org/TR/2026/CRD-wasm-js-api-2-20260728/) · [ECMAScript 2026 draft](https://tc39.es/ecma262/2026/)
