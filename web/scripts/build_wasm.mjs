import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { wasmBuildOptions } from "./wasm_build_flags.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(webRoot, "..");
const buildOptions = wasmBuildOptions(repositoryRoot);

const crates = [
  ["chronicle_preprocessing_runtime_wasm", "chronicle_preprocessing_runtime_wasm"],
  ["chronicle_semantic_index_wasm", "chronicle_semantic_index_wasm"],
];

for (const [crate, output] of crates) {
  process.stdout.write(`building ${crate} for browser WASM\n`);
  const result = spawnSync(
    "wasm-pack",
    [
      "build",
      `../rust/${crate}`,
      "--target",
      "web",
      "--out-dir",
      `../../web/src/wasm/${output}/pkg`,
      ...(buildOptions.cargoArgs.length > 0
        ? ["--", ...buildOptions.cargoArgs]
        : []),
    ],
    { env: buildOptions.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The license notices of the crates just linked are committed beside the
// packages (the deploy runner cannot resolve the Rust graph); `make wasm-fresh`
// fails when this regeneration changes them.
const notices = spawnSync(process.execPath, [path.join(webRoot, "scripts", "rust_wasm_notices.mjs")], {
  stdio: "inherit",
});
if (notices.error) throw notices.error;
if (notices.status !== 0) process.exit(notices.status ?? 1);
