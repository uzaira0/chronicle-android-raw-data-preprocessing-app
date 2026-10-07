import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SELECTABLE_CAMPAIGNS,
  assertSelectionBasisUnchanged,
  campaignVerdict,
  classifyCoverageFile,
  footprintDir,
  harnessClosureFiles,
  restampInheritedLedger,
} from "../../scripts/footprint_selection.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) =>
        rm(temporaryRoot, { recursive: true, force: true }),
      ),
  );
});

function temporaryRepository(): string {
  const root = mkdtempSync(path.resolve(import.meta.dirname, "../../.tmp-footprint-"));
  temporaryRoots.push(root);
  return root;
}

const FIRST_CAMPAIGN = SELECTABLE_CAMPAIGNS[0];
if (!FIRST_CAMPAIGN) throw new Error("no selectable campaigns declared");
const CAMPAIGN = FIRST_CAMPAIGN;

interface FootprintOverrides {
  schema?: string;
  coveredFiles?: Array<{ path: string; digest: string }>;
  untrackedTouchedFiles?: string[];
  manifestClosureDigest?: string;
  harnessDigest?: string;
  contractDigest?: string;
  toolchain?: string;
}

const MATCHING_BASIS: import("../../scripts/footprint_selection.mjs").SelectionBasis = {
  perFileDigests: {
    "rust/x/src/lib.rs": "sha256:aa",
    "rust/x/src/other.rs": "sha256:bb",
    "rust/x/Cargo.lock": "sha256:cc",
  },
  manifestClosureDigest: "sha256:manifests",
  contractDigest: "sha256:contract",
  harnessDigests: { [CAMPAIGN.id]: "sha256:harness" },
  toolchain: "rustc 1.99.0-nightly | binary: rustc",
};

function writeFootprint(
  repositoryRoot: string,
  overrides: FootprintOverrides = {},
): void {
  const directory = footprintDir(repositoryRoot);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, `${CAMPAIGN.id}.json`),
    `${JSON.stringify({
      schema: "chronicle-campaign-footprint/v1",
      campaign: CAMPAIGN.id,
      coveredFiles: [{ path: "rust/x/src/lib.rs", digest: "sha256:aa" }],
      untrackedTouchedFiles: [],
      manifestClosureDigest: MATCHING_BASIS.manifestClosureDigest,
      harnessDigest: MATCHING_BASIS.harnessDigests[CAMPAIGN.id],
      contractDigest: MATCHING_BASIS.contractDigest,
      toolchain: MATCHING_BASIS.toolchain,
      ...overrides,
    })}\n`,
  );
}

