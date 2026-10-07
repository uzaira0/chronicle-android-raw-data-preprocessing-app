#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");
const canonicalDoiAliases = new Map([
  ["10.48550/arxiv.1910.03970", "10.1038/s41746-021-00514-4"],
]);

function readJsonl(file) {
  return readFileSync(resolve(corpusDir, file), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function normalizeTitle(value) {
  return value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function parseTsv(file, sourceKind) {
  const lines = readFileSync(resolve(corpusDir, file), "utf8").trim().split("\n");
  const headers = lines[0].split("\t");
  return lines.slice(1).map(line => {
    const values = line.split("\t");
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const doi = /^10\.\d{4,9}\//i.test(row.stable_id) ? row.stable_id.toLowerCase() : null;
    return {
      source_kind: sourceKind,
      source_id: row.id,
      title: row.title,
      doi,
      stable_id: row.stable_id,
      source_fields: row,
    };
  });
}

const ledgerRecords = readJsonl("corpus-record-ledger.jsonl").map(record => ({
  source_kind: `slice_${record.source_slice}`,
  source_id: record.source_record_id,
  title: record.title,
  doi: record.primary_doi_candidate,
  stable_id: record.primary_doi_candidate,
  source_fields: {
    source_file: record.source_file,
    inherited_access_claim: record.inherited_access_claim,
    inherited_reconstruction_labels: record.inherited_reconstruction_labels,
    source_sha256: record.source_sha256,
  },
}));
const discoveryRecords = [
  ...parseTsv("review-discovery-ledger.tsv", "review_discovery"),
  ...parseTsv("primary-expansion-ledger.tsv", "primary_expansion"),
];
const reviewIncludedRecords = readJsonl("review-reference-union.jsonl")
  .filter(group => group.status === "review_included_primary_candidate")
  .map(group => ({
    source_kind: "review_included_primary",
    source_id: group.canonical_candidate_key,
    title: group.title ?? group.representative_citation,
    doi: group.doi,
    stable_id: group.doi ?? group.canonical_candidate_key,
    source_fields: {
      citing_reviews: group.citing_reviews,
      included_by_reviews: group.included_by_reviews,
      citation_variant_count: group.citation_variant_count,
      evidence_state: group.status,
    },
  }));
const metadata = new Map(readJsonl("corpus-openalex-metadata.jsonl").map(work => [work.doi?.replace(/^https:\/\/doi\.org\//, "").toLowerCase(), work]));
const retrieval = new Map(readJsonl("corpus-fulltext-retrieval-manifest.jsonl").filter(row => row.doi).map(row => [row.doi.toLowerCase(), row]));
const europePmcRetrieval = new Map(readJsonl("corpus-europe-pmc-retrieval-manifest.jsonl").filter(row => row.doi).map(row => [row.doi.toLowerCase(), row]));

const groups = new Map();
for (const record of [...ledgerRecords, ...discoveryRecords, ...reviewIncludedRecords]) {
  const canonicalDoi = record.doi ? canonicalDoiAliases.get(record.doi) ?? record.doi : null;
  const key = canonicalDoi ? `doi:${canonicalDoi}` : `title:${normalizeTitle(record.title)}`;
  const group = groups.get(key) ?? [];
  group.push(record);
  groups.set(key, group);
}

const works = [...groups.entries()].map(([workKey, appearances]) => {
  const doi = workKey.startsWith("doi:") ? workKey.slice(4) : appearances.find(appearance => appearance.doi)?.doi ?? null;
  const workMetadata = doi ? metadata.get(doi) ?? null : null;
  const pdfRetrievalRecord = doi ? retrieval.get(doi) ?? null : null;
  const pmcRetrievalRecord = doi ? europePmcRetrieval.get(doi) ?? null : null;
  const pdfRetrieved = ["cached", "retrieved_and_extracted"].includes(pdfRetrievalRecord?.status);
  const pmcRetrieved = ["cached", "retrieved_and_extracted"].includes(pmcRetrievalRecord?.status);
  const retrievalRecord = pdfRetrieved ? pdfRetrievalRecord : pmcRetrieved ? pmcRetrievalRecord : pdfRetrievalRecord ?? pmcRetrievalRecord;
  const retrievalStatus = pdfRetrieved
    ? `pdf_${pdfRetrievalRecord.status}`
    : pmcRetrieved
      ? `pmc_${pmcRetrievalRecord.status}`
      : retrievalRecord?.status ?? (workMetadata?.open_access?.is_oa ? "oa_location_not_retrieved" : "no_retrieved_full_text");
  return {
    provisional_work_key: workKey,
    canonical_title_candidate: workMetadata?.title ?? appearances.map(appearance => appearance.title).sort((left, right) => right.length - left.length)[0],
    doi,
    publication_year: workMetadata?.publication_year ?? null,
    openalex_id: workMetadata?.id ?? null,
    openalex_type: workMetadata?.type ?? null,
    is_open_access: workMetadata?.open_access?.is_oa ?? null,
    fulltext_retrieval_status: retrievalStatus,
    extracted_text_path: (pdfRetrieved || pmcRetrieved) ? retrievalRecord.text_path : null,
    audit_state: (pdfRetrieved || pmcRetrieved)
      ? "full_text_retrieved_not_yet_reaudited"
      : "candidate_not_fully_audited",
    source_appearances: appearances,
  };
}).sort((left, right) => left.provisional_work_key.localeCompare(right.provisional_work_key));

const statusCounts = Object.fromEntries(
  Object.entries(Object.groupBy(works, work => work.fulltext_retrieval_status)).map(([status, rows]) => [status, rows.length]),
);
const summary = {
  generated_at: new Date().toISOString(),
  input_source_appearances: ledgerRecords.length + discoveryRecords.length + reviewIncludedRecords.length,
  existing_slice_role_records: ledgerRecords.length,
  new_review_candidates: discoveryRecords.filter(record => record.source_kind === "review_discovery").length,
  new_primary_candidates: discoveryRecords.filter(record => record.source_kind === "primary_expansion").length,
  review_included_primary_candidates: reviewIncludedRecords.length,
  provisional_work_groups: works.length,
  doi_keyed_groups: works.filter(work => work.doi).length,
  non_doi_title_keyed_groups: works.filter(work => !work.doi).length,
  manually_confirmed_doi_aliases: Object.fromEntries(canonicalDoiAliases),
  fulltext_status_counts: statusCounts,
  warning: "Work groups are provisional DOI/title clusters, not a completed manual deduplication. Preprint/publication pairs, malformed identifiers, artifacts, standards, and title variants still require reconciliation.",
};

writeFileSync(resolve(corpusDir, "corpus-candidate-union.jsonl"), `${works.map(work => JSON.stringify(work)).join("\n")}\n`);
writeFileSync(resolve(corpusDir, "corpus-candidate-union-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
