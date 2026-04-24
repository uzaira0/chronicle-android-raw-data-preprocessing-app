import * as Comlink from "comlink";
import type { MatcherInput, MatcherOutput } from "@/lib/types";

let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
    await module.default();
  })();
  return initPromise;
}

const api = {
  async matcherVersion(): Promise<string> {
    await ensureInit();
    const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
    return module.matcherVersion();
  },
  async runMatcher(input: MatcherInput): Promise<MatcherOutput> {
    await ensureInit();
    const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
    const encodeFlags = (values: boolean[]): Uint8Array =>
      Uint8Array.from(values, (value) => (value ? 1 : 0));
    return module.matchAppUsageUpdateIndices(
      input.appCodes,
      input.timestampNs,
      encodeFlags(input.resumed),
      encodeFlags(input.sameStop),
      encodeFlags(input.otherStop),
      encodeFlags(input.stopped),
      input.options.allowStopEventReuse,
      input.options.useActivityStoppedAsFallback,
      input.options.applyThresholdToFallback,
      input.options.longDurationThresholdNs,
    ) as MatcherOutput;
  },
};

export type ChronicleWorkerApi = typeof api;

Comlink.expose(api);
