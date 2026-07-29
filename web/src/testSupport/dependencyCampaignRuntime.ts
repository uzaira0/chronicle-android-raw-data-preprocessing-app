import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WASM_FILE = "chronicle_preprocessing_runtime_wasm_bg.wasm";

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
