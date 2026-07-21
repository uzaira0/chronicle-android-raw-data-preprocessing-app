/// <reference types="vite/client" />

// Build identity injected by Vite `define` (vite.config.ts) at build time.
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;

declare module "@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js" {
  export default function init(): Promise<void>;
  export function initSync(input: { module: BufferSource | WebAssembly.Module }): unknown;
  export function matcherVersion(): string;
  export function matchAppUsageUpdateIndices(
    appCodes: Int32Array,
    timestampNs: BigInt64Array,
    resumed: Uint8Array,
    sameStop: Uint8Array,
    otherStop: Uint8Array,
    stopped: Uint8Array,
    background: Uint8Array,
    allowStopEventReuse: boolean,
    useActivityStoppedAsFallback: boolean,
    applyThresholdToFallback: boolean,
    longDurationThresholdNs: bigint,
  ): unknown;
  export function matchAppUsageUpdateIndicesV2(
    appCodes: Int32Array,
    timestampNs: BigInt64Array,
    resumed: Uint8Array,
    sameStop: Uint8Array,
    otherStop: Uint8Array,
    stopped: Uint8Array,
    background: Uint8Array,
    allowStopEventReuse: boolean,
    useActivityStoppedAsFallback: boolean,
    applyThresholdToFallback: boolean,
    longDurationThresholdNs: bigint,
    proximityNs: bigint,
  ): unknown;
  export function splitOverlappingSessions(
    starts: BigInt64Array,
    stops: BigInt64Array,
  ): unknown;
}
