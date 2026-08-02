import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(webRoot, "..");
const runtimeCrate = path.join(
  repositoryRoot,
  "rust/chronicle_preprocessing_runtime_wasm",
);
const semanticRoot = path.join(repositoryRoot, ".semantic-federation");
const localSemprof = path.join(
  homedir(),
  "semantic-profile-toolchain",
  "target",
  "debug",
  "semprof",
);
const semprofBin = process.env.SEM_PROF_BIN ||
  (existsSync(localSemprof) ? localSemprof : "semprof");
const temporaryPackage = mkdtempSync(
  path.join(tmpdir(), "chronicle-dependency-campaign-wasm-"),
);
const backupRoot = mkdtempSync(
  path.join(tmpdir(), "chronicle-dependency-evidence-backup-"),
);
const generatedPaths = [
  "web/src/lib/pipelineGraph/golden/family-expected",
  "web/src/wasm/chronicle_preprocessing_runtime_wasm",
  ".semantic-federation/proofs/dependency-certificate.json",
  ".semantic-federation/semantic/capability-bindings.json",
  ".semantic-federation/semantic/resources",
  ".semantic-federation/semantic/semantic-profile.json",
  ".semantic-federation/semantic/semantic-profile.lock",
  "docs/semantic-federation/behavior-inventory.json",
];
const toolchainEnv = {
  ...process.env,
  PATH: `${path.join(homedir(), ".cargo", "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
};

/**
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<void>}
 */
function run(label, command, args, options = {}) {
  process.stdout.write(`\n[dependency evidence] ${label}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? webRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} ended from signal ${signal}`));
      } else if (code !== 0) {
        reject(new Error(`${label} failed with exit code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

/** Wait for every child before reporting failure so no writer outlives rollback. */
/** @param {Promise<unknown>[]} jobs */
async function runAll(jobs) {
  const results = await Promise.allSettled(jobs);
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
}

const snapshots = generatedPaths.map((relativePath, index) => {
  const source = path.join(repositoryRoot, relativePath);
  const backup = path.join(backupRoot, String(index));
  const existed = existsSync(source);
  if (existed) cpSync(source, backup, { recursive: true });
  return { source, backup, existed };
});

function restoreSnapshots() {
  for (const snapshot of snapshots) {
    rmSync(snapshot.source, { recursive: true, force: true });
    if (snapshot.existed) {
      mkdirSync(path.dirname(snapshot.source), { recursive: true });
      cpSync(snapshot.backup, snapshot.source, { recursive: true });
    }
  }
}

try {
  await run(
    "regenerate product contracts",
    path.join(repositoryRoot, "scripts/generate_semantic_behavior_inventory.py"),
    ["--contracts-only"],
    { cwd: repositoryRoot },
  );
  await run(
    "refresh structural dependency certificate",
    path.join(repositoryRoot, "scripts/generate_semantic_behavior_inventory.py"),
    ["--certificate-only"],
    { cwd: repositoryRoot },
  );
  await run(
    "regenerate semantic profile",
    semprofBin,
    [
      "generate",
      "--source",
      "semantic/profile-source.json",
      "--output",
      "semantic/semantic-profile.json",
    ],
    { cwd: semanticRoot },
  );
  await run(
    "resolve semantic profile",
    semprofBin,
    [
      "resolve",
      "--manifest",
      "semantic/semantic-profile.json",
      "--registry",
      "vendor/semantic-profile-registry",
      "--output",
      "semantic/semantic-profile.lock",
    ],
    { cwd: semanticRoot },
  );
  await run(
    "verify semantic profile",
    semprofBin,
    ["verify", "--lock", "semantic/semantic-profile.lock"],
    { cwd: semanticRoot },
  );
  await run(
    "verify capability bindings",
    semprofBin,
    ["verify-bindings", "--bindings", "semantic/capability-bindings.json"],
    { cwd: semanticRoot },
  );

  await run("build isolated campaign runtime", "wasm-pack", [
    "build",
    runtimeCrate,
    "--target",
    "web",
    "--out-dir",
    temporaryPackage,
    "--features",
    "dependency-campaign-bootstrap",
  ], { env: toolchainEnv });

  const campaignEnv = {
    ...toolchainEnv,
    CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR: temporaryPackage,
    UPDATE_CONFIGURATION_SPACE: "1",
    UPDATE_ARTIFACT_INFLUENCE: "1",
    UPDATE_RAW_BOUNDARY_INFLUENCE: "1",
    UPDATE_INTERACTION_INFLUENCE: "1",
    UPDATE_MIXED_INFLUENCE: "1",
    UPDATE_SEMANTIC_MUTATIONS: "1",
  };
  await runAll([
    run(
      "configuration-space covering array",
      "npm",
      ["run", "test:configuration-space-covering"],
      { env: campaignEnv },
    ),
    run(
      "configuration interventions",
      "npm",
      ["run", "test:configuration-influence-parallel"],
      { env: campaignEnv },
    ),
    run(
      "artifact interventions",
      "npm",
      ["run", "test:artifact-influence-parallel"],
      { env: campaignEnv },
    ),
    run(
      "raw timestamp boundaries",
      "npm",
      ["run", "test:raw-boundary-influence-parallel"],
      { env: campaignEnv },
    ),
  ]);
  await runAll([
    run(
      "configuration interactions",
      "npm",
      ["run", "test:interaction-influence-parallel"],
      { env: campaignEnv },
    ),
    run(
      "artifact/configuration interactions",
      "npm",
      ["run", "test:mixed-influence"],
      { env: campaignEnv },
    ),
  ]);
  await run(
    "dependency-model mutations",
    "npm",
    ["run", "test:semantic-mutations"],
    { env: campaignEnv },
  );
  await run(
    "regenerate the checked dependency receipt",
    path.join(repositoryRoot, "scripts/generate_semantic_behavior_inventory.py"),
    [],
    { cwd: repositoryRoot },
  );
  await run("rebuild the normal fail-closed WASM package", "npm", [
    "run",
    "build:wasm",
  ]);
  // Workspace roots include the build-environment digest. The temporary
  // campaign runtime deliberately enables a bootstrap feature, so its roots
  // cannot be the checked expectation for the normal browser build. Refresh
  // this result snapshot once with the final fail-closed WASM package.
  await run(
    "refresh final-runtime configuration-space snapshot",
    "npm",
    ["run", "test:configuration-space-covering"],
    {
      env: {
        ...toolchainEnv,
        UPDATE_CONFIGURATION_SPACE: "1",
      },
    },
  );
  // Reconciles the declared field-level edges against the changed-cell
  // sidecars the campaigns above just rewrote, so it must run last and against
  // the final fail-closed package.
  await run(
    "refresh field-level provenance reconciliation",
    "npm",
    ["run", "test:field-provenance"],
    {
      env: {
        ...toolchainEnv,
        UPDATE_FIELD_PROVENANCE: "1",
      },
    },
  );
  // Per-source-column mixed tomography pins the implementation receipt of the
  // final fail-closed package, so it runs after the last build:wasm above.
  await run(
    "refresh per-field mixed tomography",
    "npm",
    ["run", "test:field-mixed-tomography"],
    {
      env: {
        ...toolchainEnv,
        UPDATE_FIELD_MIXED: "1",
      },
    },
  );
} catch (error) {
  restoreSnapshots();
  throw error;
} finally {
  rmSync(temporaryPackage, { recursive: true, force: true });
  rmSync(backupRoot, { recursive: true, force: true });
}

process.stdout.write("\n[dependency evidence] all ledgers and normal WASM package refreshed\n");
