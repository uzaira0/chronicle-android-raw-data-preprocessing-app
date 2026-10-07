import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildB06AllOutputsIntersectionFixtures } from "../src/testSupport/b06OmissionFixtureMaterializer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const DEFAULTS_ROOT = path.join(WEB_ROOT, "src/assets/defaults");
const FIXTURES_ROOT = path.join(WEB_ROOT, "src/testSupport/fixtures");
const PINNED_NODE_MAJOR = (await readFile(path.join(WEB_ROOT, ".node-version"), "utf8"))
  .trim();
const OBSERVED_NODE_MAJOR = process.versions.node.split(".")[0];

const args = new Set(process.argv.slice(2));
if (
  args.size !== 1 ||
  (!args.has("--check") && !args.has("--update"))
) {
  throw new Error(
    "usage: vite-node scripts/generate_b06_omission_fixtures.mts --check|--update",
  );
}
if (OBSERVED_NODE_MAJOR !== PINNED_NODE_MAJOR) {
  throw new Error(
    `B06 omission fixtures must be checked and updated with pinned Node ${PINNED_NODE_MAJOR}; observed ${process.versions.node}`,
  );
}

const [codebookCsv, filterCsv, backgroundCsv, forcingScreenOpenCsv] =
  await Promise.all([
    readFile(path.join(DEFAULTS_ROOT, "unified_app_codebook.csv"), "utf8"),
    readFile(
      path.join(
        DEFAULTS_ROOT,
        "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        DEFAULTS_ROOT,
        "Chronicle_Android_raw_data_preprocessor_background_apps.csv",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        DEFAULTS_ROOT,
        "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
      ),
      "utf8",
    ),
  ]);

const fixtures = buildB06AllOutputsIntersectionFixtures({
  codebookCsv,
  filterCsv,
  backgroundCsv,
  forcingScreenOpenCsv,
});

if (args.has("--update")) {
  await Promise.all(
    fixtures.map(({ fileName, csv }) =>
      writeFile(path.join(FIXTURES_ROOT, fileName), csv, "utf8"),
    ),
  );
  process.stdout.write(
    `${JSON.stringify({ mode: "update", files: fixtures.length, nodeMajor: OBSERVED_NODE_MAJOR })}\n`,
  );
} else {
  const drift: string[] = [];
  for (const { fileName, csv } of fixtures) {
    const current = await readFile(path.join(FIXTURES_ROOT, fileName), "utf8").catch(
      () => null,
    );
    if (current !== csv) drift.push(fileName);
  }
  if (drift.length > 0) {
    throw new Error(
      `B06 omission fixtures drifted: ${drift.join(", ")}; regenerate with --update`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ mode: "check", files: fixtures.length, nodeMajor: OBSERVED_NODE_MAJOR, pinnedNodeMajor: PINNED_NODE_MAJOR })}\n`,
  );
}
