/* tslint:disable */
/* eslint-disable */

export class PreparedReviewWorkspace {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    execute_selected_base(selected_base: Uint8Array): RuntimeHandle;
    required_base_kind(): string;
}

export class RuntimeHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    artifact_metadata_json(index: number): string;
    manifest_json(): string;
    take_artifact_bytes(index: number): Uint8Array;
    readonly artifact_count: number;
}

/**
 * Product support artifacts injected by registered semantic role. Adding a
 * role does not change the execution ABI or reorder existing inputs.
 */
export class RuntimeSupportFiles {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    put(role: string, bytes: Uint8Array): void;
    put_with_name(role: string, name: string, bytes: Uint8Array): void;
}

export function build_environment_digest(): string;

/**
 * Discover normalized IANA timezones through the same Rust boundary used by
 * production preprocessing.
 */
export function discover_timezones_v2(csv_bytes: Uint8Array): string[];

/**
 * Resolve product-owned role requirements without executing computation.
 * The browser can render binding holes from this report; ExecuteWorkspace
 * independently enforces the same report and fails closed when it is not
 * ready, so UI validation can never become the only safety boundary.
 */
export function evaluate_workspace_requirements(request_json: string, csv_bytes: Uint8Array, support_files: RuntimeSupportFiles): string;

export function execute_workspace(request_json: string, csv_bytes: Uint8Array, support_files: RuntimeSupportFiles): RuntimeHandle;

/**
 * Execute an interactive review with an optional verified early-row cache.
 * The Rust kernel rechecks the cache key against the raw input and all
 * options/support files that can affect those rows; a mismatch is a normal
 * cache miss and runs the raw path.
 */
export function execute_workspace_with_review_base(request_json: string, csv_bytes: Uint8Array, review_base_bytes: Uint8Array, support_files: RuntimeSupportFiles): RuntimeHandle;

/**
 * Execute an interactive review with independently verified post-review and
 * post-reconstruction checkpoints. The reconstruction header is rejected before payload
 * decompression when any semantic input to reconstruction changed.
 */
export function execute_workspace_with_review_bases(request_json: string, csv_bytes: Uint8Array, review_base_bytes: Uint8Array, reconstruction_base_bytes: Uint8Array, support_files: RuntimeSupportFiles): RuntimeHandle;

export function get_comparison_cache_retained(): number;

export function implementation_build_digest(): string;

/**
 * Tolerant upload inspection owned by the same Rust runtime as execution.
 * Malformed CSV is reported through warnings instead of escaping as an error,
 * because upload inspection is advisory and must never crash the file picker.
 */
export function inspect_raw_file_v1(csv_bytes: Uint8Array, file_name: string, size_bytes: number): string;

export function plan_workflow_explorer_view_json(request_json: string): string;

/**
 * Prepare a review from an already verified OPFS workspace. Only the small
 * persisted-base headers cross the boundary until Rust selects the exact
 * compatible base; the unchanged raw file stays in its content-addressed
 * object. A cache miss is reported as `none` and the browser must call the
 * ordinary raw-input API.
 */
export function prepare_persisted_workspace_review(request_json: string, input_size_bytes: number, review_probe: Uint8Array, reconstruction_probe: Uint8Array, support_files: RuntimeSupportFiles): PreparedReviewWorkspace;

export function prepare_workspace_review(request_json: string, csv_bytes: Uint8Array, review_probe: Uint8Array, reconstruction_probe: Uint8Array, support_files: RuntimeSupportFiles): PreparedReviewWorkspace;

export function review_base_probe_spec_json(): string;

export function runtime_identity_json(): string;

export function runtime_version(): string;

export function set_comparison_cache_capacity(capacity: number): void;

export function verify_evidence_journal_cbor(bytes: Uint8Array): number;

export function workflow_contract_json(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_preparedreviewworkspace_free: (a: number, b: number) => void;
    readonly __wbg_runtimehandle_free: (a: number, b: number) => void;
    readonly __wbg_runtimesupportfiles_free: (a: number, b: number) => void;
    readonly build_environment_digest: (a: number) => void;
    readonly discover_timezones_v2: (a: number, b: number, c: number) => void;
    readonly evaluate_workspace_requirements: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly execute_workspace: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly execute_workspace_with_review_base: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly execute_workspace_with_review_bases: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly implementation_build_digest: (a: number) => void;
    readonly inspect_raw_file_v1: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly plan_workflow_explorer_view_json: (a: number, b: number, c: number) => void;
    readonly prepare_persisted_workspace_review: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly prepare_workspace_review: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly preparedreviewworkspace_execute_selected_base: (a: number, b: number, c: number, d: number) => void;
    readonly preparedreviewworkspace_required_base_kind: (a: number, b: number) => void;
    readonly review_base_probe_spec_json: (a: number) => void;
    readonly runtime_identity_json: (a: number) => void;
    readonly runtime_version: (a: number) => void;
    readonly runtimehandle_artifact_count: (a: number) => number;
    readonly runtimehandle_artifact_metadata_json: (a: number, b: number, c: number) => void;
    readonly runtimehandle_manifest_json: (a: number, b: number) => void;
    readonly runtimehandle_take_artifact_bytes: (a: number, b: number, c: number) => void;
    readonly runtimesupportfiles_new: () => number;
    readonly runtimesupportfiles_put: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly runtimesupportfiles_put_with_name: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly set_comparison_cache_capacity: (a: number) => void;
    readonly verify_evidence_journal_cbor: (a: number, b: number, c: number) => void;
    readonly workflow_contract_json: (a: number) => void;
    readonly get_comparison_cache_retained: () => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
