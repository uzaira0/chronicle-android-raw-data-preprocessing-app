import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/canonicalJson";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import { ALL_ON, GOLDEN_RUNTIME } from "@/testSupport/rustCampaignGraph";
import { runtimeScientificPreflightFixture } from "@/testSupport/runtimeScientificPreflightFixture";
import {
  completeLegacyScientificCampaignOptions,
  executeScientificCampaignWorkspace,
  putScientificCampaignSupportArtifact,
  requireExecutedScientificCampaign,
  ScientificCampaignRefusalError,
} from "@/testSupport/scientificCampaignExecution";

const activeOptions = {
  ...ALL_ON,
  processScreenUsage: true,
} as const;

const parryOptions = {
  ...activeOptions,
  screenSessionConstructionStrategy: "parry_toth_2025_session_glance_v1",
} as const;

const inactiveOptions = {
  ...ALL_ON,
  processAppUsage: false,
  processScreenUsage: false,
} as const;

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Mirrors `RUNTIME_ARTIFACT_REQUEST_FIELDS` in `workflow_contract.rs` for the
 * mocked runtime; the real campaigns read the list from the live
 * `workflow_contract_json` export. */
const MOCK_ARTIFACT_REQUEST_FIELDS = [
  "enable_parquet_export",
  "enable_spss_export",
  "enable_plotting",
  "enable_interactive_timeline",
  "enable_activity_heatmap",
  "export_plots_as_svg",
  "include_filtered_app_usage_in_plots",
] as const;

const mockContractRuntime = {
  workflow_contract_json: () =>
    JSON.stringify({
      runtimeArtifactRequestFields: MOCK_ARTIFACT_REQUEST_FIELDS,
    }),
};

function computationDigest(options: Record<string, unknown>): string {
  return sha256(
    canonicalJson(
      Object.fromEntries(
        Object.entries(options).filter(
          ([key]) =>
            !(MOCK_ARTIFACT_REQUEST_FIELDS as readonly string[]).includes(key),
        ),
      ),
    ),
  );
}

