#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");

function decodeXml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function firstTag(xml, tag, attributes = "") {
  const match = xml.match(new RegExp(`<${tag}${attributes}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function normalizeDoi(value) {
  return value
    ?.toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/[\s\]\[{}<>]+/g, "")
    .replace(/[.,;:)'\"]+$/g, "") ?? null;
}

function inferTitle(citation) {
  const afterParenthesizedYear = citation.match(/\(\d{4}[a-z]?\)\.\s+(.+?)(?=\.\s+(?:[A-Z][A-Za-z&'’\- ]+[,;]\s*\d|https?:|doi:|arXiv))/i)?.[1];
  if (afterParenthesizedYear?.length >= 8) return afterParenthesizedYear;
  const afterBareYear = citation.match(/\b\d{4}[a-z]?\.\s+(.+?)(?=\.\s+(?:[A-Z][A-Za-z&'’\- ]+[,;]\s*\d|https?:|doi:|arXiv))/i)?.[1];
  return afterBareYear?.length >= 8 ? afterBareYear : null;
}

const reviewLines = readFileSync(resolve(corpusDir, "review-discovery-ledger.tsv"), "utf8").trim().split("\n");
const reviewHeaders = reviewLines.shift().split("\t");
const reviewsByDoi = new Map(reviewLines.map(line => {
  const values = line.split("\t");
  const row = Object.fromEntries(reviewHeaders.map((header, index) => [header, values[index] ?? ""]));
  return [row.stable_id.toLowerCase(), row];
}));

const pmcManifest = readFileSync(resolve(corpusDir, "corpus-europe-pmc-retrieval-manifest.jsonl"), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map(JSON.parse)
  .filter(row => ["cached", "retrieved_and_extracted"].includes(row.status) && reviewsByDoi.has(row.doi.toLowerCase()));

const references = [];
for (const item of pmcManifest) {
  const review = reviewsByDoi.get(item.doi.toLowerCase());
  const xml = readFileSync(resolve(repoRoot, item.xml_path), "utf8");
  const blocks = [...xml.matchAll(/<ref\b([^>]*)>([\s\S]*?)<\/ref>/gi)];
  for (let index = 0; index < blocks.length; index += 1) {
    const attributes = blocks[index][1];
    const body = blocks[index][2];
    const fullCitation = decodeXml(body);
    const id = attributes.match(/\bid=["']([^"']+)/i)?.[1] ?? null;
    const title = firstTag(body, "article-title") ?? firstTag(body, "chapter-title") ?? inferTitle(fullCitation) ?? firstTag(body, "source");
    const doi = normalizeDoi(firstTag(body, "pub-id", "[^>]*pub-id-type=[\"']doi[\"']") ?? fullCitation.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0]);
    const pmid = firstTag(body, "pub-id", "[^>]*pub-id-type=[\"']pmid[\"']") ?? null;
    const surnames = [...body.matchAll(/<surname[^>]*>([\s\S]*?)<\/surname>/gi)].map(match => decodeXml(match[1]));
    references.push({
      review_id: review.id,
      review_doi: item.doi,
      review_title: review.title,
      reference_index: index + 1,
      reference_xml_id: id,
      title,
      year: firstTag(body, "year") ?? fullCitation.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? null,
      authors: surnames,
      source: firstTag(body, "source"),
      doi,
      pmid,
      full_citation: fullCitation,
      title_parse_method: firstTag(body, "article-title") || firstTag(body, "chapter-title") ? "xml_structured" : title ? "citation_heuristic" : "unparsed",
      screening_state: "reference_harvested_not_yet_scope_screened",
    });
  }
}

const perReview = Object.fromEntries(
  Object.entries(Object.groupBy(references, reference => reference.review_id)).map(([reviewId, rows]) => [reviewId, rows.length]),
);
const uniqueDoiCount = new Set(references.map(reference => reference.doi).filter(Boolean)).size;
const normalizedTitleCount = new Set(references.map(reference => reference.title?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean)).size;
const summary = {
  generated_at: new Date().toISOString(),
  reviews_with_pmc_xml: pmcManifest.length,
  harvested_reference_rows: references.length,
  unique_reference_dois: uniqueDoiCount,
  unique_normalized_titles: normalizedTitleCount,
  per_review: perReview,
  warning: "Reference rows include methods, background sources, reviews, and excluded studies. They are discovery records until scope and included-study status are screened against each review.",
};

writeFileSync(resolve(corpusDir, "review-reference-harvest.jsonl"), `${references.map(reference => JSON.stringify(reference)).join("\n")}\n`);
writeFileSync(resolve(corpusDir, "review-reference-harvest-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
