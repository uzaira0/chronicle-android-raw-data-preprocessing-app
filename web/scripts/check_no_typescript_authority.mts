/** Fail if the deleted TypeScript preprocessing authority is reintroduced. */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
];

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

if (violations.length > 0) {
  throw new Error(
    `TypeScript preprocessing authority is forbidden; Rust/WASM is the only engine:\n${violations
      .map((violation) => `- ${violation}`)
      .join("\n")}`,
  );
}

console.log("TypeScript authority boundary: Rust/WASM is the only preprocessing engine.");
