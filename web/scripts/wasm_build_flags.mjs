import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENCODED_FLAG_SEPARATOR = "\x1f";
const FIXED_HOST_RUSTC = fileURLToPath(new URL("./rustc_fixed_host.sh", import.meta.url));

/**
 * @param {string | undefined} searchPath
 * @param {string} command
 * @returns {string | undefined}
 */
function findOnPath(searchPath, command) {
  return (searchPath ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, command))
    .find(existsSync);
}

/**
 * Replace every PATH directory that holds `command` with a mirror of that
 * directory without it, so the other tools there (cargo, sed, cc, git, ...)
 * stay reachable. Mirrors are content-addressed under `mirrorRoot` and built
 * by rename, so concurrent builds share them safely.
 * @param {string | undefined} searchPath
 * @param {string} command
 * @param {string} mirrorRoot
 * @returns {string}
 */
export function pathWithoutCommand(searchPath, command, mirrorRoot) {
  return (searchPath ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => {
      if (!existsSync(path.join(directory, command))) return directory;
      const entries = readdirSync(directory).filter((name) => name !== command).sort();
      const key = createHash("sha256").update(JSON.stringify([directory, command, entries])).digest("hex");
      const mirror = path.join(mirrorRoot, key.slice(0, 16));
      if (!existsSync(mirror)) {
        const staging = `${mirror}.${process.pid}.tmp`;
        rmSync(staging, { recursive: true, force: true });
        mkdirSync(staging, { recursive: true });
        for (const name of entries) symlinkSync(path.join(directory, name), path.join(staging, name));
        try {
          renameSync(staging, mirror);
        } catch (error) {
          rmSync(staging, { recursive: true, force: true });
          if (!existsSync(mirror)) throw error;
        }
      }
      return mirror;
    })
    .join(path.delimiter);
}

/** Reject roots anywhere in binary data, except two exact non-path statements
 * in FINESSE's preserved method definition (10.1145/3479600, PDF p8 section3.3).
 * @param {string} binaryText
 * @returns {string[]}
 */
export function leakedHomeDirectoryPrefixes(binaryText) {
  const paths = binaryText
    .replaceAll("target-app open/home/lock/notification-caused foreground switch observations", "\0")
    .replaceAll("app/home/lock/notification-switch detectors/ties unknown.", "\0");
  return ["/Users/", "/home/", "/root/", "\\Users\\"].filter(prefix => paths.includes(prefix));
}

/**
 * @typedef {object} WasmBuildPaths
 * @property {string} cargoHome
 * @property {string} home
 * @property {string} repositoryRoot
 * @property {string} rustcSysroot
 */

/**
 * @typedef {object} WasmBuildOptions
 * @property {string[]} cargoArgs
 * @property {NodeJS.ProcessEnv} env
 * @property {WasmBuildPaths} paths
 * @property {string[]} remapFlags
 */

