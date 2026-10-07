#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");
const ledgerPath = resolve(corpusDir, "corpus-record-ledger.jsonl");

const records = readFileSync(ledgerPath, "utf8")
  .trim()
  .split("\n")
  .map(line => JSON.parse(line));
const discoveryDois = ["review-discovery-ledger.tsv", "primary-expansion-ledger.tsv"].flatMap(file => {
  const lines = readFileSync(resolve(corpusDir, file), "utf8").trim().split("\n");
  const headers = lines[0].split("\t");
  const stableIndex = headers.indexOf("stable_id");
  return lines.slice(1).map(line => line.split("\t")[stableIndex]?.toLowerCase()).filter(value => /^10\.\d{4,9}\//.test(value));
});
const reviewReferenceDois = readFileSync(resolve(corpusDir, "review-reference-union.jsonl"), "utf8")
  .trim().split("\n").filter(Boolean).map(JSON.parse).map(row => row.doi).filter(Boolean);
const dois = [...new Set([
  ...records.map(record => record.primary_doi_candidate).filter(Boolean),
  ...discoveryDois,
  ...reviewReferenceDois,
])].sort();

const batchSize = 40;
const metadata = [];
const failures = [];

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function fetchBatch(batch, attempt = 1) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", `doi:${batch.map(doi => `https://doi.org/${doi}`).join("|")}`);
  url.searchParams.set("per-page", "100");
  url.searchParams.set(
    "select",
    "id,doi,title,display_name,publication_year,publication_date,type,type_crossref,authorships,primary_location,open_access,best_oa_location,locations,cited_by_count,referenced_works_count,is_retracted,is_paratext",
  );
  const response = await fetch(url, { headers: { "User-Agent": "chronicle-literature-review/1.0" } });
  if (!response.ok) {
    if (attempt === 1 && (response.status === 429 || response.status >= 500)) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1500));
      return fetchBatch(batch, 2);
    }
    throw new Error(`OpenAlex ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

for (const batch of chunks(dois, batchSize)) {
  try {
    const result = await fetchBatch(batch);
    metadata.push(...result.results);
    const returned = new Set(result.results.map(work => work.doi?.replace(/^https:\/\/doi\.org\//, "").toLowerCase()));
    for (const doi of batch) if (!returned.has(doi)) failures.push({ doi, reason: "not_returned_by_openalex" });
  } catch (error) {
    for (const doi of batch) failures.push({ doi, reason: String(error) });
  }
}

metadata.sort((left, right) => (left.doi ?? "").localeCompare(right.doi ?? ""));
writeFileSync(resolve(corpusDir, "corpus-openalex-metadata.jsonl"), `${metadata.map(work => JSON.stringify(work)).join("\n")}\n`);
writeFileSync(
  resolve(corpusDir, "corpus-openalex-metadata-summary.json"),
  `${JSON.stringify({
    generated_at: new Date().toISOString(),
    requested_unique_dois: dois.length,
    matched_works: metadata.length,
    unmatched_or_failed: failures.length,
    failures,
    caution: "OpenAlex metadata and OA locations are discovery evidence. They do not prove that a full text was retrieved or read.",
  }, null, 2)}\n`,
);

process.stdout.write(`requested=${dois.length} matched=${metadata.length} unmatched_or_failed=${failures.length}\n`);
