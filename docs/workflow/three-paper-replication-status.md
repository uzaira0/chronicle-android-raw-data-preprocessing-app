# Three-paper replication boundary (2026-09-23)

“Executable on a source-shaped fixture” is not “the original paper reproduced.” The
three original-data studies below are **not replicable from the available artifacts**.
This is a source-availability verdict, not a claim that their disclosed methods are
irrelevant to Chronicle.

| Paper | What is actually verified | Original-data/result verdict and indispensable missing material |
|---|---|---|
| Schoedel et al., *Keep on scrolling?* (`10.1016/j.chb.2023.107977`) | The released aggregate-data/model branch has 68 source-bound offline R execution receipts; these internal campaign cells are not individually selectable or rerunnable from Chronicle's current GUI. The screen-preprocessing component and a source-shaped raw-input route have tests. | **Not replicable from raw events** for all four source feature-extraction configurations. The authors' released R wrappers state that the raw time-stamped PhoneStudy sensing data are private; the PhoneStudy, ESM, call/SMS, and participant-level inputs are absent. The 68 released-data analyses do not establish raw-event replication. |
| Gouin-Vallerand et al., *Transitions between Mobile Application Usages* (`10.1145/2638728.2641700`) | The ranked-snapshot component requires a caller-assigned device `entity_id`; it groups even colliding snapshot IDs separately by device, drops consecutive exact rank-and-component list repeats per device, and emits retained snapshots in descending source-rank order. A source-shaped oracle and public-runner tests cover unchanged, changed, returned, and cross-device identical lists. The relationship-matrix component passes synthetic tests only under an explicitly supplied matrix policy. | **Not replicable** for all six audited source execution units. The exact 30-device Device Analyzer subset and selection manifest, unpublished Java analyzer and its forward-looking launch reconstruction, clock-reference join, matrix policy, and statistical definitions are absent or underdetermined. Rank reversal and exact-repeat removal do not infer launches or reproduce the paper's transition series. |
| Harbach et al., *The Anatomy of Smartphone Unlocking* (`10.1145/2858036.2858267`) | The normalized-input keyguard component passes synthetic tests for full screen-on/off session duration, preparation time, source-described session groups (first-try success, success after an error, aborted attempt, code unnecessary, slide unlock, and no unlock), three distinct dismissal causes, ordered code attempts with durations and `f/t/s` sequence, and an expected 30-second lockout after the fifth wrong entry (too-short entries excluded). Its receipt counts error sequences and critical errors by lock type, including distinct affected participants. It distinguishes an abort after a wrong code (the paper's possible-access-prevention upper bound) from an abort after only a too-short entry; this is not a finding of unauthorized access. It also distinguishes no-unlock from sleep and refuses equal-timestamp events without a published order rule. | **Not replicable** for all ten audited research-question configurations. The 2015 PhoneLab participant event/survey files, modified-AOSP logger schema/source, source write order, full survey instrument, and several cohort/statistical boundary rules are unavailable. The inferred lockout end is not a witnessed PhoneLab event; these fixture checks do not prove raw decoding or the paper's results. |

The source-located, per-configuration verdicts and artifact sweeps are in
`.tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits/`:
`doi-10.1016-j.chb.2023.107977.json`,
`doi-10.1145-2638728.2641700.json`, and
`doi-10.1145-2858036.2858267.json`.
The CHB raw-data statement is also in
`.tmp-literature-review-private/corrective-packet-08-ranks277-329-20260831/work/rank287-archive/SmartphoneUsage_Wellbeing/scripts/featureExtraction/01_SOURCE_featureExtraction_DatasetA.R:4`.
The 93-profile execution spec still records zero fully reproduced configurations.
Individual executable-setting counts are not whole-paper scores; do not promote any of these
three paper profiles on the basis of synthetic fixtures alone.
The existing Android profile execution manifest now gives a source-located
not-replicable reason for each of these three full-paper selections; its
`compiler`/`missing_fixture` codes remain the validator's readiness categories,
not claims that private data can be recovered by adding a fixture.
The Research Method Profile card displays those reasons from the generated
runtime registry for a loaded profile with the exact registered identity; it
does not label a component fixture as a reproduced paper.
Harbach's new attempt duration is KeyEntryBegin-to-outcome; it does not
silently stand in for the paper's further-attempt/recovery-time statistic.
Its error and lockout counts describe the supplied normalized fixture rows;
the source cohort exclusions and published denominators are not applied.

Verification at this boundary: the 361-case input-adapter conformance test,
all four three-paper Rust component/source test targets, 147 focused web tests,
web typecheck, the 93-profile execution-spec validator, and generated
runtime-registry checks pass. None uses the unavailable original
participant-level event files.
