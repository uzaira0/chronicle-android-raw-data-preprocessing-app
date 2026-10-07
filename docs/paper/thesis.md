# Paper thesis and arm status, 2026-08-08

Two things happened on 2026-08-08. They are not the same kind of thing and the
paper must not treat them as such.

1. **A finding about the source material.** The comparators are not four
   independent methods. This constrains what the paper can claim and belongs in
   it. §1.
2. **Two bugs in our own arms.** One fixed, one open. These are engineering
   status. They do not belong in the paper at all, and the pre-fix numbers must
   never be cited as measurements. §2.

## 1 — the comparators are not independent

`docs/workflow/prior-art-vocabulary.md` listed `culverhouse_trim_and_log`
alongside Parry & Toth and EYES as prior art. Reading the primary sources shows
the lineage is not parallel:

| Artifact | What it actually is |
| --- | --- |
| Parry & Toth (2025), doi:10.5117/CCR2025.1.8.PARR | The published procedure. Steps 1–9, with an example R implementation. |
| `joshculverhouse/chronicle-android-preprocessing` | An **adaptation of the Parry & Toth example implementation**. Its own README says so, and `run_preprocessing.R:457` stamps every output row `source_dataset = "ParryToth-adapted"`. |
| `joshculverhouse/chronicle-preprocessed-cleaning` | A downstream cleaning pass over that preprocessor's output. This is what `culverhouse_trim_and_log` implements. |
| This repository | Independent. |
| EYES | Independent. |

So the count of independent reconstruction rules is **three, not four**:
Parry & Toth (with Culverhouse as a derivative), EYES, and ours.

There is a second, sharper problem. `README.md` of this repository credits Josh
Culverhouse, PhD for converting the plotting code to Python, supplying apps for
the app codebook, and testing. He is a contributor to the artifact under study.
A paper that presents his cleaner as an outside check on our engine would be
overstating its own independence. The paper must state the relationship.

None of this makes the comparison worthless — a derivative that changes the
answer is still evidence about the original — but it changes what the
comparison licenses us to claim.

## 2 — arm status (engineering, not a paper claim)

Nothing in this section is a result. It is a defect log for two arms, kept so
the pre-fix numbers are never mistaken for measurements.

The first divergence run reported these daily totals over a 20-day synthetic
stream. The `parry_toth` and `eyes_complement` arms both produced single
episodes of exactly 24.00 h, which cannot be a real day of use:

| Arm | total (min) | max single episode |
| --- | ---: | ---: |
| `fused_matcher` | 3,401 | 1.05 h |
| `parry_toth_forward_pairing` | 28,152 | 24.00 h |
| `eyes_complement` | 30,572 | 24.00 h |

Both anomalies have the same shape of cause: **each arm consumed a mid-pipeline
intermediate instead of the published method's actual output.**

### 2a. Parry & Toth — two of three closers were missing (FIXED)

Their reference implementation ends an app episode at the first of three
events: the screen going non-interactive, the same package moving to the
background, or a different package taking the foreground. Our arm implemented
only the third, because it read `MatcherInput`, which carries app-event flags
and no screen stream. Overnight episodes therefore ran until the next morning's
first foreground event.

Measured directly on the raw event stream, before any engine runs
(`scratchpad/fixture_gaps.py`, 20 days, screen events present on 18 of 20 days,
27 silences ≥ 3 h):

| Closer set | episodes closed | median | max | total |
| --- | ---: | ---: | ---: | ---: |
| One closer (what we had) | 271 | 0.243 h | 24.00 h | 526.4 h |
| Three closers (the published rule) | 272 | 0.034 h | 14.13 h | 257.3 h |

The arm was 2.05x high. That is the size of our defect on this fixture and
nothing more — not a property of Parry & Toth, not a property of event-log
measurement, and not citable.

Fixed in `match_app_usage_forward_pairing_indices_core`
(`rust/chronicle_app_usage_matcher/src/lib.rs`) and its caller in
`match_app_episodes_with_strategy`
(`rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs`). After the
fix the arm's maximum episode is 13.17 h and its total 20,090 min.

