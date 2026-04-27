/* tslint:disable */
/* eslint-disable */

/**
 * Boundary-friendly handle to a completed pipeline run. Holds the produced
 * CSV bytes inside Rust linear memory; JS pulls them out via `app_bytes` /
 * `screen_bytes`, each of which is a single `Uint8Array` copy at the
 * boundary. This avoids the JS-Array-length cap that `serde-wasm-bindgen`
 * hits when round-tripping >100 MB Vec<u8> as a regular array.
 */
export class PipelineV2Handle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Returns a copy of the app CSV bytes as a Uint8Array. The internal
     * buffer is *not* released; call `take_app_bytes` if you want move
     * semantics (frees Rust memory).
     */
    app_bytes(): Uint8Array;
    screen_bytes(): Uint8Array;
    take_app_bytes(): Uint8Array;
    take_screen_bytes(): Uint8Array;
    readonly app_row_count: number;
    readonly duplicate_timestamps_corrected: number;
    readonly original_row_count: number;
    readonly processed_row_count: number;
    readonly screen_row_count: number;
}

export function dedupe_event_rows(ts_ns: BigInt64Array, interaction_type: string[], app_package_name: string[]): any;

export function derive_screen_usage_sessions(event_timestamp_ns: BigInt64Array, interaction_type: string[], app_package_name: string[], timezone: string[], apps_forcing_keys: string[], apps_forcing_values: string[], auto_lock_timeout_seconds: number, auto_lock_tolerance_seconds: number, manual_lock_max_tail_seconds: number, keyguard_near_stop_seconds: number): any;

export function format_timestamps(ts_ns: BigInt64Array, tz_name: string): any;

export function parse_raw_csv(bytes: Uint8Array): any;

export function process_full_pipeline_e2e(csv_bytes: Uint8Array, tz_name: string, filtered_packages: string[], same_stop_types: string[], other_stop_types: string[], long_duration_threshold_ns: bigint, allow_stop_event_reuse: boolean, use_activity_stopped_as_fallback: boolean, apply_threshold_to_fallback: boolean): Uint8Array;

export function process_full_pipeline_v2(csv_bytes: Uint8Array, options_json: string, filter_csv_bytes: Uint8Array, apps_forcing_csv_bytes: Uint8Array, codebook_csv_bytes: Uint8Array): PipelineV2Handle;

/**
 * End-to-end pipeline: raw CSV bytes IN → processed CSV bytes OUT.
 * Does parse + sort + dedup + format + write entirely in Rust. The only
 * boundary crossings are the two byte arrays.
 *
 * Output columns (subset of the real pipeline, enough to be representative
 * and to compare against an equivalent TS path):
 *   event_timestamp, app_package_name, interaction_type, date, hour, day
 */
export function process_pipeline_e2e(csv_bytes: Uint8Array, tz_name: string): Uint8Array;

/**
 * Stable sort of a timestamp column. Returns a permutation array of u32
 * row indices such that ts_ns[result[i]] is non-decreasing, with original
 * position breaking ties.
 *
 * Boundary: BigInt64Array in, Uint32Array out. Cheap.
 */
export function sort_by_timestamp_stable(ts_ns: BigInt64Array): Uint32Array;

/**
 * Minimal-boundary-cost CSV writer benchmark.
 * Inputs:
 *   * `event_timestamps`  — pre-formatted timestamp strings (one per row).
 *   * `app_packages`       — string per row.
 *   * `interaction_types`  — string per row.
 *   * `hours`              — u8 per row.
 *   * `days`               — u8 per row.
 * Output: a single Uint8Array of CSV bytes (header + rows + LF).
 *
 * This simulates the per-row CSV-escape + concat work in `buildAppCsvText`
 * for a representative subset of columns. The boundary cost on input is
 * the same string-vector marshalling that hurt the parse benchmark; on
 * output it is one ArrayBuffer transfer.
 */
export function write_simple_csv(event_timestamps: string[], app_packages: string[], interaction_types: string[], hours: Uint8Array, days: Uint8Array): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_pipelinev2handle_free: (a: number, b: number) => void;
    readonly dedupe_event_rows: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly derive_screen_usage_sessions: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => void;
    readonly format_timestamps: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly parse_raw_csv: (a: number, b: number, c: number) => void;
    readonly pipelinev2handle_app_bytes: (a: number, b: number) => void;
    readonly pipelinev2handle_app_row_count: (a: number) => number;
    readonly pipelinev2handle_duplicate_timestamps_corrected: (a: number) => number;
    readonly pipelinev2handle_original_row_count: (a: number) => number;
    readonly pipelinev2handle_processed_row_count: (a: number) => number;
    readonly pipelinev2handle_screen_bytes: (a: number, b: number) => void;
    readonly pipelinev2handle_screen_row_count: (a: number) => number;
    readonly pipelinev2handle_take_app_bytes: (a: number, b: number) => void;
    readonly pipelinev2handle_take_screen_bytes: (a: number, b: number) => void;
    readonly process_full_pipeline_e2e: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: number, n: number, o: number) => void;
    readonly process_full_pipeline_v2: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly process_pipeline_e2e: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sort_by_timestamp_stable: (a: number, b: number, c: number) => void;
    readonly write_simple_csv: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
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
