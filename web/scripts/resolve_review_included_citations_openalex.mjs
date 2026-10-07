#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");
const rows = readFileSync(resolve(corpusDir, "review-reference-evidence.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  .filter(row => row.screening_state === "explicit_review_included_primary" && !row.doi);
const stop = new Set("a an and are as at be by for from in into is of on or the to using with".split(" "));
const titleTokens = value => new Set(value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(token => token.length > 1 && !stop.has(token)));
const jaccard = (left, right) => {
  const shared = [...left].filter(token => right.has(token)).length;
  return shared / (left.size + right.size - shared);
};
const inferTitle = citation => citation.match(/\((?:19|20)\d{2}[a-z]?\)\s+(.+?)(?=\.\s+[A-Z][^.]{1,100}(?:\s\d|\s\d+\(|,\s*pp|,\s*vol))/)?.[1]
  ?? citation.replace(/^\d+\.\s*/, "").match(/(?:19|20)\d{2}[a-z]?[).]?\s+(.+?)(?=\.\s+[A-Z][^.]{1,100}(?:\s\d|\s\d+\(|,\s*pp|,\s*vol))/)?.[1]
  ?? citation;
const inferFirstAuthor = citation => citation.replace(/^\d+\.\s*/, "").split(/[ ,]/)[0].toLowerCase().replace(/[^a-z]/g, "");

async function fetchWithRetry(url, attempt = 1) {
  const response = await fetch(url, { headers: { "User-Agent": "chronicle-literature-review/1.0" } });
  if (response.status === 429 && attempt < 4) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, attempt * 1500));
    return fetchWithRetry(url, attempt + 1);
  }
  return response;
}

async function resolveRow(row) {
  const queryTitle = inferTitle(row.full_citation);
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", queryTitle);
  url.searchParams.set("per-page", "5");
  url.searchParams.set("select", "id,doi,title,publication_year,authorships");
  const response = await fetchWithRetry(url);
  if (!response.ok) return { ...row, query_title: queryTitle, resolution_status: `openalex_http_${response.status}`, candidates: [] };
  const result = await response.json();
  const expectedTokens = titleTokens(queryTitle);
  const expectedYear = Number(row.year) || null;
  const expectedAuthor = inferFirstAuthor(row.full_citation);
  const candidates = result.results.map(work => {
    const similarity = jaccard(expectedTokens, titleTokens(work.title));
    const firstAuthor = work.authorships?.[0]?.author?.display_name?.split(/\s+/).at(-1)?.toLowerCase().replace(/[^a-z]/g, "") ?? null;
    const yearGap = expectedYear && work.publication_year ? Math.abs(expectedYear - work.publication_year) : null;
    return {
      openalex_id: work.id,
      doi: work.doi?.replace(/^https:\/\/doi\.org\//, "").toLowerCase() ?? null,
      title: work.title,
      publication_year: work.publication_year,
      title_token_jaccard: Number(similarity.toFixed(4)),
      first_author_match: Boolean(firstAuthor && expectedAuthor && firstAuthor === expectedAuthor),
      year_gap: yearGap,
    };
  }).sort((left, right) => right.title_token_jaccard - left.title_token_jaccard || Number(right.first_author_match) - Number(left.first_author_match));
  const best = candidates[0];
  const accepted = best && best.title_token_jaccard >= 0.8 && (best.year_gap === null || best.year_gap <= 1) && (best.first_author_match || best.title_token_jaccard >= 0.92);
  return {
    review_id: row.review_id,
    locator: row.reference_xml_id,
    original_citation: row.full_citation,
    query_title: queryTitle,
    expected_year: expectedYear,
    expected_first_author: expectedAuthor,
    resolution_status: accepted ? "high_confidence_openalex_match" : best ? "candidate_requires_manual_review" : "no_candidate",
    accepted_doi: accepted ? best.doi : null,
    accepted_openalex_id: accepted ? best.openalex_id : null,
    candidates,
  };
}

const outputPath = resolve(corpusDir, "review-included-citation-openalex-resolution.jsonl");
const previous = existsSync(outputPath) ? readFileSync(outputPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
const previousByKey = new Map(previous.map(row => [`${row.review_id}:${row.locator}`, row]));
const resolved = previous.filter(row => !row.resolution_status.startsWith("openalex_http_"));
const pendingRows = rows.filter(row => {
  const prior = previousByKey.get(`${row.review_id}:${row.reference_xml_id}`);
  return !prior || prior.resolution_status.startsWith("openalex_http_");
});
for (let index = 0; index < pendingRows.length; index += 2) {
  resolved.push(...await Promise.all(pendingRows.slice(index, index + 2).map(resolveRow)));
  await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
}
const summary = {
  generated_at: new Date().toISOString(),
  attempted_explicit_included_citations_without_doi: rows.length,
  status_counts: Object.fromEntries(Object.entries(Object.groupBy(resolved, row => row.resolution_status)).map(([status, items]) => [status, items.length])),
  accepted_doi_count: new Set(resolved.map(row => row.accepted_doi).filter(Boolean)).size,
  warning: "Only high title-similarity matches with compatible year and author evidence are accepted automatically. Other candidates require manual source confirmation.",
};
writeFileSync(outputPath, `${resolved.map(row => JSON.stringify(row)).join("\n")}\n`);
writeFileSync(resolve(corpusDir, "review-included-citation-openalex-resolution-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
