import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { leakedHomeDirectoryPrefixes, wasmBuildPaths } from "./wasm_build_flags.mjs";
import { assertDeclarationSurface } from "./wasm_declaration_surface.mjs";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(webDir, "..");
const buildPaths = wasmBuildPaths(repositoryRoot);
const forbiddenBuildPaths = [
  ["repository root", buildPaths.repositoryRoot],
  ["home directory", buildPaths.home],
  ["Cargo home", buildPaths.cargoHome],
  ["Rust sysroot", buildPaths.rustcSysroot],
];

/** @type {Array<{name: string, expected: string[], expectedClasses: Record<string, string[]>, expectedFunctions: Record<string, string>, expectedDefaultFunction: string}>} */
const packages = [
  {
    name: "chronicle_preprocessing_runtime_wasm",
    expected: [
      "class:RuntimeHandle",
      "class:RuntimeSupportFiles",
      "class:PreparedReviewWorkspace",
      "class:RawStudySplit",
      "function:begin_raw_inspection_batch",
      "function:build_environment_digest",
      "function:decompress_bundled_gzip",
      "function:discover_timezones_v2",
      "function:dispose_raw_inspection_batch",
      "function:evaluate_workspace_requirements",
      "function:execute_literature_component",
      "function:execute_workspace",
      "function:execute_workspace_with_review_base",
      "function:execute_workspace_with_review_bases",
      "function:get_comparison_cache_retained",
      "function:implementation_build_digest",
      "function:initSync",
      "function:install_payload_spill",
      "function:inspect_raw_file_v1",
      "function:inspect_raw_file_v2",
      "function:maximum_duration_applicability_json",
      "function:opener_set_applicability_json",
      "function:workflow_contract_json",
      "function:plan_workflow_explorer_view_json",
      "function:prepare_persisted_workspace_review",
      "function:prepare_workspace_review",
      "function:register_raw_participant_partition_artifact",
      "function:review_base_probe_spec_json",
      "function:runtime_identity",
      "function:runtime_identity_json",
      "function:runtime_version",
      "function:scientific_preflight_json",
      "function:set_comparison_cache_capacity",
      "function:set_payload_budget_bytes",
      "function:split_raw_by_study_v1",
      "function:verify_evidence_journal_cbor",
    ],
    expectedClasses: {
      PreparedReviewWorkspace: [
        "constructor:private constructor();",
        "method:[Symbol.dispose](): void;",
        "method:execute_selected_base(selected_base: Uint8Array): RuntimeHandle;",
        "method:execute_selected_base_pair(review_base: Uint8Array, reconstruction_base: Uint8Array): RuntimeHandle;",
        "method:free(): void;",
        "method:required_base_kind(): string;",
      ],
      RawStudySplit: [
        "constructor:private constructor();",
        "method:[Symbol.dispose](): void;",
        "method:free(): void;",
        "method:study_ids(): string[];",
        "method:take_part(index: number): Uint8Array;",
      ],
      RuntimeHandle: [
        "constructor:private constructor();",
        "method:[Symbol.dispose](): void;",
        "method:artifact_metadata_json(index: number): string;",
        "method:free(): void;",
        "method:manifest_json(): string;",
        "method:take_artifact_bytes(index: number): Uint8Array;",
        "readonly:readonly artifact_count: number;",
      ],
      RuntimeSupportFiles: [
        "constructor:constructor();",
        "method:[Symbol.dispose](): void;",
        "method:free(): void;",
        "method:put(role: string, bytes: Uint8Array): void;",
        "method:put_with_name(role: string, name: string, bytes: Uint8Array): void;",
      ],
    },
    expectedFunctions: {
      begin_raw_inspection_batch:
        "export function begin_raw_inspection_batch(secret_bytes: Uint8Array): string;",
      build_environment_digest:
        "export function build_environment_digest(): string;",
      decompress_bundled_gzip:
        "export function decompress_bundled_gzip(packed: Uint8Array, expected_bytes: number): Uint8Array;",
      discover_timezones_v2:
        "export function discover_timezones_v2(csv_bytes: Uint8Array): string[];",
      dispose_raw_inspection_batch:
        "export function dispose_raw_inspection_batch(batch_id: string): boolean;",
      evaluate_workspace_requirements:
        "export function evaluate_workspace_requirements(request_json: string, csv_bytes: Uint8Array, support_files: RuntimeSupportFiles): string;",
      execute_literature_component:
        "export function execute_literature_component(component_id: string, request_json: string, csv_bytes: Uint8Array, support_files: RuntimeSupportFiles): RuntimeHandle;",
      execute_workspace:
        "export function execute_workspace(request_json: string, csv_bytes: Uint8Array, support_files: RuntimeSupportFiles): RuntimeHandle;",
      execute_workspace_with_review_base:
        "export function execute_workspace_with_review_base(request_json: string, csv_bytes: Uint8Array, review_base_bytes: Uint8Array, support_files: RuntimeSupportFiles): RuntimeHandle;",
      execute_workspace_with_review_bases:
        "export function execute_workspace_with_review_bases(request_json: string, csv_bytes: Uint8Array, review_base_bytes: Uint8Array, reconstruction_base_bytes: Uint8Array, support_files: RuntimeSupportFiles): RuntimeHandle;",
      get_comparison_cache_retained:
        "export function get_comparison_cache_retained(): number;",
      implementation_build_digest:
        "export function implementation_build_digest(): string;",
      initSync:
        "export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;",
      inspect_raw_file_v1:
        "export function inspect_raw_file_v1(csv_bytes: Uint8Array, file_name: string, size_bytes: number): string;",
      inspect_raw_file_v2:
        "export function inspect_raw_file_v2(csv_bytes: Uint8Array, file_name: string, size_bytes: number, participant_partition_batch_id: string): string;",
      maximum_duration_applicability_json:
        "export function maximum_duration_applicability_json(request_json: string): string;",
      opener_set_applicability_json:
        "export function opener_set_applicability_json(request_json: string): string;",
      plan_workflow_explorer_view_json:
        "export function plan_workflow_explorer_view_json(request_json: string): string;",
      prepare_persisted_workspace_review:
        "export function prepare_persisted_workspace_review(request_json: string, input_size_bytes: number, review_probe: Uint8Array, reconstruction_probe: Uint8Array, support_files: RuntimeSupportFiles): PreparedReviewWorkspace;",
      prepare_workspace_review:
        "export function prepare_workspace_review(request_json: string, csv_bytes: Uint8Array, review_probe: Uint8Array, reconstruction_probe: Uint8Array, support_files: RuntimeSupportFiles): PreparedReviewWorkspace;",
      register_raw_participant_partition_artifact:
        "export function register_raw_participant_partition_artifact(csv_bytes: Uint8Array, participant_partition_batch_id: string): void;",
      review_base_probe_spec_json:
        "export function review_base_probe_spec_json(): string;",
      runtime_identity: "export function runtime_identity(): RuntimeIdentity;",
      runtime_identity_json: "export function runtime_identity_json(): string;",
      runtime_version: "export function runtime_version(): string;",
      scientific_preflight_json:
        "export function scientific_preflight_json(request_json: string, csv_bytes: Uint8Array, support_files: RuntimeSupportFiles): string;",
      set_comparison_cache_capacity:
        "export function set_comparison_cache_capacity(capacity: number): void;",
      set_payload_budget_bytes:
        "export function set_payload_budget_bytes(bytes: bigint): void;",
      split_raw_by_study_v1:
        "export function split_raw_by_study_v1(csv_bytes: Uint8Array): RawStudySplit;",
      install_payload_spill:
        "export function install_payload_spill(bridge: PayloadSpillBridge, budget_bytes: bigint): void;",
      verify_evidence_journal_cbor:
        "export function verify_evidence_journal_cbor(bytes: Uint8Array): number;",
      workflow_contract_json:
        "export function workflow_contract_json(): string;",
    },
    expectedDefaultFunction:
      "export default function __wbg_init(module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;",
  },
  {
    name: "chronicle_semantic_index_wasm",
    expected: [
      "function:decompress_bundled_gzip",
      "function:initSync",
      "function:query_registered",
      "function:query_registered_view",
      "function:rebuild_semantic_index",
    ],
    expectedClasses: {},
    expectedFunctions: {
      decompress_bundled_gzip:
        "export function decompress_bundled_gzip(packed: Uint8Array, expected_bytes: number): Uint8Array;",
      initSync:
        "export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;",
      query_registered:
        "export function query_registered(index: Uint8Array, query_id: string): string;",
      query_registered_view:
        "export function query_registered_view(index: Uint8Array, query_id: string, workspace_root_digest: string, revision: bigint): string;",
      rebuild_semantic_index:
        "export function rebuild_semantic_index(source_json: Uint8Array, scientific_artifact_bundle: Uint8Array): Uint8Array;",
    },
    expectedDefaultFunction:
      "export default function __wbg_init(module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;",
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
  assertDeclarationSurface(pkg.name, declaration, {
    topLevel: pkg.expected,
    classes: pkg.expectedClasses,
    functions: pkg.expectedFunctions,
    defaultFunction: pkg.expectedDefaultFunction,
  });

  const wasmPath = path.join(
    webDir,
    "src/wasm",
    pkg.name,
    "pkg",
    `${pkg.name}_bg.wasm`,
  );
  const wasm = await readFile(wasmPath);
  const leakedPaths = forbiddenBuildPaths
    .filter(([, value]) => value && wasm.includes(Buffer.from(value)))
    .map(([label]) => label);
  const binaryText = wasm.toString("latin1");
  const leakedHomePrefixes = leakedHomeDirectoryPrefixes(binaryText);
  if (leakedPaths.length > 0 || leakedHomePrefixes.length > 0) {
    throw new Error(
      `${pkg.name} embeds private build paths.\n` +
        `build roots=${leakedPaths.join(",") || "none"}\n` +
        `home prefixes=${leakedHomePrefixes.join(",") || "none"}`,
    );
  }
}

console.log("WASM export boundary and build-path privacy checks passed.");