/** @param {string} candidate @returns {string} */
function canonicalPath(candidate) {
  const absolute = path.resolve(candidate);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

/**
 * @param {string} repositoryRoot
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function rustcSysroot(repositoryRoot, env) {
  const result = execFileSync(env.RUSTC || "rustc", ["--print", "sysroot"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env,
  }).trim();
  if (!result) throw new Error("rustc --print sysroot returned an empty path");
  return canonicalPath(result);
}

/**
 * @param {string} repositoryRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {WasmBuildPaths}
 */
export function wasmBuildPaths(repositoryRoot, env = process.env) {
  const canonicalRepositoryRoot = canonicalPath(repositoryRoot);
  const home = canonicalPath(homedir());
  const cargoHome = canonicalPath(env.CARGO_HOME || path.join(home, ".cargo"));
  return {
    cargoHome,
    home,
    repositoryRoot: canonicalRepositoryRoot,
    rustcSysroot: rustcSysroot(canonicalRepositoryRoot, env),
  };
}

/** @param {WasmBuildPaths} paths @returns {string[]} */
function remapFlags(paths) {
  // rustc applies the last matching remap. Sorting by source length keeps the
  // most-specific prefix authoritative if a checkout lives below another root.
  /** @type {Array<[string, string]>} */
  const mappings = [
    [paths.repositoryRoot, "/workspace"],
    [paths.cargoHome, "/cargo-home"],
    [paths.rustcSysroot, "/rust-toolchain"],
  ];
  return mappings
    .sort(([left], [right]) => left.length - right.length)
    .map(([source, destination]) => `--remap-path-prefix=${source}=${destination}`);
}

/**
 * @param {string[]} existing
 * @param {string[]} additions
 * @returns {string[]}
 */
function appendUnique(existing, additions) {
  const result = [...existing];
  for (const addition of additions) {
    if (!result.includes(addition)) result.push(addition);
  }
  return result;
}

/**
 * Return the environment and trailing Cargo arguments for one wasm-pack build.
 *
 * Cargo treats CARGO_ENCODED_RUSTFLAGS, RUSTFLAGS, and target rustflags as
 * mutually exclusive sources. With no caller flags, a CLI config array lets
 * Cargo merge these remaps with the runtime crate's target-feature array. When
 * caller flags exist, append to that already-authoritative source instead.
 *
 * @param {string} repositoryRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {WasmBuildOptions}
 */
export function wasmBuildOptions(repositoryRoot, env = process.env) {
  const paths = wasmBuildPaths(repositoryRoot, env);
  const additions = remapFlags(paths);
  // ahash (via arrow, parquet and the kernel) takes compile-time hash seeds from
  // const-random, which reads getrandom in every compiler process unless this
  // is set. Unset, every build embeds 64 fresh random bytes in the runtime WASM.
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = { ...env, CONST_RANDOM_SEED: "chronicle-wasm-build" };
  // Cargo mixes the build host into crate metadata, so the same sources built
  // different WASM on macOS and Linux; this rustc reports one fixed host.
  // The real rustc is resolved on the caller's PATH, the one the sysroot remap
  // above was read from. RUSTC is now a fixed file, so Cargo's rustc-info cache
  // (keyed on that file) would miss a toolchain change: turn it off.
  childEnv.CHRONICLE_REAL_RUSTC =
    env.CHRONICLE_REAL_RUSTC || env.RUSTC || findOnPath(env.PATH, "rustc") || "rustc";
  childEnv.RUSTC = FIXED_HOST_RUSTC;
  childEnv.CARGO_CACHE_RUSTC_INFO = "0";
  // wasm-pack runs the first wasm-opt on PATH and downloads its own pinned
  // binaryen only when there is none. Binaryen versions optimize to different
  // bytes (Homebrew's version 131 against wasm-pack 0.14's version_117).
  childEnv.PATH = pathWithoutCommand(
    env.PATH,
    "wasm-opt",
    path.join(paths.repositoryRoot, "rust", "target", "wasm-build-path"),
  );
  // Apple's ar/ranlib cannot index minicov's WASM objects. Respect explicit
  // cross-tool overrides; otherwise use the installed Homebrew LLVM archiver.
  if (process.platform === "darwin" && ![
    env["AR_wasm32-unknown-unknown"], env.AR_wasm32_unknown_unknown, env.TARGET_AR, env.AR,
  ].some(Boolean)) {
    const archiver = ["/opt/homebrew/opt/llvm/bin/llvm-ar", "/usr/local/opt/llvm/bin/llvm-ar"].find(existsSync);
    if (archiver) childEnv.AR_wasm32_unknown_unknown = archiver;
  }

  if (typeof env.CARGO_ENCODED_RUSTFLAGS === "string") {
    const existing = env.CARGO_ENCODED_RUSTFLAGS
      ? env.CARGO_ENCODED_RUSTFLAGS.split(ENCODED_FLAG_SEPARATOR)
      : [];
    childEnv.CARGO_ENCODED_RUSTFLAGS = appendUnique(existing, additions)
      .join(ENCODED_FLAG_SEPARATOR);
    return { cargoArgs: [], env: childEnv, paths, remapFlags: additions };
  }

  if (typeof env.RUSTFLAGS === "string") {
    // Match Cargo's effective RUSTFLAGS parsing before switching to the encoded
    // representation, which can safely carry checkout paths containing spaces.
    const existing = env.RUSTFLAGS
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
    delete childEnv.RUSTFLAGS;
    childEnv.CARGO_ENCODED_RUSTFLAGS = appendUnique(existing, additions)
      .join(ENCODED_FLAG_SEPARATOR);
    return { cargoArgs: [], env: childEnv, paths, remapFlags: additions };
  }

  return {
    cargoArgs: [
      "--config",
      `target.wasm32-unknown-unknown.rustflags=${JSON.stringify(additions)}`,
    ],
    env: childEnv,
    paths,
    remapFlags: additions,
  };
}