describe("campaign footprint verdicts", () => {
  it("refuses in-flight source, build-flag, or harness changes, including uncovered sources", () => {
    expect(() => assertSelectionBasisUnchanged(MATCHING_BASIS, structuredClone(MATCHING_BASIS))).not.toThrow();
    for (const current of [
      { ...MATCHING_BASIS, perFileDigests: { ...MATCHING_BASIS.perFileDigests, "rust/x/src/other.rs": "sha256:changed" } },
      { ...MATCHING_BASIS, perFileDigests: { ...MATCHING_BASIS.perFileDigests, "web/scripts/wasm_build_flags.mjs": "sha256:changed" } },
      { ...MATCHING_BASIS, harnessDigest: "sha256:changed" },
    ]) {
      expect(() => assertSelectionBasisUnchanged(MATCHING_BASIS, current)).toThrow("inputs changed during the run");
    }
  });

  it("declares exactly the five instrumented bootstrap campaigns selectable", () => {
    expect(SELECTABLE_CAMPAIGNS.map((campaign) => campaign.id)).toEqual([
      "configuration-influence",
      "artifact-influence",
      "raw-boundary-influence",
      "interaction-influence",
      "mixed-artifact-configuration",
    ]);
  });

  it("is dirty (fail-closed) without a recorded footprint", () => {
    const repositoryRoot = temporaryRepository();
    expect(
      campaignVerdict({
        campaign: CAMPAIGN,
        basis: MATCHING_BASIS,
        repositoryRoot,
      }),
    ).toEqual({ verdict: "dirty", reason: "no recorded footprint" });
  });

  it("is clean only when every conditioning fact is unchanged", () => {
    const repositoryRoot = temporaryRepository();
    writeFootprint(repositoryRoot);
    expect(
      campaignVerdict({
        campaign: CAMPAIGN,
        basis: MATCHING_BASIS,
        repositoryRoot,
      }),
    ).toEqual({ verdict: "clean" });
  });

  it("flips dirty when a covered file's digest moves and stays clean when only an uncovered source moves", () => {
    const repositoryRoot = temporaryRepository();
    writeFootprint(repositoryRoot);
    const coveredEdit = {
      ...MATCHING_BASIS,
      perFileDigests: {
        ...MATCHING_BASIS.perFileDigests,
        "rust/x/src/lib.rs": "sha256:changed",
      },
    };
    expect(
      campaignVerdict({
        campaign: CAMPAIGN,
        basis: coveredEdit,
        repositoryRoot,
      }),
    ).toEqual({
      verdict: "dirty",
      reason: "covered file changed: rust/x/src/lib.rs",
    });
    const uncoveredEdit = {
      ...MATCHING_BASIS,
      perFileDigests: {
        ...MATCHING_BASIS.perFileDigests,
        "rust/x/src/other.rs": "sha256:changed",
      },
    };
    expect(
      campaignVerdict({
        campaign: CAMPAIGN,
        basis: uncoveredEdit,
        repositoryRoot,
      }),
    ).toEqual({ verdict: "clean" });
  });

  it("dirties every remaining conditioning axis: removal, schema, untracked, manifests, harness, contract, toolchain, empty coverage", () => {
    const repositoryRoot = temporaryRepository();
    const cases: Array<{
      overrides: FootprintOverrides;
      basis?: typeof MATCHING_BASIS;
      reason: string;
    }> = [
      {
        overrides: {},
        basis: { ...MATCHING_BASIS, perFileDigests: {} },
        reason: "covered file removed: rust/x/src/lib.rs",
      },
      {
        overrides: { schema: "chronicle-campaign-footprint/v0" },
        reason: "footprint schema chronicle-campaign-footprint/v0",
      },
      {
        overrides: { untrackedTouchedFiles: ["rust/unknown.rs"] },
        reason:
          "prior run touched files outside the digest map: rust/unknown.rs",
      },
      {
        overrides: { manifestClosureDigest: "sha256:stale" },
        reason: "crate manifest closure changed (Cargo.toml/Cargo.lock)",
      },
      {
        overrides: { harnessDigest: "sha256:stale" },
        reason: "harness closure changed",
      },
      {
        overrides: { contractDigest: "sha256:stale" },
        reason: "workflow contract changed",
      },
      {
        overrides: { toolchain: "rustc 1.0.0" },
        reason: "toolchain changed",
      },
      {
        overrides: { coveredFiles: [] },
        reason: "footprint covers no files",
      },
    ];
    for (const testCase of cases) {
      writeFootprint(repositoryRoot, testCase.overrides);
      expect(
        campaignVerdict({
          campaign: CAMPAIGN,
          basis: testCase.basis ?? MATCHING_BASIS,
          repositoryRoot,
        }),
        testCase.reason,
      ).toEqual({ verdict: "dirty", reason: testCase.reason });
    }
  });
});

describe("coverage filename classification", () => {
  const repositoryRoot = "/repo";

  it("maps remapped and absolute repository paths to digest-map keys", () => {
    expect(
      classifyCoverageFile("/workspace/rust/x/src/lib.rs", repositoryRoot),
    ).toEqual({ kind: "repository", key: "rust/x/src/lib.rs" });
    expect(
      classifyCoverageFile("/repo/rust/x/src/lib.rs", repositoryRoot),
    ).toEqual({ kind: "repository", key: "rust/x/src/lib.rs" });
  });

  it("resolves a sibling crate compiled through deps/ symlinks to its real digest-map key", () => {
    const root = temporaryRepository();
    mkdirSync(path.join(root, "rust/kernel/src"), { recursive: true });
    mkdirSync(path.join(root, "rust/runtime/deps"), { recursive: true });
    mkdirSync(path.join(root, "rust/index/deps"), { recursive: true });
    writeFileSync(path.join(root, "rust/kernel/src/lib.rs"), "");
    symlinkSync("../../kernel", path.join(root, "rust/runtime/deps/kernel"));
    symlinkSync("../../runtime", path.join(root, "rust/index/deps/runtime"));
    for (const filename of [
      "/workspace/rust/runtime/deps/kernel/src/lib.rs",
      "/workspace/rust/index/deps/runtime/deps/kernel/src/lib.rs",
      path.join(root, "rust/runtime/deps/kernel/src/lib.rs"),
    ]) {
      expect(classifyCoverageFile(filename, root)).toEqual({
        kind: "repository",
        key: "rust/kernel/src/lib.rs",
      });
    }
  });

  it("classifies dependency-registry sources as pinned by the manifest closure, remapped or not", () => {
    for (const filename of [
      "/cargo-home/registry/src/index.crates.io-1949cf8c6b5b557f/salsa-macro-rules-0.28.1/src/setup_tracked_fn.rs",
      "/home/u/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/salsa-0.28.1/src/lib.rs",
    ]) {
      expect(classifyCoverageFile(filename, repositoryRoot)).toEqual({
        kind: "registry",
        key: filename,
      });
    }
  });

  it("classifies stdlib sources as pinned by the toolchain identity, remapped or not", () => {
    for (const filename of [
      "/rust-toolchain/lib/rustlib/src/rust/library/std/src/sys/thread_local/no_threads.rs",
      "/opt/rust/lib/rustlib/src/rust/library/core/src/option.rs",
    ]) {
      expect(classifyCoverageFile(filename, repositoryRoot)).toEqual({
        kind: "toolchain",
        key: filename,
      });
    }
  });

  it("leaves an unrecognized absolute path as repository-kind so it lands untracked (fail-closed)", () => {
    expect(classifyCoverageFile("/somewhere/else.rs", repositoryRoot)).toEqual({
      kind: "repository",
      key: "/somewhere/else.rs",
    });
  });
});

