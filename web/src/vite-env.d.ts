/// <reference types="vite/client" />

declare module "@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js" {
  export default function init(): Promise<void>;
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
}
