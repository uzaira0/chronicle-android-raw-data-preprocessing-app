import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    linkmlPython: string | null;
  }
}

// The interpreter the generated-schema checks run under. One pinned set for
// every test, so all of them check against the same LinkML.
export const LINKML_UVX_ARGS = ["--from", "linkml==1.10.0", "--with", "jsonschema", "python"] as const;

const PRINT_EXECUTABLE = ["-c", "import sys; print(sys.executable)"];

function resolveInterpreter(extraArgs: string[]): string {
  return execFileSync("uvx", [...extraArgs, ...LINKML_UVX_ARGS, ...PRINT_EXECUTABLE], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 120_000,
  }).trim();
}

// Resolve the LinkML interpreter once per run. Calling `uvx` from every test
// re-resolves the packages each time, and once uv's cached PyPI index goes
// stale every call goes back to the network. With several test files doing
// that at once, one slow response held a test past its 180 s timeout
// (methodProfileTemporalObservations, 2026-10-07). Offline first, because
// the cache normally holds everything; online only to fill an empty cache.
export default function provideLinkmlPython(project: TestProject): void {
  let python: string | null = null;
  for (const extraArgs of [["--offline"], []]) {
    try {
      python = resolveInterpreter(extraArgs);
      break;
    } catch {
      // Try the next mode; the tests that need it report the absence by name.
    }
  }
  if (python === null) {
    process.stdout.write("[linkml python] uvx could not provide linkml==1.10.0; tests that need it will fail.\n");
  }
  project.provide("linkmlPython", python);
}
