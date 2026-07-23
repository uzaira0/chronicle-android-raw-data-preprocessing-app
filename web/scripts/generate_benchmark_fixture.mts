import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
} from "../src/testSupport/syntheticChronicleCorpus";

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]) {
  let output = path.resolve("../.tmp-benchmark/chronicle-synthetic.csv");
  let sessions = 200;
  let seed = 0x80c0ffee;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--output" && next) {
      output = path.resolve(next);
      index += 1;
    } else if (token === "--sessions" && next) {
      sessions = positiveInteger(token, next);
      index += 1;
    } else if (token === "--seed" && next) {
      seed = positiveInteger(token, next);
      index += 1;
    } else {
      throw new Error(`unknown or incomplete argument: ${token ?? ""}`);
    }
  }
  return { output, sessions, seed };
}

const args = parseArgs(process.argv.slice(2));
const defaults = path.resolve("src/assets/defaults");
const [codebookCsv, filterCsv, backgroundCsv, forcingScreenOpenCsv] = await Promise.all([
  readFile(path.join(defaults, "unified_app_codebook.csv"), "utf8"),
  readFile(
    path.join(defaults, "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"),
    "utf8",
  ),
  readFile(
    path.join(defaults, "Chronicle_Android_raw_data_preprocessor_background_apps.csv"),
    "utf8",
  ),
  readFile(
    path.join(defaults, "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv"),
    "utf8",
  ),
]);
const catalog = buildSyntheticCatalog({
  codebookCsv,
  filterCsv,
  backgroundCsv,
  forcingScreenOpenCsv,
});
const corpus = generateSyntheticChronicleCorpus(
  {
    id: `performance-${args.sessions}`,
    seed: args.seed,
    sessionCount: args.sessions,
    startUtc: "2026-01-01T00:00:00Z",
    timezones: ["America/Chicago"],
    shuffleRows: false,
    injectExactDuplicates: true,
    injectDuplicateTimestamps: true,
    injectLongAndMissingStops: true,
    injectOverlaps: true,
    injectUnicodeAndQuotedLabels: true,
    injectInfluenceProbes: true,
  },
  catalog,
);
await mkdir(path.dirname(args.output), { recursive: true });
await writeFile(args.output, corpus.csv);
const bytes = Buffer.byteLength(corpus.csv);
const sha256 = createHash("sha256").update(corpus.csv).digest("hex");
process.stdout.write(
  `${JSON.stringify({
    output: args.output,
    sessions: args.sessions,
    rows: corpus.rowCount,
    bytes,
    sha256: `sha256:${sha256}`,
  })}\n`,
);
