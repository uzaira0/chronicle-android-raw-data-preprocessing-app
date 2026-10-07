import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEPENDENCY_EVIDENCE_GENERATED_PATHS,
  snapshotGeneratedPaths,
} from "./generated_path_transaction.mjs";
import {
  createProcessTreeSupervisor,
  ProcessSignalError,
  stopWriterTreesThenRestore,
} from "./process_tree_supervisor.mjs";
import { wasmBuildOptions } from "./wasm_build_flags.mjs";
import {
  NIGHTLY_TOOLCHAIN,
  SELECTABLE_CAMPAIGNS,
  campaignVerdict,
  currentSelectionBasis,
  assertSelectionBasisUnchanged,
  footprintDir,
  recordCampaignFootprint,
  restampInheritedLedger,
} from "./footprint_selection.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(webRoot, "..");
const runtimeCrate = path.join(
  repositoryRoot,
  "rust/chronicle_preprocessing_runtime_wasm",
);
const semanticRoot = path.join(repositoryRoot, ".semantic-federation");
const semprofBin = process.env.SEM_PROF_BIN || "semprof";

async function refreshDependencyEvidence() {
  // Campaign-scoped variables must never leak in from the operator's shell:
  // an exported CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR (the finally message
  // below used to invite retaining the aborted temp dir) silently pointed the
  // three final-package refreshes -- and later `make all` unit tests -- at the
  // BOOTSTRAP wasm, and a stray FIELD_MIXED_ONLY truncated the recorded
  // aggregate to one column. The campaign steps re-set what they need
  // explicitly in `campaignEnv`.
  delete process.env.CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR;
  delete process.env.FIELD_MIXED_ONLY;
  // A stray footprint directory would make the final-package steps (which run
  // the uninstrumented WASM) throw in their capture hook.
  delete process.env.CHRONICLE_FOOTPRINT_PROFRAW_DIR;
  delete process.env.CHRONICLE_FOOTPRINT_CAMPAIGN_ID;
  const supervisor = createProcessTreeSupervisor({
    // A successful campaign whose vitest/esbuild children need more than the
    // default 2 s to leave the process group under heavy CAP_CPU contention
    // should not cost a full rollback; the override is an escape hatch, not a
    // default change.
    treeDrainWaitMs:
      Number.isSafeInteger(Number(process.env.CHRONICLE_TREE_DRAIN_WAIT_MS)) &&
      Number(process.env.CHRONICLE_TREE_DRAIN_WAIT_MS) > 0
        ? Number(process.env.CHRONICLE_TREE_DRAIN_WAIT_MS)
        : undefined,
  });
  const removeSignalHandlers = supervisor.installSignalHandlers();
  const toolchainEnv = { ...process.env };
  /** @type {string | null} */
  let temporaryPackage = null;
  /** @type {string | null} */
  let backupRoot = null;
  /** @type {ReturnType<typeof snapshotGeneratedPaths> | null} */
  let generatedPathTransaction = null;
  /** @type {Error | null} */
  let outcomeError = null;
  let rollbackFailedPartWay = false;
  let cleanupIsSafe = false;

  /**
   * @param {string} label
   * @param {string} command
   * @param {string[]} args
   * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} options
   */
  function run(label, command, args, options = {}) {
    process.stdout.write(`\n[dependency evidence] ${label}\n`);
    return supervisor.run(label, command, args, {
      cwd: options.cwd ?? webRoot,
      env: options.env ?? process.env,
    });
  }

  const familyExpectedDir = path.join(
    webRoot,
    "src/lib/pipelineGraph/golden/family-expected",
  );
  /** @param {string} goldenFile */
  function goldenMtime(goldenFile) {
    try {
      return statSync(path.join(familyExpectedDir, goldenFile)).mtimeMs;
    } catch {
      return null;
    }
  }
  /**
   * An UPDATE-mode step writes its golden unconditionally, so an unchanged
   * mtime means the recording body never ran at all -- a renamed `it()` title
   * turns a `-t`-filtered vitest run into an all-skipped exit-0 no-op, and
   * "a gate never run is indistinguishable from a gate that passes".
   * @param {string} label
   * @param {string} goldenFile
   * @param {number | null} before
   */
  function assertGoldenRewritten(label, goldenFile, before) {
    const after = goldenMtime(goldenFile);
    if (after === null || (before !== null && after <= before)) {
      throw new Error(
        `${label} exited 0 without rewriting ${goldenFile}: the UPDATE-mode ` +
          "test recorded nothing (check that its test title still matches the " +
          "-t filter in package.json)",
      );
    }
  }

  try {
    supervisor.throwIfStopping();
    temporaryPackage = mkdtempSync(
      path.join(webRoot, ".tmp-dependency-campaign-wasm-"),
    );
    backupRoot = mkdtempSync(
      path.join(webRoot, ".tmp-dependency-evidence-backup-"),
    );
    generatedPathTransaction = snapshotGeneratedPaths({
      repositoryRoot,
      backupRoot,
      relativePaths: [...DEPENDENCY_EVIDENCE_GENERATED_PATHS],
    });
    supervisor.throwIfStopping();

    await run(
      "regenerate product contracts",
      path.join(
        repositoryRoot,
        "scripts/generate_semantic_behavior_inventory.py",
      ),
      ["--contracts-only"],
      { cwd: repositoryRoot },
    );
    await run(
      "refresh structural dependency certificate",
      path.join(
        repositoryRoot,
        "scripts/generate_semantic_behavior_inventory.py",
      ),
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

    // Footprint selection: decide which instrumented campaigns must
    // re-measure before anything is built. FULL=1 forces a complete
    // re-measure. Every selectable campaign gets exactly one loud verdict
    // line — a silent skip and a silent run are equally banned.
    const selectionBasis = currentSelectionBasis({
      repositoryRoot,
      webRoot,
    });
    const assertInputsUnchanged = () => assertSelectionBasisUnchanged(
      selectionBasis, currentSelectionBasis({ repositoryRoot, webRoot }),
    );
    const forceFull = process.env.FULL === "1";
    const campaignSelections = SELECTABLE_CAMPAIGNS.map((campaign) => ({
      campaign,
      verdict: forceFull
        ? /** @type {{verdict: "dirty", reason: string}} */ ({
            verdict: "dirty",
            reason: "FULL=1",
          })
        : campaignVerdict({ campaign, basis: selectionBasis, repositoryRoot }),
    }));
    // Five loud verdict lines, always — a silent skip and a silent run are
    // equally banned, and a silently truncated campaign list must scream.
    if (campaignSelections.length !== 5) {
      throw new Error(
        `expected exactly 5 selectable campaigns, saw ${campaignSelections.length}`,
      );
    }
    for (const { campaign, verdict } of campaignSelections) {
      process.stdout.write(
        verdict.verdict === "clean"
          ? `[footprint] ${campaign.id}: inherit (clean; footprint verified)\n`
          : `[footprint] ${campaign.id}: re-run (dirty: ${verdict.reason})\n`,
      );
    }
    const rerunCampaigns = campaignSelections
      .filter(({ verdict }) => verdict.verdict === "dirty")
      .map(({ campaign }) => campaign);
    const inheritedCampaigns = campaignSelections
      .filter(({ verdict }) => verdict.verdict === "clean")
      .map(({ campaign }) => campaign);

    // The bootstrap runtime is always built with per-crate LLVM coverage
    // instrumentation so every re-run campaign records its executed-file
    // footprint. Requires nightly (profile-rustflags, -Zno-profiler-runtime)
    // with the llvm-tools component; minicov supplies the profiling runtime
    // inside the dependency-campaign-bootstrap feature. `--no-gc-sections`
    // keeps the coverage mapping sections llvm-cov reads out of the linker's
    // reach, and `--no-opt` skips wasm-opt, whose behavior over instrumented
    // code is unvalidated — this package is temporary and never shipped.
    const instrumentedToolchainEnv = {
      ...toolchainEnv,
      RUSTUP_TOOLCHAIN: NIGHTLY_TOOLCHAIN,
    };
    const bootstrapBuildOptions = wasmBuildOptions(
      repositoryRoot,
      instrumentedToolchainEnv,
    );
    if (bootstrapBuildOptions.cargoArgs.length === 0) {
      throw new Error(
        "RUSTFLAGS/CARGO_ENCODED_RUSTFLAGS are set in the environment; the " +
          "instrumented bootstrap build needs Cargo's CLI-config rustflags " +
          "path so target and per-package flags merge — unset them and re-run",
      );
    }
    const instrumentedCrates = [
      "chronicle_app_usage_matcher",
      "chronicle_chrono_kernel_wasm",
      "chronicle_preprocessing_semantic_adapter",
      "chronicle_preprocessing_runtime_wasm",
    ];
    const instrumentedCargoArgs = [
      "--config",
      `target.wasm32-unknown-unknown.rustflags=${JSON.stringify([
        ...bootstrapBuildOptions.remapFlags,
        "-Clink-arg=--no-gc-sections",
      ])}`,
      "-Zprofile-rustflags",
      ...instrumentedCrates.flatMap((crate) => [
        "--config",
        `profile.release.package.${crate}.rustflags=["-Cinstrument-coverage","-Zno-profiler-runtime"]`,
      ]),
    ];
    await run(
      "build isolated campaign runtime (coverage-instrumented)",
      "wasm-pack",
      [
        "build",
        runtimeCrate,
        "--target",
        "web",
        "--no-opt",
        "--out-dir",
        temporaryPackage,
        "--",
        "--features",
        "dependency-campaign-bootstrap",
        ...instrumentedCargoArgs,
      ],
      { env: bootstrapBuildOptions.env },
    );
    // The single authority receipt of THIS run, read from the runtime that
    // every campaign executes — the same embedded constants each campaign
    // manifest reports, so this is not a second derivation. It re-stamps the
    // ledgers of inherited (clean, skipped) campaigns; when any campaign
    // re-ran, its freshly measured receipt must agree exactly (checked below).
    const bootstrapPkg = await import(
      pathToFileURL(
        path.join(temporaryPackage, "chronicle_preprocessing_runtime_wasm.js"),
      ).href
    );
    bootstrapPkg.initSync({
      module: readFileSync(
        path.join(
          temporaryPackage,
          "chronicle_preprocessing_runtime_wasm_bg.wasm",
        ),
      ),
    });
    const bootstrapIdentity = JSON.parse(bootstrapPkg.runtime_identity_json());
    assertInputsUnchanged();
    const donorReceipt = {
      // The literal RuntimeManifest embeds (rust/.../src/lib.rs); if it ever
      // drifts, the inventory's single-receipt gate fails loudly because any
      // re-run campaign records the real value.
      implementation: "chronicle_preprocessing_runtime_wasm/0.1.0",
      implementationDigest: bootstrapIdentity.implementationDigest,
      planDigest: bootstrapIdentity.planDigest,
      profileDigest: bootstrapIdentity.profileDigest,
      profileLockDigest: bootstrapIdentity.profileLockDigest,
      runtimeAuthorityDigest: bootstrapIdentity.runtimeAuthorityDigest,
      productContractDigest: bootstrapIdentity.productContractDigest,
    };
    const footprintProfrawDir = path.join(temporaryPackage, "footprint-profraw");
    mkdirSync(footprintProfrawDir);

    const campaignEnv = {
      ...toolchainEnv,
      CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR: temporaryPackage,
      CHRONICLE_FOOTPRINT_PROFRAW_DIR: footprintProfrawDir,
      UPDATE_CONFIGURATION_SPACE: "1",
      UPDATE_ARTIFACT_INFLUENCE: "1",
      UPDATE_RAW_BOUNDARY_INFLUENCE: "1",
      UPDATE_INTERACTION_INFLUENCE: "1",
      UPDATE_MIXED_INFLUENCE: "1",
      UPDATE_SEMANTIC_MUTATIONS: "1",
    };
    const campaignStepScripts = new Map([
      ["configuration-influence", "test:configuration-influence-parallel"],
      ["artifact-influence", "test:artifact-influence-parallel"],
      ["raw-boundary-influence", "test:raw-boundary-influence-parallel"],
      ["interaction-influence", "test:interaction-influence-parallel"],
      ["mixed-artifact-configuration", "test:mixed-influence"],
    ]);
    const rerunIds = new Set(rerunCampaigns.map((campaign) => campaign.id));
    /** @param {(typeof SELECTABLE_CAMPAIGNS)[number]} campaign */
    const campaignStep = (campaign) => {
      const script = campaignStepScripts.get(campaign.id);
      if (!script) {
        throw new Error(`no npm script mapped for campaign ${campaign.id}`);
      }
      return run(
        campaign.stepLabel,
        "npm",
        ["run", script],
        {
          env: {
            ...campaignEnv,
            CHRONICLE_FOOTPRINT_CAMPAIGN_ID: campaign.id,
          },
        },
      );
    };
    const bootstrapCoveringBefore = goldenMtime(
      "configuration-space-campaign.json",
    );
    await supervisor.runAll([
      run(
        "configuration-space covering array",
        "npm",
        ["run", "test:configuration-space-covering"],
        {
          env: {
            ...campaignEnv,
            CHRONICLE_FOOTPRINT_CAMPAIGN_ID: "configuration-space-covering",
          },
        },
      ),
      ...SELECTABLE_CAMPAIGNS.filter(
        (campaign) =>
          [
            "configuration-influence",
            "artifact-influence",
            "raw-boundary-influence",
          ].includes(campaign.id) && rerunIds.has(campaign.id),
      ).map(campaignStep),
    ]);
    assertGoldenRewritten(
      "configuration-space covering array",
      "configuration-space-campaign.json",
      bootstrapCoveringBefore,
    );
    assertInputsUnchanged();
    const secondGroup = SELECTABLE_CAMPAIGNS.filter(
      (campaign) =>
        ["interaction-influence", "mixed-artifact-configuration"].includes(
          campaign.id,
        ) && rerunIds.has(campaign.id),
    ).map(campaignStep);
    if (secondGroup.length > 0) {
      await supervisor.runAll(secondGroup);
    }
    assertInputsUnchanged();

    // Footprints and inheritance. Every re-run campaign's coverage shards are
    // merged into a per-campaign footprint proof; every inherited campaign's
    // untouched measured ledger is re-stamped with this run's authority
    // receipt so the inventory's single-receipt gate binds one identity. Runs
    // before the mutation step, which reads the influence ledgers and asserts
    // their receipts agree.
    for (const campaign of rerunCampaigns) {
      const freshLedger = JSON.parse(
        readFileSync(
          path.join(familyExpectedDir, campaign.ledger),
          "utf8",
        ),
      );
      for (const [field, value] of Object.entries(donorReceipt)) {
        if (freshLedger.implementationReceipt?.[field] !== value) {
          throw new Error(
            `${campaign.ledger} recorded implementationReceipt.${field} != ` +
              "the bootstrap runtime identity — donor derivation is wrong, " +
              "refusing to re-stamp inherited ledgers from it",
          );
        }
      }
    }
    const linkedBootstrapWasm = path.join(
      runtimeCrate,
      "target/wasm32-unknown-unknown/release/chronicle_preprocessing_runtime_wasm.wasm",
    );
    for (const campaign of rerunCampaigns) {
      if (!existsSync(linkedBootstrapWasm)) {
        throw new Error(
          `linked bootstrap WASM missing at ${linkedBootstrapWasm} — cannot ` +
            "map coverage to source files",
        );
      }
      const recorded = recordCampaignFootprint({
        campaign,
        basis: selectionBasis,
        repositoryRoot,
        profrawRoot: footprintProfrawDir,
        linkedBootstrapWasm,
      });
      process.stdout.write(
        `[footprint] recorded ${campaign.id}: ${recorded.covered} covered ` +
          `files, ${recorded.untracked} untracked\n`,
      );
    }
    for (const campaign of inheritedCampaigns) {
      const footprintFile = path.join(
        footprintDir(repositoryRoot),
        `${campaign.id}.json`,
      );
      const footprintFileDigest = `sha256:${createHash("sha256")
        .update(readFileSync(footprintFile))
        .digest("hex")}`;
      restampInheritedLedger({
        familyExpectedDir,
        campaign,
        donorReceipt,
        footprintFileDigest,
      });
      process.stdout.write(
        `[footprint] inherited ${campaign.id}: measured ledger kept, ` +
          `receipt re-stamped to this run\n`,
      );
    }

    await run(
      "dependency-model mutations",
      "npm",
      ["run", "test:semantic-mutations"],
      { env: campaignEnv },
    );
    await run(
      "regenerate the checked dependency receipt",
      path.join(
        repositoryRoot,
        "scripts/generate_semantic_behavior_inventory.py",
      ),
      [],
      { cwd: repositoryRoot },
    );
    // The final inventory refresh can change capability bindings and resources
    // after the bootstrap profile was resolved. Re-resolve the complete semantic
    // set and close it before compiling the normal runtime that embeds those
    // exact profile and lock bytes.
    await run(
      "regenerate the final semantic profile",
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
      "resolve the final semantic profile",
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
      "verify the final semantic profile",
      semprofBin,
      ["verify", "--lock", "semantic/semantic-profile.lock"],
      { cwd: semanticRoot },
    );
    await run(
      "verify the final capability bindings",
      semprofBin,
      ["verify-bindings", "--bindings", "semantic/capability-bindings.json"],
      { cwd: semanticRoot },
    );
    await run(
      "regenerate the final conformance report",
      semprofBin,
      [
        "conform",
        "--lock",
        "semantic/semantic-profile.lock",
        "--subject",
        "semantic/semantic-profile.json",
        "--output",
        "semantic/conformance-report.json",
      ],
      { cwd: semanticRoot },
    );
    await run(
      "regenerate the final semantic artifact closure",
      semprofBin,
      [
        "closure",
        "--root",
        "semantic",
        "--output",
        "semantic/artifact-closure.json",
      ],
      { cwd: semanticRoot },
    );
    await run("rebuild the normal fail-closed WASM package", "npm", [
      "run",
      "build:wasm",
    ]);
    assertInputsUnchanged();
    // Workspace roots include the build-environment digest. The temporary
    // campaign runtime deliberately enables a bootstrap feature, so its roots
    // cannot be the checked expectation for the normal browser build. Refresh
    // this result snapshot once with the final fail-closed WASM package.
    const finalCoveringBefore = goldenMtime("configuration-space-campaign.json");
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
    assertGoldenRewritten(
      "refresh final-runtime configuration-space snapshot",
      "configuration-space-campaign.json",
      finalCoveringBefore,
    );
    // Reconciles the declared field-level edges against the changed-cell
    // sidecars the campaigns above just rewrote, so it must run last and against
    // the final fail-closed package.
    const provenanceBefore = goldenMtime("field-level-provenance-ledger.json");
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
    assertGoldenRewritten(
      "refresh field-level provenance reconciliation",
      "field-level-provenance-ledger.json",
      provenanceBefore,
    );
    // Per-source-column mixed tomography pins the implementation receipt of the
    // final fail-closed package, so it runs after the last build:wasm above.
    const fieldMixedBefore = goldenMtime("field-mixed-tomography-ledger.json");
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
    assertGoldenRewritten(
      "refresh per-field mixed tomography",
      "field-mixed-tomography-ledger.json",
      fieldMixedBefore,
    );
    assertInputsUnchanged();
    await supervisor.waitForIdle();
    cleanupIsSafe = true;
  } catch (error) {
    outcomeError = error instanceof Error ? error : new Error(String(error));
    try {
      outcomeError = await stopWriterTreesThenRestore(
        supervisor,
        generatedPathTransaction,
        outcomeError,
      );
      cleanupIsSafe = true;
    } catch (rollbackError) {
      // stopWriterTreesThenRestore wraps a restore() failure in an
      // AggregateError; anything else means the writer trees never drained.
      rollbackFailedPartWay = rollbackError instanceof AggregateError;
      outcomeError =
        rollbackError instanceof Error
          ? rollbackError
          : new Error(String(rollbackError));
    }
  } finally {
    removeSignalHandlers();
    if (cleanupIsSafe) {
      if (temporaryPackage) {
        rmSync(temporaryPackage, { recursive: true, force: true });
      }
      if (generatedPathTransaction) {
        generatedPathTransaction.cleanup();
      } else if (backupRoot) {
        rmSync(backupRoot, { recursive: true, force: true });
      }
    } else {
      const retainedPaths = [temporaryPackage, backupRoot]
        .filter((candidate) => candidate !== null)
        .join(", ");
      process.stderr.write(
        rollbackFailedPartWay
          ? `\n[dependency evidence] generated-path rollback FAILED PART-WAY; the working tree is a mix of snapshot and campaign output — restore manually from the backup before re-running; retained recovery paths: ${retainedPaths}\n`
          : `\n[dependency evidence] rollback refused while a writer tree may remain; retained recovery paths: ${retainedPaths}\n`,
      );
    }
  }

  if (outcomeError) throw outcomeError;
}

try {
  await refreshDependencyEvidence();
  process.stdout.write(
    "\n[dependency evidence] all ledgers and normal WASM package refreshed\n",
  );
} catch (error) {
  if (error instanceof ProcessSignalError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
