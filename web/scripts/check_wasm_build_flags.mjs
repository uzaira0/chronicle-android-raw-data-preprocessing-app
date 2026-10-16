import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { leakedHomeDirectoryPrefixes, pathWithoutCommand, wasmBuildOptions } from "./wasm_build_flags.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));

test("WASM privacy rejects actual home roots without mistaking paper navigation prose for a path", () => {
  assert.deepEqual(leakedHomeDirectoryPrefixes("target-app open/home/lock/notification-caused foreground switch observations"), []);
  assert.deepEqual(leakedHomeDirectoryPrefixes("app/home/lock/notification-switch detectors/ties unknown."), []);
  for (const prefix of ["/Users/", "/home/", "/root/", "\\Users\\"]) {
    for (const boundary of ["", "\0", '"', " ", "=", "C:", "file://"]) {
      assert.deepEqual(leakedHomeDirectoryPrefixes(`${boundary}${prefix}sentinel-private-user/source.rs`), [prefix]);
    }
  }
  // A WASM length/framing byte can look like an ASCII letter: no token-boundary exemption.
  for (let byte = 0; byte < 256; byte += 1) {
    assert.deepEqual(leakedHomeDirectoryPrefixes(`${String.fromCharCode(byte)}/home/sentinel-private-user/source.rs`), ["/home/"]);
  }
  assert.deepEqual(leakedHomeDirectoryPrefixes("app/home/lock/sentinel-private-user/source.rs"), ["/home/"]);
  assert.deepEqual(leakedHomeDirectoryPrefixes("/home/a\0/root/b\0/Users/c\0/home/d"), ["/Users/", "/home/", "/root/"]);
});

test("WASM build preserves an explicit target archiver", () => {
  const env = { ...process.env, AR_wasm32_unknown_unknown: "explicit-llvm-ar" };
  assert.equal(wasmBuildOptions(repo, env).env.AR_wasm32_unknown_unknown, "explicit-llvm-ar");
});

test("macOS WASM build selects an installed LLVM archive writer", () => {
  const env = { ...process.env };
  for (const key of ["AR_wasm32-unknown-unknown", "AR_wasm32_unknown_unknown", "TARGET_AR", "AR"]) delete env[key];
  const expected = process.platform === "darwin"
    ? ["/opt/homebrew/opt/llvm/bin/llvm-ar", "/usr/local/opt/llvm/bin/llvm-ar"].find(existsSync)
    : undefined;
  assert.equal(wasmBuildOptions(repo, env).env.AR_wasm32_unknown_unknown, expected);
});

test("WASM build reports one fixed rustc host, so Cargo metadata does not depend on the build machine", () => {
  const options = wasmBuildOptions(repo);
  assert.ok(path.isAbsolute(options.env.CHRONICLE_REAL_RUSTC), options.env.CHRONICLE_REAL_RUSTC);
  assert.equal(options.env.CARGO_CACHE_RUSTC_INFO, "0");
  const run = (/** @type {string} */ rustc, /** @type {string[]} */ args) =>
    execFileSync(rustc, args, { cwd: repo, encoding: "utf8", env: options.env });
  const real = run(options.env.CHRONICLE_REAL_RUSTC, ["-vV"]);
  assert.match(real, /^host: /m);
  assert.equal(run(options.env.RUSTC, ["-vV"]), real.replace(/^host: .*$/m, "host: x86_64-unknown-linux-gnu"));
  // Any other invocation is the real rustc, unchanged.
  assert.equal(run(options.env.RUSTC, ["--print", "sysroot"]), run(options.env.CHRONICLE_REAL_RUSTC, ["--print", "sysroot"]));
  // A build started from inside another WASM build keeps the original rustc.
  assert.equal(wasmBuildOptions(repo, options.env).env.CHRONICLE_REAL_RUSTC, options.env.CHRONICLE_REAL_RUSTC);
});

test("WASM build hides PATH copies of wasm-opt but keeps the other tools beside them", () => {
  const scratch = mkdtempSync(path.join(fileURLToPath(new URL("../../rust/", import.meta.url)), ".wasm-opt-probe-"));
  try {
    const withOpt = path.join(scratch, "bin");
    mkdirSync(withOpt);
    writeFileSync(path.join(withOpt, "wasm-opt"), "");
    writeFileSync(path.join(withOpt, "other-tool"), "");
    const mirrors = path.join(scratch, "mirrors");
    const [first, mirror, last] = pathWithoutCommand(["/usr/bin", withOpt, "/bin"].join(path.delimiter), "wasm-opt", mirrors)
      .split(path.delimiter);
    assert.deepEqual([first, last], ["/usr/bin", "/bin"]);
    assert.ok(mirror.startsWith(mirrors), mirror);
    assert.deepEqual(readdirSync(mirror), ["other-tool"]);
    // The same directory maps to the same mirror on the next build.
    assert.equal(pathWithoutCommand(withOpt, "wasm-opt", mirrors), mirror);
    const options = wasmBuildOptions(repo, { ...process.env, PATH: `${withOpt}${path.delimiter}${process.env.PATH}` });
    assert.ok(!options.env.PATH.split(path.delimiter).some((directory) => existsSync(path.join(directory, "wasm-opt"))));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
