import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

/**
 * @typedef {{id: string, stepLabel: string, ledger: string, harnessEntries: string[]}} SelectableCampaign
 * @typedef {{perFileDigests: Record<string, string>, manifestClosureDigest: string,
 *   contractDigest: string, harnessDigests: Record<string, string>, toolchain: string}} SelectionBasis
 * @typedef {{verdict: "clean"} | {verdict: "dirty", reason: string}} CampaignVerdict
 * @typedef {{implementation: string, implementationDigest: string, planDigest: string,
 *   profileDigest: string, profileLockDigest: string, runtimeAuthorityDigest: string,
 *   productContractDigest: string}} ImplementationReceipt
 */

/**
 * Footprint-based campaign selection (Ekstazi / cargo-difftests design).
 *
 * A campaign's footprint is the set of production source files its recorded
 * LLVM coverage actually executed, each pinned by the digest of the same
 * test-stripped normalized bytes the implementation digest folds (the
 * `footprint_digests` example and build.rs include one shared definition).
 * On the next refresh a campaign is CLEAN — its prior measured ledger payload
 * still testifies — only if every file it executed is byte-identically
 * unchanged under that normalization AND its harness closure, workflow
 * contract, and toolchain identity are unchanged. Anything else, including a
 * missing or unreadable footprint, is DIRTY and the campaign re-runs. This
 * module never decides Salsa invalidation and never re-derives graph
 * reachability; it only decides which record-mode campaigns re-execute, and
 * inherits their unchanged committed ledgers when it can prove nothing they
 * measured could have moved.
 */

/** The campaigns eligible for selection: exactly those that execute the
 * instrumented bootstrap WASM. The covering array (embeds fresh workspace
 * roots), semantic mutations (runs no WASM), and the two final-package steps
 * (field provenance / field-mixed run the uninstrumented final WASM) always
 * re-run. */
export const SELECTABLE_CAMPAIGNS = [
  {
    id: "configuration-influence",
    stepLabel: "configuration interventions",
    ledger: "configuration-influence-ledger.json",
    harnessEntries: [
      "scripts/run_configuration_influence_parallel.mjs",
      "src/lib/pipelineGraph/golden/configurationSpaceCampaign.test.ts",
    ],
  },
  {
    id: "artifact-influence",
    stepLabel: "artifact interventions",
    ledger: "artifact-influence-ledger.json",
    harnessEntries: [
      "scripts/run_artifact_influence_parallel.mjs",
      "src/lib/pipelineGraph/golden/artifactInterventionCampaign.test.ts",
    ],
  },
  {
    id: "raw-boundary-influence",
    stepLabel: "raw timestamp boundaries",
    ledger: "raw-boundary-influence-ledger.json",
    harnessEntries: [
      "scripts/run_raw_boundary_influence_parallel.mjs",
      "src/lib/pipelineGraph/golden/rawBoundaryTomography.test.ts",
    ],
  },
  {
    id: "interaction-influence",
    stepLabel: "configuration interactions",
    ledger: "interaction-influence-ledger.json",
    harnessEntries: [
      "scripts/run_interaction_influence_parallel.mjs",
      "src/lib/pipelineGraph/golden/interactionTomography.test.ts",
    ],
  },
  {
    id: "mixed-artifact-configuration",
    stepLabel: "artifact/configuration interactions",
    ledger: "mixed-artifact-configuration-ledger.json",
    harnessEntries: [
      "scripts/run_mixed_influence.mjs",
      "src/lib/pipelineGraph/golden/mixedArtifactConfigurationTomography.test.ts",
    ],
  },
];

const FOOTPRINT_SCHEMA = "chronicle-campaign-footprint/v1";

/** Every campaign also runs through these: the refresh that sets each
 * campaign's environment and launches its npm script, the clean-env wrapper
 * its runner spawns, the vitest configuration (aliases, timeouts), the npm
 * scripts and lockfile (which command runs, and every bare-specifier import),
 * and the TypeScript configurations vitest transforms with. */
