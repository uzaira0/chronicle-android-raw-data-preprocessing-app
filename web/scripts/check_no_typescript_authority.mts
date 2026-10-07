/** Fail if the deleted TypeScript preprocessing authority is reintroduced. */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BROWSER_PROCESSING_OPTION_KEYS } from "../src/lib/generatedContract";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(webDir, "..");
const sourceDir = path.join(webDir, "src");

const forbiddenPaths = [
  "src/lib/browserPipeline.ts",
  "src/lib/processingReport.ts",
  "src/lib/pipelineGraph/engine.ts",
  "src/lib/pipelineGraph/graphDef.ts",
  "src/lib/pipelineGraph/stepGraph.ts",
  "src/lib/pipelineGraph/stepRunner.ts",
  "src/lib/pipelineGraph/steps",
  "src/lib/stages",
];

const forbiddenSymbols = [
  "GraphEngine",
  "PipelineCtx",
  "UnitWiring",
  "processRawCsvContent",
  "runRustV2Shadow",
  "rustShadowMode",
  "execute_bounded_v2_shadow",
  "buildProcessingReport",
  "buildProvenanceJsonLd",
  "ALL_INTERACTION_TYPES_MAP",
  "parseInteractionRemap",
];

const forbiddenRepoPaths = [
  "rust/chronicle_app_usage_wasm",
  "rust/chronicle_incremental_query_spike",
  "rust/chronicle_polars_kernels_wasm",
  "rust/vendor/salsa-0.28.1",
  "web/src/wasm/chronicle_app_usage_wasm",
  "web/src/wasm/chronicle_chrono_kernel_wasm",
  "web/src/wasm/chronicle_polars_kernels_wasm",
];

/**
 * `src/testSupport/` is the one directory this file's own recursion skips (see
 * `sourceFiles` below), and it is exactly where 5,273 lines of parallel B06 semantic
 * authority (`b06OmissionOracle.ts`) accumulated without any gate reading it. The two
 * limits below police that zone directly.
 *
 * Measured justification (re-measured 2026-08-13, over the current contents of
 * `web/src/testSupport/`, counting every non-test module by this file's own metric —
 * `source.split("\n").length`, i.e. `wc -l` plus the trailing newline):
 *
 *   lines  option-vocabulary  file
 *    1039                  0  artifactInterventions.ts
 *     648                  6  scientificCampaignExecution.ts
 *     588                  0  syntheticChronicleCorpus.ts
 *     324                  0  configurationEquivalenceClasses.ts
 *     263                  0  campaignManifest.ts
 *     204                  0  workflowContract.ts
 *     149                  0  outputCellTomography.ts
 *     148                  0  memoryFileSystem.ts
 *     112                  0  b06OmissionFixtureMaterializer.ts
 *      94                  0  rustCampaignGraph.ts
 *      76                  0  runtimeScientificPreflightFixture.ts
 *      19                  0  dependencyCampaignRuntime.ts
 *
 * `campaignManifest.ts` is the shared observation layer the five dependency-tomography
 * campaigns read the runtime manifest through: it aliases the GENERATED boundary type
 * (`RuntimeManifest` from `generatedRuntimeBoundary.ts`) rather than hand-writing a sixth
 * structural copy, and carries only projections over the observed document — statuses,
 * digests, executed queries, changed checkpoint components. It declares no option or
 * branch semantics, which is why its option vocabulary is 0 and why it is not the class of
 * module these two limits exist to catch.
 *
 *   the deleted parallel authority   5,274 lines,  11 option-vocabulary terms
 *
 * TEST_SUPPORT_MAX_LINES = 1200 clears today's largest legitimate module (1,039) with ~15%
 * headroom and fails the 5,274-line semantic model by 4.4x.
 *
 * TEST_SUPPORT_MAX_OPTION_VOCABULARY = 8 clears today's densest legitimate module (6) with
 * headroom and fails the deleted oracle (11). "Option vocabulary" is a distinct declared
 * browser option key appearing as a quoted literal, or a distinct option-shaped native key
 * (`*_policy` / `*_disposition` / `*_strategy` / `*_threshold_ns` / `*_threshold_source` /
 * `*_explicit`) appearing anywhere — quoted, as an object key, or as a bare identifier,
 * because a semantics table is just as much a semantics table when its keys are unquoted.
 * A test-support module naming nine or more of these is declaring an option/branch semantics
 * table, which belongs in the LinkML contract and the kernel — not here.
 *
 * Fixture and corpus modules are exempt from the line limit only: they carry data, not
 * branch semantics. `*.test.ts` / `*.test.tsx` are exempt from both — assertions may
 * legitimately enumerate the option space they are asserting over.
 */
