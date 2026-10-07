# Review of reviews: objective smartphone-use measurement and upstream construction

**Status:** living synthesis; the final review corpus and primary-paper screening are not complete.

## Denominators that may be reported now

The seeded review ledger has 52 source/version records representing **51 canonical review works**.
R023 (arXiv `1910.03970`) and R032 (`10.1038/s41746-021-00514-4`) are the same 108-study review;
the published DOI is canonical and the preprint remains an access/version route. Usable main text has
been recovered for 46/52 records. At the current checkpoint, 33 records are audited through references
and every linked artifact, two have complete main-text audits with a specifically named unavailable
artifact, three are partial because the publication itself remains inaccessible, 11 have retrieved
full text awaiting audit, and three have no retrieved main text. The authoritative row-level state is
[`review-audit-status.jsonl`](./review-audit-status.jsonl).

Review bibliographies cannot be added together as if they were independent studies. The 25 XML-backed
reviews contain 2,833 reference rows, including background and methods citations. After DOI/PMID/title/
citation normalization plus six explicit included-study tables and five defensible reference-index
mappings, the current evidence graph contains 453 provisional included-primary work groups. These
remain candidates until their topical scope and source text are checked. Counts in a review's PRISMA
diagram describe that review's own eligibility decision; they do not prove relevance to app/screen-event
construction and do not create a corpus-wide unique-paper denominator.

## What the review literature actually measures

The review corpus separates into five materially different families:

1. **Objective screen/app-use measurement reviews.** Pérez, Browne, Byrne, Harris, Beynon,
   Cendrero-Luengo, the 2026 Screen Use Measurement Tools map, Ryding and Kuss, and Parry examine
   instruments, accuracy, or construct validity. Several are dominated by questionnaires. Byrne finds
   zero device-based measures in 622 early-childhood studies; Harris retains 78 scales and zero objective
   logs; Paudel's 13 studies are all parental self-report. These are prevalence/measurement-boundary
   findings, not event-processing evidence.
2. **Passive smartphone/digital-phenotyping reviews.** Cornet, Trifan, D'Llima, Dumas, Lee, Choi,
   Zhang, Beames, Bidargaddi, Shen, Stuijt, Leaning, and related mental-health reviews expose phone
   platforms, sensors, features, sampling, missingness, and analysis. Their primary corpora are the most
   productive discovery route for upstream processing.
3. **Technical acquisition/preprocessing reviews.** The Straczkiewicz HAR review, Finnegan behavioral
   biometrics review, Abuhamad authentication survey, sensor-quality review, Android API survey, and
   crowdsensing chapter address preprocessing directly but often for accelerometers, authentication,
   stationary sensors, or generic crowdsensing rather than app/screen events. They are transfer evidence,
   not automatically direct mobile-use evidence.
4. **Narrative surveys and conceptual critiques.** Kaye, Melcher, and Abuhamad lack reproducible
   systematic-review denominators. They remain valuable for concepts and terminology but must not be
   counted as bounded evidence censuses.
5. **Reviews intentionally outside objective logging.** Fischer and Kleen explicitly exclude automated
   passive phone-use/GPS collection. Such records document a scope boundary and contribute zero included
   objective-log candidates.

## Strongest review-level evidence about preprocessing disclosure

### Beames et al. (35 studies)

Beames et al. supplies the strongest direct reporting audit found so far. Its QA-DPSS instrument checks
sampling/collection, replicable indicator definition and processing, missing/valid data, robustness,
dropout, selective reporting, and storage/privacy. Appendix D maps exact schedules and feature definitions
for location, accelerometer, gyroscope, steps, calls/SMS, microphone, light, screen/lock, Bluetooth, and
apps while explicitly recording `NR`. Thirty of 35 studies were high risk and five moderate; none low.
The review nevertheless used one title/abstract screener, and some table cells inherit phone specifications
from a dataset's primary paper rather than the cited analysis.

### Shen et al. (42 studies)

Shen et al. independently extracts filtering/denoising and parameters, missing-data handling, imbalance,
sensor-specific processing, feature windows/length/overlap, time/frequency features, selection, ML, and
validation. Its definitions of app use (activation, duration, frequency, app-open intervals, screen-on time
during use) and screen events (on/off/lock/unlock counts and durations) are output definitions, not raw-event
algorithms. It does not recover Android/iOS schemas, same-timestamp priority, duplicate-event policy, or
event-to-session construction.

