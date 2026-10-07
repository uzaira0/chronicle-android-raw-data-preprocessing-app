import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalJson } from "@/lib/canonicalJson";
import {
  LITERATURE_INPUT_ADAPTER_CONTRACTS,
  literatureComponentExecutionForSettings,
} from "@/lib/literatureInputAdapters";
import {
  executeLiteratureComponentRuntime,
  exportPersistedRustWorkspace,
  literatureComponentWorkspaceId,
  reopenImportedLiteratureComponent,
  reopenLiteratureComponentResult,
  setRustPersistenceForTesting,
  setRustRuntimeForTesting,
  verifyPersistedRustWorkspace,
} from "@/lib/rustPipelineRuntime";
import {
  openOpfsWorkspace,
  persistRuntimeObject,
  persistRuntimeWorkspace,
  readRuntimeObject,
  recoverRuntimeWorkspace,
} from "@/lib/opfsArtifactStore";
import {
  MemoryDirectoryHandle,
  memoryDirectoryHandle,
} from "@/testSupport/memoryFileSystem";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

const encoder = new TextEncoder();
const IMPLEMENTATION_DIGEST = `sha256:${"1".repeat(64)}`;
const BUILD_DIGEST = `sha256:${"2".repeat(64)}`;
const CONTRACT_DIGEST = `sha256:${"3".repeat(64)}`;
const CONFORMANCE_DIGEST = `sha256:${"4".repeat(64)}`;
const REGISTRY_DIGEST = `sha256:${"5".repeat(64)}`;
const ORACLE_ID = registration().sourceOracleId;
/** Identity the mocked runtime reports when a persisted head is verified. */
const loadedRuntimeIdentity = {
  implementationDigest: IMPLEMENTATION_DIGEST,
  buildEnvironmentDigest: BUILD_DIGEST,
};

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalJson(value));
}

async function metadata(
  kind: string,
  mediaType: string,
  bytes: Uint8Array,
  derivedFrom: string[] = [],
  rowCount?: number,
) {
  const contentDigest = await digest(bytes);
  return {
    artifactId: `urn:chronicle:artifact:${kind}:${contentDigest.slice(7)}`,
    kind,
    mediaType,
    digest: contentDigest,
    size: bytes.byteLength,
    derivedFrom,
    ...(rowCount === undefined ? {} : { rowCount }),
  };
}

function registration() {
  const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(
    ({ semanticType }) => semanticType === "schoedel_screen_preprocessing",
  )!;
  return literatureComponentExecutionForSettings(group.methodSettingIds)!;
}

async function componentFixture(
  raw: Uint8Array,
  support: Uint8Array,
  inputFileName = "ps_activity.csv",
  limitations: string[] = [],
  oracleId = ORACLE_ID,
  /**
   * Fields merged into one receipt body before it is hashed, so the emitted
   * artifact stays internally addressed while its claim disagrees with the
   * registration the runtime verifies it against.
   */
  receiptOverrides: {
    method?: Record<string, unknown>;
    adaptation?: Record<string, unknown>;
    execution?: Record<string, unknown>;
  } = {},
) {
  const component = { ...registration(), limitations };
  const inputDigest = await digest(raw);
  const supportDigest = await digest(support);
  const workspaceId = await literatureComponentWorkspaceId(
    component.componentId,
    inputDigest.slice(7),
  );
  const derivedBytes = encoder.encode("user_id,usage\n1,1\n");
  const derivedMetadata = await metadata(
    component.derivedResultKind,
    "text/csv",
    derivedBytes,
    [],
    1,
  );
  const methodReceiptBytes = jsonBytes({
    protocolVersion: "chronicle-literature-component-method-receipt/v1",
    componentId: component.componentId,
    parentMethodProfileId: component.parentMethodProfileId,
    parentProfileExecutionStatus: "blocked",
    sourceWorkId: component.sourceWorkId,
    sourceMethodVariantId: component.sourceMethodVariantId,
    methodProfileVersion: component.methodProfileVersion,
    settingIds: component.methodSettingIds,
    ...(limitations.length ? { limitations } : {}),
    inputBindings: component.methodSettingIds.map((settingId) => ({
      settingId,
    })),
    implementationDigest: IMPLEMENTATION_DIGEST,
    buildEnvironmentDigest: BUILD_DIGEST,
    inputAdapterContractDigest: CONTRACT_DIGEST,
    inputAdapterConformanceDigest: CONFORMANCE_DIGEST,
    androidMethodProfileRegistryContentDigest: REGISTRY_DIGEST,
    ...receiptOverrides.method,
  });
  const methodMetadata = await metadata(
    "literature-component-method-receipt-json",
    "application/json",
    methodReceiptBytes,
  );
  const adaptationReceiptBytes = jsonBytes({
    protocolVersion: "chronicle-literature-input-adaptation-receipt/v1",
    settingIds: component.methodSettingIds,
    adapterIds: [component.componentId],
    originalInputDigest: inputDigest,
    adaptedInputDigest: inputDigest,
    sourceRowCount: 1,
    emittedRowCount: 0,
    mappedEventRowCount: 0,
    materializedIntervalCount: 0,
    duplicateSourceIdsRemoved: 0,
    correctedTimestampProvenanceRows: 0,
    participantsRemoved: 0,
    derivedResult: {
      kind: component.derivedResultKind,
      digest: derivedMetadata.digest,
      rowCount: 1,
    },
    schoedelScreenPreprocessing: { oracleId },
    ...receiptOverrides.adaptation,
  });
  const adaptationMetadata = await metadata(
    "literature-input-adaptation-receipt-json",
    "application/json",
    adaptationReceiptBytes,
  );
  const executionReceiptBytes = jsonBytes({
    protocolVersion: "chronicle-literature-component-execution-receipt/v1",
    componentId: component.componentId,
    componentExecutionStatus: "executed",
    fullProfileExecutionStatus: "blocked",
    parentMethodProfileId: component.parentMethodProfileId,
    sourceWorkId: component.sourceWorkId,
    sourceMethodVariantId: component.sourceMethodVariantId,
    methodProfileVersion: component.methodProfileVersion,
    settingIds: component.methodSettingIds,
    ...(limitations.length ? { limitations } : {}),
    originalInputDigest: inputDigest,
    supportArtifactDigests: {
      phonestudy_ps_communication_file: supportDigest,
    },
    supportAdapterInputDigests: {
      phonestudy_ps_communication_file: supportDigest,
    },
    supportFormats: {
      phonestudy_ps_communication_file: "text/csv; normalizedFromXlsx=false",
    },
    componentMethodReceiptDigest: methodMetadata.digest,
    adaptationReceiptDigest: adaptationMetadata.digest,
    derivedResultKind: component.derivedResultKind,
    derivedResultDigest: derivedMetadata.digest,
    derivedResultRowCount: 1,
    oracleId,
    kernelInputEligible: false,
    canonicalKernelInputDigest: null,
    implementationDigest: IMPLEMENTATION_DIGEST,
    buildEnvironmentDigest: BUILD_DIGEST,
    inputAdapterContractDigest: CONTRACT_DIGEST,
    inputAdapterConformanceDigest: CONFORMANCE_DIGEST,
    androidMethodProfileRegistryContentDigest: REGISTRY_DIGEST,
    ...receiptOverrides.execution,
  });
  const executionMetadata = await metadata(
    "literature-component-execution-receipt-json",
    "application/json",
    executionReceiptBytes,
    [methodMetadata.digest, adaptationMetadata.digest, derivedMetadata.digest],
  );
  const content = [
    { metadata: methodMetadata, bytes: methodReceiptBytes },
    { metadata: adaptationMetadata, bytes: adaptationReceiptBytes },
    { metadata: derivedMetadata, bytes: derivedBytes },
    { metadata: executionMetadata, bytes: executionReceiptBytes },
  ];
  const identity = {
    workspaceId,
    previousWorkspaceRootDigest: null,
    inputDigest,
    assignmentDigests: {
      raw_chronicle_csv: inputDigest,
      phonestudy_ps_communication_file: supportDigest,
    },
    supportArtifactDigests: {
      phonestudy_ps_communication_file: supportDigest,
    },
    supportAdapterInputDigests: {
      phonestudy_ps_communication_file: supportDigest,
    },
    componentId: component.componentId,
    parentMethodProfileId: component.parentMethodProfileId,
    fullProfileExecutionStatus: "blocked",
    sourceWorkId: component.sourceWorkId,
    sourceMethodVariantId: component.sourceMethodVariantId,
    methodProfileVersion: component.methodProfileVersion,
    settingIds: component.methodSettingIds,
    componentExecutionReceiptDigest: executionMetadata.digest,
    oracleId,
    implementationDigest: IMPLEMENTATION_DIGEST,
    buildEnvironmentDigest: BUILD_DIGEST,
    inputAdapterContractDigest: CONTRACT_DIGEST,
    inputAdapterConformanceDigest: CONFORMANCE_DIGEST,
    androidMethodProfileRegistryContentDigest: REGISTRY_DIGEST,
  };
  const closureBytes = jsonBytes({
    protocolVersion: "chronicle-literature-component-artifact-closure/v1",
    ...identity,
    artifacts: content.map(({ metadata: value }) => value),
  });
  const closureMetadata = await metadata(
    "artifact-closure-json",
    "application/json",
    closureBytes,
    content.map(({ metadata: value }) => value.digest),
  );
  const rootBytes = jsonBytes({
    protocolVersion: "chronicle-literature-component-root/v1",
    ...identity,
    artifactDigests: [
      ...content.map(({ metadata: value }) => value.digest),
      closureMetadata.digest,
    ].sort(),
    artifactClosureDigest: closureMetadata.digest,
  });
  const rootMetadata = await metadata(
    "workspace-root-json",
    "application/json",
    rootBytes,
    [closureMetadata.digest],
  );
  const artifacts = [
    ...content,
    { metadata: closureMetadata, bytes: closureBytes },
    { metadata: rootMetadata, bytes: rootBytes },
  ];
  const manifest = {
    protocolVersion: "chronicle-literature-component-runtime/v1",
    requestId: `component-${inputDigest.slice(7, 23)}-${supportDigest.slice(7, 23)}`,
    command: "ExecuteLiteratureComponent",
    workspaceId,
    previousWorkspaceRootDigest: null,
    workspaceRootDigest: rootMetadata.digest,
    artifactClosureDigest: closureMetadata.digest,
    inputFileName,
    inputDigest,
    componentId: component.componentId,
    componentExecutionReceiptDigest: executionMetadata.digest,
    sourceRowCount: 1,
    derivedResultRowCount: 1,
    implementationDigest: IMPLEMENTATION_DIGEST,
    buildEnvironmentDigest: BUILD_DIGEST,
    inputAdapterContractDigest: CONTRACT_DIGEST,
    inputAdapterConformanceDigest: CONFORMANCE_DIGEST,
    androidMethodProfileRegistryContentDigest: REGISTRY_DIGEST,
    artifacts: artifacts.map(({ metadata: value }) => value),
  };
  return { component, inputDigest, supportDigest, artifacts, manifest };
}

