#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const sourceDir = resolve(repoRoot, "docs/paper/search-briefs");
const outputDir = resolve(repoRoot, "docs/paper/consolidated-literature");

const slices = [
  { name: "A", file: "results-slice-A.md", expected: 123, keep: id => /^\d+$/.test(id) ? Number(id) <= 19 : /^A(?:0?[1-9]|[1-3]\d|40|8[6-9]|9\d|1[0-4]\d)$/.test(id) },
  { name: "B", file: "results-slice-B.md", expected: 95, keep: id => /^\d+$/.test(id) && Number(id) >= 1 && Number(id) <= 95 },
  { name: "C", file: "results-slice-C.md", expected: 66, keep: id => /^\d+$/.test(id) && Number(id) >= 1 && Number(id) <= 66 },
  { name: "D", file: "results-slice-D.md", expected: 105, keep: id => /^D(?:0?[1-9]|[1-9]\d|10[0-5])$/.test(id) },
  { name: "E", file: "results-slice-E.md", expected: 94, keep: id => /^E(?:0?[1-9]|[1-8]\d|9[0-4])$/.test(id) },
  { name: "F", file: "results-slice-F.md", expected: 90, keep: id => /^F(?:0?[1-9]|[1-8]\d|90)$/.test(id) },
];

const headingPattern = /^(#{2,3})\s+([A-F]?\d+)[.\s]*(?:—|-)??\s*(.+)$/gm;
const doiPattern = /10\.\d{4,9}\/[A-Za-z0-9][A-Za-z0-9._;()/:+-]*/gi;
const urlPattern = /https?:\/\/[^\s)>\]]+/gi;

function cleanIdentifier(value) {
  let cleaned = value
    .replace(/[.,;:]+$/, "")
    .replace(/\\+$/, "")
    .toLowerCase();
  while (cleaned.endsWith(")") && (cleaned.match(/\)/g)?.length ?? 0) > (cleaned.match(/\(/g)?.length ?? 0)) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned.replace(/\/full$/, "");
}

function normalizeText(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[`*_“”‘’'".,:;!?()[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractTitle(label) {
  const italics = [...label.matchAll(/\*([^*]{8,})\*/g)];
  if (italics.length > 0) return italics.at(-1)[1].trim();
  const split = label.split(/\s+—\s+|\s+-\s+/);
  return (split.length > 1 ? split.at(-1) : label).trim();
}

function accessClaim(markdown) {
  const accessLine = markdown
    .split("\n")
    .find(line => /^- \*\*(Access|Availability)[^*]*\.\*\*/i.test(line));
  const text = accessLine ?? "";
  if (/inaccessible|could not access|not accessible|blocked/i.test(text)) return "blocked_or_inaccessible_claimed";
  if (/full text|full article|full paper|full source|accepted manuscript|author manuscript/i.test(text)) return "full_text_or_source_claimed";
  if (/abstract/i.test(text)) return "abstract_only_claimed";
  if (/metadata/i.test(text)) return "metadata_only_claimed";
  return "not_explicitly_classified";
}

function reconstructionClaim(markdown) {
  const matches = [...markdown.matchAll(/\b(DECLARED|DELEGATED|ABSENT|UNDETERMINED|N\/A|NOT REPORTED|INACCESSIBLE)\b/gi)];
  return [...new Set(matches.map(match => match[1].toLowerCase().replace("n/a", "not_applicable")))];
}

function parseSlice(slice) {
  const path = resolve(sourceDir, slice.file);
  const markdown = readFileSync(path, "utf8");
  const headings = [...markdown.matchAll(headingPattern)];
  const recordsById = new Map();

  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const id = match[2];
    if ((slice.name === "A" && match[1] !== "###") || !slice.keep(id)) continue;
    const start = match.index;
    const end = headings[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end).trim();
    const label = match[3].trim();
    const title = extractTitle(label);
    const dois = [...new Set((section.match(doiPattern) ?? []).map(cleanIdentifier))];
    const urls = [...new Set((section.match(urlPattern) ?? []).map(url => url.replace(/[.,;:]+$/, "")))];
    const primaryDoi = dois.find(doi => !doi.startsWith("10.5555/")) ?? dois[0] ?? null;
    const titleKey = normalizeText(title);
    const recordKey = primaryDoi ? `doi:${primaryDoi}` : `title:${titleKey}`;

    recordsById.set(id, {
      source_slice: slice.name,
      source_record_id: id,
      source_file: `docs/paper/search-briefs/${slice.file}`,
      source_heading: label,
      title,
      title_key: titleKey,
      provisional_work_key: recordKey,
      primary_doi_candidate: primaryDoi,
      all_doi_mentions: dois,
      urls,
      inherited_access_claim: accessClaim(section),
      inherited_reconstruction_labels: reconstructionClaim(section),
      audit_state: "inherited_record_needs_reverification",
      source_sha256: createHash("sha256").update(section).digest("hex"),
      source_markdown: section,
    });
  }

  const records = [...recordsById.values()];
  if (records.length !== slice.expected) {
    throw new Error(`${slice.name}: expected ${slice.expected} records, parsed ${records.length}`);
  }
  return records;
}

const records = slices.flatMap(parseSlice);
const groups = new Map();
for (const record of records) {
  const group = groups.get(record.provisional_work_key) ?? [];
  group.push(`${record.source_slice}:${record.source_record_id}`);
  groups.set(record.provisional_work_key, group);
}

const summary = {
  generated_at: new Date().toISOString(),
  status: "mechanical_inventory_not_a_completed_full_text_audit",
  source_record_count: records.length,
  expected_source_record_count: slices.reduce((sum, slice) => sum + slice.expected, 0),
  per_slice: Object.fromEntries(slices.map(slice => [slice.name, records.filter(record => record.source_slice === slice.name).length])),
  provisional_work_key_count: groups.size,
  repeated_provisional_work_keys: [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({ key, members })),
  inherited_access_claim_counts: Object.fromEntries(
    Object.entries(Object.groupBy(records, record => record.inherited_access_claim)).map(([key, values]) => [key, values.length]),
  ),
  cautions: [
    "A source record is a retained ledger entry, not necessarily a unique paper.",
    "The first DOI in a record is only a provisional work key because sections can cite ancestors, datasets, or software.",
    "Access and reconstruction labels are inherited claims from the Markdown ledgers and require paper-level re-verification.",
    "The complete original Markdown section is preserved in every JSONL row so no recorded field is discarded.",
  ],
};

writeFileSync(resolve(outputDir, "corpus-record-ledger.jsonl"), `${records.map(record => JSON.stringify(record)).join("\n")}\n`);
writeFileSync(resolve(outputDir, "corpus-record-ledger-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
