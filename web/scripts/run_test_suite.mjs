#!/usr/bin/env node
// The `npm run test` entry point, and the whole of the Makefile's `web-test`
// target.
//
// It runs the unit suite plus the contract-scoped slice of the configuration
// campaign. The four campaign suites are excluded from `test:unit` because a
// full replay is long-running and has its own Makefile targets
// (`make combinatorial`, `make dependency-evidence`), but the two
// configuration-space checks named below are the fail-closed part: they refuse
// to pass when a declared option has no observed binding, or when a conditional
// support binding is left as a hole. A new option must not be able to land
// without them running.
//
// This file was previously untracked: `.gitignore`'s blanket `*test*` pattern
// matched its name, so it was never committed and a working-tree cleanup
// deleted it, leaving `npm run test` pointing at nothing. The negation entry
// in `.gitignore` alongside the other rescued script names is what keeps it.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "..");

/** Each step is a package.json script name, run in order, stopping at the first failure. */
const STEPS = ["test:unit", "test:configuration-space-contract"];

for (const step of STEPS) {
  process.stdout.write(`\n=== npm run ${step} ===\n`);
  const result = spawnSync("npm", ["run", step], {
    cwd: webDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    process.stderr.write(`${step} failed to start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`\n${step} failed with exit code ${result.status}\n`);
    process.exit(result.status ?? 1);
  }
}