interface RestampedLedger {
  implementationReceipt: Record<string, string>;
  interventions: Array<{ id: string }>;
  footprintInheritance: {
    measuredOnImplementationDigest: string;
    inheritedAtImplementationDigest: string;
    footprintProof: string;
    footprintProofDigest: string;
  };
}

describe("inherited ledger re-stamp", () => {
  const donorReceipt = {
    implementation: "chronicle_preprocessing_runtime_wasm/0.1.0",
    implementationDigest: "sha256:new-implementation",
    planDigest: "sha256:plan",
    profileDigest: "sha256:profile",
    profileLockDigest: "sha256:lock",
    runtimeAuthorityDigest: "sha256:authority",
    productContractDigest: "sha256:contract",
  };

  function writeLedger(directory: string): string {
    const ledgerPath = path.join(directory, CAMPAIGN.ledger);
    writeFileSync(
      ledgerPath,
      `${JSON.stringify({
        protocolVersion: "chronicle-configuration-influence-ledger/v1",
        implementationReceipt: {
          ...donorReceipt,
          implementationDigest: "sha256:measured-on",
        },
        interventions: [{ id: "measured-payload" }],
      })}\n`,
    );
    return ledgerPath;
  }

  it("replaces only the receipt, records the inheritance, and preserves the measured payload", () => {
    const directory = temporaryRepository();
    const ledgerPath = writeLedger(directory);
    restampInheritedLedger({
      familyExpectedDir: directory,
      campaign: CAMPAIGN,
      donorReceipt,
      footprintFileDigest: "sha256:footprint",
    });
    const ledger = JSON.parse(
      readFileSync(ledgerPath, "utf8"),
    ) as RestampedLedger;
    expect(ledger.implementationReceipt).toEqual(donorReceipt);
    expect(ledger.interventions).toEqual([{ id: "measured-payload" }]);
    expect(ledger.footprintInheritance).toEqual({
      measuredOnImplementationDigest: "sha256:measured-on",
      inheritedAtImplementationDigest: "sha256:new-implementation",
      footprintProof: `.semantic-federation/proofs/footprints/${CAMPAIGN.id}.json`,
      footprintProofDigest: "sha256:footprint",
    });
  });

  it("preserves the original measured-on digest through repeated inheritance", () => {
    const directory = temporaryRepository();
    const ledgerPath = writeLedger(directory);
    restampInheritedLedger({
      familyExpectedDir: directory,
      campaign: CAMPAIGN,
      donorReceipt,
      footprintFileDigest: "sha256:footprint",
    });
    const secondDonor = {
      ...donorReceipt,
      implementationDigest: "sha256:second-inheritance",
    };
    restampInheritedLedger({
      familyExpectedDir: directory,
      campaign: CAMPAIGN,
      donorReceipt: secondDonor,
      footprintFileDigest: "sha256:footprint-2",
    });
    const ledger = JSON.parse(
      readFileSync(ledgerPath, "utf8"),
    ) as RestampedLedger;
    expect(ledger.implementationReceipt).toEqual(secondDonor);
    expect(ledger.footprintInheritance.measuredOnImplementationDigest).toBe(
      "sha256:measured-on",
    );
    expect(ledger.footprintInheritance.inheritedAtImplementationDigest).toBe(
      "sha256:second-inheritance",
    );
  });

  it("refuses a ledger without an authority receipt", () => {
    const directory = temporaryRepository();
    writeFileSync(
      path.join(directory, CAMPAIGN.ledger),
      `${JSON.stringify({ protocolVersion: "x" })}\n`,
    );
    expect(() =>
      restampInheritedLedger({
        familyExpectedDir: directory,
        campaign: CAMPAIGN,
        donorReceipt,
        footprintFileDigest: "sha256:footprint",
      }),
    ).toThrow("has no implementationReceipt to re-stamp");
  });
});

