import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const cargoBin = path.join(homedir(), ".cargo", "bin");
const env = {
  ...process.env,
  PATH: `${cargoBin}${path.delimiter}${process.env.PATH ?? ""}`,
};

const crates = [
  ["chronicle_app_usage_wasm", "chronicle_app_usage_wasm"],
  ["chronicle_preprocessing_runtime_wasm", "chronicle_preprocessing_runtime_wasm"],
  ["chronicle_semantic_index_wasm", "chronicle_semantic_index_wasm"],
];
if (process.argv.includes("--include-benchmark-kernel")) {
  // The production runtime already compiles and embeds this kernel. Its
  // standalone WASM package exists only for the low-level benchmark scripts;
  // rebuilding it during every app/test build duplicated the slowest wasm-opt
  // pass without changing the application bundle.
  crates.splice(1, 0, ["chronicle_chrono_kernel_wasm", "chronicle_chrono_kernel_wasm"]);
}

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
    ],
    { env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
