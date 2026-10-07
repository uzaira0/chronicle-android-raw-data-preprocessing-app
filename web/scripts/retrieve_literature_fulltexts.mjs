#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const corpusDir = resolve(repoRoot, "docs/paper/consolidated-literature");
const evidenceDir = resolve(repoRoot, "web/.tmp/literature-review/fulltext");
mkdirSync(evidenceDir, { recursive: true });

const works = readFileSync(resolve(corpusDir, "corpus-openalex-metadata.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map(line => JSON.parse(line))
  .filter(work => work.best_oa_location?.pdf_url || work.locations?.some(location => location.pdf_url));

const concurrency = 4;
const queue = [...works];
const manifest = [];

function workKey(work) {
  return createHash("sha256").update(work.doi ?? work.id).digest("hex").slice(0, 20);
}

async function download(work) {
  const key = workKey(work);
  const pdfPath = resolve(evidenceDir, `${key}.pdf`);
  const textPath = resolve(evidenceDir, `${key}.txt`);
  const candidateUrls = [...new Set([
    work.best_oa_location?.pdf_url,
    work.primary_location?.pdf_url,
    ...(work.locations ?? []).map(location => location.pdf_url),
  ].filter(Boolean))];
  const base = {
    key,
    openalex_id: work.id,
    doi: work.doi?.replace(/^https:\/\/doi\.org\//, "") ?? null,
    title: work.title,
    pdf_url_candidates: candidateUrls,
    pdf_path: `web/.tmp/literature-review/fulltext/${key}.pdf`,
    text_path: `web/.tmp/literature-review/fulltext/${key}.txt`,
  };

  if (existsSync(pdfPath) && statSync(pdfPath).size > 1024 && existsSync(textPath)) {
    return { ...base, status: "cached", bytes: statSync(pdfPath).size, text_bytes: statSync(textPath).size };
  }

  const errors = [];
  for (const candidateUrl of candidateUrls) {
    try {
      const response = await fetch(candidateUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(45_000),
        headers: {
          "User-Agent": "Mozilla/5.0 ChronicleLiteratureReview/1.0",
          Accept: "application/pdf,text/html;q=0.8,*/*;q=0.5",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? "";
      const looksPdf = body.subarray(0, 5).toString() === "%PDF-";
      if (!looksPdf) throw new Error(`not_pdf content_type=${contentType} bytes=${body.length}`);
      writeFileSync(pdfPath, body);
      const extraction = spawnSync("pdftotext", ["-layout", pdfPath, textPath], { encoding: "utf8" });
      if (extraction.status !== 0) {
        return { ...base, status: "pdf_retrieved_text_extraction_failed", bytes: body.length, error: extraction.stderr?.trim() || `pdftotext_exit_${extraction.status}` };
      }
      return {
        ...base,
        status: "retrieved_and_extracted",
        bytes: body.length,
        text_bytes: statSync(textPath).size,
        content_type: contentType,
        final_url: response.url,
        pdf_sha256: createHash("sha256").update(body).digest("hex"),
      };
    } catch (error) {
      errors.push({ url: candidateUrl, error: String(error) });
    }
  }
  return { ...base, status: "retrieval_failed", errors };
}

async function worker() {
  while (queue.length > 0) {
    const work = queue.shift();
    manifest.push(await download(work));
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
manifest.sort((left, right) => (left.doi ?? left.openalex_id).localeCompare(right.doi ?? right.openalex_id));

writeFileSync(resolve(corpusDir, "corpus-fulltext-retrieval-manifest.jsonl"), `${manifest.map(row => JSON.stringify(row)).join("\n")}\n`);
const statusCounts = Object.fromEntries(
  Object.entries(Object.groupBy(manifest, row => row.status)).map(([status, rows]) => [status, rows.length]),
);
writeFileSync(
  resolve(corpusDir, "corpus-fulltext-retrieval-summary.json"),
  `${JSON.stringify({ generated_at: new Date().toISOString(), attempted: manifest.length, status_counts: statusCounts }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ attempted: manifest.length, status_counts: statusCounts })}\n`);
