/// <reference types="vite/client" />

declare module "@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js" {
  export default function init(): Promise<void>;
  export function matcherVersion(): string;
  export function matchAppUsageUpdateIndices(
    appCodes: number[],
    timestampNs: number[],
    resumed: Uint8Array,
    sameStop: Uint8Array,
    otherStop: Uint8Array,
    stopped: Uint8Array,
    allowStopEventReuse: boolean,
    useActivityStoppedAsFallback: boolean,
    applyThresholdToFallback: boolean,
    longDurationThresholdNs: number,
  ): unknown;
}
