import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GOLDEN_SCENARIOS,
  runGoldenScenario,
  serializeGoldenOutputs,
} from "@/lib/pipelineGraph/golden/goldenScenario";

/**
 * Byte-for-byte reproduction lock for the whole pipeline.
 *
 * The recorded files under `expected/` ARE the algorithm outputs we already
 * produce; this test fails the moment any change (refactor or ontology work)
 * alters a byte. To (re)record the baseline after an INTENTIONAL output change,
 * run: `UPDATE_GOLDEN=1 npm test -- goldenParity`, then review the git diff of
 * the golden files as part of the change.
 */

const EXPECTED_DIR = join(dirname(fileURLToPath(import.meta.url)), "expected");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

async function produceAll(): Promise<Map<string, string>> {
  const all = new Map<string, string>();
  for (const scenario of GOLDEN_SCENARIOS) {
    const outputs = await serializeGoldenOutputs(await runGoldenScenario(scenario));
    for (const [name, content] of outputs) {
      if (all.has(name)) {
        throw new Error(`golden: output filename "${name}" produced by two scenarios`);
      }
      all.set(name, content);
    }
  }
  return new Map([...all.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

describe("pipeline golden reproduction", () => {
  it("reproduces the recorded byte-for-byte outputs", async () => {
    const produced = await produceAll();
    expect(produced.size).toBeGreaterThan(0);

    if (UPDATE) {
      // Rewrite the whole directory so stale files from an earlier fixture shape
      // never linger.
      rmSync(EXPECTED_DIR, { recursive: true, force: true });
      mkdirSync(EXPECTED_DIR, { recursive: true });
      for (const [name, content] of produced) {
        writeFileSync(join(EXPECTED_DIR, name), content, "utf8");
      }
      return;
    }

    // The set of produced outputs must match the recorded set exactly — a new or
    // vanished output file is itself a change worth surfacing.
    const recorded = existsSync(EXPECTED_DIR) ? readdirSync(EXPECTED_DIR).sort() : [];
    expect(recorded.length).toBeGreaterThan(0);
    expect([...produced.keys()]).toEqual(recorded);

    for (const [name, content] of produced) {
      const golden = readFileSync(join(EXPECTED_DIR, name), "utf8");
      expect(content, `golden mismatch in ${name}`).toBe(golden);
    }
  });

  it("is deterministic across repeated recomputes", async () => {
    const first = await produceAll();
    const second = await produceAll();
    expect([...second.entries()]).toEqual([...first.entries()]);
  });
});
