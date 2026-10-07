#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");

const normalize = value => value?.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim() ?? "";
const digest = value => createHash("sha256").update(value).digest("hex").slice(0, 20);

const includedIndexRules = {
  R006: index => (index >= 1 && index <= 3) || (index >= 6 && index <= 120),
  R013: index => index >= 21 && index <= 67,
  R015: index => (index >= 38 && index <= 59) || (index >= 63 && index <= 73) ||
    (index >= 75 && index <= 92) || (index >= 98 && index <= 104) || (index >= 106 && index <= 114),
  R018: index => index >= 26 && index <= 61,
  R020: index => index >= 13 && index <= 62,
};

const harvestedRows = readFileSync(resolve(corpusDir, "review-reference-harvest.jsonl"), "utf8")
  .trim().split("\n").filter(Boolean).map(JSON.parse);
const explicitIncludedRows = [
  "review-r013-included-primary-citations.tsv",
  "review-r031-r038-included-primary-citations.tsv",
].flatMap(file => {
  const explicitLines = readFileSync(resolve(corpusDir, file), "utf8").trim().split("\n");
  const explicitHeaders = explicitLines.shift().split("\t");
  return explicitLines.map((line, index) => {
  const values = line.split("\t");
  const item = Object.fromEntries(explicitHeaders.map((header, fieldIndex) => [header, values[fieldIndex] ?? ""]));
  const doi = (item.doi || item.citation.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0] || "")
    .toLowerCase().replace(/[.,;:)'\"]+$/g, "") || null;
  return {
    review_id: item.review_id,
    review_doi: null,
    review_title: null,
    reference_index: null,
    reference_xml_id: item.locator,
    title: null,
    year: item.citation.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? null,
    authors: [],
    source: null,
    doi,
    pmid: null,
    full_citation: item.citation,
    title_parse_method: "not_parsed_from_explicit_included_table",
    screening_state: "explicit_review_included_primary",
    explicit_included_provenance: item.provenance,
    explicit_source_file: file,
    explicit_row_number: index + 2,
  };
  });
});

const rows = [...harvestedRows, ...explicitIncludedRows].map(row => {
    const included = row.screening_state === "explicit_review_included_primary" || (includedIndexRules[row.review_id]?.(row.reference_index) ?? false);
    const identityBasis = row.doi ? `doi:${row.doi}` : row.pmid ? `pmid:${row.pmid}` :
      row.title ? `title:${normalize(row.title)}` : `citation:${normalize(row.full_citation)}`;
    return {
      ...row,
      canonical_candidate_key: identityBasis.startsWith("doi:") || identityBasis.startsWith("pmid:")
        ? identityBasis : `${identityBasis.split(":", 1)[0]}:${digest(identityBasis)}`,
      included_study_evidence: included ? (row.screening_state === "explicit_review_included_primary" ? "included_by_explicit_review_table" : "included_by_review_reference_index") : "not_yet_classified",
    };
  });

const groups = Object.values(Object.groupBy(rows, row => row.canonical_candidate_key)).map(group => ({
  canonical_candidate_key: group[0].canonical_candidate_key,
  doi: group.find(row => row.doi)?.doi ?? null,
  pmid: group.find(row => row.pmid)?.pmid ?? null,
  title: group.find(row => row.title)?.title ?? null,
  year: group.find(row => row.year)?.year ?? null,
  citation_variant_count: new Set(group.map(row => normalize(row.full_citation))).size,
  citing_review_count: new Set(group.map(row => row.review_id)).size,
  citing_reviews: [...new Set(group.map(row => row.review_id))].sort(),
  included_by_reviews: [...new Set(group.filter(row => row.included_study_evidence.startsWith("included_by_")).map(row => row.review_id))].sort(),
  status: group.some(row => row.included_study_evidence.startsWith("included_by_"))
    ? "review_included_primary_candidate" : "reference_discovery_not_yet_screened",
  representative_citation: group[0].full_citation,
})).sort((a, b) => a.canonical_candidate_key.localeCompare(b.canonical_candidate_key));

const summary = {
  generated_at: new Date().toISOString(),
  harvested_reference_rows: harvestedRows.length,
  explicit_included_table_rows: explicitIncludedRows.length,
  combined_evidence_rows: rows.length,
  provisional_deduplicated_reference_groups: groups.length,
  groups_with_doi: groups.filter(group => group.doi).length,
  review_included_primary_candidates: groups.filter(group => group.status === "review_included_primary_candidate").length,
  unscreened_reference_discovery_groups: groups.filter(group => group.status === "reference_discovery_not_yet_screened").length,
  reference_index_evidence_rules: Object.keys(includedIndexRules),
  explicit_included_table_reviews: [...new Set(explicitIncludedRows.map(row => row.review_id))].sort(),
  warning: "Deduplication is exact DOI/PMID, then normalized parsed title, then normalized full citation. Non-DOI groups remain provisional. Only explicitly mapped reference-index ranges are marked as review-included candidates.",
};

writeFileSync(resolve(corpusDir, "review-reference-evidence.jsonl"), `${rows.map(row => JSON.stringify(row)).join("\n")}\n`);
writeFileSync(resolve(corpusDir, "review-reference-union.jsonl"), `${groups.map(group => JSON.stringify(group)).join("\n")}\n`);
writeFileSync(resolve(corpusDir, "review-reference-union-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
