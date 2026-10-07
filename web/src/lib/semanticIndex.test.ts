import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  executeRustRuntime,
  queryRustReview,
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

/** The one fixture both the execute-path and the review-path cases run on, so
 * the two cannot silently diverge into testing different workloads. */
const SEMANTIC_INDEX_CSV = new TextEncoder().encode(
  [
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
    "Study,P01,Target Child,Secret,Unknown importance: 1,super.secret.package,2026-03-07 10:00:00,America/Chicago",
    "Study,P01,Target Child,Secret,Unknown importance: 2,super.secret.package,2026-03-07 10:01:00,America/Chicago",
  ].join("\n"),
);

const SEMANTIC_INDEX_OPTIONS = {
  ...DEFAULT_BROWSER_OPTIONS,
  studyName: "Semantic Index Proof",
  processAppUsage: true,
  processScreenUsage: false,
  selectedTimezone: "America/Chicago",
  timezoneHandling: "selected-convert" as const,
  useFilterFile: false,
  useAppsForcingScreenOpenFile: false,
  useBackgroundAppsFile: false,
  useAppCodebook: false,
  enablePlotting: false,
};

const SEMANTIC_INDEX_RUNTIME = {
  datetimeOfPreprocessing: "2026-07-21 12:00:00 UTC",
  persistRustWorkspace: false,
  incrementalEngine: true,
  provenanceEvidence: true,
};

/** U+001F, the field separator `expected_query_reason_id` hashes with
 * (`rust/chronicle_semantic_index_wasm/src/lib.rs:3377`). */
const UNIT_SEPARATOR = "\u001f";

