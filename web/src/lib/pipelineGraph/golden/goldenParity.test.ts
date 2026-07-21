import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ledgerViolations } from "@/lib/pipelineGraph/executionRecords";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import type { ProcessedFileResult } from "@/lib/types";
import {
  GOLDEN_SCENARIOS,
  goldenRustMatcher,
  runGoldenScenario,
  serializeGoldenOutputs,
  type GoldenScenario,
} from "@/lib/pipelineGraph/golden/goldenScenario";
import * as matcherKernel from "@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js";

/**
 * Byte-for-byte reproduction lock for the covered pipeline configs.
 *
 * The recorded files under `expected/` ARE the algorithm outputs we already
 * produce; this test fails the moment any change (refactor or ontology work)
 * alters a byte. To (re)record the baseline after an INTENTIONAL output change,
 * run: `UPDATE_GOLDEN=1 npm test -- goldenParity`, then review the git diff of
 * the golden files as part of the change.
 *
 * Scope/exclusions are documented in goldenScenario.ts ("COVERAGE BOUNDARY"):
 * the WASM concurrent-usage/background-apps branch is not exercised, and the
 * embedded local timestamps are ICU/tz-sensitive — record on the pinned Node.
 */

const EXPECTED_DIR = join(dirname(fileURLToPath(import.meta.url)), "expected");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

beforeAll(() => {
  const wasmBytes = readFileSync(
    new URL(
      "../../../wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm_bg.wasm",
      import.meta.url,
    ),
  );
  matcherKernel.initSync({ module: wasmBytes });
});

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
    // vanished output file is itself a change worth surfacing. Sort with the SAME
    // comparator produceAll() uses (localeCompare); readdirSync().sort() defaults
    // to UTF-16 code-unit order, which disagrees with localeCompare on case and
    // punctuation and would raise a spurious ordering mismatch on identical sets.
    const recorded = existsSync(EXPECTED_DIR)
      ? readdirSync(EXPECTED_DIR).sort((a, b) => a.localeCompare(b))
      : [];
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

  // The golden harness always routes episode matching through Rust/WASM and
  // keeps the concurrent splitter disabled. Exercise both injected boundaries
  // directly so a future accidental bypass cannot pass silently.
  const GUARD_HEADER =
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";
  const GUARD_CSV = [
    GUARD_HEADER,
    "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,America/Chicago",
    "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:05,America/Chicago",
    "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:02:05,America/Chicago",
    "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:09:30,America/Chicago",
  ].join("\n");

  it("delegates episode matching to the injected Rust boundary", async () => {
    const scenario: GoldenScenario = {
      name: "guard: wasm matcher",
      inputFileName: "Guard.csv",
      inputCsv: GUARD_CSV,
      options: {
        ...DEFAULT_BROWSER_OPTIONS,
        timezoneHandling: "selected-filter",
        selectedTimezone: "America/Chicago",
        useAppCodebook: false,
        enablePlotting: false,
        enableActivityHeatmap: false,
        proximityIntervalSeconds: 0,
      },
      supportFiles: {},
    };
    const throwingMatcher = (): Promise<never> =>
      Promise.reject(new Error("golden: injected matcher was called"));
    await expect(runGoldenScenario(scenario, throwingMatcher)).rejects.toThrow(
      /injected matcher was called/,
    );
  });

  it("throwingSplitter fires when a config models concurrent usage", async () => {
    const scenario: GoldenScenario = {
      name: "guard: concurrent splitter",
      inputFileName: "Guard.csv",
      inputCsv: GUARD_CSV,
      // proximity stays default (>0) so the in-process matcher runs; the
      // concurrent-usage split then delegates to runSplitter (the throwing stub).
      options: {
        ...DEFAULT_BROWSER_OPTIONS,
        timezoneHandling: "selected-filter",
        selectedTimezone: "America/Chicago",
        useAppCodebook: false,
        enablePlotting: false,
        enableActivityHeatmap: false,
        modelConcurrentUsage: true,
      },
      supportFiles: {},
    };
    const throwingSplitter = (): Promise<never> =>
      Promise.reject(new Error("golden: runSplitter was called"));
    await expect(
      runGoldenScenario(scenario, goldenRustMatcher, throwingSplitter),
    ).rejects.toThrow(/runSplitter was called/);
  });

  it("serializeGoldenOutputs rejects two outputs that claim the same filename", async () => {
    const clashing = {
      outputs: [
        { kind: "app", outputFileName: "clash.csv", blob: new Blob(["first"]) },
        { kind: "app", outputFileName: "clash.csv", blob: new Blob(["second"]) },
      ],
    } as unknown as ProcessedFileResult;
    await expect(serializeGoldenOutputs(clashing)).rejects.toThrow(/duplicate output filename/);
  });

  it("every scenario's execution ledger is populated and expectation-clean", async () => {
    for (const scenario of GOLDEN_SCENARIOS) {
      const result = await runGoldenScenario(scenario);
      const ledger = result.executionLedger;
      expect(ledger, `${scenario.name}: missing executionLedger`).toBeDefined();
      // Every engine node reports a record, and the live-run units carry
      // step records (the golden configs run the pipeline for real).
      expect(ledger!.length).toBeGreaterThan(0);
      expect(ledger!.flatMap((unit) => unit.steps).length).toBeGreaterThan(0);
      // The conservation/monotonic/loss declarations on the real steps must
      // hold on real data — a violation here means a lineage declaration
      // (not the pipeline) is wrong.
      expect(
        ledgerViolations(ledger!),
        `${scenario.name}: violated expectations in the execution ledger`,
      ).toEqual([]);
    }
  });
});
