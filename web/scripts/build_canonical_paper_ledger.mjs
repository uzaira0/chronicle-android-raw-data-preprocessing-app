#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");
const readJsonl = file => readFileSync(resolve(corpusDir, file), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const works = readJsonl("corpus-candidate-union.jsonl");
const reviewAudit = new Map(readJsonl("review-audit-status.jsonl").map(row => [row.review_id, row]));

const ledger = works.map(work => {
  const kinds = new Set(work.source_appearances.map(appearance => appearance.source_kind));
  const sliceAppearances = work.source_appearances.filter(appearance => appearance.source_kind.startsWith("slice_"));
  const reviewAppearances = work.source_appearances.filter(appearance => appearance.source_kind === "review_discovery");
  const directExpansion = work.source_appearances.filter(appearance => appearance.source_kind === "primary_expansion");
  const includedEvidence = work.source_appearances.filter(appearance => appearance.source_kind === "review_included_primary");
  const retentionState = sliceAppearances.length > 0
    ? "retained_existing_six_slice_corpus"
    : reviewAppearances.length > 0
      ? "retained_review_level_work"
      : directExpansion.length > 0
        ? "provisional_direct_primary_candidate"
        : "provisional_review_included_primary_candidate";
  const attachedReviewAudits = reviewAppearances.map(appearance => reviewAudit.get(appearance.source_id)).filter(Boolean);
  return {
    canonical_work_key: work.provisional_work_key,
    title: work.canonical_title_candidate,
    doi: work.doi,
    publication_year: work.publication_year,
    retention_state: retentionState,
    source_roles: [...kinds].sort(),
    source_record_ids: work.source_appearances.map(appearance => appearance.source_id),
    review_inclusion_evidence: includedEvidence.map(appearance => appearance.source_fields),
    fulltext_retrieval_status: work.fulltext_retrieval_status,
    extracted_text_path: work.extracted_text_path,
    main_text_audit_status: attachedReviewAudits.length
      ? attachedReviewAudits.map(audit => ({ review_id: audit.review_id, audit_state: audit.audit_state, main_text_status: audit.main_text_status }))
      : work.audit_state,
    references_audit_status: attachedReviewAudits.length
      ? attachedReviewAudits.map(audit => ({ review_id: audit.review_id, checked: audit.references_checked }))
      : "not_yet_checked_in_canonical_pass",
    supplement_audit_status: attachedReviewAudits.length
      ? attachedReviewAudits.map(audit => ({ review_id: audit.review_id, linked_artifacts_checked: audit.linked_artifacts_checked, artifact_gap: audit.artifact_gap }))
      : "not_yet_checked_in_canonical_pass",
    code_audit_status: attachedReviewAudits.length ? "see_review_narrative_audit" : "not_yet_checked_in_canonical_pass",
    data_audit_status: attachedReviewAudits.length ? "see_review_narrative_audit" : "not_yet_checked_in_canonical_pass",
    canonical_dedup_status: "exact_identifier_or_normalized_title_group; manual version aliases applied",
  };
});

const counts = Object.fromEntries(Object.entries(Object.groupBy(ledger, row => row.retention_state)).map(([state, rows]) => [state, rows.length]));
const summary = {
  generated_at: new Date().toISOString(),
  canonical_and_provisional_work_rows: ledger.length,
  retention_state_counts: counts,
  retained_work_rows_now: ledger.filter(row => row.retention_state.startsWith("retained_")).length,
  provisional_candidate_rows: ledger.filter(row => row.retention_state.startsWith("provisional_")).length,
  fulltext_retrieved_rows: ledger.filter(row => row.extracted_text_path).length,
  manual_version_aliases_applied: { "10.48550/arxiv.1910.03970": "10.1038/s41746-021-00514-4" },
  warning: "This is the live canonicalization ledger, not the final corpus. Provisional review-included and direct-expansion candidates require scope screening; missing audit fields remain explicit rather than inferred.",
};

writeFileSync(resolve(corpusDir, "canonical-paper-ledger.jsonl"), `${ledger.map(row => JSON.stringify(row)).join("\n")}\n`);
writeFileSync(resolve(corpusDir, "canonical-paper-ledger-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
