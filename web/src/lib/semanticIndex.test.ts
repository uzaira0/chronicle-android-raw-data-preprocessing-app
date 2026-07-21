import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import {
  executeRustRuntime,
  setRustRuntimeForTesting,
} from "@/lib/rustPipelineRuntime";
import {
  queryRegisteredSemanticIndex,
  rebuildSemanticIndex,
  setSemanticIndexForTesting,
} from "@/lib/semanticIndex";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";
import * as indexWasm from "@/wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm.js";

beforeAll(async () => {
  const [runtimeBytes, indexBytes] = await Promise.all([
    readFile(
      new URL(
        "../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
        import.meta.url,
      ),
    ),
    readFile(
      new URL(
        "../wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm_bg.wasm",
        import.meta.url,
      ),
    ),
  ]);
  runtimeWasm.initSync({ module: runtimeBytes });
  indexWasm.initSync({ module: indexBytes });
  setRustRuntimeForTesting(runtimeWasm);
  setSemanticIndexForTesting(indexWasm);
});

describe("derived semantic index WASM boundary", () => {
  it("rebuilds deterministically and exposes only registered product queries", async () => {
    const csv = new TextEncoder().encode(
      [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Secret,Unknown importance: 1,super.secret.package,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Secret,Unknown importance: 2,super.secret.package,2026-03-07 10:01:00,America/Chicago",
      ].join("\n"),
    );
    const execution = await executeRustRuntime(
      csv,
      "raw.csv",
      {
        ...DEFAULT_BROWSER_OPTIONS,
        studyName: "Semantic Index Proof",
        processAppUsage: true,
        processScreenUsage: false,
        selectedTimezone: "America/Chicago",
        timezoneHandling: "selected-convert",
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useBackgroundAppsFile: false,
        useAppCodebook: false,
        enablePlotting: false,
      },
      undefined,
      {
        datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
        persistRustWorkspace: false,
      },
    );
    const source = execution.artifacts.get("semantic-index-source-json");
    expect(source).toBeDefined();

    const first = await rebuildSemanticIndex(source!);
    const second = await rebuildSemanticIndex(source!);
    expect(second).toEqual(first);
    expect(new TextDecoder().decode(first)).not.toContain(
      "super.secret.package",
    );

    const executions = await queryRegisteredSemanticIndex(
      first,
      "actual-executions",
    );
    expect(executions.rows).toHaveLength(15);

    const assignments = await queryRegisteredSemanticIndex(
      first,
      "role-assignments",
    );
    expect(assignments.rows?.length).toBeGreaterThanOrEqual(2);

    await expect(
      queryRegisteredSemanticIndex(first, "DROP ALL"),
    ).rejects.toThrow(/unregistered production query/i);
  });
});
