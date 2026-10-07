import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The first paint waits for every module main.tsx reaches through static
 * value imports, including each packed registry those modules await at top
 * level. This walks that graph from the source (type-only imports are erased
 * by the compiler, so they are skipped) and pins what must stay behind a
 * dynamic import: the method-profile registries (about 10 MB of JSON once
 * decoded), the method-profile catalogue, and the Rust runtime bridge.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveSpecifier(from: string, specifier: string): string | null {
  const bare = specifier.split("?")[0]!;
  let base: string;
  if (bare.startsWith("@/")) base = resolve(SRC, bare.slice(2));
  else if (bare.startsWith(".")) base = resolve(dirname(from), bare);
  else return null; // a package
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
    .find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function staticValueImports(file: string): string[] {
  if (!/\.(ts|tsx)$/.test(file)) return [];
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const typeOnly = clause?.isTypeOnly
        || (clause !== undefined && clause.name === undefined && clause.namedBindings !== undefined
          && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length > 0
          && clause.namedBindings.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
      specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  return specifiers;
}

function firstPaintGraph(): Set<string> {
  const entry = resolve(SRC, "main.tsx");
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    for (const specifier of staticValueImports(file)) {
      const target = resolveSpecifier(file, specifier);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return new Set([...seen].map((file) => file.slice(SRC.length + 1)));
}

describe("first-paint import graph", () => {
  const graph = firstPaintGraph();

  it("walks the real entry graph", () => {
    // The walker must see the app itself, or an empty graph would pass.
    expect(graph.has("App.tsx")).toBe(true);
    expect(graph.has("lib/settingsPersistence.ts")).toBe(true);
    expect(graph.has("lib/generatedContract.ts")).toBe(true);
  });

  it.each([
    "generated/android-method-profile-runtime-registry.json",
    "generated/source-artifact-provenance-registry.json",
    "generated/literature-external-executor-registry.json",
    "lib/sourceArtifactProvenanceRegistry.ts",
    "lib/literatureInputAdapters.ts",
    "lib/literatureExternalExecutors.ts",
    "lib/sleepDiaryReplication.ts",
    "lib/methodProfiles.ts",
    "lib/methodReceiptValidation.ts",
    "lib/rustPipelineRuntime.ts",
    "lib/rustPipelineAuthority.ts",
    "lib/plotGenerator.ts",
    "components/ResearchMethodProfileCard.tsx",
    "components/SleepDiaryReplicationCard.tsx",
    "components/ResultPanel.tsx",
    "components/ViewPanel.tsx",
    "components/LiteratureComponentResultPanel.tsx",
  ])("does not statically reach %s", (module) => {
    expect(graph.has(module)).toBe(false);
  });
});