function concatArtifacts(parts: readonly Uint8Array[]): Uint8Array {
  const bundle = new Uint8Array(
    parts.reduce((size, bytes) => size + bytes.byteLength, 0),
  );
  let offset = 0;
  for (const bytes of parts) {
    bundle.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return bundle;
}

describe("derived semantic index WASM boundary", () => {
  it("rebuilds deterministically and exposes only registered product queries", async () => {
    const csv = SEMANTIC_INDEX_CSV;
    const execution = await executeRustRuntime(
      csv,
      "raw.csv",
      SEMANTIC_INDEX_OPTIONS,
      undefined,
      SEMANTIC_INDEX_RUNTIME,
    );
    const source = execution.artifacts.get("semantic-index-source-json");
    if (!source) throw new Error("missing semantic-index source artifact");

    const sourceValue = JSON.parse(new TextDecoder().decode(source)) as {
      scientificValidationSubstrateKinds: string[];
    };
    const bundle = concatArtifacts(
      sourceValue.scientificValidationSubstrateKinds.map((kind) => {
        const bytes = execution.artifacts.get(kind);
        if (!bytes) throw new Error(`missing scientific substrate: ${kind}`);
        return bytes;
      }),
    );
    const first = await rebuildSemanticIndex(source, bundle);
    const second = await rebuildSemanticIndex(source, bundle);
    expect(second).toEqual(first);
    expect(new TextDecoder().decode(first)).not.toContain(
      "super.secret.package",
    );

    const executions = await queryRegisteredSemanticIndex(
      first,
      "actual-executions",
    );
    expect(executions.rows?.length).toBeGreaterThan(0);

    const assignments = await queryRegisteredSemanticIndex(
      first,
      "role-assignments",
    );
    expect(assignments.rows?.length).toBeGreaterThanOrEqual(2);

    const qualifications = await queryRegisteredSemanticIndex(
      first,
      "qualification-traces",
    );
    expect(qualifications.rows?.length).toBeGreaterThanOrEqual(2);
    expect(
      qualifications.rows?.every((row) => row["?decision"]?.includes("accepted")),
      JSON.stringify(qualifications.rows, null, 2),
    ).toBe(true);

    const requirements = await queryRegisteredSemanticIndex(
      first,
      "requirement-traces",
    );
    expect(requirements.rows).toHaveLength(11);
    expect(requirements.rows?.some((row) => row["?state"]?.includes("satisfied"))).toBe(
      true,
    );

    await expect(
      queryRegisteredSemanticIndex(first, "DROP ALL"),
    ).rejects.toThrow(/unregistered production query/i);
  });

  /**
   * The review path must never produce an index source, and a source that
   * carries review-mode statuses must never rebuild into an index.
   *
   * `queryRustReview` runs with `materialize_full_outputs == false`
   * (`chronicle_preprocessing_runtime_wasm/src/lib.rs:4336` —
   * `request.command != QUERY_REVIEW_COMMAND`), so the twelve
   * `ReviewBehavior::Omit` queries are not computed. The kernel still writes
   * well-formed *placeholder* checkpoints for them
   * (`pipeline_v2_incremental.rs:15373`,
   * `workflow_state_checkpoint("index_raw_dates", "not_requested")`), whose
   * terminal digests are structurally valid. `"skipped"` is therefore the only
   * field in `chronicle-semantic-index-source/v7` that separates a placeholder
   * digest from a product digest, which is why
   * `validate_query_execution_identity` refuses it.
   *
   * Until this case existed the suite only ever exercised a full execution, so
   * neither half of the invariant was pinned on the web side.
   */
  it("never emits an index source on the review path, and refuses one built from review statuses", async () => {
    const csv = SEMANTIC_INDEX_CSV;
    const execution = await executeRustRuntime(
      csv,
      "raw.csv",
      SEMANTIC_INDEX_OPTIONS,
      undefined,
      SEMANTIC_INDEX_RUNTIME,
    );
    const review = await queryRustReview(
      csv,
      "raw.csv",
      SEMANTIC_INDEX_OPTIONS,
      undefined,
      SEMANTIC_INDEX_RUNTIME,
    );

    // 1. Structural: the execute path is the only producer of the source.
    expect(execution.artifacts.has("semantic-index-source-json")).toBe(true);
    const reviewManifest = JSON.parse(review.manifestJson) as {
      command: string;
      workspaceRootDigest?: string;
      artifacts: Array<{ kind: string }>;
    };
    expect(reviewManifest.command).toBe("QueryReview");
    expect(reviewManifest.artifacts.map((entry) => entry.kind)).not.toContain(
      "semantic-index-source-json",
    );
    // A review run also mints no new authoritative root, so nothing it produces
    // can reach `readVerifiedSemanticIndexSnapshot`, which resolves the source
    // only from a persisted workspace-root closure.
    expect(reviewManifest.workspaceRootDigest).toBeUndefined();
    expect(review).not.toHaveProperty("artifacts");

    // 2. `index_raw_dates` is an `Omit` query whose applicability is
    // `option_true("process_app_usage")` (`workflow_contract.rs:1911`), and this
    // fixture sets `processAppUsage: true`, so it is applicable and reported
    // skipped rather than bypassed. Derived from the options in play — never a
    // hardcoded count.
    expect(review.skippedQueryIds).toContain("index_raw_dates");
    expect(review.errorQueryIds).toEqual([]);

    // 3. Vocabulary coupling end to end: relabel one real execution row with the
    // status a review-sourced index would carry, keeping the row otherwise
    // self-consistent, and the Rust gate must still fail closed.
    const sourceBytes = execution.artifacts.get("semantic-index-source-json");
    if (!sourceBytes) throw new Error("missing semantic-index source artifact");
    const substrateSource = JSON.parse(
      new TextDecoder().decode(sourceBytes),
    ) as {
      scientificValidationSubstrateKinds: string[];
      queryExecutions: Array<{
        query_id: string;
        status: string;
        input_key: string;
        output_digest: string;
        reason_id: string;
      }>;
    };
    const bundle = concatArtifacts(
      substrateSource.scientificValidationSubstrateKinds.map((kind) => {
        const bytes = execution.artifacts.get(kind);
        if (!bytes) throw new Error(`missing scientific substrate: ${kind}`);
        return bytes;
      }),
    );
    // Control: the untouched source rebuilds.
    await expect(
      rebuildSemanticIndex(sourceBytes, bundle),
    ).resolves.toBeInstanceOf(Uint8Array);

    // Oracle check for the reason digest below. `reason_id` mismatch raises the
    // same error string as a refused status, so without this the rejection could
    // pass for the wrong reason. Reproducing an untouched row's own `reason_id`
    // proves the formula, so the only thing left varying is `status`.
    const reasonId = (row: {
      query_id: string;
      input_key: string;
      output_digest: string;
      status: string;
    }) =>
      `sha256:${createHash("sha256")
        .update(
          [row.query_id, row.input_key, row.output_digest, row.status].join(
            UNIT_SEPARATOR,
          ),
          "utf8",
        )
        .digest("hex")}`;
    for (const row of substrateSource.queryExecutions) {
      expect(reasonId(row)).toBe(row.reason_id);
    }

    for (const status of ["skipped", "error"]) {
      const tampered = JSON.parse(new TextDecoder().decode(sourceBytes)) as {
        queryExecutions: Array<{
          query_id: string;
          status: string;
          input_key: string;
          output_digest: string;
          reason_id: string;
        }>;
      };
      const row = tampered.queryExecutions[0];
      if (!row) throw new Error("index source carries no query executions");
      row.status = status;
      // `expected_query_reason_id` in
      // `rust/chronicle_semantic_index_wasm/src/lib.rs:3377`.
      row.reason_id = reasonId(row);
      await expect(
        rebuildSemanticIndex(
          new TextEncoder().encode(JSON.stringify(tampered)),
          bundle,
        ),
      ).rejects.toThrow(/semantic index query execution is invalid/i);
    }
  });

  it("can clear and restore the injected module between isolated workspaces", () => {
    setSemanticIndexForTesting(null);
    setSemanticIndexForTesting(indexWasm);
  });

  it("lazy-initializes the generated module once when no test module is injected", async () => {
    vi.resetModules();
    const init = vi.fn().mockResolvedValue(undefined);
    const rebuild = vi.fn(
      (source: Uint8Array, bundle: Uint8Array) => {
        expect(bundle).toBeInstanceOf(Uint8Array);
        return Uint8Array.from(source);
      },
    );
    const query = vi.fn(() => JSON.stringify({ queryId: "actual-executions" }));
    vi.doMock(
      "@/wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm.js",
      () => ({
        default: init,
        rebuild_semantic_index: rebuild,
        query_registered: query,
      }),
    );

    try {
      const fresh = await import("@/lib/semanticIndex");
      const source = new Uint8Array([1, 2, 3]);
      const bundle = new Uint8Array([4, 5, 6]);
      await expect(fresh.rebuildSemanticIndex(source, bundle)).resolves.toEqual(
        source,
      );
      await expect(
        fresh.queryRegisteredSemanticIndex(source, "actual-executions"),
      ).resolves.toEqual({ queryId: "actual-executions" });
      expect(init).toHaveBeenCalledTimes(1);
      expect(rebuild).toHaveBeenCalledWith(source, bundle);
      expect(query).toHaveBeenCalledWith(source, "actual-executions");
    } finally {
      vi.doUnmock(
        "@/wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm.js",
      );
      vi.resetModules();
      setSemanticIndexForTesting(indexWasm);
    }
  });
});