function installFixture(fixture: Awaited<ReturnType<typeof componentFixture>>) {
  const supports: Array<{
    roles: Array<{ role: string; name: string; bytes: Uint8Array }>;
    freed: boolean;
  }> = [];
  const result = { freed: false };
  const execute = vi.fn((componentId: string, requestJson: string) => {
    const request = JSON.parse(requestJson) as Record<string, unknown>;
    expect(componentId).toBe(fixture.component.componentId);
    expect(request).not.toHaveProperty("methodProfileReceipt");
    expect(request).not.toHaveProperty("methodProfileReceipts");
    expect(request).not.toHaveProperty("participantPartitionBatchId");
    expect(request.options).toBeTypeOf("object");
    return {
      artifact_count: fixture.artifacts.length,
      manifest_json: () => canonicalJson(fixture.manifest),
      artifact_metadata_json: (index: number) =>
        canonicalJson(fixture.artifacts[index]!.metadata),
      take_artifact_bytes: (index: number) =>
        Uint8Array.from(fixture.artifacts[index]!.bytes),
      free: () => {
        result.freed = true;
      },
    };
  });
  class Supports {
    roles: Array<{ role: string; name: string; bytes: Uint8Array }> = [];
    freed = false;
    constructor() {
      supports.push(this);
    }
    put(): void {
      throw new Error("unnamed support is forbidden");
    }
    put_with_name(role: string, name: string, bytes: Uint8Array): void {
      this.roles.push({ role, name, bytes: Uint8Array.from(bytes) });
    }
    free(): void {
      this.freed = true;
    }
  }
  setRustRuntimeForTesting({
    implementation_build_digest: () => IMPLEMENTATION_DIGEST,
    build_environment_digest: () => BUILD_DIGEST,
    runtime_identity: () => ({ ...loadedRuntimeIdentity }),
    RuntimeSupportFiles: Supports,
    execute_literature_component: execute,
  } as unknown as Parameters<typeof setRustRuntimeForTesting>[0]);
  return { supports, result, execute };
}

afterEach(() => {
  setRustPersistenceForTesting(null);
  setRustRuntimeForTesting(runtimeWasm);
});

