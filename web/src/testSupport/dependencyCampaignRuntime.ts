import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const WASM_FILE = "chronicle_preprocessing_runtime_wasm_bg.wasm";

/**
 * Hook timeout for the synchronous `initSync` of the campaign runtime. The
 * evidence refresh runs three campaigns × four shards plus the covering-array
 * suite at once — thirteen processes each compiling the same multi-megabyte
 * module — inside a CPU-quota'd cgroup that other agents' jobs share. Under
 * that contention a compile has exceeded the global 10 s `hookTimeout` and
 * then a 90 s bound (dependency-evidence runs 4 and 6, 2026-08-17) without
 * anything being wrong; a synchronous compile cannot hang, it completes or the
 * process dies. The bound stays finite so a stuck hook still fails by name;
 * it is wide enough for a cold compile starved to a fraction of one core.
 */
export const CAMPAIGN_RUNTIME_INIT_TIMEOUT_MS = 300_000;

/**
 * Hook timeout for the footprint-capture `afterAll`. The capture itself is a
 * memory walk plus one file write, but it runs at the END of a campaign shard
 * while three sibling shards and the other campaigns still saturate the same
 * CPU-quota'd cgroup — the global 10 s `hookTimeout` expired there on
 * dependency-evidence run 2 (2026-08-28) after the shard's own test had
 * already passed. Same contention rationale as the init timeout above.
 */
export const CAMPAIGN_FOOTPRINT_CAPTURE_TIMEOUT_MS = 300_000;

/**
 * Load the normal checked-in runtime unless the evidence-refresh command has
 * supplied its isolated test-only package. Vite separately redirects the JS
 * module import to the same directory.
 */
export function dependencyCampaignRuntimeBytes(): Uint8Array {
  const override = process.env.CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR;
  return readFileSync(
    override
      ? resolve(override, WASM_FILE)
      : new URL(`../wasm/chronicle_preprocessing_runtime_wasm/pkg/${WASM_FILE}`, import.meta.url),
  );
}

/**
 * Write this campaign process's LLVM profraw counters for footprint selection.
 *
 * Active only when the dependency-evidence refresh exports
 * CHRONICLE_FOOTPRINT_PROFRAW_DIR (never in normal test runs). Fail-closed by
 * construction: a missing export on the loaded runtime or an empty capture is
 * an error, never a silent skip — a campaign that ran without recording its
 * footprint must not be treated as "no footprint change". Shards of one
 * campaign each write their own pid-named file; llvm-profdata merges them.
 */
export function captureCampaignFootprint(runtime: object): void {
  const directory = process.env.CHRONICLE_FOOTPRINT_PROFRAW_DIR;
  if (!directory) return;
  // The export exists only in the instrumented bootstrap build, so the normal
  // package's type declarations (deliberately) do not know it.
  const capture = (runtime as { capture_coverage_profraw?: () => Uint8Array })
    .capture_coverage_profraw;
  if (typeof capture !== "function") {
    throw new Error(
      "CHRONICLE_FOOTPRINT_PROFRAW_DIR is set but the campaign runtime has no " +
        "capture_coverage_profraw export — the bootstrap WASM was built without " +
        "coverage instrumentation",
    );
  }
  const bytes = capture();
  if (bytes.length === 0) {
    throw new Error("campaign footprint capture returned an empty profraw");
  }
  const campaign = process.env.CHRONICLE_FOOTPRINT_CAMPAIGN_ID ?? "campaign";
  writeFileSync(resolve(directory, `${campaign}-${process.pid}.profraw`), bytes);
}
