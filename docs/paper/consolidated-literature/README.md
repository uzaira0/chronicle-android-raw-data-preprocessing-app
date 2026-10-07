# Consolidated literature review

This folder is the authoritative entry point for the paper-discovery work. The detailed six-field evidence records remain in the slice ledgers because they preserve quotations, access routes, thresholds, and negative-search notes without flattening them into a bibliography.

## Authoritative files

- [`report-source.md`](./report-source.md) — canonical full-text method audit. It defines the no-skipped-fields extraction contract, records what was actually read, and separates reported rules from absent, unresolved, and inaccessible details.
- [`review-fulltext-audits.md`](./review-fulltext-audits.md) — review-first audit of meta-analyses, systematic/scoping reviews, methodological reviews, and taxonomies, including searches, flow arithmetic, extraction, appraisal, supplements, contradictions, and upstream-construction relevance.
- [`review-of-reviews-synthesis.md`](./review-of-reviews-synthesis.md) — living synthesis of what the review literature actually covers, which reviews audit preprocessing, recurrent reporting defects, and the unresolved event-construction fields.
- [`review-discovery-ledger.tsv`](./review-discovery-ledger.tsv) — seeded review-level corpus with stable identifiers, claimed study counts, access state, and unresolved reporting problems.
- [`review-audit-status.jsonl`](./review-audit-status.jsonl) — one status record per seeded review, separating fully read, artifact-gap, partial-access, retrieved-not-read, and not-retrieved states.
- [`review-reference-harvest.jsonl`](./review-reference-harvest.jsonl) — every reference harvested from locally available review XML; these are discovery records, not automatically included studies.
- [`review-reference-union.jsonl`](./review-reference-union.jsonl) — provisional cross-review citation deduplication with separately evidenced included-study status; see [`review-reference-union-summary.json`](./review-reference-union-summary.json) for counts and limitations.
- [`canonical-paper-ledger.jsonl`](./canonical-paper-ledger.jsonl) — live one-row-per-work reconciliation across the six slices, review corpus, direct expansion, and explicitly review-included primary candidates, with retention and audit states kept separate; see [`canonical-paper-ledger-summary.json`](./canonical-paper-ledger-summary.json).
- [`non-open-access-review-queue.tsv`](./non-open-access-review-queue.tsv) — explicit institutional-library retrieval queue. Open access is not an eligibility rule, and abstracts never count as full-text audits.
- [`master-review.md`](./master-review.md) — cross-slice synthesis, corpus counts, strongest and newest work, direct-method disclosure map, coverage gaps, and paper-level implications.
- [`deduplication-register.md`](./deduplication-register.md) — DOI/title/stable-key normalization rules, cross-slice duplicate clusters, and canonical-home decisions.
- [`chatgpt-pro-deep-research-2026-08-06.md`](./chatgpt-pro-deep-research-2026-08-06.md) — primary-source reconciliation of the independent Pro deep-research return: 17 accepted canonical records, five scope rejections, and identifier/source corrections.
- [`chatgpt-pro-fresh-discovery-reconciliation-2026-08-06.md`](./chatgpt-pro-fresh-discovery-reconciliation-2026-08-06.md) — independent reconciliation of the second Pro discovery pass: 31 direct additions, one adjacent-only correction, method-disclosure tiers, and the resulting novelty amendment.
- [`fresh_mobile_event_literature_run_f093cc3b.md`](./fresh_mobile_event_literature_run_f093cc3b.md) — unmodified narrative return for run `[codex-pro-run:f093cc3b-123a-43b4-ba30-476adc363f8e]`.
- [`fresh_mobile_event_import_table_f093cc3b.csv`](./fresh_mobile_event_import_table_f093cc3b.csv) — 32-row provisional import table from that run; use the reconciliation file for final dispositions.
- [`fresh_mobile_event_audit_f093cc3b.csv`](./fresh_mobile_event_audit_f093cc3b.csv) — all 84 screened candidates, including duplicate/off-scope/unresolved decisions.
- [`fresh_mobile_event_run_summary_f093cc3b.txt`](./fresh_mobile_event_run_summary_f093cc3b.txt) — compact raw screening totals.
- [`../search-briefs/results-slice-A.md`](../search-briefs/results-slice-A.md) — Android raw events, direct instrumentation, collectors, and executable builders.
- [`../search-briefs/results-slice-B.md`](../search-briefs/results-slice-B.md) — iOS artifacts/APIs and native Screen Time/data-donation measurement.
- [`../search-briefs/results-slice-C.md`](../search-briefs/results-slice-C.md) — adjacent event/session formalisms. This is transfer evidence, not part of the direct mobile core.
- [`../search-briefs/results-slice-D.md`](../search-briefs/results-slice-D.md) — preprocessing multiverses, measurement theory, reliability, and vendor validity.
- [`../search-briefs/results-slice-E.md`](../search-briefs/results-slice-E.md) — ontologies, executable cohort/event semantics, temporal models, and provenance.
- [`../search-briefs/results-slice-F.md`](../search-briefs/results-slice-F.md) — self-report/log discrepancy and processing-attribution evidence.

The older [`../literature-dossier.md`](../literature-dossier.md) remains a useful deep reading of the first 54 DOI-verified works, and [`../citation-chase/`](../citation-chase/) remains the backward/forward chase for the Winklbauer–Batinic network. Neither is the corpus index after the six-slice expansion.

## Scope rule

The direct core includes work that collects, derives, validates, formalizes, or compares mobile/device-use measures. Slice C is retained only when it supplies a transferable event-grouping formalism or a useful counterexample. Generic web analytics and clickstream work are not treated as direct evidence merely because they use the word “session.”

## Counting rule

Slice totals count each retained ledger record once inside its source slice. Corpus-wide totals are not obtained by adding headings or subtracting every repeated DOI mention: the files contain supplements, code/data DOIs, cross-references, corrections, and earlier superseded write-ups. The deduplication register therefore distinguishes a canonical work from related artifacts and from a mere cross-slice pointer.