### Zhang et al. (47 studies)

Zhang et al. reports coarse operational details often absent elsewhere: 22/47 use remote-server storage,
three local storage, six impose data thresholds (two greater than 14 hours/day and four at least 19), and
only one reports completeness (85.3%). It catalogs fixed and dynamic sampling. It has no formal quality
assessment and does not reconstruct ordering, pairing, or boundary rules.

### Dumas et al. (65 studies)

Dumas et al. quantifies reporting absence: only 6/65 report stream missingness, 4/65 sampling rate or duty
cycle, 22/65 operating system, and 7/65 compliance/attrition. Its approximately 3,700 manually saved records
were reduced to 111 formal records without an itemized trail, and its PRISMA figure begins at 111. It does
not evaluate behavior-extraction algorithms.

### Bidargaddi et al. (50 studies)

Bidargaddi et al. reports mean sampling intervals of 81 seconds for activity, 86 for sleep, 486 for
location, and 143 for within-phone interaction. It does not extract deduplication, ordering, sessionization,
or feature-construction rules. Its seven-day minimum conflicts with included three- and four-day studies,
and the detailed-search appendix named in the paper is missing/misnumbered.

### Finnegan et al. (122 studies)

Finnegan et al.'s released study and quality matrices show only 35/122 behavioral-biometric studies clearly
describe data handling and only 7/122 have replicable methods. Full-text screening and quality scoring were
single-reviewer stages. The review's signal-processing focus is relevant upstream but its authentication/
demographic task differs from app/screen-use episode construction.

## The central unresolved construction problem

No audited review has systematically extracted all of the following for objective app/screen logs:

- source API and raw event vocabulary;
- timestamp clock, resolution, timezone, and correction policy;
- distinction between exact duplicate records and distinct events sharing a timestamp;
- deterministic priority for distinct same-instant events;
- foreground/background, screen/lock/unlock, and app-transition pairing;
- orphan-event and missing-counterpart handling;
- observation-window and day-boundary censoring;
- session/episode gap thresholds and justification;
- simultaneous/multiwindow attribution;
- aggregation denominator and treatment of unobserved time;
- software version, executable code, and released intermediate data.

Some reviews assess sampling, missingness, feature windows, or data handling, but none supplies this complete
event-construction audit. Therefore a review's use of labels such as “screen time,” “app duration,” “unlock,”
or “session” cannot be treated as evidence that the underlying quantity is reproducible.

## Review-method defects that affect the evidence base

The full-text audits have identified recurrent, source-specific defects rather than assigning generic
“poor reporting” labels:

- Trifan alternates between 118 and 119 studies, while its stated flow yields 114.
- Ryding and Kuss claim 18, but exclusion arithmetic does not reproduce that total.
- Pérez's search totals differ by 16 records from the screened count.
- Dumas's prior-review counts conflict between caption, prose, and table.
- Shen leaves 1,400 title/abstract exclusions unexplained, one full-text exclusion unexplained, and reports
  23 versus 24 depression studies.
- The multimodal ML review labels 11,602 as removed duplicates even though arithmetic shows it is the
  post-deduplication screening set; it also refers to nonexistent quality item QC13.
- Oatley's crime-data flow is irreconcilable and its 107 “primary studies” include seven surveys.
- Harris supplies 78 instruments but no retained article denominator or article-level included set.
- Cendrero-Luengo reports 321 candidates in prose versus 329 in the flow figure.
- The crowdsensing chapter remains partial; a companion thesis cannot substitute for the inaccessible
  published chapter.

These errors matter because they prevent exact reconstruction of the review-selected evidence and can
silently propagate incorrect denominators into subsequent reviews.

## Implication for the primary-paper review

The review layer is being used as a discovery graph, not as a substitute for reading primaries. A primary
paper enters the direct construction corpus only after its own full text and accessible supplements/code/
data are checked. Review-level descriptions may identify where to look, but are labeled inherited evidence
until verified against the primary source. Papers using only self-report, generic wearables, stationary
sensors, or inertial HAR remain boundary/transfer evidence unless they disclose a method directly relevant
to app/screen-event construction.
