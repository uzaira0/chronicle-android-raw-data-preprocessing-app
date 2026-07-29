import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  getRustRuntimeVersion,
  initializeRustRuntime,
} from "@/lib/rustPipelineRuntime";

describe("Rust runtime initialization", () => {
  it("initializes the generated module from one precompiled WASM module", async () => {
    const bytes = await readFile(
      new URL(
        "../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
        import.meta.url,
      ),
    );
    const compiled = await WebAssembly.compile(bytes);

    await expect(initializeRustRuntime(compiled)).resolves.toBeUndefined();
    await expect(initializeRustRuntime(compiled)).resolves.toBeUndefined();
    await expect(getRustRuntimeVersion()).resolves.toBe(
      "chronicle-preprocessing-runtime/0.1.0",
    );
  });
});
