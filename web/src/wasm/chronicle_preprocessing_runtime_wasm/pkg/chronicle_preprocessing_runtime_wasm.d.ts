/* tslint:disable */
/* eslint-disable */

export type PayloadSpillBridge = {
    put(id: number, bytes: Uint8Array): void;
    get(id: number): Uint8Array;
    remove(id: number): void;
};


/**
 * Protocol, implementation, build-environment, and embedded-authority digests
 * of the loaded runtime; the same value `runtime_identity_json` serializes.
 */
export interface RuntimeIdentity {
    protocolVersion: string;
    implementationDigest: string;
    buildEnvironmentDigest: string;
    productContractDigest: string;
    planDigest: string;
    profileDigest: string;
    profileLockDigest: string;
    runtimeAuthorityDigest: string;
    dependencyCertificateDigest: string;
}


export class PreparedReviewWorkspace {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    execute_selected_base(selected_base: Uint8Array): RuntimeHandle;
    /**
     * A reconstruction resume needs both complete envelopes: the
     * reconstruction base owns the validated reconstruction and foundational
     * receipts while the independently keyed review base owns the annotation
     * substrate, and the kernel fails closed on a header-only review base.
     */
    execute_selected_base_pair(review_base: Uint8Array, reconstruction_base: Uint8Array): RuntimeHandle;
    required_base_kind(): string;
}

/**
 * The per-study parts of a picked raw file that mixes studies, taken out one
 * at a time so the browser never holds two copies of every part. Study IDs
 * are already published in every output row.
 */
export class RawStudySplit {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Sorted study IDs; empty for a single-study file.
     */
    study_ids(): string[];
    take_part(index: number): Uint8Array;
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

export function begin_raw_inspection_batch(secret_bytes: Uint8Array): string;

export function build_environment_digest(): string;

/**
 * Byte-only compatibility fallback for browsers without DecompressionStream.
 * It does not construct or execute a workspace or initialize Salsa state.
 */
export function decompress_bundled_gzip(packed: Uint8Array, expected_bytes: number): Uint8Array;

/**
 * Discover normalized IANA timezones through the same Rust boundary used by
 * production preprocessing.
 */
export function discover_timezones_v2(csv_bytes: Uint8Array): string[];

export function dispose_raw_inspection_batch(batch_id: string): boolean;

/**
 * Resolve product-owned role requirements without executing computation.
 * The browser can render binding holes from this report; ExecuteWorkspace
 * independently enforces the same report and fails closed when it is not
 * ready, so UI validation can never become the only safety boundary.
 */
export function evaluate_workspace_requirements(request_json: string, csv_bytes: Uint8Array, support_files: RuntimeSupportFiles): string;

export function execute_literature_component(component_id: string, request_json: string, csv_bytes: Uint8Array, support_files: RuntimeSupportFiles): RuntimeHandle;

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

export function inspect_raw_file_v2(csv_bytes: Uint8Array, file_name: string, size_bytes: number, participant_partition_batch_id: string): string;

/**
 * Routes payload spills through `bridge` and caps resident payload bytes at
 * `budget_bytes`. Call once, before the first execution; handles published
 * earlier keep the store they were published into.
 */
export function install_payload_spill(bridge: PayloadSpillBridge, budget_bytes: bigint): void;

export function maximum_duration_applicability_json(request_json: string): string;

export function opener_set_applicability_json(request_json: string): string;

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

/**
 * Register the exact execution-decoder participant set for one raw artifact
 * in an already configured ephemeral batch. This pool-worker setup API never
 * serializes participant identifiers or the batch secret and is deliberately
 * separate from RuntimeRequest/options/provenance.
 */
export function register_raw_participant_partition_artifact(csv_bytes: Uint8Array, participant_partition_batch_id: string): void;

export function review_base_probe_spec_json(): string;

export function runtime_identity(): RuntimeIdentity;

export function runtime_identity_json(): string;

export function runtime_version(): string;

/**
 * Run all input-dependent scientific applicability checks on the exact
 * workspace engine that execution will reuse. Typed refusals remain inside
 * the returned receipt; malformed identity or input still fails closed.
 */
export function scientific_preflight_json(request_json: string, csv_bytes: Uint8Array, support_files: RuntimeSupportFiles): string;

export function set_comparison_cache_capacity(capacity: number): void;

export function set_payload_budget_bytes(bytes: bigint): void;

export function split_raw_by_study_v1(csv_bytes: Uint8Array): RawStudySplit;

export function verify_evidence_journal_cbor(bytes: Uint8Array): number;

export function workflow_contract_json(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_preparedreviewworkspace_free: (a: number, b: number) => void;
    readonly __wbg_rawstudysplit_free: (a: number, b: number) => void;
    readonly __wbg_runtimehandle_free: (a: number, b: number) => void;
    readonly __wbg_runtimesupportfiles_free: (a: number, b: number) => void;
    readonly begin_raw_inspection_batch: (a: number, b: number, c: number) => void;
    readonly build_environment_digest: (a: number) => void;
    readonly decompress_bundled_gzip: (a: number, b: number, c: number, d: number) => void;
    readonly discover_timezones_v2: (a: number, b: number, c: number) => void;
    readonly dispose_raw_inspection_batch: (a: number, b: number) => number;
    readonly evaluate_workspace_requirements: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly execute_literature_component: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly execute_workspace: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly execute_workspace_with_review_base: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly execute_workspace_with_review_bases: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly get_comparison_cache_retained: () => number;
    readonly implementation_build_digest: (a: number) => void;
    readonly inspect_raw_file_v1: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly inspect_raw_file_v2: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly install_payload_spill: (a: number, b: bigint) => void;
    readonly maximum_duration_applicability_json: (a: number, b: number, c: number) => void;
    readonly opener_set_applicability_json: (a: number, b: number, c: number) => void;
    readonly plan_workflow_explorer_view_json: (a: number, b: number, c: number) => void;
    readonly prepare_persisted_workspace_review: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly prepare_workspace_review: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly preparedreviewworkspace_execute_selected_base: (a: number, b: number, c: number, d: number) => void;
    readonly preparedreviewworkspace_execute_selected_base_pair: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly preparedreviewworkspace_required_base_kind: (a: number, b: number) => void;
    readonly rawstudysplit_study_ids: (a: number, b: number) => void;
    readonly rawstudysplit_take_part: (a: number, b: number, c: number) => void;
    readonly register_raw_participant_partition_artifact: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly review_base_probe_spec_json: (a: number) => void;
    readonly runtime_identity: (a: number) => void;
    readonly runtime_identity_json: (a: number) => void;
    readonly runtime_version: (a: number) => void;
    readonly runtimehandle_artifact_count: (a: number) => number;
    readonly runtimehandle_artifact_metadata_json: (a: number, b: number, c: number) => void;
    readonly runtimehandle_manifest_json: (a: number, b: number) => void;
    readonly runtimehandle_take_artifact_bytes: (a: number, b: number, c: number) => void;
    readonly runtimesupportfiles_new: () => number;
    readonly runtimesupportfiles_put: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly runtimesupportfiles_put_with_name: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly scientific_preflight_json: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly set_comparison_cache_capacity: (a: number) => void;
    readonly set_payload_budget_bytes: (a: number, b: bigint) => void;
    readonly split_raw_by_study_v1: (a: number, b: number) => number;
    readonly verify_evidence_journal_cbor: (a: number, b: number, c: number) => void;
    readonly workflow_contract_json: (a: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
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
