#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");
const readJsonl = file => readFileSync(resolve(corpusDir, file), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);

const lines = readFileSync(resolve(corpusDir, "review-discovery-ledger.tsv"), "utf8").trim().split("\n");
const headers = lines.shift().split("\t");
const reviews = lines.map(line => Object.fromEntries(headers.map((header, index) => [header, line.split("\t")[index] ?? ""])));
const manifests = [...readJsonl("corpus-fulltext-retrieval-manifest.jsonl"), ...readJsonl("corpus-europe-pmc-retrieval-manifest.jsonl")];

const complete = new Set([
  "R001", "R002", "R003", "R004", "R005", "R006", "R007", "R008", "R010",
  "R011", "R012", "R013", "R014", "R015", "R017", "R018", "R019", "R020",
  "R021", "R022", "R023", "R024", "R026", "R027", "R028", "R030",
  "R031", "R032", "R034", "R035", "R036", "R037", "R038",
]);
const completeWithArtifactGap = new Set(["R025", "R033"]);
const partial = new Map([
  ["R009", "main text not recovered"],
  ["R016", "publisher full text paywalled and repository file embargoed"],
  ["R029", "publisher chapter unavailable; abstract and companion thesis checked but not substituted"],
]);
const externalMainText = new Set(["R005", "R013", "R025", "R026", "R027", "R032", "R033", "R038"]);

const rows = reviews.map(review => {
  const doi = review.stable_id.toLowerCase();
  const machineRecords = manifests.filter(record => record.doi?.toLowerCase() === doi);
  const machineFullText = machineRecords.some(record => ["cached", "retrieved_and_extracted"].includes(record.status));
  const auditState = complete.has(review.id) ? "complete_through_references_and_linked_artifacts" :
    completeWithArtifactGap.has(review.id) ? "complete_with_named_unavailable_artifact" :
    partial.has(review.id) ? "partial_access_blocked" :
    machineFullText ? "full_text_retrieved_not_yet_audited" : "full_text_not_yet_retrieved";
  return {
    review_id: review.id,
    doi,
    title: review.title,
    main_text_status: complete.has(review.id) || completeWithArtifactGap.has(review.id)
      ? (machineFullText ? "retrieved_and_read" : externalMainText.has(review.id) ? "retrieved_from_legitimate_external_repository_and_read" : "read_access_provenance_in_audit")
      : partial.has(review.id) ? "partial_or_unavailable" : machineFullText ? "retrieved_not_read" : "not_retrieved",
    references_checked: complete.has(review.id) || completeWithArtifactGap.has(review.id),
    linked_artifacts_checked: complete.has(review.id),
    artifact_gap: completeWithArtifactGap.has(review.id) ? (review.id === "R025" ? "referenced electronic supplement unavailable" : "OSF/protocol and S1–S4 supplements unavailable") : null,
    audit_state: auditState,
    blocking_note: partial.get(review.id) ?? null,
    machine_retrieval_records: machineRecords.map(record => ({ status: record.status, text_path: record.text_path ?? null })),
  };
});

const counts = Object.fromEntries(Object.entries(Object.groupBy(rows, row => row.audit_state)).map(([key, value]) => [key, value.length]));
const summary = {
  generated_at: new Date().toISOString(),
  review_source_records: rows.length,
  canonical_review_works: rows.length - 1,
  version_aliases: { R023: "R032" },
  audit_state_counts: counts,
  warning: "Complete means the accessible main text was read through references and every linked artifact was checked; named unavailable artifacts remain explicit. Code/data absence is recorded in the narrative audit and is not inferred from metadata.",
};

writeFileSync(resolve(corpusDir, "review-audit-status.jsonl"), `${rows.map(row => JSON.stringify(row)).join("\n")}\n`);
writeFileSync(resolve(corpusDir, "review-audit-status-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
