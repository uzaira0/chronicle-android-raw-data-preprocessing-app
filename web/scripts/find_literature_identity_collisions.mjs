#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");
const works = readFileSync(resolve(corpusDir, "corpus-candidate-union.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const metadata = new Map(readFileSync(resolve(corpusDir, "corpus-openalex-metadata.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).map(work => [work.doi?.replace(/^https:\/\/doi\.org\//, "").toLowerCase(), work]));
const stop = new Set("a an and are as at be by for from in into is of on or the to using with review systematic scoping study studies".split(" "));

function tokens(value) {
  return new Set(value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(token => token.length > 1 && !stop.has(token)));
}

function jaccard(left, right) {
  const intersection = [...left].filter(token => right.has(token)).length;
  return intersection / (left.size + right.size - intersection);
}

function firstAuthor(work) {
  if (!work.doi) return null;
  return metadata.get(work.doi)?.authorships?.[0]?.author?.display_name?.split(/\s+/).at(-1)?.toLowerCase() ?? null;
}

const indexed = works.map(work => ({ work, titleTokens: tokens(work.canonical_title_candidate), firstAuthor: firstAuthor(work) }));
const candidates = [];
for (let leftIndex = 0; leftIndex < indexed.length; leftIndex += 1) {
  const left = indexed[leftIndex];
  if (left.titleTokens.size < 4) continue;
  for (let rightIndex = leftIndex + 1; rightIndex < indexed.length; rightIndex += 1) {
    const right = indexed[rightIndex];
    if (right.titleTokens.size < 4) continue;
    const similarity = jaccard(left.titleTokens, right.titleTokens);
    if (similarity < 0.82) continue;
    const yearGap = left.work.publication_year && right.work.publication_year ? Math.abs(left.work.publication_year - right.work.publication_year) : null;
    const sameFirstAuthor = Boolean(left.firstAuthor && right.firstAuthor && left.firstAuthor === right.firstAuthor);
    const automaticDisposition = similarity >= 0.96 && (sameFirstAuthor || yearGap === null || yearGap <= 2)
      ? "probable_version_or_duplicate_manual_confirmation_required"
      : "title_similarity_candidate_manual_review_required";
    candidates.push({
      left_work_key: left.work.provisional_work_key,
      right_work_key: right.work.provisional_work_key,
      left_title: left.work.canonical_title_candidate,
      right_title: right.work.canonical_title_candidate,
      left_year: left.work.publication_year,
      right_year: right.work.publication_year,
      left_first_author: left.firstAuthor,
      right_first_author: right.firstAuthor,
      title_token_jaccard: Number(similarity.toFixed(4)),
      same_first_author: sameFirstAuthor,
      year_gap: yearGap,
      disposition: automaticDisposition,
      merge_applied: false,
    });
  }
}

candidates.sort((left, right) => right.title_token_jaccard - left.title_token_jaccard || left.left_work_key.localeCompare(right.left_work_key));
const summary = {
  generated_at: new Date().toISOString(),
  provisional_work_groups_checked: works.length,
  collision_candidates: candidates.length,
  probable_version_or_duplicate_candidates: candidates.filter(candidate => candidate.disposition.startsWith("probable")).length,
  warning: "No merge is applied automatically. Similar titles can represent distinct reports, protocols, corrections, translations, or dataset analyses and require source-level confirmation.",
};
writeFileSync(resolve(corpusDir, "corpus-identity-collision-candidates.jsonl"), `${candidates.map(candidate => JSON.stringify(candidate)).join("\n")}\n`);
writeFileSync(resolve(corpusDir, "corpus-identity-collision-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
