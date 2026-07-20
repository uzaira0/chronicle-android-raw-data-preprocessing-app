/**
 * Shared WASM matcher/splitter harness for the vite-node profiler + runner
 * scripts (profile_steps.mts, profile_intl_breakdown.mts,
 * run_browser_processing.mts).
 *
 * These three scripts each had a byte-identical copy of the default-support
 * loader, the one-shot WASM init, and the matcher/splitter adapters — three
 * copies that would silently drift (e.g. a matcher-signature change landing in
 * one but not the others). This module is the single source of truth.
 *
 * Every path here is resolved relative to THIS file's directory, which is the
 * same `scripts/` directory the callers live in, so the `../src/...` targets
 * are unchanged.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  BrowserSupportFiles,
  MatcherInput,
  MatcherOutput,
  SplitterInput,
  SplitterOutput,
} from "../src/lib/types";

const SCRIPTS_DIR = path.dirname(new URL(import.meta.url).pathname);

export const DEFAULTS_DIR = path.resolve(SCRIPTS_DIR, "../src/assets/defaults");

const WASM_MODULE_PATH = "../src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js";
const WASM_BINARY_PATH = path.resolve(
  SCRIPTS_DIR,
  "../src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm_bg.wasm",
);

/** Load a default support file (filter/codebook/etc.) as name + raw bytes. */
export async function loadDefaultSupport(name: string): Promise<{ name: string; bytes: ArrayBuffer }> {
  const bytes = await readFile(path.join(DEFAULTS_DIR, name));
  return {
    name,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

let initPromise: Promise<void> | null = null;

/** Initialise the WASM matcher module exactly once per process. */
export async function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const module = await import(WASM_MODULE_PATH);
    await module.default({ module_or_path: await readFile(WASM_BINARY_PATH) });
  })();
  return initPromise;
}

/** Node-side adapter to the WASM app-usage matcher (matches the worker call). */
export async function runMatcher(input: MatcherInput): Promise<MatcherOutput> {
  await ensureInit();
  const module = await import(WASM_MODULE_PATH);
  return module.matchAppUsageUpdateIndices(
    input.appCodes,
    input.timestampNs,
    input.resumed,
    input.sameStop,
    input.otherStop,
    input.stopped,
    input.background,
    input.options.allowStopEventReuse,
    input.options.useActivityStoppedAsFallback,
    input.options.applyThresholdToFallback,
    input.options.longDurationThresholdNs,
  ) as MatcherOutput;
}

/** Node-side adapter to the WASM overlapping-session splitter. */
export async function runSplitter(input: SplitterInput): Promise<SplitterOutput> {
  await ensureInit();
  const module = await import(WASM_MODULE_PATH);
  const wasmModule = module as unknown as {
    splitOverlappingSessions: (starts: BigInt64Array, stops: BigInt64Array) => SplitterOutput;
  };
  return wasmModule.splitOverlappingSessions(input.starts, input.stops);
}

export type { BrowserSupportFiles };