function scientificFixture(
  input: {
    options?: BrowserProcessingOptions;
    b05Disposition?: "executable" | "refused" | "not_applicable";
    screenExecutable?: boolean;
    schoedelExecutable?: boolean;
    eyesDisposition?: "executable" | "refused" | "not_applicable";
    supportArtifacts?: Map<string, Uint8Array>;
  } = {},
) {
  const optionsInput = input.options ?? activeOptions;
  const rawBytes = new Uint8Array([1, 2]);
  const options = buildRustV2Options(optionsInput, GOLDEN_RUNTIME);
  const screenStrategy =
    optionsInput.screenSessionConstructionStrategy ??
    "chronicle_screen_interactive_v1";
  const screenStrategyExplicit =
    optionsInput.screenSessionConstructionStrategy !== undefined;
  const supportArtifacts =
    input.supportArtifacts ?? new Map<string, Uint8Array>();
  const inputDigest = sha256(rawBytes);
  const optionsDigest = sha256(canonicalJson(options));
  const roleIdentity = (roleId: string, digest: string) => ({
    artifactDigest: digest,
    assignmentId: sha256(["assignment", roleId, digest].join("\u001f")),
  });
  const receipt = runtimeScientificPreflightFixture();
  const activeIngressRoles: Record<
    string,
    { artifactDigest: string; assignmentId: string }
  > = {
    processing_options: roleIdentity("processing_options", optionsDigest),
    raw_chronicle_csv: roleIdentity("raw_chronicle_csv", inputDigest),
    ...Object.fromEntries(
      [...supportArtifacts].map(([roleId, bytes]) => [
        roleId,
        roleIdentity(roleId, sha256(bytes)),
      ]),
    ),
  };
  receipt.key = {
    protocolVersion: "chronicle-runtime-scientific-preflight/v2",
    optionsDigest,
    inputDigest,
    inputSizeBytes: rawBytes.byteLength,
    activeIngressRoles,
    fragmentedParticipantCount: 0,
    fragmentedParticipantTokenScopeDigest: sha256(canonicalJson([])),
  };
  receipt.b05Schoedel.optionsDigest = computationDigest(options);
  receipt.b05Schoedel.componentOptionsDigest = sha256(
    JSON.stringify({
      protocolVersion: "chronicle-b05-schoedel-preflight/v1",
      usageSessionMode: options.usage_session_mode,
      screenSessionConstructionStrategy: screenStrategy,
      screenSessionConstructionStrategyExplicit: screenStrategyExplicit,
      episodeReconstructionStrategy: options.episode_reconstruction_strategy,
    }),
  );
  receipt.b05Schoedel.screenComponentOptionsDigest = sha256(
    JSON.stringify({
      protocolVersion: "chronicle-b05-screen-options/v1",
      screenSessionConstructionStrategy: screenStrategy,
    }),
  );
  receipt.b05Schoedel.schoedelComponentOptionsDigest = sha256(
    JSON.stringify({
      protocolVersion: "chronicle-schoedel-options/v1",
      screenSessionConstructionStrategy: screenStrategy,
      episodeReconstructionStrategy: options.episode_reconstruction_strategy,
      eventRetentionSet: options.event_retention_set,
      openerSet: options.opener_set,
    }),
  );
  receipt.b05Schoedel.optionsDigestOrigin = "verified_request_jcs";
  receipt.b05Schoedel.requestedScreenStrategyId = screenStrategy;
  receipt.b05Schoedel.effectiveScreenStrategyId = screenStrategy;
  receipt.b05Schoedel.requestedEpisodeStrategyId =
    options.episode_reconstruction_strategy as string;
  const schoedelActive =
    optionsInput.processAppUsage &&
    optionsInput.episodeReconstructionStrategy ===
      "schoedel_2026_app_within_screen_prose_v1";
  receipt.b05Schoedel.effectiveEpisodeStrategyId = schoedelActive
    ? (options.episode_reconstruction_strategy as string)
    : null;
  const b05Required = optionsInput.processScreenUsage || schoedelActive;
  const screenExecutable = input.screenExecutable ?? true;
  const schoedelExecutable = input.schoedelExecutable ?? true;
  receipt.b05Schoedel.disposition =
    input.b05Disposition ??
    (!b05Required
      ? "not_applicable"
      : screenExecutable && (!schoedelActive || schoedelExecutable)
        ? "executable"
        : "refused");
  receipt.b05Schoedel.screenConstructionPhase = !b05Required
    ? "not_applicable"
    : "finalized";
  receipt.b05Schoedel.schoedelReconstructionPhase = schoedelActive
    ? "finalized"
    : "not_applicable";
  receipt.b05Schoedel.screenApplicability = b05Required
    ? {
        protocolVersion: "chronicle-b05-foundational-semantics/v1",
        relation: screenExecutable
          ? screenStrategy === "chronicle_screen_interactive_v1"
            ? screenStrategyExplicit
              ? "baseline_equivalent"
              : "baseline_native"
            : "source_aligned_adapter"
          : "refused",
        executable: screenExecutable,
        refusalReason: screenExecutable
          ? null
          : "input_capability_evidence_absent",
        refusalDetail: screenExecutable ? null : "capability_evidence_absent",
      }
    : null;
  receipt.b05Schoedel.schoedelApplicability = schoedelActive
    ? {
        protocolVersion: "chronicle-b05-foundational-semantics/v1",
        relation: schoedelExecutable ? "controlled_derivative" : "refused",
        executable: schoedelExecutable,
        refusalReason: schoedelExecutable
          ? null
          : !screenExecutable
            ? "invalid_screen_interval_dependency"
            : "capability_evidence_not_bound_to_input",
        refusalDetail: schoedelExecutable
          ? null
          : !screenExecutable
            ? "invalid_screen_interval_dependency"
            : "capability_evidence_not_bound_to_input",
      }
    : null;
  receipt.eyesInputPartition.inputDigest = inputDigest;
  receipt.eyesInputPartition.optionsDigest = computationDigest(options);
  receipt.eyesInputPartition.optionsDigestOrigin = "verified_request_jcs";
  receipt.eyesInputPartition.fragmentedParticipantCount = 0;
  const eyesActive =
    optionsInput.processAppUsage &&
    optionsInput.episodeReconstructionStrategy === "eyes_complement";
  receipt.eyesInputPartition.disposition =
    input.eyesDisposition ?? (eyesActive ? "executable" : "not_applicable");
  receipt.eyesInputPartition.requestedEpisodeStrategyId =
    options.episode_reconstruction_strategy as string;
  receipt.eyesInputPartition.effectiveEpisodeStrategyId =
    receipt.eyesInputPartition.disposition === "executable"
      ? "eyes_complement"
      : null;
  receipt.eyesInputPartition.relation =
    receipt.eyesInputPartition.disposition === "executable"
      ? "partial_replay"
      : null;
  receipt.eyesInputPartition.refusalReason = null;
  receipt.eyesInputPartition.refusalDetail = null;
  const closeReceipt = () => {
    const eyesUnsigned = {
      ...receipt.eyesInputPartition,
      resolutionDigest: "",
    };
    receipt.eyesInputPartition.resolutionDigest = sha256(
      JSON.stringify(eyesUnsigned),
    );
    closeOuterReceipt();
  };
  const closeOuterReceipt = () => {
    receipt.keyDigest = sha256(canonicalJson(receipt.key));
    receipt.b05SchoedelDigest = sha256(canonicalJson(receipt.b05Schoedel));
    receipt.eyesInputPartitionDigest = sha256(
      canonicalJson(receipt.eyesInputPartition),
    );
    receipt.commitDigest = sha256(
      canonicalJson({
        protocolVersion: receipt.protocolVersion,
        keyDigest: receipt.keyDigest,
        b05SchoedelDigest: receipt.b05SchoedelDigest,
        eyesInputPartitionDigest: receipt.eyesInputPartitionDigest,
      }),
    );
  };
  closeReceipt();
  return {
    receipt,
    closeReceipt,
    closeOuterReceipt,
    requestJson: JSON.stringify({ inputSha256: inputDigest, options }),
    rawBytes,
    supportArtifacts,
  };
}

function inactiveFixture() {
  const rawBytes = new Uint8Array([1]);
  const options = buildRustV2Options(inactiveOptions, GOLDEN_RUNTIME);
  return {
    requestJson: JSON.stringify({ inputSha256: sha256(rawBytes), options }),
    rawBytes,
  };
}