describe("registered literature component runtime", () => {
  it("resolves the complete Schoedel setting unit and refuses partial selection", () => {
    const component = registration();
    expect(component.methodSettingIds).toHaveLength(16);
    expect(component.requiredSupportRoles).toEqual([
      "phonestudy_ps_communication_file",
    ]);
    expect(
      literatureComponentExecutionForSettings(
        component.methodSettingIds.slice(0, -1),
      ),
    ).toBeUndefined();
    expect(component.fullProfileExecutionStatus).toBe("blocked");
  });

  it("registers the exact Harbach-De Luca-Egelman keyguard component boundary", () => {
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(
      ({ semanticType }) => semanticType === "keyguard_transition_fsm",
    );
    expect(group).toBeDefined();
    const component = literatureComponentExecutionForSettings(
      group!.methodSettingIds,
    );

    expect(component).toMatchObject({
      componentId: "chronicle.keyguard-transition-fsm/v1",
      parentMethodProfileId: "method-profile:doi:10.1145/2858036.2858267",
      sourceWorkId: "doi:10.1145/2858036.2858267",
      sourceMethodVariantId:
        "source-audit-configuration-space-cf29f24c1bfd65e2d30d98c3",
      derivedResultKind: "literature-keyguard-session-evidence-csv",
      fullProfileExecutionStatus: "blocked",
      requiredSupportRoles: [],
    });
    expect(component?.methodSettingIds).toHaveLength(9);
    expect(component?.limitations).toHaveLength(5);
  });

  it("registers the count-neutral daily-contact source-variant component", () => {
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(
      ({ semanticType }) => semanticType === "notification_study_daily_result",
    );
    expect(group).toBeDefined();
    const component = literatureComponentExecutionForSettings(
      group!.methodSettingIds,
    );

    expect(component).toMatchObject({
      componentId: "chronicle.notification-study-daily/v1",
      parentMethodProfileId:
        "method-profile:doi:10.1080/15213269.2024.2334025",
      sourceWorkId: "doi:10.1080/15213269.2024.2334025",
      sourceMethodVariantId:
        "source-audit-configuration-space-0fb788bc62d547eaaf91bb9a",
      derivedResultKind:
        "literature-notification-daily-count-source-variants-csv",
      fullProfileExecutionStatus: "blocked",
      requiredSupportRoles: [],
    });
    expect(component?.methodSettingIds).toEqual([
      "method-setting-00b9e68ec2f812485d70c809",
      "method-setting-1a54c43ea05a73d05fb96b06",
      "method-setting-b4785babbe7649c9ea815804",
    ]);
    expect(component?.limitations.join(" ")).toContain("distinct variants");
  });

  it("executes without a parent receipt and verifies every emitted artifact", async () => {
    const raw = encoder.encode(
      "user_id,activityName,event\n1,SCREEN,ON_UNLOCKED\n",
    );
    const support = encoder.encode("id,type,length\n1,OUTGOING,1\n");
    const fixture = await componentFixture(raw, support);
    const harness = installFixture(fixture);

    const execution = await executeLiteratureComponentRuntime(
      fixture.component,
      raw,
      "ps_activity.csv",
      {
        phoneStudyPsCommunicationFile: {
          name: "ps_communication.csv",
          bytes: support.slice().buffer,
        },
      },
      false,
      fixture.inputDigest.slice(7),
    );

    expect(execution.componentExecutionReceipt).toMatchObject({
      componentExecutionStatus: "executed",
      fullProfileExecutionStatus: "blocked",
      kernelInputEligible: false,
    });
    expect(execution.artifacts).toHaveLength(6);
    expect(execution.artifacts.every(({ bytes }) => bytes)).toBe(true);
    expect(harness.supports[0]!.roles.map(({ role }) => role)).toEqual([
      "phonestudy_ps_communication_file",
    ]);
    expect(harness.supports[0]!.freed).toBe(true);
    expect(harness.result.freed).toBe(true);
  });

  it("decodes and preserves receipt-visible component limitations", async () => {
    const limitation =
      "The source omits the bin anchor; this bounded fixture uses timestamp-ns anchor 0.";
    const raw = encoder.encode(
      "user_id,activityName,event\n1,SCREEN,ON_UNLOCKED\n",
    );
    const support = encoder.encode("id,type,length\n1,OUTGOING,1\n");
    const fixture = await componentFixture(raw, support, "ps_activity.csv", [
      limitation,
    ]);
    installFixture(fixture);

    const execution = await executeLiteratureComponentRuntime(
      fixture.component,
      raw,
      "ps_activity.csv",
      {
        phoneStudyPsCommunicationFile: {
          name: "ps_communication.csv",
          bytes: support.slice().buffer,
        },
      },
      false,
      fixture.inputDigest.slice(7),
    );

    expect(execution.componentExecutionReceipt.limitations).toEqual([
      limitation,
    ]);
  });

  it("persists raw, support, closure, and root through the OPFS primitives", async () => {
    const raw = encoder.encode(
      "user_id,activityName,event\n1,SCREEN,ON_UNLOCKED\n",
    );
    const support = encoder.encode("id,type,length\n1,OUTGOING,1\n");
    const fixture = await componentFixture(raw, support);
    installFixture(fixture);
    const memory = new MemoryDirectoryHandle();
    const root = memoryDirectoryHandle(memory);
    setRustPersistenceForTesting({
      openRoot: () => Promise.resolve(root),
      recover: (value) => recoverRuntimeWorkspace(value),
      persist: (value, input) => persistRuntimeWorkspace(value, input),
    });

    const execution = await executeLiteratureComponentRuntime(
      fixture.component,
      raw,
      "ps_activity.csv",
      {
        phoneStudyPsCommunicationFile: {
          name: "ps_communication.csv",
          bytes: support.slice().buffer,
        },
      },
      true,
      fixture.inputDigest.slice(7),
    );

    expect(execution.persistedWorkspace?.generation).toBe(1);
    expect(execution.artifacts.every(({ bytes }) => bytes === undefined)).toBe(
      true,
    );
    await expect(readRuntimeObject(root, fixture.inputDigest)).resolves.toEqual(
      raw,
    );
    await expect(
      readRuntimeObject(root, fixture.supportDigest),
    ).resolves.toEqual(support);
    await expect(
      readRuntimeObject(root, execution.manifest.artifactClosureDigest),
    ).resolves.toBeInstanceOf(Uint8Array);
    await expect(
      readRuntimeObject(root, execution.manifest.workspaceRootDigest),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it("rejects metadata tampering and still frees both WASM handles", async () => {
    const raw = encoder.encode(
      "user_id,activityName,event\n1,SCREEN,ON_UNLOCKED\n",
    );
    const support = encoder.encode("id,type,length\n1,OUTGOING,1\n");
    const fixture = await componentFixture(raw, support);
    fixture.artifacts[2]!.metadata.size += 1;
    const harness = installFixture(fixture);

    await expect(
      executeLiteratureComponentRuntime(
        fixture.component,
        raw,
        "ps_activity.csv",
        {
          phoneStudyPsCommunicationFile: {
            name: "ps_communication.csv",
            bytes: support.slice().buffer,
          },
        },
        false,
        fixture.inputDigest.slice(7),
      ),
    ).rejects.toThrow(/integrity mismatch/);
    expect(harness.supports[0]!.freed).toBe(true);
    expect(harness.result.freed).toBe(true);
  });

  it("rejects a rehashed receipt set claiming an unregistered source oracle", async () => {
    const raw = encoder.encode("user_id,activityName,event\n1,SCREEN,ON_UNLOCKED\n");
    const support = encoder.encode("id,type,length\n1,OUTGOING,1\n");
    const fixture = await componentFixture(raw, support, "ps_activity.csv", [], "forged-oracle");
    installFixture(fixture);
    await expect(executeLiteratureComponentRuntime(fixture.component, raw, "ps_activity.csv", {
      phoneStudyPsCommunicationFile: { name: "ps_communication.csv", bytes: support.buffer },
    }, false)).rejects.toThrow("saved literature component receipt identity mismatch");
  });

  /**
   * `executeLiteratureComponentRuntimeUnlocked` re-derives every claim the
   * kernel handle makes before any of it is published or persisted. Each case
   * below tampers with exactly one claim in the fixture and names the guard it
   * must reach.
   */
  describe("fail-closed guards over the kernel handle", () => {
    const RAW = encoder.encode(
      "user_id,activityName,event\n1,SCREEN,ON_UNLOCKED\n",
    );
    const SUPPORT = encoder.encode("id,type,length\n1,OUTGOING,1\n");

    function supportFiles(name = "ps_communication.csv") {
      return {
        phoneStudyPsCommunicationFile: {
          name,
          bytes: SUPPORT.slice().buffer,
        },
      };
    }

    async function runFixture(
      fixture: Awaited<ReturnType<typeof componentFixture>>,
      files = supportFiles(),
    ) {
      return executeLiteratureComponentRuntime(
        fixture.component,
        RAW,
        "ps_activity.csv",
        files,
        false,
        fixture.inputDigest.slice(7),
      );
    }

    it("requires a non-blank input file name", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      installFixture(fixture);
      await expect(
        executeLiteratureComponentRuntime(
          fixture.component,
          RAW,
          "   ",
          supportFiles(),
          false,
          fixture.inputDigest.slice(7),
        ),
      ).rejects.toThrow("inputFileName is required");
    });
    it("refuses an empty required communication source before kernel execution", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      installFixture(fixture);
      const files = supportFiles(); files.phoneStudyPsCommunicationFile.bytes = new ArrayBuffer(0);
      await expect(runFixture(fixture, files)).rejects.toThrow("phonestudy_ps_communication_file is required");
    });

    it("rejects a registration whose required support roles repeat", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      installFixture(fixture);
      const component = {
        ...fixture.component,
        requiredSupportRoles: [
          ...fixture.component.requiredSupportRoles,
          ...fixture.component.requiredSupportRoles,
        ],
      };
      await expect(
        executeLiteratureComponentRuntime(
          component,
          RAW,
          "ps_activity.csv",
          supportFiles(),
          false,
          fixture.inputDigest.slice(7),
        ),
      ).rejects.toThrow(
        "literature component required support roles are invalid",
      );
    });

    it("rejects a registration with a blank required support role", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      installFixture(fixture);
      const component = {
        ...fixture.component,
        requiredSupportRoles: [" "],
      };
      await expect(
        executeLiteratureComponentRuntime(
          component,
          RAW,
          "ps_activity.csv",
          supportFiles(),
          false,
          fixture.inputDigest.slice(7),
        ),
      ).rejects.toThrow(
        "literature component required support roles are invalid",
      );
    });

    it("refuses a support file that is not source-faithful CSV", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      installFixture(fixture);
      await expect(
        runFixture(fixture, supportFiles("ps_communication.xlsx")),
      ).rejects.toThrow(
        "phonestudy_ps_communication_file must use source-faithful CSV format",
      );
    });

    it("fails closed on a runtime with no literature component boundary", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      setRustRuntimeForTesting({
        implementation_build_digest: () => IMPLEMENTATION_DIGEST,
        build_environment_digest: () => BUILD_DIGEST,
      } as unknown as Parameters<typeof setRustRuntimeForTesting>[0]);
      await expect(runFixture(fixture)).rejects.toThrow(
        "loaded Rust runtime does not expose literature component execution",
      );
    });

    it("rejects a manifest that names a different input file than the request", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      fixture.manifest.inputFileName = "other.csv";
      installFixture(fixture);
      await expect(runFixture(fixture)).rejects.toThrow(
        "literature component runtime manifest identity mismatch",
      );
    });

    it("rejects a manifest advertising fewer artifacts than the handle holds", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      fixture.manifest.artifacts = fixture.manifest.artifacts.slice(1);
      installFixture(fixture);
      await expect(runFixture(fixture)).rejects.toThrow(
        "literature component manifest/handle count mismatch",
      );
    });

    it("rejects a manifest entry that disagrees with the handle metadata it advertises", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      // The manifest and the handle metadata share one object in the fixture;
      // replace only the manifest's copy so the handle still reports the truth.
      const kind = "literature-component-method-receipt-json";
      const index = fixture.manifest.artifacts.findIndex(
        (entry) => entry.kind === kind,
      );
      fixture.manifest.artifacts[index] = {
        ...fixture.manifest.artifacts[index]!,
        size: fixture.manifest.artifacts[index]!.size + 1,
      };
      installFixture(fixture);
      await expect(runFixture(fixture)).rejects.toThrow(
        `literature component manifest/handle mismatch: ${kind}`,
      );
    });

    it("rejects a JSON receipt advertised under a non-JSON media type", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      const kind = "literature-component-method-receipt-json";
      fixture.manifest.artifacts.find((entry) => entry.kind === kind)!.mediaType =
        "text/plain";
      fixture.artifacts.find(({ metadata }) => metadata.kind === kind)!.metadata.mediaType =
        "text/plain";
      installFixture(fixture);
      await expect(runFixture(fixture)).rejects.toThrow(
        "literature component artifact catalog is invalid",
      );
    });

    it("rejects a handle that repeats one kind in place of a required artifact", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      const receiptIndex = fixture.artifacts.findIndex(
        ({ metadata }) =>
          metadata.kind === "literature-component-execution-receipt-json",
      );
      const methodArtifact = fixture.artifacts.find(
        ({ metadata }) =>
          metadata.kind === "literature-component-method-receipt-json",
      )!;
      fixture.artifacts[receiptIndex] = methodArtifact;
      installFixture(fixture);
      await expect(runFixture(fixture)).rejects.toThrow(
        "literature component omitted a required artifact",
      );
    });

    it.each([
      [
        "a manifest field the component contract does not declare",
        (fixture: Awaited<ReturnType<typeof componentFixture>>) => {
          (fixture.manifest as unknown as Record<string, unknown>).smuggledField = 1;
        },
        "runtime manifest contract violation at componentManifest: unexpected or missing fields",
      ],
      [
        "a manifest missing a field the component contract declares",
        (fixture: Awaited<ReturnType<typeof componentFixture>>) => {
          delete (fixture.manifest as unknown as Record<string, unknown>).sourceRowCount;
        },
        "runtime manifest contract violation at componentManifest: unexpected or missing fields",
      ],
      [
        "a manifest protocol the reader does not implement",
        (fixture: Awaited<ReturnType<typeof componentFixture>>) => {
          (fixture.manifest as unknown as Record<string, unknown>).protocolVersion =
            "chronicle-literature-component-runtime/v0";
        },
        "runtime manifest contract violation at componentManifest: unsupported protocol or command",
      ],
      [
        "a manifest command other than ExecuteLiteratureComponent",
        (fixture: Awaited<ReturnType<typeof componentFixture>>) => {
          (fixture.manifest as unknown as Record<string, unknown>).command =
            "QueryReview";
        },
        "runtime manifest contract violation at componentManifest: unsupported protocol or command",
      ],
      [
        "a manifest catalog that repeats one artifact id",
        (fixture: Awaited<ReturnType<typeof componentFixture>>) => {
          const artifacts = fixture.manifest.artifacts;
          artifacts.push({ ...artifacts[0]!, kind: "another-json" });
        },
        "runtime manifest contract violation at componentManifest.artifacts: duplicate kind or artifact id",
      ],
      [
        "a manifest catalog that repeats one artifact kind",
        (fixture: Awaited<ReturnType<typeof componentFixture>>) => {
          const artifacts = fixture.manifest.artifacts;
          artifacts.push({
            ...artifacts[0]!,
            artifactId: `${artifacts[0]!.artifactId}-copy`,
          });
        },
        "runtime manifest contract violation at componentManifest.artifacts: duplicate kind or artifact id",
      ],
    ] as Array<
      [string, (fixture: Awaited<ReturnType<typeof componentFixture>>) => void, string]
    >)("rejects %s", async (_label, tamper, message) => {
      const fixture = await componentFixture(RAW, SUPPORT);
      tamper(fixture);
      installFixture(fixture);
      await expect(runFixture(fixture)).rejects.toThrow(message);
    });

    it.each([
      ["a digest that is not 64 hexadecimal characters", "not-a-digest"],
      ["an uppercase digest", "A".repeat(64)],
    ])("rejects %s as the verified input digest", async (_label, inputSha256) => {
      const fixture = await componentFixture(RAW, SUPPORT);
      installFixture(fixture);
      await expect(
        executeLiteratureComponentRuntime(
          fixture.component,
          RAW,
          "ps_activity.csv",
          supportFiles(),
          false,
          inputSha256,
        ),
      ).rejects.toThrow(
        "verified input digest must be 64 lowercase hexadecimal characters",
      );
    });

    it("refuses a durable component execution without the Web Locks API", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      installFixture(fixture);
      // Node 24.5+ ships a global navigator.locks; model a browser without it.
      vi.stubGlobal("navigator", {});
      try {
        await expect(
          executeLiteratureComponentRuntime(
            fixture.component,
            RAW,
            "ps_activity.csv",
            supportFiles(),
            true,
            fixture.inputDigest.slice(7),
          ),
        ).rejects.toThrow(
          "Durable component execution requires the browser Web Locks API",
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });

    /**
     * Each receipt below is hashed after the change, so its own content address
     * is intact and only the claim it makes is wrong. The rules are the ones the
     * literature input adapter contract fixes for the component: the method
     * receipt's parent profile stays blocked, the adaptation receipt's row
     * counts are the manifest's, and the execution receipt's support formats are
     * the source-faithful CSV the adapter was handed.
     */
    it.each([
      [
        "an execution receipt claiming the full parent executed",
        { execution: { fullProfileExecutionStatus: "executed" } },
        "runtime manifest contract violation at componentExecutionReceipt: invalid execution or blocked-parent status",
      ],
      [
        "an execution receipt claiming canonical-kernel eligibility",
        { execution: { kernelInputEligible: true } },
        "runtime manifest contract violation at componentExecutionReceipt: invalid execution or blocked-parent status",
      ],
      [
        "a method receipt claiming its parent profile executed",
        { method: { parentProfileExecutionStatus: "executed" } },
        "literature component method receipt mismatch",
      ],
      [
        "an adaptation receipt whose source row count is not the manifest's",
        { adaptation: { sourceRowCount: 2 } },
        "literature component adaptation receipt mismatch",
      ],
      [
        "an execution receipt claiming a support file was normalized from xlsx",
        {
          execution: {
            supportFormats: {
              phonestudy_ps_communication_file:
                "text/csv; normalizedFromXlsx=true",
            },
          },
        },
        "literature component execution receipt mismatch",
      ],
    ] as Array<
      [string, Parameters<typeof componentFixture>[5], string]
    >)("rejects %s", async (_label, receiptOverrides, message) => {
      const fixture = await componentFixture(
        RAW,
        SUPPORT,
        "ps_activity.csv",
        [],
        ORACLE_ID,
        receiptOverrides,
      );
      installFixture(fixture);
      await expect(runFixture(fixture)).rejects.toThrow(message);
    });

    it("rejects a workspace root whose declared parent is not the artifact closure", async () => {
      const fixture = await componentFixture(RAW, SUPPORT);
      const rootEntry = fixture.artifacts.find(
        ({ metadata }) => metadata.kind === "workspace-root-json",
      )!;
      rootEntry.metadata.derivedFrom = [];
      fixture.manifest.artifacts.find(
        ({ kind }) => kind === "workspace-root-json",
      )!.derivedFrom = [];
      installFixture(fixture);
      await expect(runFixture(fixture)).rejects.toThrow(
        "literature component root/closure metadata mismatch",
      );
    });
  });
  /**
   * `reopenLiteratureComponentResult` re-verifies a persisted workspace from
   * its committed root and closure objects; it never trusts a field of the
   * manifest it is handed. Each case below persists one real execution and
   * then changes exactly one manifest claim.
   */
  describe("reopening a persisted component workspace", () => {
    const RAW = encoder.encode(
      "user_id,activityName,event\n1,SCREEN,ON_UNLOCKED\n",
    );
    const SUPPORT = encoder.encode("id,type,length\n1,OUTGOING,1\n");

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function persistOnce() {
      const fixture = await componentFixture(RAW, SUPPORT);
      installFixture(fixture);
      const memory = new MemoryDirectoryHandle();
      // Reopening resolves the workspace through OPFS under a shared Web Lock;
      // vitest provides neither.
      vi.stubGlobal("navigator", {
        storage: { getDirectory: () => Promise.resolve(memoryDirectoryHandle(memory)) },
        locks: {
          request: (_name: string, _options: unknown, operation: () => unknown) =>
            Promise.resolve(operation()),
        },
      });
      const root = await openOpfsWorkspace(
        await literatureComponentWorkspaceId(
          fixture.component.componentId,
          fixture.inputDigest.slice(7),
        ),
      );
      setRustPersistenceForTesting({
        openRoot: () => Promise.resolve(root),
        recover: (value) => recoverRuntimeWorkspace(value),
        persist: (value, input) => persistRuntimeWorkspace(value, input),
      });
      const execution = await executeLiteratureComponentRuntime(
        fixture.component,
        RAW,
        "ps_activity.csv",
        {
          phoneStudyPsCommunicationFile: {
            name: "ps_communication.csv",
            bytes: SUPPORT.slice().buffer,
          },
        },
        true,
        fixture.inputDigest.slice(7),
      );
      return { execution, fixture, root };
    }

    /**
     * Store a changed workspace-root object under its own content address and
     * point the manifest at it, so the root's own rules are reached rather than
     * the root-digest check in front of them.
     */
    async function reopenWithRoot(
      persisted: Awaited<ReturnType<typeof persistOnce>>,
      tamper: (root: Record<string, unknown>) => void,
    ) {
      const rootBytes = await readRuntimeObject(
        persisted.root,
        persisted.execution.manifest.workspaceRootDigest,
      );
      const value = JSON.parse(new TextDecoder().decode(rootBytes)) as Record<
        string,
        unknown
      >;
      tamper(value);
      const bytes = encoder.encode(canonicalJson(value));
      const rootDigest = await digest(bytes);
      await persistRuntimeObject(persisted.root, {
        digest: rootDigest,
        bytes,
        kind: "workspace-root-json",
        mediaType: "application/json",
        size: bytes.byteLength,
      } as never);
      const manifest = JSON.parse(persisted.execution.manifestJson) as Record<
        string,
        unknown
      >;
      manifest.workspaceRootDigest = rootDigest;
      (manifest.artifacts as Array<Record<string, unknown>>).forEach((artifact) => {
        if (artifact.kind === "workspace-root-json") {
          artifact.digest = rootDigest;
          artifact.size = bytes.byteLength;
          artifact.artifactId = `urn:chronicle:artifact:workspace-root-json:${rootDigest.slice(7)}`;
        }
      });
      return reopenLiteratureComponentResult(JSON.stringify(manifest));
    }

    /**
     * Store a changed artifact-closure object, then repoint the root at it so
     * the root/closure rules are reached with both objects readable.
     */
    async function reopenWithClosure(
      persisted: Awaited<ReturnType<typeof persistOnce>>,
      tamper: (closure: Record<string, unknown>) => void,
    ) {
      const closureBytes = await readRuntimeObject(
        persisted.root,
        persisted.execution.manifest.artifactClosureDigest,
      );
      const value = JSON.parse(new TextDecoder().decode(closureBytes)) as Record<
        string,
        unknown
      >;
      const priorDigest = persisted.execution.manifest.artifactClosureDigest;
      tamper(value);
      const bytes = encoder.encode(canonicalJson(value));
      const closureDigest = await digest(bytes);
      await persistRuntimeObject(persisted.root, {
        digest: closureDigest,
        bytes,
        kind: "artifact-closure-json",
        mediaType: "application/json",
        size: bytes.byteLength,
      } as never);
      return reopenWithRoot(persisted, (root) => {
        root.artifactClosureDigest = closureDigest;
        root.artifactDigests = (root.artifactDigests as string[])
          .map((entry) => (entry === priorDigest ? closureDigest : entry))
          .sort();
      });
    }


    const reopenWith = (
      manifestJson: string,
      mutate: (manifest: Record<string, unknown>) => void,
    ) => {
      const manifest = JSON.parse(manifestJson) as Record<string, unknown>;
      mutate(manifest);
      return reopenLiteratureComponentResult(JSON.stringify(manifest));
    }


    it("reopens the saved workspace and republishes every persisted artifact", async () => {
      const { execution } = await persistOnce();
      const reopened = await reopenLiteratureComponentResult(execution.manifestJson);
      expect(reopened.workspaceId).toBe(execution.workspaceId);
      expect(reopened.componentExecutionReceipt).toEqual(
        execution.componentExecutionReceipt,
      );
      expect(reopened.artifacts.map(({ metadata }) => metadata.kind).sort()).toEqual(
        execution.artifacts.map(({ metadata }) => metadata.kind).sort(),
      );
      expect(
        reopened.artifacts.every(({ persistedArtifact }) => persistedArtifact !== undefined),
      ).toBe(true);
    });

    it.each([
      [
        "a component id the committed settings do not resolve to",
        (manifest: Record<string, unknown>) => {
          manifest.componentId = "literature-component:absent";
        },
        "Saved component registration mismatch",
      ],
      [
        "an artifact inventory missing one committed kind",
        (manifest: Record<string, unknown>) => {
          manifest.artifacts = (manifest.artifacts as unknown[]).slice(1);
        },
        "Saved component artifact inventory mismatch",
      ],
      [
        "a parent workspace root the committed root does not name",
        (manifest: Record<string, unknown>) => {
          manifest.previousWorkspaceRootDigest = `sha256:${"c".repeat(64)}`;
        },
        "literature component workspace-root identity mismatch",
      ],
      [
        "an input digest the committed root does not name",
        (manifest: Record<string, unknown>) => {
          manifest.inputDigest = `sha256:${"d".repeat(64)}`;
        },
        "literature component workspace-root identity mismatch",
      ],
      [
        "a derived result row count the saved receipt does not report",
        (manifest: Record<string, unknown>) => {
          manifest.derivedResultRowCount =
            (manifest.derivedResultRowCount as number) + 1;
        },
        "Saved component manifest identity mismatch",
      ],
      [
        "an implementation digest the saved receipt does not carry",
        (manifest: Record<string, unknown>) => {
          manifest.implementationDigest = `sha256:${"e".repeat(64)}`;
        },
        "Saved component manifest identity mismatch",
      ],
      [
        "a source row count the saved adaptation receipt does not report",
        (manifest: Record<string, unknown>) => {
          manifest.sourceRowCount = (manifest.sourceRowCount as number) + 1;
        },
        "Saved component source count mismatch",
      ],
      ["a root artifact with an invented byte size", manifest => {
        const artifacts = manifest.artifacts as Array<Record<string, unknown>>;
        const target = artifacts.find(artifact => artifact.kind === "workspace-root-json")!;
        target.size = (target.size as number) + 1;
      }, "Saved component artifact size mismatch"],
      ["a root artifact replaced by the existing closure bytes", manifest => {
        const artifacts = manifest.artifacts as Array<Record<string, unknown>>;
        const target = artifacts.find(artifact => artifact.kind === "workspace-root-json")!;
        const source = artifacts.find(artifact => artifact.kind === "artifact-closure-json")!;
        target.digest = source.digest; target.size = source.size;
        target.artifactId = `urn:chronicle:artifact:workspace-root-json:${(source.digest as string).slice(7)}`;
      }, "Saved component root mismatch"],
      ["a closure artifact replaced by the existing root bytes", manifest => {
        const artifacts = manifest.artifacts as Array<Record<string, unknown>>;
        const target = artifacts.find(artifact => artifact.kind === "artifact-closure-json")!;
        const source = artifacts.find(artifact => artifact.kind === "workspace-root-json")!;
        target.digest = source.digest; target.size = source.size;
        target.artifactId = `urn:chronicle:artifact:artifact-closure-json:${(source.digest as string).slice(7)}`;
      }, "Saved component closure mismatch"],
    ] as Array<[string, (manifest: Record<string, unknown>) => void, string]>)(
      "refuses %s",
      async (_label, mutate, message) => {
        const { execution } = await persistOnce();
        await expect(reopenWith(execution.manifestJson, mutate)).rejects.toThrow(message);
        await expect(reopenLiteratureComponentResult(execution.manifestJson)).resolves.toMatchObject({ workspaceId: execution.workspaceId });
      },
    );

    it("refuses an artifact whose claimed size is not the size the closure committed", async () => {
      const { execution } = await persistOnce();
      await expect(
        reopenWith(execution.manifestJson, (manifest) => {
          const artifacts = manifest.artifacts as Array<Record<string, unknown>>;
          const target = artifacts.find(
            (artifact) => artifact.kind === "literature-input-adaptation-receipt-json",
          )!;
          target.size = (target.size as number) + 1;
        }),
      ).rejects.toThrow(
        "literature component manifest/closure mismatch: literature-input-adaptation-receipt-json",
      );
    });

    it("refuses an execution receipt digest the committed root does not name", async () => {
      const { execution } = await persistOnce();
      const other = execution.manifest.artifacts.find(
        ({ kind }) => kind === "literature-input-adaptation-receipt-json",
      )!;
      await expect(
        reopenWith(execution.manifestJson, (manifest) => {
          manifest.componentExecutionReceiptDigest = other.digest;
        }),
      ).rejects.toThrow("Saved component receipt mismatch");
    });


    it.each([
      [
        "a root protocol the reader does not implement",
        (root: Record<string, unknown>) => {
          root.protocolVersion = "chronicle-literature-component-root/v0";
        },
        "runtime manifest contract violation at componentRoot.protocolVersion: unsupported protocol",
      ],
      [
        "a root that repeats one artifact digest",
        (root: Record<string, unknown>) => {
          const digests = root.artifactDigests as string[];
          root.artifactDigests = [digests[0]!, ...digests];
        },
        "literature component root artifact set is invalid",
      ],
      [
        "a root whose artifact set omits its own closure",
        (root: Record<string, unknown>) => {
          root.artifactDigests = (root.artifactDigests as string[]).filter(
            (value) => value !== root.artifactClosureDigest,
          );
        },
        "literature component root artifact set is invalid",
      ],
      [
        "a root whose ingress assignment is not the artifact it committed",
        (root: Record<string, unknown>) => {
          const assignments = root.assignmentDigests as Record<string, string>;
          assignments.raw_chronicle_csv = `sha256:${"9".repeat(64)}`;
        },
        "literature component ingress assignment mismatch",
      ],
      [
        "a root whose support adapter input is not its support artifact",
        (root: Record<string, unknown>) => {
          const inputs = root.supportAdapterInputDigests as Record<string, string>;
          for (const role of Object.keys(inputs)) {
            inputs[role] = `sha256:${"9".repeat(64)}`;
          }
        },
        "literature component ingress assignment mismatch",
      ],
      [
        "a root naming an object the artifact closure does not hold",
        (root: Record<string, unknown>) => {
          root.artifactDigests = [
            ...(root.artifactDigests as string[]),
            `sha256:${"9".repeat(64)}`,
          ].sort();
        },
        "literature component root/closure digest set mismatch",
      ],
    ] as Array<[string, (root: Record<string, unknown>) => void, string]>)(
      "refuses %s",
      async (_label, tamper, message) => {
        const persisted = await persistOnce();
        await expect(reopenWithRoot(persisted, tamper)).rejects.toThrow(message);
      },
    );


    it.each([
      ["componentId", "component:foreign"],
      ["parentMethodProfileId", "profile:foreign"],
      ["fullProfileExecutionStatus", "executed"],
      ["sourceWorkId", "doi:foreign"],
      ["sourceMethodVariantId", "foreign-variant"],
      ["methodProfileVersion", "foreign-version"],
    ] as const)("refuses a saved root with foreign %s and retains the original", async (field, value) => {
      const persisted = await persistOnce();
      await expect(reopenWithRoot(persisted, root => { root[field] = value; })).rejects.toThrow(
        "runtime manifest contract violation at componentRoot: component registration identity mismatch",
      );
      expect((await recoverRuntimeWorkspace(persisted.root))?.workspaceRootDigest).toBe(persisted.execution.manifest.workspaceRootDigest);
      await expect(reopenLiteratureComponentResult(persisted.execution.manifestJson)).resolves.toMatchObject({ workspaceId: persisted.execution.workspaceId });
    });

    it.each([
      [
        "a closure protocol the reader does not implement",
        (closure: Record<string, unknown>) => {
          closure.protocolVersion =
            "chronicle-literature-component-artifact-closure/v0";
        },
        "runtime manifest contract violation at componentClosure.protocolVersion: unsupported protocol",
      ],
      [
        "a closure whose workspace identity is not the root's",
        (closure: Record<string, unknown>) => {
          closure.inputDigest = `sha256:${"9".repeat(64)}`;
        },
        "literature component root/closure identity mismatch: inputDigest",
      ],
      [
        "a closure content set that drops one committed artifact",
        (closure: Record<string, unknown>) => {
          closure.artifacts = (closure.artifacts as unknown[]).slice(1);
        },
        "literature component closure content set is invalid",
      ],
      [
        "a closure content set holding a kind the component does not emit",
        (closure: Record<string, unknown>) => {
          const artifacts = closure.artifacts as Array<Record<string, unknown>>;
          artifacts[0] = { ...artifacts[0]!, kind: "unexpected-json" };
        },
        "literature component closure content set is invalid",
      ],
    ] as Array<[string, (closure: Record<string, unknown>) => void, string]>)(
      "refuses %s",
      async (_label, tamper, message) => {
        const persisted = await persistOnce();
        await expect(reopenWithClosure(persisted, tamper)).rejects.toThrow(message);
      },
    );

    /**
     * Re-store the workspace with a changed artifact closure and import it by
     * its new root digest. The import path carries no manifest, so the closure's
     * own rules in `verifyLiteratureComponentRoot` are the ones reached.
     */
    async function importWithClosure(
      persisted: Awaited<ReturnType<typeof persistOnce>>,
      tamper: (closure: Record<string, unknown>) => Promise<void> | void,
    ) {
      const priorClosureDigest = persisted.execution.manifest.artifactClosureDigest;
      const closureValue = JSON.parse(
        new TextDecoder().decode(
          await readRuntimeObject(persisted.root, priorClosureDigest),
        ),
      ) as Record<string, unknown>;
      await tamper(closureValue);
      const closureBytes = encoder.encode(canonicalJson(closureValue));
      const closureDigest = await digest(closureBytes);
      await persistRuntimeObject(persisted.root, {
        digest: closureDigest,
        bytes: closureBytes,
        kind: "artifact-closure-json",
        mediaType: "application/json",
        size: closureBytes.byteLength,
      } as never);
      const rootValue = JSON.parse(
        new TextDecoder().decode(
          await readRuntimeObject(
            persisted.root,
            persisted.execution.manifest.workspaceRootDigest,
          ),
        ),
      ) as Record<string, unknown>;
      rootValue.artifactClosureDigest = closureDigest;
      rootValue.artifactDigests = [
        ...(rootValue.artifactDigests as string[]).filter(
          (entry) => entry !== priorClosureDigest,
        ),
        closureDigest,
      ].sort();
      const rootBytes = encoder.encode(canonicalJson(rootValue));
      const rootDigest = await digest(rootBytes);
      await persistRuntimeObject(persisted.root, {
        digest: rootDigest,
        bytes: rootBytes,
        kind: "workspace-root-json",
        mediaType: "application/json",
        size: rootBytes.byteLength,
      } as never);
      return reopenImportedLiteratureComponent(
        persisted.execution.workspaceId,
        rootDigest,
      );
    }

    it("refuses a closure that claims a size the stored object does not have", async () => {
      const persisted = await persistOnce();
      await expect(
        importWithClosure(persisted, (closure) => {
          const artifacts = closure.artifacts as Array<Record<string, unknown>>;
          const target = artifacts.find(
            (artifact) =>
              artifact.kind === "literature-input-adaptation-receipt-json",
          )!;
          target.size = (target.size as number) + 1;
        }),
      ).rejects.toThrow(
        "persisted Rust artifact integrity mismatch: literature-input-adaptation-receipt-json",
      );
    });

    it("refuses a stored receipt object whose bytes are not canonical JSON", async () => {
      const persisted = await persistOnce();
      await expect(
        importWithClosure(persisted, async (closure) => {
          const artifacts = closure.artifacts as Array<Record<string, unknown>>;
          const target = artifacts.find(
            (artifact) =>
              artifact.kind === "literature-input-adaptation-receipt-json",
          )!;
          const original = JSON.parse(
            new TextDecoder().decode(
              await readRuntimeObject(persisted.root, target.digest as string),
            ),
          ) as unknown;
          // Same value, whitespace the canonical encoder never emits.
          const bytes = encoder.encode(JSON.stringify(original, null, 1));
          const replacement = await digest(bytes);
          await persistRuntimeObject(persisted.root, {
            digest: replacement,
            bytes,
            kind: target.kind as string,
            mediaType: "application/json",
            size: bytes.byteLength,
          } as never);
          target.digest = replacement;
          target.size = bytes.byteLength;
        }),
      ).rejects.toThrow(/is not canonical JSON/);
    });

    it("refuses a stored receipt object whose bytes are not JSON at all", async () => {
      const persisted = await persistOnce();
      await expect(
        importWithClosure(persisted, async (closure) => {
          const artifacts = closure.artifacts as Array<Record<string, unknown>>;
          const target = artifacts.find(
            (artifact) =>
              artifact.kind === "literature-input-adaptation-receipt-json",
          )!;
          const bytes = encoder.encode("{not json");
          const replacement = await digest(bytes);
          await persistRuntimeObject(persisted.root, {
            digest: replacement,
            bytes,
            kind: target.kind as string,
            mediaType: "application/json",
            size: bytes.byteLength,
          } as never);
          target.digest = replacement;
          target.size = bytes.byteLength;
        }),
      ).rejects.toThrow(/is not valid JSON/);
    });

    it("imports the saved workspace back from its committed root digest", async () => {
      const { execution } = await persistOnce();
      const imported = await reopenImportedLiteratureComponent(
        execution.workspaceId,
        execution.manifest.workspaceRootDigest,
      );
      expect(imported?.componentExecutionReceipt).toEqual(
        execution.componentExecutionReceipt,
      );
      expect(imported?.manifest.inputFileName).toBe("Restored component input");
      expect(imported?.manifest.requestId).toBe(
        `reopened:${execution.manifest.workspaceRootDigest}`,
      );
    });

    it("verifies the saved component head and refuses to export one from a different runtime", async () => {
      const { execution } = await persistOnce();
      await expect(
        verifyPersistedRustWorkspace(execution.workspaceId),
      ).resolves.toMatchObject({
        workspaceRootDigest: execution.manifest.workspaceRootDigest,
      });
      for (const drift of [
        { implementationDigest: `sha256:${"9".repeat(64)}` },
        { buildEnvironmentDigest: `sha256:${"9".repeat(64)}` },
      ]) {
        Object.assign(loadedRuntimeIdentity, drift);
        try {
          await expect(
            verifyPersistedRustWorkspace(execution.workspaceId),
          ).rejects.toThrow(
            "component history head was produced by a different runtime identity",
          );
          await expect(
            exportPersistedRustWorkspace(
              execution.workspaceId,
              execution.manifest.workspaceRootDigest,
            ),
          ).rejects.toThrow(
            "component history head was produced by a different runtime identity",
          );
        } finally {
          Object.assign(loadedRuntimeIdentity, {
            implementationDigest: IMPLEMENTATION_DIGEST,
            buildEnvironmentDigest: BUILD_DIGEST,
          });
        }
      }
    });

    it("refuses an import addressed at anything other than the committed root", async () => {
      const { execution } = await persistOnce();
      const adaptation = execution.manifest.artifacts.find(
        ({ kind }) => kind === "literature-input-adaptation-receipt-json",
      )!;
      await expect(
        reopenImportedLiteratureComponent(execution.workspaceId, adaptation.digest),
      ).rejects.toThrow("persisted Rust workspace identity mismatch");
    });

    it("re-derives the same workspace id from the component id and input digest", async () => {
      const { execution, fixture } = await persistOnce();
      await expect(
        literatureComponentWorkspaceId(
          fixture.component.componentId,
          execution.manifest.inputDigest.slice(7),
        ),
      ).resolves.toBe(execution.workspaceId);
    });

    it.each([
      ["a blank component id", "   ", "0".repeat(64)],
      ["an input digest that is not a sha256", "component", "not-a-digest"],
    ])("refuses to derive a workspace id from %s", async (_label, componentId, inputSha256) => {
      await expect(
        literatureComponentWorkspaceId(componentId, inputSha256),
      ).rejects.toThrow("literature component workspace identity is invalid");
    });
  });
});