describe("per-campaign harness closures", () => {
  const webRoot = path.resolve(__dirname, "../..");

  it("follows a real campaign's imports and leaves unrelated scripts out", () => {
    const configuration = SELECTABLE_CAMPAIGNS.find(
      (campaign) => campaign.id === "configuration-influence",
    );
    if (!configuration) throw new Error("configuration-influence not declared");
    const files = harnessClosureFiles(webRoot, configuration.harnessEntries);
    expect(files).toEqual(
      expect.arrayContaining([
        "scripts/run_configuration_influence_parallel.mjs",
        "src/lib/pipelineGraph/golden/configurationSpaceCampaign.test.ts",
        "scripts/run-clean-env.mjs",
        "scripts/refresh_dependency_evidence.mjs",
        "vitest.config.ts",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
      ]),
    );
    expect(files).not.toContain("scripts/measure_browser_peak_memory.mjs");
    expect(files).not.toContain("scripts/check_wasm_exports.mjs");
    expect(files).toContain("../.semantic-federation/semantic/resources/chronicle.plan.json");
    expect(files.some((file) => file.startsWith("src/wasm/"))).toBe(false);
  });

  it("resolves the @/ alias, ?raw imports, .js-for-.ts, and spawned script paths", () => {
    const root = temporaryRepository();
    const write = (rel: string, text: string) => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text);
    };
    write("scripts/run-clean-env.mjs", "");
    write("scripts/refresh_dependency_evidence.mjs", "");
    write("vitest.config.ts", "");
    write("package.json", "{}");
    write("package-lock.json", "{}");
    write("tsconfig.json", "{}");
    write("tsconfig.node.json", "{}");
    write(
      "scripts/runner.mjs",
      'import { a } from "./helper.mjs";\nspawn(node, ["scripts/spawned.mjs"]);\nconst glue = "src/wasm/runtime/pkg/runtime.js";\nconst relativeGlue = "../src/wasm/runtime/pkg/runtime.js";\n',
    );
    write("src/wasm/runtime/pkg/runtime.js", '/* @ts-self-types="./runtime.d.ts" */\n');
    write("src/wasm/runtime/pkg/runtime.d.ts", "export declare function execute(): void;\n");
    write("scripts/helper.mjs", 'import "node:fs";\nimport x from "vitest";\n');
    write("scripts/spawned.mjs", "");
    write(
      "src/entry.test.ts",
      'import {\n  b,\n} from "@/lib/b.js";\nimport csv from "@/assets/d.csv?raw";\nconst c = await import("./c");\n',
    );
    write("src/lib/b.ts", "");
    write("src/assets/d.csv", "a,b\n");
    write("src/c.ts", "");
    // Vite resolves "./c" to c.js before c.ts: both are in the closure.
    write("src/c.js", "");
    write("src/testSupport/fixture.json", "{}");
    write("scripts/unrelated.mjs", "");
    expect(harnessClosureFiles(root, ["scripts/runner.mjs", "src/entry.test.ts"])).toEqual([
      "package-lock.json",
      "package.json",
      "scripts/helper.mjs",
      "scripts/refresh_dependency_evidence.mjs",
      "scripts/run-clean-env.mjs",
      "scripts/runner.mjs",
      "scripts/spawned.mjs",
      "src/assets/d.csv",
      "src/c.js",
      "src/c.ts",
      "src/entry.test.ts",
      "src/lib/b.ts",
      "src/testSupport/fixture.json",
      "tsconfig.json",
      "tsconfig.node.json",
      "vitest.config.ts",
    ]);
  });

  it("refuses a local import it cannot resolve instead of dropping it", () => {
    const root = temporaryRepository();
    writeFileSync(path.join(root, "vitest.config.ts"), "");
    mkdirSync(path.join(root, "scripts"));
    writeFileSync(path.join(root, "scripts/run-clean-env.mjs"), "");
    writeFileSync(path.join(root, "scripts/refresh_dependency_evidence.mjs"), "");
    writeFileSync(path.join(root, "entry.ts"), 'import "./missing";\n');
    expect(() => harnessClosureFiles(root, ["entry.ts"])).toThrow(
      /cannot resolve "\.\/missing"/,
    );
  });
});