The fix also removed the Step-6 same-package collapse, because the reference
implementation does not collapse in preprocessing — it defers merging to the
cleaning pass. Where the paper's prose and the paper's own reference code
disagree, the code is what other researchers actually run.

### 2b. EYES — the device-state split is computed and discarded (NOT FIXED)

`segment_eyes_complement` returns both `episodes` (triplet-reconstructed, raw)
and `final_app_usage` (those episodes split against the SHUTDOWN / IDLE / GAP /
GLANCE timeline and tagged with `device_status`). EYES's answer for app usage is
the `ACTIVE` fragments of `final_app_usage`.

`eyes_complement_episodes` reads `segmentation.episodes` and never touches
`final_app_usage`. Every IDLE and GAP block EYES computes — including the 27
silences ≥ 3 h in this fixture, well over its `gap_silence_hours` default of
3.0 — is discarded before it can bound anything. That is why this arm still
reports 24.00 h episodes after the Parry & Toth fix.

This one is not a two-line change. `MatcherOutput` addresses episodes by **row
index**, and a `final_app_usage` fragment boundary is a block edge that need not
coincide with any row. Projecting EYES faithfully requires the seam to carry
intervals, not indices. Until that lands, the `eyes_complement` numbers below
are not evidence about EYES.

## What the thesis is

Unchanged: *the choice of reconstruction rule moves children's measured screen
time by more than the effects the literature reports finding in it.*

It is not yet tested. The first attempt to test it did not test it, because two
of the three arms were defective. That is the whole status.

An earlier draft of this file promoted 2a into a thesis about "methods versus
their own implementations." That was wrong and is retracted. 2a is a bug we
wrote and fixed. It is not evidence about published methods, about other
researchers, or about measurement in this field, and it does not belong in the
paper. It is recorded above only so the arm's history is auditable and so the
pre-fix numbers are never cited.

The claims are as they were:

- **C1 (sublation).** Every published rule examined is a special case of one
  structure whose free slot is *what bounds an episode with no observed end*.
  Parry & Toth fill it from the screen stream, via Steps 3/8/9. EYES fills it
  with the device-state timeline. Culverhouse fills it with a 6 h band and a
  10-minute truncation. Ours fills it with a 12 h long-duration cap. Naming the
  slot is the contribution. Unaffected by any of the above.
- **C2 (bindings disagree).** The headline experiment. **Untested.** It needs
  three working arms and real study data; it currently has two working arms and
  a synthetic fixture.
- **C3 (instrument ladder).** iOS Screen Time screenshots remain rung 1 — a
  vendor aggregate whose construct arrives pre-decided. Unaffected.
- **C4/C5** are unaffected.

What the paper must not claim, on current evidence:

- that four independent methods were compared (three, one derivative);
- that Culverhouse is an outside check (he is a contributor to this repository);
- any magnitude from the `eyes_complement` arm (2b);
- any headline magnitude from synthetic data at all — the spread on a generated
  fixture is a property of the generator. Real study data is required, and the
  synthetic runs establish only that the arms dispatch differently, which
  pathology drives divergence, and that the thesis is falsifiable.

## Current arm results, with the caveats attached

Same 20-day fixture, after the Parry & Toth fix. `eyes_complement` rows are
listed for completeness and are **not** usable as evidence (2b).

| Arm | interval policy | total (min) | max episode |
| --- | --- | ---: | ---: |
| `fused_matcher` | none | 3,401 | 1.05 h |
| `fused_matcher` | culverhouse | 3,401 | 1.05 h |
| `parry_toth_forward_pairing` | none | 20,091 | 13.17 h |
| `parry_toth_forward_pairing` | culverhouse | 3,868 | 1.15 h |
| `eyes_complement` | none | 30,572 | 24.00 h |
| `eyes_complement` | culverhouse | 5,629 | 2.12 h |

These are a smoke test that the arms dispatch and that 2a is fixed. They are
not a measurement of anything: the spread on a generated fixture is a property
of the generator, and one arm is still broken. Do not quote a ratio off this
table.

## Next

- Carry EYES's `final_app_usage` through the seam (2b). Until then the arm is
  not reportable.
- Re-run on real study data. Synthetic magnitudes are generator properties.
- State the Culverhouse relationship in the paper's methods section, not a
  footnote.