const TEST_SUPPORT_MAX_LINES = 1200;
const TEST_SUPPORT_MAX_OPTION_VOCABULARY = 8;

const OPTION_SHAPED_NATIVE_KEY =
  /\b[a-z0-9]+(?:_[a-z0-9]+)*_(?:policy|disposition|strategy|threshold_ns|threshold_source|explicit)\b/g;
const QUOTED_IDENTIFIER = /["'`]([A-Za-z0-9_]+)["'`]/g;

const declaredOptionKeys = new Set<string>(BROWSER_PROCESSING_OPTION_KEYS);

function isFixtureModule(fileName: string, relativePath: string): boolean {
  return (
    /(?:^|[/.])fixtures?[/.]/i.test(relativePath) ||
    /(?:fixture|fixtures|corpus)\.tsx?$/i.test(fileName) ||
    /(?:Fixture|Fixtures|Corpus)\.tsx?$/.test(fileName)
  );
}

function isTestModule(fileName: string): boolean {
  return fileName.endsWith(".test.ts") || fileName.endsWith(".test.tsx");
}

function optionVocabulary(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(OPTION_SHAPED_NATIVE_KEY)) {
    found.add(match[0]);
  }
  for (const match of source.matchAll(QUOTED_IDENTIFIER)) {
    const literal = match[1];
    if (literal !== undefined && declaredOptionKeys.has(literal)) {
      found.add(literal);
    }
  }
  return Array.from(found).sort((left, right) => left.localeCompare(right));
}

async function testSupportModules(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await testSupportModules(target)));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(target);
    }
  }
  return files;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "testSupport" || entry.name === "wasm") continue;
      files.push(...(await sourceFiles(target)));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(target);
    }
  }
  return files;
}

const violations: string[] = [];
for (const relative of forbiddenPaths) {
  if (await exists(path.join(webDir, relative))) {
    violations.push(`${relative}: deleted TypeScript preprocessing path exists`);
  }
}
for (const relative of forbiddenRepoPaths) {
  if (await exists(path.join(repoDir, relative))) {
    violations.push(`${relative}: retired duplicate implementation exists`);
  }
}

for (const file of await sourceFiles(sourceDir)) {
  const source = await readFile(file, "utf8");
  for (const symbol of forbiddenSymbols) {
    if (source.includes(symbol)) {
      violations.push(
        `${path.relative(webDir, file)}: forbidden duplicate-authority symbol ${symbol}`,
      );
    }
  }
}

const testSupportDir = path.join(sourceDir, "testSupport");
for (const file of await testSupportModules(testSupportDir)) {
  const relative = path.relative(webDir, file);
  const fileName = path.basename(file);
  if (isTestModule(fileName)) continue;
  const source = await readFile(file, "utf8");

  if (!isFixtureModule(fileName, relative)) {
    const lines = source.split("\n").length;
    if (lines > TEST_SUPPORT_MAX_LINES) {
      violations.push(
        `${relative}: ${lines} lines exceeds the ${TEST_SUPPORT_MAX_LINES}-line test-support limit; ` +
          `a module this large in the unpoliced test-support zone is parallel semantic authority`,
      );
    }
  }

  const vocabulary = optionVocabulary(source);
  if (vocabulary.length > TEST_SUPPORT_MAX_OPTION_VOCABULARY) {
    violations.push(
      `${relative}: declares ${vocabulary.length} option/branch semantics terms ` +
        `(${vocabulary.join(", ")}), exceeding the limit of ${TEST_SUPPORT_MAX_OPTION_VOCABULARY}; ` +
        `option semantics belong in web/schema/chronicle-local-contract.linkml.yaml and the kernel`,
    );
  }
}

if (violations.length > 0) {
  throw new Error(
    `TypeScript preprocessing authority is forbidden; Rust/WASM is the only engine:\n${violations
      .map((violation) => `- ${violation}`)
      .join("\n")}`,
  );
}

console.log(
  "TypeScript authority boundary: Rust/WASM is the only preprocessing engine; " +
    `src/testSupport carries no module over ${TEST_SUPPORT_MAX_LINES} lines or ` +
    `${TEST_SUPPORT_MAX_OPTION_VOCABULARY} option/branch semantics terms.`,
);
