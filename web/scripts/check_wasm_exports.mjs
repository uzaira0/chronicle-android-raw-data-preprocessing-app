import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { leakedHomeDirectoryPrefixes, wasmBuildPaths } from "./wasm_build_flags.mjs";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(webDir, "..");
const buildPaths = wasmBuildPaths(repositoryRoot);
const forbiddenBuildPaths = [
  ["repository root", buildPaths.repositoryRoot],
  ["home directory", buildPaths.home],
  ["Cargo home", buildPaths.cargoHome],
  ["Rust sysroot", buildPaths.rustcSysroot],
];

const packages = [
  {
    name: "chronicle_preprocessing_runtime_wasm",
    expected: [
      "class:RuntimeHandle",
      "class:RuntimeSupportFiles",
      "class:PreparedReviewWorkspace",
      "function:build_environment_digest",
      "function:discover_timezones_v2",
      "function:evaluate_workspace_requirements",
      "function:execute_workspace",
      "function:execute_workspace_with_review_base",
      "function:execute_workspace_with_review_bases",
      "function:get_comparison_cache_retained",
      "function:implementation_build_digest",
      "function:initSync",
      "function:inspect_raw_file_v1",
      "function:workflow_contract_json",
      "function:plan_workflow_explorer_view_json",
      "function:prepare_persisted_workspace_review",
      "function:prepare_workspace_review",
      "function:review_base_probe_spec_json",
      "function:runtime_identity_json",
      "function:runtime_identity",
      "function:runtime_version",
      "function:set_comparison_cache_capacity",
      "function:verify_evidence_journal_cbor",
    ],
  },
  {
    name: "chronicle_semantic_index_wasm",
    expected: [
      "function:initSync",
      "function:query_registered",
      "function:rebuild_semantic_index",
    ],
  },
];

for (const pkg of packages) {
  const declarationPath = path.join(
    webDir,
    "src/wasm",
    pkg.name,
    "pkg",
    `${pkg.name}.d.ts`,
  );
  const declaration = await readFile(declarationPath, "utf8");
  const actual = [...declaration.matchAll(/^export (class|function) ([A-Za-z0-9_]+)/gm)]
    .map((match) => `${match[1]}:${match[2]}`)
    .sort();
  const expected = [...pkg.expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${pkg.name} export surface drifted.\nexpected=${expected.join(",")}\nactual=${actual.join(",")}`,
    );
  }
}

// Every shipped WASM binary, not only the export-checked one: a build path in
// either is the developer's username and folder layout in every user's browser.
for (const name of ["chronicle_preprocessing_runtime_wasm", "chronicle_semantic_index_wasm"]) {
  const wasm = await readFile(path.join(webDir, "src/wasm", name, "pkg", `${name}_bg.wasm`));
  const leakedPaths = forbiddenBuildPaths
    .filter(([, value]) => value && wasm.includes(Buffer.from(value)))
    .map(([label]) => label);
  const leakedHomePrefixes = leakedHomeDirectoryPrefixes(wasm.toString("latin1"));
  if (leakedPaths.length > 0 || leakedHomePrefixes.length > 0) {
    throw new Error(
      `${name} embeds private build paths.\n` +
        `build roots=${leakedPaths.join(",") || "none"}\n` +
        `home prefixes=${leakedHomePrefixes.join(",") || "none"}`,
    );
  }
}

console.log("WASM export boundary and build-path privacy checks passed.");
