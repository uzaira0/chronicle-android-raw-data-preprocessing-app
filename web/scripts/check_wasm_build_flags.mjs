import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { leakedHomeDirectoryPrefixes, wasmBuildOptions } from "./wasm_build_flags.mjs";

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