const SHARED_HARNESS_ENTRIES = [
  "scripts/refresh_dependency_evidence.mjs",
  "scripts/run-clean-env.mjs",
  "vitest.config.ts",
];
const SHARED_HARNESS_FILES = ["package.json", "package-lock.json"];

/** Fixture data a campaign may read by path at run time rather than import:
 * every .json/.csv under these roots (never the ledgers it writes). */
const HARNESS_DATA_ROOTS = ["src/lib/pipelineGraph/golden", "src/testSupport", "scripts"];

const IMPORT_PATTERNS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  /\bnew\s+URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url/g,
];
/** A local script named by path in a string (runners spawn their test file
 * and the clean-env wrapper this way). */
const SPAWNED_PATH_PATTERN = /(['"`])((?:\.{1,2}\/|scripts\/|src\/)[\w./-]+\.(?:mjs|mts|ts|js))\1/g;
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".json", "/index.ts", "/index.mjs", "/index.js"];

/**
 * Resolve one import specifier to the web-relative files it could load: every
 * existing candidate, not just the first, so adding a file that the bundler
 * would prefer (Vite tries .js before .ts) dirties the closure too. Returns []
 * for a package import (pinned by package-lock.json) or generated WASM glue
 * (pinned by the Rust implementation digests). A local specifier that
 * resolves to nothing throws: a closure that silently drops a file would
 * under-dirty.
 *
 * @param {string} webRoot @param {string} fromRel @param {string} specifier
 * @returns {string[]}
 */
function resolveHarnessImport(webRoot, fromRel, specifier) {
  const bare = specifier.replace(/\?.*$/, "");
  let base;
  if (bare.startsWith("@/")) base = path.join("src", bare.slice(2));
  else if (bare.startsWith("./") || bare.startsWith("../")) {
    base = path.join(path.dirname(fromRel), bare);
  } else return [];
  if (base.startsWith(`src${path.sep}wasm${path.sep}`)) return [];
  const candidates = RESOLVE_SUFFIXES.map((suffix) => base + suffix);
  // TypeScript ESM imports name the emitted .js for a .ts source.
  if (/\.m?js$/.test(base)) candidates.push(base.replace(/\.(m?)js$/, ".$1ts"));
  const found = candidates.filter((candidate) => {
    const absolute = path.join(webRoot, candidate);
    return existsSync(absolute) && statSync(absolute).isFile();
  });
  if (found.length > 0) return found;
  throw new Error(`harness closure: cannot resolve "${specifier}" imported by ${fromRel}`);
}

/**
 * The web files a campaign can execute or load: the static and literal
 * dynamic import closure of its entries (through the `@/` alias and `?raw`
 * imports), local scripts it names by path, the shared entries, and the
 * fixture data under the harness roots.
 *
 * @param {string} webRoot @param {string[]} entries @returns {string[]}
 */
export function harnessClosureFiles(webRoot, entries) {
  const seen = new Set();
  const pending = [...SHARED_HARNESS_ENTRIES, ...entries];
  while (pending.length > 0) {
    const rel = /** @type {string} */ (pending.pop());
    if (seen.has(rel)) continue;
    const absolute = path.join(webRoot, rel);
    if (!existsSync(absolute)) throw new Error(`harness closure: missing entry ${rel}`);
    seen.add(rel);
    if (!/\.(?:ts|tsx|mts|mjs|js)$/.test(rel)) continue;
    const text = readFileSync(absolute, "utf8");
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        pending.push(...resolveHarnessImport(webRoot, rel, match[2] ?? ""));
      }
    }
    for (const match of text.matchAll(SPAWNED_PATH_PATTERN)) {
      const named = match[2];
      if (!named) continue;
      const fromWebRoot = path.join(webRoot, named);
      const fromFile = path.join(webRoot, path.dirname(rel), named);
      const resolved = !named.startsWith(".") && existsSync(fromWebRoot)
        ? path.normalize(named)
        : named.startsWith(".") && existsSync(fromFile)
          ? path.relative(webRoot, fromFile)
          : null;
      // Literal paths must obey the same generated-WASM exclusion as imports:
      // the normal build rewrites these outputs from the pinned Rust sources.
      if (resolved && !resolved.startsWith(`src${path.sep}wasm${path.sep}`)) {
        pending.push(resolved);
      }
    }
  }
  for (const file of SHARED_HARNESS_FILES) seen.add(file);
  for (const entry of readdirSync(webRoot)) {
    if (/^tsconfig.*\.json$/.test(entry)) seen.add(entry);
  }
  /** @param {string} rel */
  const walk = (rel) => {
    const absolute = path.join(webRoot, rel);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.(json|csv)$/.test(entry.name) && !child.includes("family-expected")) {
        seen.add(child);
      }
    }
  };
  HARNESS_DATA_ROOTS.forEach(walk);
  return [...seen].sort();
}

