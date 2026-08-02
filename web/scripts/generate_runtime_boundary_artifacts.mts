/**
 * Generate (or drift-check) the browser boundary validator that the Rust
 * serialization model owns.
 *
 * Source of truth: the `RuntimeManifest` / `ReviewRuntimeManifest` Rust types
 * in `rust/chronicle_preprocessing_runtime_wasm` and the semantic-adapter and
 * chrono-kernel types they embed. The `boundary_model` example parses them
 * with `syn` and prints the complete TypeScript module; this script writes it
 * to `web/src/lib/generatedRuntimeBoundary.ts` or, with `--check`, fails when
 * the committed file no longer matches the Rust model.
 *
 * Same shape as `generate_contract_artifacts.mts` (LinkML -> generatedContract.ts):
 * generate-or-check, one committed artifact, no hand edits.
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repositoryDir = path.resolve(webDir, "..");
const runtimeManifestPath = path.join(
  repositoryDir,
  "rust",
  "chronicle_preprocessing_runtime_wasm",
  "Cargo.toml",
);
const generatedPath = path.join(
  webDir,
  "src",
  "lib",
  "generatedRuntimeBoundary.ts",
);

function renderBoundaryArtifact(): string {
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--locked",
      "--manifest-path",
      runtimeManifestPath,
      "--example",
      "boundary_model",
    ],
    {
      cwd: repositoryDir,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CHRONICLE_REPOSITORY_ROOT: repositoryDir },
    },
  );
  if (result.error) {
    throw new Error(
      `could not run the Rust boundary-model generator: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `the Rust boundary-model generator failed (exit ${result.status}):\n${result.stderr}`,
    );
  }
  if (!result.stdout.includes("RUNTIME_BOUNDARY_MODEL")) {
    throw new Error(
      "the Rust boundary-model generator produced no model; refusing to write a partial artifact",
    );
  }
  return result.stdout;
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const nextContents = renderBoundaryArtifact();
  const currentContents = await readFile(generatedPath, "utf-8").catch(
    () => null,
  );

  if (currentContents !== nextContents) {
    if (checkOnly) {
      throw new Error(
        `${path.relative(webDir, generatedPath)} no longer matches the Rust ` +
          "serialization model; run npm run generate:boundary",
      );
    }
    await writeFile(generatedPath, nextContents, "utf-8");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: checkOnly ? "check" : "write",
        artifacts: [path.relative(webDir, generatedPath)],
      },
      null,
      2,
    ),
  );
}

await main();
