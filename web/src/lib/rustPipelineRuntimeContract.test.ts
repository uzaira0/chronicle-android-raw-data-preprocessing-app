import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  decodeRuntimeManifest,
  executeRustRuntime,
  queryRustReview,
  setRustRuntimeForTesting,
  verifyRuntimeArtifactCatalog,
  type RuntimeManifest,
} from "@/lib/rustPipelineRuntime";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

let manifest: RuntimeManifest;

function cloneManifest(): RuntimeManifest {
  return structuredClone(manifest);
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  return value as unknown[];
}

function firstRecord(
  candidate: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  return record(array(candidate[field])[0]);
}

function representativeSourceFixture(): Uint8Array {
  const rows = [
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
  ];
  for (let index = 0; index < 600; index += 1) {
    const hour = Math.floor(index / 60);
    const minute = index % 60;
    const interaction =
      index % 2 === 0 ? "Activity Resumed" : "Activity Paused";
    rows.push(
      `Study,P01,Target Child,Chat,${interaction},com.example.chat,2026-03-07 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00,America/Chicago`,
    );
  }
  return new TextEncoder().encode(rows.join("\n"));
}

const INVALID_CASES: Array<
  [string, (candidate: Record<string, unknown>) => void, RegExp]
> = [
  [
    "protocol drift",
    (candidate) => {
      candidate.protocolVersion = "chronicle-preprocessing-runtime/v2";
    },
    /protocolVersion/,
  ],
  [
    "command substitution",
    (candidate) => {
      candidate.command = "GetView";
    },
    /command/,
  ],
  [
    "empty request identity",
    (candidate) => {
      candidate.requestId = "";
    },
    /requestId.*non-empty string/,
  ],
  [
    "malformed authority digest",
    (candidate) => {
      candidate.productContractDigest = "sha256:not-a-digest";
    },
    /productContractDigest/,
  ],
  [
    "unknown cache mode",
    (candidate) => {
      record(candidate.dependencyCacheDecision).mode = "optimistic_guess";
    },
    /expected certified_narrow or conservative_full/,
  ],
  [
    "non-boolean empirical currency",
    (candidate) => {
      record(candidate.dependencyCacheDecision).empirical_evidence_current =
        "yes";
    },
    /empirical_evidence_current.*boolean/,
  ],
  [
    "false narrow-cache structural claim",
    (candidate) => {
      const decision = record(candidate.dependencyCacheDecision);
      decision.mode = "certified_narrow";
      decision.certificate_digest = candidate.dependencyCertificateDigest;
      decision.binding_surface_digest = null;
    },
    /certified_narrow requires certificate and binding-surface identity/,
  ],
  [
    "certificate identity split",
    (candidate) => {
      record(candidate.dependencyCacheDecision).certificate_digest =
        `sha256:${"f".repeat(64)}`;
    },
    /does not match manifest dependency certificate/,
  ],
  [
    "negative row count",
    (candidate) => {
      record(candidate.counts).original = -1;
    },
    /counts\.original.*non-negative safe integer/,
  ],
  [
    "role assignment is not an object",
    (candidate) => {
      array(candidate.roleAssignments)[0] = "not-an-assignment";
    },
    /roleAssignments\[0\].*object/,
  ],
  [
    "role assignment has a non-string qualifier",
    (candidate) => {
      record(firstRecord(candidate, "roleAssignments").qualifiers).scope = 7;
    },
    /roleAssignments\[0\]\.qualifiers\.scope.*non-empty string/,
  ],
  [
    "role assignment has a fractional revision",
    (candidate) => {
      firstRecord(candidate, "roleAssignments").revision = 1.5;
    },
    /roleAssignments\[0\]\.revision.*non-negative safe integer/,
  ],
  [
    "artifact reference has malformed ancestry",
    (candidate) => {
      record(firstRecord(candidate, "roleAssignments").artifact).derived_from =
        "not-an-array";
    },
    /derived_from.*array/,
  ],
  [
    "artifact reference has a non-string ancestor",
    (candidate) => {
      record(firstRecord(candidate, "roleAssignments").artifact).derived_from =
        [7];
    },
    /derived_from\[0\].*non-empty string/,
  ],
  [
    "unknown node execution status",
    (candidate) => {
      firstRecord(candidate, "nodeExecutions").status = "silently_stale";
    },
    /nodeExecutions\[0\]\.status.*unknown execution status/,
  ],
  [
    "qualification trace has an unknown decision",
    (candidate) => {
      firstRecord(candidate, "qualificationTraces").decision = "maybe";
    },
    /qualificationTraces\[0\]\.decision.*unknown qualification decision/,
  ],
  [
    "qualification rule has a non-boolean result",
    (candidate) => {
      const trace = firstRecord(candidate, "qualificationTraces");
      record(array(trace.rule_evaluations)[0]).passed = "true";
    },
    /rule_evaluations\[0\]\.passed.*boolean/,
  ],
  [
    "requirement trace has an unknown materialization state",
    (candidate) => {
      firstRecord(candidate, "requirementTraces").state = "silently_stale";
    },
    /requirementTraces\[0\]\.state.*unknown materialization state/,
  ],
  [
    "requirement trace has an invalid nullable condition result",
    (candidate) => {
      firstRecord(candidate, "requirementTraces").condition_result = "false";
    },
    /condition_result.*boolean/,
  ],
  [
    "timezone accounting drift",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      summary.rowsRemovedByTimezone = Number(summary.rowsRemovedByTimezone) + 1;
    },
    /row accounting is inconsistent/,
  ],
  [
    "unknown timezone action",
    (candidate) => {
      record(candidate.processingSummary).timezoneAction = "infer-silently";
    },
    /timezoneAction.*unknown timezone action/,
  ],
  [
    "checkpoint substitution",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      const checkpoints = record(summary.logicalStageCheckpoints);
      const nodeId = Object.keys(checkpoints)[0];
      record(checkpoints[nodeId]).terminalDigest = `sha256:${"f".repeat(64)}`;
    },
    /checkpoint identity or terminal digest/,
  ],
  [
    "checkpoint component uses the wrong digest family",
    (candidate) => {
      const checkpoints = record(
        record(candidate.processingSummary).logicalStageCheckpoints,
      );
      const nodeId = Object.keys(checkpoints)[0];
      record(checkpoints[nodeId]).payloadDigest = `sha256:${"a".repeat(64)}`;
    },
    /payloadDigest.*lowercase blake3 digest/,
  ],
  [
    "checkpoint protocol is unsupported",
    (candidate) => {
      const checkpoints = record(
        record(candidate.processingSummary).logicalStageCheckpoints,
      );
      const nodeId = Object.keys(checkpoints)[0];
      record(checkpoints[nodeId]).protocolVersion =
        "chronicle-logical-stage-checkpoint/v99";
    },
    /protocolVersion.*unsupported checkpoint protocol/,
  ],
  [
    "checkpoint stage identity substitution",
    (candidate) => {
      const checkpoints = record(
        record(candidate.processingSummary).logicalStageCheckpoints,
      );
      const nodeId = Object.keys(checkpoints)[0];
      record(checkpoints[nodeId]).nodeId = "different-node";
    },
    /checkpoint identity or terminal digest/,
  ],
  [
    "empty stage checkpoint domain",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      summary.logicalStageDigests = {};
      summary.logicalStageCheckpoints = {};
    },
    /digest and checkpoint domains must contain the same 15 identities/,
  ],
  [
    "stage digest and checkpoint domain mismatch",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      const checkpoints = record(summary.logicalStageCheckpoints);
      delete checkpoints[Object.keys(checkpoints)[0]];
    },
    /digest and checkpoint domains must contain the same 15 identities/,
  ],
  [
    "artifact metadata has a negative row count",
    (candidate) => {
      firstRecord(candidate, "artifacts").rowCount = -1;
    },
    /artifacts\[0\]\.rowCount.*non-negative safe integer/,
  ],
  [
    "artifact preview contains a non-string cell",
    (candidate) => {
      firstRecord(candidate, "artifacts").previewRows = [["valid", 7]];
    },
    /previewRows\[0\]\[1\].*expected a string/,
  ],
  [
    "step execution has an unknown status",
    (candidate) => {
      firstRecord(candidate, "stepExecutions").status = "silently_stale";
    },
    /stepExecutions\[0\]\.status.*unknown execution status/,
  ],
  [
    "step execution domain is incomplete",
    (candidate) => {
      array(candidate.stepExecutions).pop();
    },
    /expected exactly 55 unique Rust step executions/,
  ],
  [
    "step execution output disagrees with its Rust checkpoint",
    (candidate) => {
      firstRecord(candidate, "stepExecutions").output_digest =
        `sha256:${"a".repeat(64)}`;
    },
    /step execution output does not match its Rust checkpoint/,
  ],
  [
    "duplicate artifact identity",
    (candidate) => {
      const artifacts = array(candidate.artifacts);
      artifacts.push(structuredClone(artifacts[0]));
    },
    /duplicate artifact kind/,
  ],
  [
    "duplicate artifact id with distinct kinds",
    (candidate) => {
      const artifacts = array(candidate.artifacts);
      const duplicate = structuredClone(record(artifacts[0]));
      duplicate.kind = "different-kind";
      artifacts.push(duplicate);
    },
    /duplicate artifact id/,
  ],
  [
    "duplicate role assignment",
    (candidate) => {
      const assignments = array(candidate.roleAssignments);
      const duplicate = structuredClone(record(assignments[0]));
      duplicate.assignment_id = "duplicate-role-assignment";
      assignments.push(duplicate);
    },
    /duplicate role/,
  ],
  [
    "duplicate node execution",
    (candidate) => {
      const executions = array(candidate.nodeExecutions);
      const duplicate = structuredClone(record(executions[0]));
      duplicate.capability_id = "duplicate-node-capability";
      executions.push(duplicate);
    },
    /duplicate node/,
  ],
  [
    "missing materialization trace surface",
    (candidate) => {
      delete candidate.requirementTraces;
    },
    /requirementTraces/,
  ],
];