describe("scientific campaign execution", () => {
  it("completes sparse legacy rows to the production request shape, including bound presence-tracked keys", () => {
    // All four presence-tracked options are exact bound request fields and
    // certified cache-relevant keys: the browser always sends them and the
    // runtime fails closed on their absence, so a sparse historical row must
    // complete them with the contract default like every other key.
    const sparse = {
      ...ALL_ON,
    } as Partial<BrowserProcessingOptions>;
    delete sparse.microUseClassificationPolicy;
    delete sparse.minimumDurationComparator;
    delete sparse.minimumDurationDisposition;
    delete sparse.screenSessionConstructionStrategy;
    const completed = completeLegacyScientificCampaignOptions(sparse);
    expect(completed).toMatchObject({
      processAppUsage: ALL_ON.processAppUsage,
      processScreenUsage: ALL_ON.processScreenUsage,
      episodeReconstructionStrategy: ALL_ON.episodeReconstructionStrategy,
      microUseClassificationPolicy:
        DEFAULT_BROWSER_OPTIONS.microUseClassificationPolicy,
      minimumDurationComparator:
        DEFAULT_BROWSER_OPTIONS.minimumDurationComparator,
      minimumDurationDisposition:
        DEFAULT_BROWSER_OPTIONS.minimumDurationDisposition,
      screenSessionConstructionStrategy:
        DEFAULT_BROWSER_OPTIONS.screenSessionConstructionStrategy,
    });
    const rustWire = JSON.parse(
      JSON.stringify(buildRustV2Options(completed, GOLDEN_RUNTIME)),
    ) as Record<string, unknown>;
    expect(rustWire).toHaveProperty(
      "micro_use_classification_policy",
      DEFAULT_BROWSER_OPTIONS.microUseClassificationPolicy,
    );
    expect(rustWire).toHaveProperty(
      "minimum_duration_comparator",
      DEFAULT_BROWSER_OPTIONS.minimumDurationComparator,
    );
    expect(rustWire).toHaveProperty(
      "minimum_duration_disposition",
      DEFAULT_BROWSER_OPTIONS.minimumDurationDisposition,
    );
    expect(rustWire).toHaveProperty(
      "screen_session_construction_strategy",
      DEFAULT_BROWSER_OPTIONS.screenSessionConstructionStrategy,
    );
  });

  it("transports capability evidence only for an active source-sensitive vector", () => {
    const calls: string[] = [];
    const supports = {
      put_with_name: (roleId: string) => calls.push(roleId),
    };
    const supportArtifacts = new Map<string, Uint8Array>();
    const bytes = new Uint8Array([1, 2, 3]);
    expect(
      putScientificCampaignSupportArtifact({
        roleId: "input_capability_evidence_file",
        fileName: "capability.csv",
        bytes,
        options: activeOptions,
        supports,
        supportArtifacts,
      }),
    ).toBe(false);
    expect(calls).toEqual([]);
    expect(supportArtifacts.size).toBe(0);
    expect(
      putScientificCampaignSupportArtifact({
        roleId: "input_capability_evidence_file",
        fileName: "capability.csv",
        bytes,
        options: parryOptions,
        supports,
        supportArtifacts,
      }),
    ).toBe(true);
    expect(calls).toEqual(["input_capability_evidence_file"]);
    expect(supportArtifacts.get("input_capability_evidence_file")).toBe(bytes);
  });

  it("rejects an injected inactive capability map before preflight or execute", () => {
    const fixture = scientificFixture();
    let preflightCalls = 0;
    let executeCalls = 0;
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime: {
          ...mockContractRuntime,
          scientific_preflight_json: () => {
            preflightCalls += 1;
            return JSON.stringify(fixture.receipt);
          },
          execute_workspace: () => {
            executeCalls += 1;
            return {};
          },
        },
        options: activeOptions,
        requestJson: fixture.requestJson,
        rawBytes: fixture.rawBytes,
        supports: {},
        supportArtifacts: new Map([
          ["input_capability_evidence_file", new Uint8Array([1])],
        ]),
      }),
    ).toThrow(/inactive scientific campaign capability evidence/);
    expect({ preflightCalls, executeCalls }).toEqual({
      preflightCalls: 0,
      executeCalls: 0,
    });
  });

  it("executes inactive cells without creating a scientific preflight", () => {
    const fixture = inactiveFixture();
    const calls: string[] = [];
    const runtime = {
      ...mockContractRuntime,
      scientific_preflight_json: () => {
        calls.push("preflight");
        throw new Error("inactive preflight must not run");
      },
      execute_workspace: () => {
        calls.push("execute");
        return { id: "handle" };
      },
    };
    const result = executeScientificCampaignWorkspace({
      runtime,
      options: inactiveOptions,
      requestJson: fixture.requestJson,
      rawBytes: fixture.rawBytes,
      supports: {},
      supportArtifacts: new Map(),
    });
    expect(result).toMatchObject({ status: "executed", executeCalls: 1 });
    expect(calls).toEqual(["execute"]);
  });

  it("preflights and executes active cells on the exact same inputs", () => {
    const { receipt, requestJson, rawBytes, supportArtifacts } =
      scientificFixture();
    const supports = {};
    const observed: unknown[][] = [];
    const runtime = {
      ...mockContractRuntime,
      scientific_preflight_json: (...args: unknown[]) => {
        observed.push(args);
        return JSON.stringify(receipt);
      },
      execute_workspace: (...args: unknown[]) => {
        observed.push(args);
        return { id: "handle" };
      },
    };
    const result = executeScientificCampaignWorkspace({
      runtime,
      options: activeOptions,
      requestJson,
      rawBytes,
      supports,
      supportArtifacts,
    });
    expect(result).toMatchObject({ status: "executed", executeCalls: 1 });
    expect(observed).toEqual([
      [requestJson, rawBytes, supports],
      [requestJson, rawBytes, supports],
    ]);
  });

  it("preserves omitted versus explicit Chronicle screen-strategy identity", () => {
    const omittedOptions = {
      ...activeOptions,
      screenSessionConstructionStrategy: undefined,
    } as unknown as BrowserProcessingOptions;
    const omitted = scientificFixture({ options: omittedOptions });
    const explicit = scientificFixture({ options: activeOptions });
    const omittedRequest = JSON.parse(omitted.requestJson) as {
      options: Record<string, unknown>;
    };
    expect(omittedRequest.options).not.toHaveProperty(
      "screen_session_construction_strategy",
    );
    expect(omitted.receipt.b05Schoedel).toMatchObject({
      requestedScreenStrategyId: "chronicle_screen_interactive_v1",
      effectiveScreenStrategyId: "chronicle_screen_interactive_v1",
      screenApplicability: {
        relation: "baseline_native",
        executable: true,
      },
    });
    expect(explicit.receipt.b05Schoedel.screenApplicability).toMatchObject({
      relation: "baseline_equivalent",
      executable: true,
    });
    expect(omitted.receipt.b05Schoedel.componentOptionsDigest).not.toBe(
      explicit.receipt.b05Schoedel.componentOptionsDigest,
    );
    for (const [options, fixture] of [
      [omittedOptions, omitted],
      [activeOptions, explicit],
    ] as const) {
      expect(
        executeScientificCampaignWorkspace({
          runtime: {
            ...mockContractRuntime,
            scientific_preflight_json: () => JSON.stringify(fixture.receipt),
            execute_workspace: () => ({ id: "handle" }),
          },
          options,
          requestJson: fixture.requestJson,
          rawBytes: fixture.rawBytes,
          supports: {},
          supportArtifacts: fixture.supportArtifacts,
        }),
      ).toMatchObject({ status: "executed", executeCalls: 1 });
    }
  });

  it("binds a source-sensitive request to the exact capability artifact", () => {
    const capabilityBytes = new TextEncoder().encode(
      "schema_version,raw_input_sha256,participant_id,capability_id,state,evidence_basis,evidence_reference,evidence_sha256\n",
    );
    const supportArtifacts = new Map([
      ["input_capability_evidence_file", capabilityBytes],
    ]);
    const fixture = scientificFixture({
      options: parryOptions,
      supportArtifacts,
    });
    const result = executeScientificCampaignWorkspace({
      runtime: {
        ...mockContractRuntime,
        scientific_preflight_json: () => JSON.stringify(fixture.receipt),
        execute_workspace: () => ({ id: "handle" }),
      },
      options: parryOptions,
      requestJson: fixture.requestJson,
      rawBytes: fixture.rawBytes,
      supports: {},
      supportArtifacts,
    });
    expect(result).toMatchObject({ status: "executed", executeCalls: 1 });
    expect(
      fixture.receipt.key.activeIngressRoles.input_capability_evidence_file
        ?.artifactDigest,
    ).toBe(sha256(capabilityBytes));
  });

  it("fails closed when caller and serialized request disagree on activation", () => {
    const active = scientificFixture();
    const inactive = inactiveFixture();
    let preflightCalls = 0;
    let executeCalls = 0;
    const runtime = {
      ...mockContractRuntime,
      scientific_preflight_json: () => {
        preflightCalls += 1;
        return JSON.stringify(active.receipt);
      },
      execute_workspace: () => {
        executeCalls += 1;
        return {};
      },
    };
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime,
        options: inactiveOptions,
        requestJson: active.requestJson,
        rawBytes: active.rawBytes,
        supports: {},
        supportArtifacts: active.supportArtifacts,
      }),
    ).toThrow(/browser\/request activation identity drifted/);
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime,
        options: activeOptions,
        requestJson: inactive.requestJson,
        rawBytes: inactive.rawBytes,
        supports: {},
        supportArtifacts: new Map(),
      }),
    ).toThrow(/browser\/request activation identity drifted/);
    expect({ preflightCalls, executeCalls }).toEqual({
      preflightCalls: 0,
      executeCalls: 0,
    });
  });

  it("fails closed when any non-activation request option differs", () => {
    const fixture = scientificFixture();
    const request = JSON.parse(fixture.requestJson) as {
      inputSha256: string;
      options: Record<string, unknown>;
    };
    request.options.minimum_usage_duration = "PT17S";
    let preflightCalls = 0;
    let executeCalls = 0;
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime: {
          ...mockContractRuntime,
          scientific_preflight_json: () => {
            preflightCalls += 1;
            return JSON.stringify(fixture.receipt);
          },
          execute_workspace: () => {
            executeCalls += 1;
            return {};
          },
        },
        options: activeOptions,
        requestJson: JSON.stringify(request),
        rawBytes: fixture.rawBytes,
        supports: {},
        supportArtifacts: fixture.supportArtifacts,
      }),
    ).toThrow(/browser\/request activation identity drifted/);
    expect({ preflightCalls, executeCalls }).toEqual({
      preflightCalls: 0,
      executeCalls: 0,
    });
  });

  it("preserves a typed refusal and never executes", () => {
    const { receipt, requestJson, rawBytes, supportArtifacts } =
      scientificFixture({ screenExecutable: false });
    let executeCalls = 0;
    const result = executeScientificCampaignWorkspace({
      runtime: {
        ...mockContractRuntime,
        scientific_preflight_json: () => JSON.stringify(receipt),
        execute_workspace: () => {
          executeCalls += 1;
          return {};
        },
      },
      options: activeOptions,
      requestJson,
      rawBytes,
      supports: {},
      supportArtifacts,
    });
    expect(result).toEqual({ status: "refused", receipt, executeCalls: 0 });
    expect(executeCalls).toBe(0);
    expect(() => requireExecutedScientificCampaign(result)).toThrow(
      ScientificCampaignRefusalError,
    );
    try {
      requireExecutedScientificCampaign(result);
    } catch (error) {
      expect(error).toBeInstanceOf(ScientificCampaignRefusalError);
      expect((error as ScientificCampaignRefusalError).receipt).toEqual(
        receipt,
      );
    }
  });

  it("fails malformed or inapplicable active preflight before execute", () => {
    const invalid = scientificFixture({ b05Disposition: "not_applicable" });
    let executeCalls = 0;
    const execute_workspace = () => {
      executeCalls += 1;
      return {};
    };
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime: {
          ...mockContractRuntime,
          scientific_preflight_json: () => JSON.stringify({}),
          execute_workspace,
        },
        options: activeOptions,
        requestJson: invalid.requestJson,
        rawBytes: invalid.rawBytes,
        supports: {},
        supportArtifacts: invalid.supportArtifacts,
      }),
    ).toThrow(/contract violation/i);
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime: {
          ...mockContractRuntime,
          scientific_preflight_json: () => JSON.stringify(invalid.receipt),
          execute_workspace,
        },
        options: activeOptions,
        requestJson: invalid.requestJson,
        rawBytes: invalid.rawBytes,
        supports: {},
        supportArtifacts: invalid.supportArtifacts,
      }),
    ).toThrow(/preflight identity drifted/);
    expect(executeCalls).toBe(0);
  });

  it("rejects a coherently closed stale receipt before execute", () => {
    const fixture = scientificFixture({ screenExecutable: false });
    fixture.receipt.key.inputDigest = `sha256:${"0".repeat(64)}`;
    fixture.receipt.eyesInputPartition.inputDigest =
      fixture.receipt.key.inputDigest;
    fixture.closeReceipt();
    let executeCalls = 0;
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime: {
          ...mockContractRuntime,
          scientific_preflight_json: () => JSON.stringify(fixture.receipt),
          execute_workspace: () => {
            executeCalls += 1;
            return {};
          },
        },
        options: activeOptions,
        requestJson: fixture.requestJson,
        rawBytes: fixture.rawBytes,
        supports: {},
        supportArtifacts: fixture.supportArtifacts,
      }),
    ).toThrow(/preflight identity drifted/);
    expect(executeCalls).toBe(0);
  });

  it("rejects every independent preflight identity and digest-closure drift", () => {
    const digest = `sha256:${"0".repeat(64)}`;
    const cases: Array<{
      id: string;
      mutate: (fixture: ReturnType<typeof scientificFixture>) => void;
    }> = [
      {
        id: "options identity",
        mutate: (fixture) => {
          fixture.receipt.key.optionsDigest = digest;
          fixture.receipt.b05Schoedel.optionsDigest = digest;
          fixture.receipt.eyesInputPartition.optionsDigest = digest;
          fixture.closeReceipt();
        },
      },
      {
        id: "missing ingress role",
        mutate: (fixture) => {
          delete fixture.receipt.key.activeIngressRoles.raw_chronicle_csv;
          fixture.closeReceipt();
        },
      },
      {
        id: "extra ingress role",
        mutate: (fixture) => {
          fixture.receipt.key.activeIngressRoles.unexpected = {
            artifactDigest: digest,
            assignmentId: digest,
          };
          fixture.closeReceipt();
        },
      },
      {
        id: "wrong ingress assignment",
        mutate: (fixture) => {
          const raw = fixture.receipt.key.activeIngressRoles.raw_chronicle_csv;
          if (!raw) throw new Error("raw role fixture is absent");
          raw.assignmentId = digest;
          fixture.closeReceipt();
        },
      },
      {
        id: "B05 component digest",
        mutate: (fixture) => {
          fixture.receipt.b05SchoedelDigest = digest;
          fixture.receipt.commitDigest = sha256(
            canonicalJson({
              protocolVersion: fixture.receipt.protocolVersion,
              keyDigest: fixture.receipt.keyDigest,
              b05SchoedelDigest: fixture.receipt.b05SchoedelDigest,
              eyesInputPartitionDigest:
                fixture.receipt.eyesInputPartitionDigest,
            }),
          );
        },
      },
      {
        id: "EYES component digest",
        mutate: (fixture) => {
          fixture.receipt.eyesInputPartitionDigest = digest;
          fixture.receipt.commitDigest = sha256(
            canonicalJson({
              protocolVersion: fixture.receipt.protocolVersion,
              keyDigest: fixture.receipt.keyDigest,
              b05SchoedelDigest: fixture.receipt.b05SchoedelDigest,
              eyesInputPartitionDigest:
                fixture.receipt.eyesInputPartitionDigest,
            }),
          );
        },
      },
      {
        id: "commit digest",
        mutate: (fixture) => {
          fixture.receipt.commitDigest = digest;
        },
      },
      {
        id: "B05 nested protocol with closed outer envelope",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.protocolVersion =
            "chronicle-b05-schoedel-preflight/v0";
          fixture.closeReceipt();
        },
      },
      {
        id: "EYES nested protocol with closed resolution and outer envelope",
        mutate: (fixture) => {
          fixture.receipt.eyesInputPartition.protocolVersion =
            "chronicle-eyes-input-partition-preflight/v1";
          fixture.closeReceipt();
        },
      },
      {
        id: "router component options digest with closed outer envelope",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.componentOptionsDigest = digest;
          fixture.closeReceipt();
        },
      },
      {
        id: "screen component options digest with closed outer envelope",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.screenComponentOptionsDigest = digest;
          fixture.closeReceipt();
        },
      },
      {
        id: "Schoedel component options digest with closed outer envelope",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.schoedelComponentOptionsDigest = digest;
          fixture.closeReceipt();
        },
      },
      {
        id: "requested screen strategy with closed outer envelope",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.requestedScreenStrategyId =
            "parry_toth_2025_session_glance_v1";
          fixture.closeReceipt();
        },
      },
      {
        id: "effective screen strategy with closed outer envelope",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.effectiveScreenStrategyId =
            "zhu_2018_unlock_lock_v1";
          fixture.closeReceipt();
        },
      },
      {
        id: "screen phase with closed outer envelope",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.screenConstructionPhase =
            "prepared_raw_source_arm";
          fixture.closeReceipt();
        },
      },
      {
        id: "screen applicability relation with closed outer envelope",
        mutate: (fixture) => {
          const screen = fixture.receipt.b05Schoedel.screenApplicability;
          if (!screen) throw new Error("screen applicability is absent");
          screen.relation = "controlled_derivative";
          fixture.closeReceipt();
        },
      },
      {
        id: "screen applicability protocol with closed outer envelope",
        mutate: (fixture) => {
          const screen = fixture.receipt.b05Schoedel.screenApplicability;
          if (!screen) throw new Error("screen applicability is absent");
          screen.protocolVersion = "chronicle-b05-foundational-semantics/v0";
          fixture.closeReceipt();
        },
      },
      {
        id: "screen refusal reason-detail pair with closed outer envelope",
        mutate: (fixture) => {
          const screen = fixture.receipt.b05Schoedel.screenApplicability;
          if (!screen) throw new Error("screen applicability is absent");
          screen.executable = false;
          screen.relation = "refused";
          screen.refusalReason = "unsupported_input_chunk";
          screen.refusalDetail = "capability_evidence_absent";
          fixture.receipt.b05Schoedel.disposition = "refused";
          fixture.closeReceipt();
        },
      },
      {
        id: "EYES requested strategy with closed resolution and outer envelope",
        mutate: (fixture) => {
          fixture.receipt.eyesInputPartition.requestedEpisodeStrategyId =
            "eyes_complement";
          fixture.closeReceipt();
        },
      },
      {
        id: "EYES resolution with closed outer envelope",
        mutate: (fixture) => {
          fixture.receipt.eyesInputPartition.resolutionDigest = digest;
          fixture.closeOuterReceipt();
        },
      },
    ];
    for (const testCase of cases) {
      const fixture = scientificFixture();
      testCase.mutate(fixture);
      let executeCalls = 0;
      expect(
        () =>
          executeScientificCampaignWorkspace({
            runtime: {
              ...mockContractRuntime,
              scientific_preflight_json: () => JSON.stringify(fixture.receipt),
              execute_workspace: () => {
                executeCalls += 1;
                return {};
              },
            },
            options: activeOptions,
            requestJson: fixture.requestJson,
            rawBytes: fixture.rawBytes,
            supports: {},
            supportArtifacts: fixture.supportArtifacts,
          }),
        testCase.id,
      ).toThrow(/preflight identity drifted|contract violation/);
      expect(executeCalls, testCase.id).toBe(0);
    }
  });

  it("requires exact disposition agreement for each active component", () => {
    const eyesOptions: BrowserProcessingOptions = {
      ...ALL_ON,
      processAppUsage: true,
      processScreenUsage: false,
      episodeReconstructionStrategy: "eyes_complement",
    };
    const dualOptions: BrowserProcessingOptions = {
      ...eyesOptions,
      processScreenUsage: true,
    };
    const invalidCases = [
      {
        id: "B05 required but EYES substituted",
        options: activeOptions,
        fixture: scientificFixture({
          b05Disposition: "not_applicable",
          eyesDisposition: "executable",
        }),
      },
      {
        id: "inactive EYES forged refusal",
        options: activeOptions,
        fixture: scientificFixture({
          b05Disposition: "executable",
          eyesDisposition: "refused",
        }),
      },
      {
        id: "dual-active EYES not applicable",
        options: dualOptions,
        fixture: scientificFixture({
          options: dualOptions,
          b05Disposition: "executable",
          eyesDisposition: "not_applicable",
        }),
      },
    ];
    for (const testCase of invalidCases) {
      let executeCalls = 0;
      expect(
        () =>
          executeScientificCampaignWorkspace({
            runtime: {
              ...mockContractRuntime,
              scientific_preflight_json: () =>
                JSON.stringify(testCase.fixture.receipt),
              execute_workspace: () => {
                executeCalls += 1;
                return {};
              },
            },
            options: testCase.options,
            requestJson: testCase.fixture.requestJson,
            rawBytes: testCase.fixture.rawBytes,
            supports: {},
            supportArtifacts: testCase.fixture.supportArtifacts,
          }),
        testCase.id,
      ).toThrow(/component|not_applicable|identity drifted/);
      expect(executeCalls, testCase.id).toBe(0);
    }

    const validEyes = scientificFixture({
      options: eyesOptions,
      b05Disposition: "not_applicable",
      eyesDisposition: "executable",
    });
    expect(
      executeScientificCampaignWorkspace({
        runtime: {
          ...mockContractRuntime,
          scientific_preflight_json: () => JSON.stringify(validEyes.receipt),
          execute_workspace: () => ({ id: "eyes" }),
        },
        options: eyesOptions,
        requestJson: validEyes.requestJson,
        rawBytes: validEyes.rawBytes,
        supports: {},
        supportArtifacts: validEyes.supportArtifacts,
      }),
    ).toMatchObject({ status: "executed", executeCalls: 1 });

    const coherentFragmentedEyes = scientificFixture({
      options: eyesOptions,
      b05Disposition: "not_applicable",
      eyesDisposition: "refused",
    });
    coherentFragmentedEyes.receipt.key.fragmentedParticipantCount = 1;
    coherentFragmentedEyes.receipt.key.fragmentedParticipantTokenScopeDigest =
      sha256(canonicalJson([`sha256:${"1".repeat(64)}`]));
    coherentFragmentedEyes.receipt.eyesInputPartition.fragmentedParticipantCount = 1;
    coherentFragmentedEyes.receipt.eyesInputPartition.effectiveEpisodeStrategyId =
      null;
    coherentFragmentedEyes.receipt.eyesInputPartition.relation = "refused";
    coherentFragmentedEyes.receipt.eyesInputPartition.refusalReason =
      "unsupported_input_chunk";
    coherentFragmentedEyes.receipt.eyesInputPartition.refusalDetail =
      "participant_stream_fragmented";
    coherentFragmentedEyes.closeReceipt();
    let fragmentedExecuteCalls = 0;
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime: {
          ...mockContractRuntime,
          scientific_preflight_json: () =>
            JSON.stringify(coherentFragmentedEyes.receipt),
          execute_workspace: () => {
            fragmentedExecuteCalls += 1;
            return {};
          },
        },
        options: eyesOptions,
        requestJson: coherentFragmentedEyes.requestJson,
        rawBytes: coherentFragmentedEyes.rawBytes,
        supports: {},
        supportArtifacts: coherentFragmentedEyes.supportArtifacts,
      }),
    ).toThrow(/preflight identity drifted/);
    expect(fragmentedExecuteCalls).toBe(0);

    const eyesTamperCases: Array<{
      id: string;
      mutate: (fixture: ReturnType<typeof scientificFixture>) => void;
    }> = [
      {
        id: "active EYES effective strategy",
        mutate: (fixture) => {
          fixture.receipt.eyesInputPartition.effectiveEpisodeStrategyId = null;
        },
      },
      {
        id: "active EYES relation",
        mutate: (fixture) => {
          fixture.receipt.eyesInputPartition.relation = "controlled_derivative";
        },
      },
      {
        id: "active EYES disposition",
        mutate: (fixture) => {
          fixture.receipt.eyesInputPartition.disposition = "not_applicable";
          fixture.receipt.eyesInputPartition.effectiveEpisodeStrategyId = null;
          fixture.receipt.eyesInputPartition.relation = null;
        },
      },
    ];
    for (const testCase of eyesTamperCases) {
      const fixture = scientificFixture({
        options: eyesOptions,
        b05Disposition: "not_applicable",
        eyesDisposition: "executable",
      });
      testCase.mutate(fixture);
      fixture.closeReceipt();
      let executeCalls = 0;
      expect(
        () =>
          executeScientificCampaignWorkspace({
            runtime: {
              ...mockContractRuntime,
              scientific_preflight_json: () => JSON.stringify(fixture.receipt),
              execute_workspace: () => {
                executeCalls += 1;
                return {};
              },
            },
            options: eyesOptions,
            requestJson: fixture.requestJson,
            rawBytes: fixture.rawBytes,
            supports: {},
            supportArtifacts: fixture.supportArtifacts,
          }),
        testCase.id,
      ).toThrow(/preflight identity drifted/);
      expect(executeCalls, testCase.id).toBe(0);
    }

    const schoedelOptions: BrowserProcessingOptions = {
      ...ALL_ON,
      processAppUsage: true,
      processScreenUsage: true,
      screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
      episodeReconstructionStrategy: "schoedel_2026_app_within_screen_prose_v1",
    };
    const schoedelRefusal = scientificFixture({
      options: schoedelOptions,
      screenExecutable: true,
      schoedelExecutable: false,
    });
    let schoedelExecuteCalls = 0;
    const refused = executeScientificCampaignWorkspace({
      runtime: {
        ...mockContractRuntime,
        scientific_preflight_json: () =>
          JSON.stringify(schoedelRefusal.receipt),
        execute_workspace: () => {
          schoedelExecuteCalls += 1;
          return {};
        },
      },
      options: schoedelOptions,
      requestJson: schoedelRefusal.requestJson,
      rawBytes: schoedelRefusal.rawBytes,
      supports: {},
      supportArtifacts: schoedelRefusal.supportArtifacts,
    });
    expect(refused).toMatchObject({ status: "refused", executeCalls: 0 });
    expect(
      schoedelRefusal.receipt.b05Schoedel.screenApplicability,
    ).toMatchObject({ executable: true, relation: "baseline_equivalent" });
    expect(
      schoedelRefusal.receipt.b05Schoedel.schoedelApplicability,
    ).toMatchObject({
      executable: false,
      relation: "refused",
      refusalReason: "capability_evidence_not_bound_to_input",
    });
    expect(schoedelExecuteCalls).toBe(0);

    const schoedelTamperCases: Array<{
      id: string;
      mutate: (fixture: ReturnType<typeof scientificFixture>) => void;
    }> = [
      {
        id: "requested episode strategy",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.requestedEpisodeStrategyId =
            "fused_state_machine_v1";
        },
      },
      {
        id: "effective episode strategy",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.effectiveEpisodeStrategyId =
            "fused_state_machine_v1";
        },
      },
      {
        id: "Schoedel phase",
        mutate: (fixture) => {
          fixture.receipt.b05Schoedel.schoedelReconstructionPhase =
            "deferred_retained_app_stream";
        },
      },
      {
        id: "Schoedel applicability relation",
        mutate: (fixture) => {
          const applicability =
            fixture.receipt.b05Schoedel.schoedelApplicability;
          if (!applicability)
            throw new Error("Schoedel applicability is absent");
          applicability.relation = "source_aligned_adapter";
        },
      },
    ];
    for (const testCase of schoedelTamperCases) {
      const fixture = scientificFixture({ options: schoedelOptions });
      testCase.mutate(fixture);
      fixture.closeReceipt();
      let executeCalls = 0;
      expect(
        () =>
          executeScientificCampaignWorkspace({
            runtime: {
              ...mockContractRuntime,
              scientific_preflight_json: () => JSON.stringify(fixture.receipt),
              execute_workspace: () => {
                executeCalls += 1;
                return {};
              },
            },
            options: schoedelOptions,
            requestJson: fixture.requestJson,
            rawBytes: fixture.rawBytes,
            supports: {},
            supportArtifacts: fixture.supportArtifacts,
          }),
        testCase.id,
      ).toThrow(/preflight identity drifted/);
      expect(executeCalls, testCase.id).toBe(0);
    }

    const impossibleSchoedel = scientificFixture({
      options: schoedelOptions,
      screenExecutable: false,
      schoedelExecutable: true,
    });
    let impossibleExecuteCalls = 0;
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime: {
          ...mockContractRuntime,
          scientific_preflight_json: () =>
            JSON.stringify(impossibleSchoedel.receipt),
          execute_workspace: () => {
            impossibleExecuteCalls += 1;
            return {};
          },
        },
        options: schoedelOptions,
        requestJson: impossibleSchoedel.requestJson,
        rawBytes: impossibleSchoedel.rawBytes,
        supports: {},
        supportArtifacts: impossibleSchoedel.supportArtifacts,
      }),
    ).toThrow(/preflight identity drifted/);
    expect(impossibleExecuteCalls).toBe(0);

    const wrongDependencyRefusal = scientificFixture({
      options: schoedelOptions,
      screenExecutable: false,
      schoedelExecutable: false,
    });
    const dependency =
      wrongDependencyRefusal.receipt.b05Schoedel.schoedelApplicability;
    if (!dependency) throw new Error("Schoedel applicability is absent");
    dependency.refusalReason = "capability_evidence_not_bound_to_input";
    dependency.refusalDetail = "capability_evidence_not_bound_to_input";
    wrongDependencyRefusal.closeReceipt();
    let wrongDependencyExecuteCalls = 0;
    expect(() =>
      executeScientificCampaignWorkspace({
        runtime: {
          ...mockContractRuntime,
          scientific_preflight_json: () =>
            JSON.stringify(wrongDependencyRefusal.receipt),
          execute_workspace: () => {
            wrongDependencyExecuteCalls += 1;
            return {};
          },
        },
        options: schoedelOptions,
        requestJson: wrongDependencyRefusal.requestJson,
        rawBytes: wrongDependencyRefusal.rawBytes,
        supports: {},
        supportArtifacts: wrongDependencyRefusal.supportArtifacts,
      }),
    ).toThrow(/preflight identity drifted/);
    expect(wrongDependencyExecuteCalls).toBe(0);
  });
});
