#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");
const evidenceDir = resolve(repoRoot, "web/.tmp/literature-review/europe-pmc");
mkdirSync(evidenceDir, { recursive: true });

function readJsonl(file) {
  return readFileSync(resolve(corpusDir, file), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

const alreadyRetrieved = new Set(
  readJsonl("corpus-fulltext-retrieval-manifest.jsonl")
    .filter(row => ["cached", "retrieved_and_extracted"].includes(row.status) && row.doi)
    .map(row => row.doi.toLowerCase()),
);
const reviewLines = readFileSync(resolve(corpusDir, "review-discovery-ledger.tsv"), "utf8").trim().split("\n");
const reviewHeaders = reviewLines.shift().split("\t");
const stableIdIndex = reviewHeaders.indexOf("stable_id");
const queue = [...new Set(
  reviewLines
    .map(line => line.split("\t")[stableIdIndex]?.toLowerCase())
    .filter(stableId => /^10\.\d{4,9}\//.test(stableId) && !alreadyRetrieved.has(stableId)),
)];
const manifest = [];

function keyFor(doi) {
  return createHash("sha256").update(doi).digest("hex").slice(0, 20);
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { "User-Agent": "ChronicleLiteratureReview/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 1) await new Promise(resolveDelay => setTimeout(resolveDelay, 600));
    }
  }
  throw lastError;
}

async function retrieve(doi) {
  const key = keyFor(doi);
  const xmlPath = resolve(evidenceDir, `${key}.xml`);
  const textPath = resolve(evidenceDir, `${key}.txt`);
  const base = {
    key,
    doi,
    xml_path: `web/.tmp/literature-review/europe-pmc/${key}.xml`,
    text_path: `web/.tmp/literature-review/europe-pmc/${key}.txt`,
  };
  if (existsSync(xmlPath) && existsSync(textPath) && statSync(textPath).size > 1024) {
    return { ...base, status: "cached", xml_bytes: statSync(xmlPath).size, text_bytes: statSync(textPath).size };
  }
  try {
    const searchUrl = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    searchUrl.searchParams.set("query", `DOI:\"${doi}\"`);
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("pageSize", "5");
    const search = await (await fetchWithRetry(searchUrl)).json();
    const match = (search.resultList?.result ?? []).find(result => result.doi?.toLowerCase() === doi.toLowerCase() && result.pmcid);
    if (!match) return { ...base, status: "no_pmc_fulltext_record" };
    const xmlUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${match.pmcid}/fullTextXML`;
    const xml = await (await fetchWithRetry(xmlUrl)).text();
    if (!/<article[\s>]/.test(xml)) return { ...base, status: "pmc_record_without_article_xml", pmcid: match.pmcid };
    writeFileSync(xmlPath, xml);
    const extraction = spawnSync("xmllint", ["--xpath", "string(//article)", xmlPath], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
    if (extraction.status !== 0 || extraction.stdout.length < 1024) {
      return { ...base, status: "xml_retrieved_text_extraction_failed", pmcid: match.pmcid, error: extraction.stderr?.trim() };
    }
    writeFileSync(textPath, extraction.stdout);
    return {
      ...base,
      status: "retrieved_and_extracted",
      pmcid: match.pmcid,
      xml_bytes: Buffer.byteLength(xml),
      text_bytes: Buffer.byteLength(extraction.stdout),
      xml_sha256: createHash("sha256").update(xml).digest("hex"),
    };
  } catch (error) {
    return { ...base, status: "retrieval_failed", error: String(error) };
  }
}

async function worker() {
  while (queue.length > 0) manifest.push(await retrieve(queue.shift()));
}

await Promise.all(Array.from({ length: 4 }, () => worker()));
manifest.sort((left, right) => left.doi.localeCompare(right.doi));
writeFileSync(resolve(corpusDir, "corpus-europe-pmc-retrieval-manifest.jsonl"), `${manifest.map(row => JSON.stringify(row)).join("\n")}\n`);
const counts = Object.fromEntries(Object.entries(Object.groupBy(manifest, row => row.status)).map(([status, rows]) => [status, rows.length]));
writeFileSync(resolve(corpusDir, "corpus-europe-pmc-retrieval-summary.json"), `${JSON.stringify({ generated_at: new Date().toISOString(), attempted: manifest.length, status_counts: counts }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ attempted: manifest.length, status_counts: counts })}\n`);