beforeAll(async () => {
  const campaignPackage = process.env.CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR;
  const runtimeBytes = await readFile(
    campaignPackage
      ? path.join(
          campaignPackage,
          "chronicle_preprocessing_runtime_wasm_bg.wasm",
        )
      : new URL(
          "../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
          import.meta.url,
        ),
  );
  runtimeWasm.initSync({ module: runtimeBytes });
  setRustRuntimeForTesting(runtimeWasm);
  const raw = new TextEncoder().encode(
    [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Example,Unknown importance: 1,example.app,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Example,Unknown importance: 2,example.app,2026-03-07 10:01:00,America/Chicago",
    ].join("\n"),
  );
  manifest = (
    await executeRustRuntime(
      raw,
      "runtime-contract.csv",
      {
        ...DEFAULT_BROWSER_OPTIONS,
        studyName: "Runtime Contract Proof",
        selectedTimezone: "America/Chicago",
        timezoneHandling: "selected-convert",
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useBackgroundAppsFile: false,
        useAppCodebook: false,
        processScreenUsage: false,
        enablePlotting: false,
      },
      undefined,
      {
        datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
        persistRustWorkspace: false,
      },
    )
  ).manifest;
});

describe("Rust/WASM runtime manifest contract firewall", () => {
  it("accepts the exact compiled runtime manifest and artifact catalog", () => {
    expect(decodeRuntimeManifest(cloneManifest())).toEqual(manifest);
    expect(manifest.dependencyCacheDecision).toMatchObject({
      mode: "certified_narrow",
      empirical_evidence_current: true,
    });
    expect(() =>
      verifyRuntimeArtifactCatalog(
        manifest,
        structuredClone(manifest.artifacts),
      ),
    ).not.toThrow();
  });

  it("keeps all 55 query results warm when OPFS persistence is disabled", async () => {
    const raw = new TextEncoder().encode(
      [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Example,Unknown importance: 1,example.app,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Example,Unknown importance: 2,example.app,2026-03-07 10:01:00,America/Chicago",
      ].join("\n"),
    );
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
      studyName: "Ephemeral continuation proof",
      selectedTimezone: "America/Chicago",
      timezoneHandling: "selected-convert" as const,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
      processScreenUsage: false,
      enablePlotting: false,
    };
    const runtime = {
      datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
      persistRustWorkspace: false,
    };
    const first = await executeRustRuntime(
      raw,
      "ephemeral-continuation.csv",
      options,
      undefined,
      runtime,
    );
    const second = await executeRustRuntime(
      raw,
      "ephemeral-continuation.csv",
      options,
      undefined,
      runtime,
    );
    expect(second.manifest.previousWorkspaceRootDigest).toBe(
      first.manifest.workspaceRootDigest,
    );
    expect(
      second.manifest.stepExecutions.filter(
        ({ status }) => status === "recomputed" || status === "error",
      ),
    ).toEqual([]);
    const runSpecificArtifacts = new Set([
      "execution-ledger-json",
      "semantic-index-source-json",
      "correspondence-index-json",
      "evidence-journal",
      "execution-state-json",
      "stage-view-json",
      "artifact-view-json",
      "obligation-view-json",
      "explanation-view-json",
      "artifact-closure-json",
      "workspace-root-json",
    ]);
    const stableKinds = [...first.artifacts.keys()]
      .filter((kind) => !runSpecificArtifacts.has(kind))
      .sort();
    expect(
      [...second.artifacts.keys()]
        .filter((kind) => !runSpecificArtifacts.has(kind))
        .sort(),
    ).toEqual(stableKinds);
    for (const kind of stableKinds) {
      expect(second.artifacts.get(kind), kind).toEqual(
        first.artifacts.get(kind),
      );
    }
  });

  it("returns byte-identical review metrics without materializing full exports", async () => {
    const raw = representativeSourceFixture();
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
      studyName: "Selective review proof",
      selectedTimezone: "America/Chicago",
      timezoneHandling: "selected-convert" as const,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
      processScreenUsage: false,
      enablePlotting: false,
    };
    const runtime = {
      datetimeOfPreprocessing: "2026-07-25 00:00:00 UTC",
      persistRustWorkspace: false,
    };
    const full = await executeRustRuntime(
      raw,
      "selective-review-proof.csv",
      options,
      undefined,
      runtime,
    );
    const review = await queryRustReview(
      raw,
      "selective-review-proof.csv",
      options,
      undefined,
      runtime,
    );
    const expected: unknown = JSON.parse(
      new TextDecoder().decode(full.artifacts.get("review-summary-json")),
    );

    expect(review.reviewSummary).toEqual(expected);
    expect(review.cachedStepIds).toHaveLength(24);
    expect(review.recomputedStepIds).toEqual([
      "relabel_usage_with_floor",
      "junk_downstream_mark",
      "sort_episodes",
      "codebook_join",
      "derive_broad_category",
      "collapse_genre",
      "engagement_walk",
      "flag_and_retain",
      "blank_junk_timing",
      "drop_selected_types",
      "drop_zero_duration",
      "resolve_participant_windows",
      "filter_rows_to_window",
      "resolve_sharing_status",
      "attribute_rows",
      "inject_placeholders",
      "assemble_result",
    ]);
    expect(review.bypassedStepIds).toHaveLength(13);
    expect(review.skippedStepIds).toEqual(["build_raw_date_index"]);
    expect(review.errorStepIds).toEqual([]);
    expect(review.comparisonDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("forces conservative recomputation when empirical release evidence is stale", () => {
    const stale = cloneManifest();
    stale.dependencyCacheDecision.mode = "conservative_full";
    stale.dependencyCacheDecision.empirical_evidence_current = false;
    expect(decodeRuntimeManifest(stale).dependencyCacheDecision).toMatchObject({
      mode: "conservative_full",
      empirical_evidence_current: false,
    });
  });

  it("accepts explicit open obligations and non-null prior-root identity", () => {
    const candidate = cloneManifest();
    candidate.previousWorkspaceRootDigest = `sha256:${"a".repeat(64)}`;
    candidate.openObligations = [
      {
        obligation_id: "obligation:filter-file",
        role_id: "role:filter-file",
        node_id: "filter-rows",
        state: "open",
        reason_id: "reason:missing-filter-file",
      },
      {
        obligation_id: "obligation:workspace",
        role_id: "role:workspace",
        node_id: null,
        state: "blocked",
        reason_id: "reason:workspace-blocked",
      },
    ];

    expect(decodeRuntimeManifest(candidate)).toMatchObject({
      previousWorkspaceRootDigest: `sha256:${"a".repeat(64)}`,
      openObligations: [
        {
          obligation_id: "obligation:filter-file",
          state: "open",
        },
        {
          node_id: null,
          state: "blocked",
        },
      ],
    });
  });

  it("accepts an explicit no-output node execution without inventing an artifact", () => {
    const candidate = cloneManifest();
    candidate.nodeExecutions[0].output = null;

    expect(
      decodeRuntimeManifest(candidate).nodeExecutions[0].output,
    ).toBeNull();
  });

  it("rejects an ineligible selected-timezone request before entering WASM", async () => {
    await expect(
      executeRustRuntime(
        new TextEncoder().encode("header\n"),
        "missing-timezone.csv",
        {
          ...DEFAULT_BROWSER_OPTIONS,
          timezoneHandling: "selected-filter",
          selectedTimezone: "",
        },
        undefined,
        {
          datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
          persistRustWorkspace: false,
        },
      ),
    ).rejects.toThrow(/Rust runtime is ineligible.*selectedTimezone/);
  });

  it("rejects durable mutation when Web Locks are unavailable", async () => {
    await expect(
      executeRustRuntime(
        new TextEncoder().encode("header\n"),
        "no-web-locks.csv",
        {
          ...DEFAULT_BROWSER_OPTIONS,
          timezoneHandling: "primary-convert",
        },
        undefined,
        {
          datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
          persistRustWorkspace: true,
        },
      ),
    ).rejects.toThrow(/Durable processing requires the browser Web Locks API/);
  });

  it("bounds the exact source-coordinate sidecar on a 600-event fixture", async () => {
    const raw = representativeSourceFixture();
    const execution = await executeRustRuntime(
      raw,
      "source-coordinate-budget.csv",
      {
        ...DEFAULT_BROWSER_OPTIONS,
        studyName: "Source Coordinate Budget",
        selectedTimezone: "America/Chicago",
        timezoneHandling: "selected-convert",
        useFilterFile: false,
        useAppsForcingScreenOpenFile: false,
        useBackgroundAppsFile: false,
        useAppCodebook: false,
        processScreenUsage: false,
        enablePlotting: false,
      },
      undefined,
      {
        datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
        persistRustWorkspace: false,
      },
    );
    const metadata = execution.manifest.artifacts.find(
      ({ kind }) => kind === "source-coordinate-index-arrow",
    );
    const bytes = execution.artifacts.get("source-coordinate-index-arrow");
    expect(metadata).toBeDefined();
    expect(bytes).toBeDefined();
    expect(metadata?.rowCount).toBeGreaterThanOrEqual(4_800);
    expect(metadata?.size).toBe(bytes?.byteLength);
    expect(metadata?.size).toBeLessThanOrEqual(raw.byteLength * 3 + 65_536);
  });

  it.each(INVALID_CASES)("rejects %s", (_name, mutate, expected) => {
    const candidate = cloneManifest() as unknown as Record<string, unknown>;
    mutate(candidate);
    expect(() => decodeRuntimeManifest(candidate)).toThrow(expected);
  });

  it("rejects disagreement between manifest metadata and exposed WASM bytes", () => {
    const exposed = structuredClone(manifest.artifacts);
    exposed[0].size += 1;
    expect(() => verifyRuntimeArtifactCatalog(manifest, exposed)).toThrow(
      /artifact catalog mismatch/,
    );

    expect(() =>
      verifyRuntimeArtifactCatalog(manifest, [
        ...structuredClone(manifest.artifacts),
        structuredClone(manifest.artifacts[0]),
      ]),
    ).toThrow(/artifact catalog length mismatch/);

    const missingEvidence = cloneManifest();
    missingEvidence.journalDigest = `sha256:${"f".repeat(64)}`;
    expect(() =>
      verifyRuntimeArtifactCatalog(missingEvidence, manifest.artifacts),
    ).toThrow(/omits evidence or dependency certificate/);
  });
});
