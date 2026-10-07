#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");

const queries = [
  "smartphone screen time measurement systematic review",
  "objective smartphone use systematic review",
  "smartphone passive sensing systematic review",
  "digital phenotyping systematic review preprocessing",
  "mobile sensing scoping review data quality",
  "smartphone app usage measurement review",
  "mobile data donation review screen time",
  "screen media measurement systematic review",
  "smartphone sensing missing data systematic review",
  "smartphone behavioral biometrics survey review",
  "digital trace data measurement systematic review",
  "mobile crowdsensing sensor data systematic review",
  "smartphone usage validation systematic review",
  "digital phenotyping reporting quality review",
  "mobile phone sensor preprocessing review",
];

const existingStableIds = new Set(
  readFileSync(resolve(corpusDir, "review-discovery-ledger.tsv"), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map(line => line.split("\t")[3].toLowerCase()),
);

const works = new Map();
for (const query of queries) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("filter", "type:review");
  url.searchParams.set("per-page", "100");
  url.searchParams.set("select", "id,doi,title,publication_year,type,authorships,primary_location,open_access,best_oa_location,cited_by_count,referenced_works_count,keywords,topics");
  const response = await fetch(url, { headers: { "User-Agent": "ChronicleLiteratureReview/1.0" } });
  if (!response.ok) throw new Error(`${query}: OpenAlex HTTP ${response.status}`);
  const result = await response.json();
  for (const work of result.results) {
    const current = works.get(work.id) ?? { ...work, matched_queries: [] };
    current.matched_queries.push(query);
    works.set(work.id, current);
  }
}

const strongTerms = [
  "smartphone", "mobile phone", "screen time", "screen media", "passive sensing", "digital phenotyping",
  "digital trace", "data donation", "app usage", "application usage", "behavioral biometric", "mobile sensing",
  "crowdsensing", "sensor data", "phone use", "device use",
];
const methodTerms = ["systematic review", "scoping review", "meta-analysis", "review", "survey", "taxonomy", "measurement", "method"];

const candidates = [...works.values()].map(work => {
  const title = work.title.toLowerCase();
  const topicText = (work.topics ?? []).map(topic => topic.display_name?.toLowerCase() ?? "").join(" ");
  const keywordText = (work.keywords ?? []).map(keyword => keyword.display_name?.toLowerCase() ?? "").join(" ");
  const strongHits = strongTerms.filter(term => title.includes(term) || topicText.includes(term) || keywordText.includes(term));
  const methodHits = methodTerms.filter(term => title.includes(term));
  const doi = work.doi?.replace(/^https:\/\/doi\.org\//, "").toLowerCase() ?? null;
  return {
    ...work,
    doi,
    matched_queries: [...new Set(work.matched_queries)],
    relevance: { strong_hits: strongHits, method_hits: methodHits },
    screening_state: strongHits.length > 0 && methodHits.length > 0 ? "title_or_topic_relevant_unscreened" : "low_signal_unscreened",
    already_in_review_seed_ledger: doi ? existingStableIds.has(doi) : false,
  };
}).sort((left, right) => {
  const scoreDifference = (right.relevance.strong_hits.length + right.relevance.method_hits.length) - (left.relevance.strong_hits.length + left.relevance.method_hits.length);
  return scoreDifference || (right.cited_by_count ?? 0) - (left.cited_by_count ?? 0);
});

const relevant = candidates.filter(candidate => candidate.screening_state === "title_or_topic_relevant_unscreened");
writeFileSync(resolve(corpusDir, "review-openalex-discovery-all.jsonl"), `${candidates.map(candidate => JSON.stringify(candidate)).join("\n")}\n`);
writeFileSync(resolve(corpusDir, "review-openalex-discovery-relevant.jsonl"), `${relevant.map(candidate => JSON.stringify(candidate)).join("\n")}\n`);
const summary = {
  generated_at: new Date().toISOString(),
  query_count: queries.length,
  unique_review_results: candidates.length,
  title_or_topic_relevant_unscreened: relevant.length,
  relevant_already_in_seed_ledger: relevant.filter(candidate => candidate.already_in_review_seed_ledger).length,
  relevant_net_new_unscreened: relevant.filter(candidate => !candidate.already_in_review_seed_ledger).length,
  warning: "These are discovery candidates, not retained reviews. Full text, scope, duplicate versions, and reference lists must be screened before inclusion.",
};
writeFileSync(resolve(corpusDir, "review-openalex-discovery-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