/** One campaign's harness digest: an edit outside its closure no longer
 * re-measures it. */
/** @param {string} webRoot @param {string[]} entries */
function harnessClosureDigest(webRoot, entries) {
  const hash = createHash("sha256");
  for (const rel of harnessClosureFiles(webRoot, entries)) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(path.join(webRoot, rel)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

/** @param {string} absolutePath */
function fileDigest(absolutePath) {
  return `sha256:${createHash("sha256").update(readFileSync(absolutePath)).digest("hex")}`;
}

/** The nightly used for the instrumented build and its llvm tools. minicov
 * 0.3.8 writes raw profile format 10 (LLVM 22), so a nightly on LLVM 23+
 * cannot merge the profraws; point CHRONICLE_NIGHTLY_TOOLCHAIN at a dated
 * nightly (e.g. nightly-2026-04-23) on such a machine. */
export const NIGHTLY_TOOLCHAIN =
  process.env.CHRONICLE_NIGHTLY_TOOLCHAIN?.trim() || "nightly";

/** Locate the nightly toolchain's llvm tools (the only local pair that reads
 * the profraw version minicov 0.3.8 emits). */
function llvmToolDir() {
  const targetLibDir = execFileSync("rustc", ["--print", "target-libdir"], {
    env: { ...process.env, RUSTUP_TOOLCHAIN: NIGHTLY_TOOLCHAIN },
    encoding: "utf8",
  }).trim();
  // Resolve the active nightly host instead of assuming the evidence campaign
  // runs on an x86_64 Linux workstation. The matching llvm-profdata/llvm-cov
  // pair lives beside that target's lib directory on every rustup host.
  const dir = path.resolve(targetLibDir, "../bin");
  if (!existsSync(path.join(dir, "llvm-profdata"))) {
    throw new Error(
      `nightly llvm-tools not found at ${dir} — run: rustup component add llvm-tools --toolchain ${NIGHTLY_TOOLCHAIN}`,
    );
  }
  return dir;
}

/** The identity facts every footprint is conditioned on beyond the per-file
 * digests. */
/** @param {{repositoryRoot: string, webRoot: string}} input @returns {SelectionBasis} */
export function currentSelectionBasis({ repositoryRoot, webRoot }) {
  const runtimeCrate = path.join(
    repositoryRoot,
    "rust/chronicle_preprocessing_runtime_wasm",
  );
  const digestJson = execFileSync(
    "cargo",
    ["run", "--quiet", "--example", "footprint_digests", "--", repositoryRoot],
    { cwd: runtimeCrate, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const perFileDigests = JSON.parse(digestJson);
  const contractGolden = path.join(
    repositoryRoot,
    "rust/chronicle_chrono_kernel_wasm/tests/golden/workflow_contract.json",
  );
  const rustcVersion = execFileSync("rustc", ["-vV"], {
    env: { ...process.env, RUSTUP_TOOLCHAIN: NIGHTLY_TOOLCHAIN },
    encoding: "utf8",
  });
  return {
    perFileDigests,
    manifestClosureDigest: manifestClosureDigest(perFileDigests),
    contractDigest: fileDigest(contractGolden),
    harnessDigests: Object.fromEntries(
      SELECTABLE_CAMPAIGNS.map((campaign) => [
        campaign.id,
        harnessClosureDigest(webRoot, campaign.harnessEntries),
      ]),
    ),
    toolchain: rustcVersion.split("\n").slice(0, 2).join(" | "),
  };
}

/** Fail before spending more time on evidence for a moving implementation.
 * @param {SelectionBasis} initial @param {SelectionBasis} current
 */
export function assertSelectionBasisUnchanged(initial, current) {
  if (!isDeepStrictEqual(initial, current)) {
    throw new Error("Dependency evidence inputs changed during the run; freeze production sources, build flags, contracts, and campaign harness before retrying");
  }
}

/** Digest over every non-`.rs` entry of the implementation digest map
 * (Cargo.toml / Cargo.lock). LLVM coverage can never witness these, yet a
 * dependency or manifest change can move behavior in any campaign — so any
 * change here dirties every campaign. */
/** @param {Record<string, string>} perFileDigests */
function manifestClosureDigest(perFileDigests) {
  const hash = createHash("sha256");
  for (const [file, digest] of Object.entries(perFileDigests)
    .filter(([file]) => !file.endsWith(".rs"))
    .sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(file);
    hash.update("\0");
    hash.update(digest);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Classify one llvm-cov filename. The instrumented build remaps the
 * repository root to /workspace, the cargo registry to /cargo-home, and the
 * rustc sysroot to /rust-toolchain (wasm_build_flags.mjs), so coverage
 * filenames arrive in those namespaces; the unremapped absolute forms are
 * handled as a fallback.
 *
 * - "repository": executed source inside this repository — must map to a
 *   digest-map entry or the footprint is dirty-forever (untracked).
 * - "registry": dependency-crate source (macro expansions attribute spans to
 *   e.g. salsa's macro files). Pinned by Cargo.lock, which the
 *   manifest-closure digest already gates — recorded informationally, never
 *   untracked.
 * - "toolchain": rust stdlib source, pinned by the recorded toolchain
 *   identity — same treatment.
 *
 * @param {string} filename @param {string} repositoryRoot
 * @returns {{kind: "repository", key: string} | {kind: "registry" | "toolchain", key: string}}
 */
export function classifyCoverageFile(filename, repositoryRoot) {
  if (
    filename.startsWith("/cargo-home/") ||
    filename.includes("/registry/src/index.crates.io-")
  ) {
    return { kind: "registry", key: filename };
  }
  if (
    filename.startsWith("/rust-toolchain/") ||
    filename.includes("/lib/rustlib/src/rust/")
  ) {
    return { kind: "toolchain", key: filename };
  }
  if (filename.startsWith("/workspace/")) {
    return {
      kind: "repository",
      key: resolveRepositoryKey(filename.slice("/workspace/".length), repositoryRoot),
    };
  }
  const relative = path.relative(repositoryRoot, filename);
  return {
    kind: "repository",
    key: relative.startsWith("..")
      ? filename
      : resolveRepositoryKey(relative, repositoryRoot),
  };
}

/**
 * Sibling crates are compiled through each crate's `deps/` symlinks (so
 * Cargo hashes their path relative to the building crate's root and the WASM
 * does not depend on the checkout path), which puts a kernel file at e.g.
 * `rust/chronicle_preprocessing_runtime_wasm/deps/chronicle_chrono_kernel_wasm/src/lib.rs`.
 * Resolve the real file so the key matches its digest-map entry.
 *
 * @param {string} key @param {string} repositoryRoot
 */
function resolveRepositoryKey(key, repositoryRoot) {
  const candidate = path.join(repositoryRoot, key);
  if (!existsSync(candidate)) return key;
  return path.relative(realpathSync(repositoryRoot), realpathSync(candidate));
}

/** @param {string} repositoryRoot */
export function footprintDir(repositoryRoot) {
  return path.join(repositoryRoot, ".semantic-federation/proofs/footprints");
}

/**
 * Decide clean/inherit vs dirty/re-run for one campaign. Returns
 * `{ verdict: "clean" } | { verdict: "dirty", reason }` — every dirty path
 * names its first cause so the refresh log explains each re-run.
 *
 * @param {{campaign: SelectableCampaign, basis: SelectionBasis, repositoryRoot: string}} input
 * @returns {CampaignVerdict}
 */
export function campaignVerdict({ campaign, basis, repositoryRoot }) {
  const file = path.join(footprintDir(repositoryRoot), `${campaign.id}.json`);
  if (!existsSync(file)) return { verdict: "dirty", reason: "no recorded footprint" };
  let footprint;
  try {
    footprint = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { verdict: "dirty", reason: `unreadable footprint: ${error}` };
  }
  if (footprint.schema !== FOOTPRINT_SCHEMA) {
    return { verdict: "dirty", reason: `footprint schema ${footprint.schema}` };
  }
  if (footprint.untrackedTouchedFiles?.length) {
    return {
      verdict: "dirty",
      reason: `prior run touched files outside the digest map: ${footprint.untrackedTouchedFiles.join(", ")}`,
    };
  }
  if (footprint.manifestClosureDigest !== basis.manifestClosureDigest) {
    return {
      verdict: "dirty",
      reason: "crate manifest closure changed (Cargo.toml/Cargo.lock)",
    };
  }
  if (footprint.harnessDigest !== basis.harnessDigests[campaign.id]) {
    return { verdict: "dirty", reason: "harness closure changed" };
  }
  if (footprint.contractDigest !== basis.contractDigest) {
    return { verdict: "dirty", reason: "workflow contract changed" };
  }
  if (footprint.toolchain !== basis.toolchain) {
    return { verdict: "dirty", reason: "toolchain changed" };
  }
  for (const entry of footprint.coveredFiles ?? []) {
    const current = basis.perFileDigests[entry.path];
    if (!current) return { verdict: "dirty", reason: `covered file removed: ${entry.path}` };
    if (current !== entry.digest) {
      return { verdict: "dirty", reason: `covered file changed: ${entry.path}` };
    }
  }
  if (!footprint.coveredFiles?.length) {
    return { verdict: "dirty", reason: "footprint covers no files" };
  }
  return { verdict: "clean" };
}

/**
 * Merge one re-run campaign's shard profraws, map coverage to touched
 * production files against the pre-bindgen linked bootstrap WASM, and write
 * the campaign's footprint proof.
 *
 * @param {{campaign: SelectableCampaign, basis: SelectionBasis, repositoryRoot: string,
 *   profrawRoot: string, linkedBootstrapWasm: string}} input
 */
export function recordCampaignFootprint({
  campaign,
  basis,
  repositoryRoot,
  profrawRoot,
  linkedBootstrapWasm,
}) {
  const tools = llvmToolDir();
  const shardFiles = readdirSync(profrawRoot)
    .filter((name) => name.startsWith(`${campaign.id}-`) && name.endsWith(".profraw"))
    .map((name) => path.join(profrawRoot, name));
  if (shardFiles.length === 0) {
    throw new Error(
      `campaign ${campaign.id} re-ran but wrote no profraw shards under ${profrawRoot} — ` +
        "footprint capture is broken, refusing to record an empty footprint",
    );
  }
  const profdata = path.join(profrawRoot, `${campaign.id}.profdata`);
  execFileSync(path.join(tools, "llvm-profdata"), [
    "merge",
    "-sparse",
    ...shardFiles,
    "-o",
    profdata,
  ]);
  const exported = execFileSync(
    path.join(tools, "llvm-cov"),
    ["export", "--summary-only", `--instr-profile=${profdata}`, linkedBootstrapWasm],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const coverage = JSON.parse(exported);
  const covered = [];
  const untracked = [];
  /** @type {{registry: string[], toolchain: string[]}} */
  const externallyPinned = { registry: [], toolchain: [] };
  for (const file of coverage.data[0].files) {
    if ((file.summary?.functions?.covered ?? 0) === 0) continue;
    const classified = classifyCoverageFile(file.filename, repositoryRoot);
    if (classified.kind !== "repository") {
      externallyPinned[classified.kind].push(classified.key);
      continue;
    }
    const digest = basis.perFileDigests[classified.key];
    if (digest) covered.push({ path: classified.key, digest });
    else untracked.push(classified.key);
  }
  if (covered.length === 0) {
    throw new Error(
      `campaign ${campaign.id} coverage export mapped no covered production files — ` +
        "instrumentation or mapping is broken",
    );
  }
  const dir = footprintDir(repositoryRoot);
  mkdirSync(dir, { recursive: true });
  const footprint = {
    schema: FOOTPRINT_SCHEMA,
    campaign: campaign.id,
    coveredFiles: covered.sort((a, b) => a.path.localeCompare(b.path)),
    untrackedTouchedFiles: untracked.sort(),
    // Informational: executed files whose bytes are pinned by the manifest
    // closure (registry) or the toolchain identity (stdlib), not per-file.
    externallyPinnedFiles: {
      registry: externallyPinned.registry.sort(),
      toolchain: externallyPinned.toolchain.sort(),
    },
    manifestClosureDigest: basis.manifestClosureDigest,
    harnessDigest: basis.harnessDigests[campaign.id],
    contractDigest: basis.contractDigest,
    toolchain: basis.toolchain,
    claimBoundary:
      "Executed-production-file set for this record-mode campaign under LLVM " +
      "coverage; each file pinned by the digest of its test-stripped " +
      "normalized source. Conditions the right to inherit this campaign's " +
      "committed ledger payload without re-measuring; never consulted for " +
      "runtime invalidation.",
  };
  writeFileSync(
    path.join(dir, `${campaign.id}.json`),
    `${JSON.stringify(footprint, null, 2)}\n`,
  );
  return { covered: covered.length, untracked: untracked.length };
}

/**
 * Re-stamp an inherited (clean, skipped) campaign ledger with the single
 * authority receipt this refresh produced, recording the inheritance
 * explicitly. The donor receipt comes from a ledger that was freshly measured
 * in THIS run — the same origin a full run gives every ledger — so no new
 * derivation path for receipts exists. The measured payload is untouched.
 *
 * @param {{familyExpectedDir: string, campaign: SelectableCampaign,
 *   donorReceipt: ImplementationReceipt, footprintFileDigest: string}} input
 */
export function restampInheritedLedger({
  familyExpectedDir,
  campaign,
  donorReceipt,
  footprintFileDigest,
}) {
  const ledgerPath = path.join(familyExpectedDir, campaign.ledger);
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const previous = ledger.implementationReceipt;
  if (!previous || typeof previous !== "object") {
    throw new Error(`${campaign.ledger} has no implementationReceipt to re-stamp`);
  }
  const measuredOn =
    ledger.footprintInheritance?.measuredOnImplementationDigest ??
    previous.implementationDigest;
  ledger.implementationReceipt = donorReceipt;
  ledger.footprintInheritance = {
    measuredOnImplementationDigest: measuredOn,
    inheritedAtImplementationDigest: donorReceipt.implementationDigest,
    footprintProof: `.semantic-federation/proofs/footprints/${campaign.id}.json`,
    footprintProofDigest: footprintFileDigest,
  };
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
