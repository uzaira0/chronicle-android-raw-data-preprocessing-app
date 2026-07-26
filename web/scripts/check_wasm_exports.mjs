import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packages = [
  {
    name: "chronicle_preprocessing_runtime_wasm",
    expected: [
      "class:RuntimeHandle",
      "class:RuntimeSupportFiles",
      "function:build_environment_digest",
      "function:discover_timezones_v2",
      "function:evaluate_workspace_requirements",
      "function:execute_workspace",
      "function:execute_workspace_with_review_base",
      "function:execute_workspace_with_review_bases",
      "function:implementation_build_digest",
      "function:initSync",
      "function:inspect_raw_file_v1",
      "function:pipeline_step_contract_json",
      "function:plan_stage_view_json",
      "function:runtime_identity_json",
      "function:runtime_version",
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

console.log("WASM export boundary: only the approved Rust runtime APIs are present.");
