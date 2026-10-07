import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error Vitest resolves this .mts source; tsconfig.node checks it directly.
import * as proofRunner from "../../scripts/generate_b03_b05_scientific_proof_report.mts";
import { canonicalJson } from "../lib/canonicalJson";
import type { RuntimeArtifactMetadata } from "../lib/generatedRuntimeBoundary";
import { runtimeScientificPreflightFixture } from "./runtimeScientificPreflightFixture";

const {
  B03_B05_PROOF_REPORT_PATHS,
  assertPreflightBeforeExecution,
  parseMode,
  validateBoundSupportFixture,
  validateExecutionEnvelopeIdentity,
  validateCertifiedDependencyDecision,
  validateExecutedCapabilityBindings,
  validatePreflightIdentity,
  validateProofOptionOverrides,
  validateRuntimeEvidenceRoots,
  verifyProofArtifactClosure,
} = proofRunner;

const fixtureRoot = resolve(process.cwd(), "src/testSupport/fixtures");

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("B03-B05 scientific proof report source contract", () => {
  it("requires the explicit proof flag and one non-writing/writing mode", () => {
    expect(parseMode(["--assert-b03-b05-scientific-proof", "--check"])).toBe(
      "check",
    );
    expect(parseMode(["--assert-b03-b05-scientific-proof", "--update"])).toBe(
      "update",
    );
    expect(() => parseMode(["--check"])).toThrow(/is required/);
    expect(() =>
      parseMode(["--assert-b03-b05-scientific-proof", "--check", "--update"]),
    ).toThrow(/exactly one/);
    expect(() =>
      parseMode([
        "--assert-b03-b05-scientific-proof",
        "--check",
        "--learn-current-output",
      ]),
    ).toThrow(/unknown proof-runner arguments/);
  });

  it("rejects misspelled, wrong-type, and out-of-domain scientific options", () => {
    expect(() =>
      validateProofOptionOverrides("options", {
        processAppUsage: true,
        episodeReconstructionStrategy: "eyes_complement",
        minimumUsageDuration: 0,
      }),
    ).not.toThrow();
    expect(() =>
      validateProofOptionOverrides("options", { processAppUsag: true }),
    ).toThrow(/unknown option processAppUsag/);
    expect(() =>
      validateProofOptionOverrides("options", { processAppUsage: "yes" }),
    ).toThrow(/wrong JSON type/);
    expect(() =>
      validateProofOptionOverrides("options", {
        episodeReconstructionStrategy: "current_default",
      }),
    ).toThrow(/exact enum domain/);
    expect(() =>
      validateBoundSupportFixture(
        "capability sidecar",
        { boundRawInputSha256: `sha256:${"1".repeat(64)}` },
        `sha256:${"2".repeat(64)}`,
      ),
    ).toThrow(/not bound to its exact raw input/);
    expect(() =>
      validateBoundSupportFixture(
        "capability sidecar",
        { boundRawInputSha256: undefined },
        `sha256:${"2".repeat(64)}`,
      ),
    ).toThrow(/not a canonical SHA-256 digest/);
  });

  it("pins package commands, report paths, witness IDs, and bound fixture bytes", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["generate:b03-b05-proof-report"]).toContain(
      "--assert-b03-b05-scientific-proof --update",
    );
    expect(packageJson.scripts["check:b03-b05-proof-report"]).toContain(
      "--assert-b03-b05-scientific-proof --check",
    );
    expect(B03_B05_PROOF_REPORT_PATHS.json).toMatch(
      /docs\/paper\/b03-b05-foundational-semantics-synthetic-proof-report\.json$/,
    );
    expect(B03_B05_PROOF_REPORT_PATHS.markdown).toMatch(
      /docs\/paper\/b03-b05-foundational-semantics-synthetic-proof-report\.md$/,
    );

    const manifestBytes = readFileSync(
      resolve(fixtureRoot, "b03-b05-fixture-manifest.json"),
    );
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
      limitations: string[];
      fixtures: Array<{
        id: string;
        path: string;
        sha256: string;
        boundRawInputSha256?: string;
      }>;
    };
    const expectations = JSON.parse(
      readFileSync(
        resolve(fixtureRoot, "b03-b05-scientific-proof-expectations.json"),
        "utf8",
      ),
    ) as {
      fixtureManifestSha256: string;
      limitations: string[];
      arms: Array<{
        id: string;
        fixtureId: string;
        supportFixtureId?: string;
        witnessIds: string[];
        expected: {
          status: string;
          scientific: { scientificArtifactCatalog: unknown } | null;
        };
      }>;
    };
    expect(expectations.fixtureManifestSha256).toBe(sha256(manifestBytes));
    expect(expectations.limitations).toEqual(manifest.limitations);
    expect(manifest.limitations).toContain(
      "contains_no_real_participant_or_study_data",
    );
    expect(manifest.limitations).not.toContain(
      "contains_no_participant_or_study_data",
    );

    const fixtureById = new Map(
      manifest.fixtures.map((fixture) => [fixture.id, fixture]),
    );
    for (const fixture of manifest.fixtures) {
      expect(
        sha256(readFileSync(resolve(fixtureRoot, fixture.path))),
        fixture.id,
      ).toBe(fixture.sha256);
    }
    const witnessIdByArm = new Map([
      ["b03-b04-strict-credit", "b03_b04_strict_credit_vector"],
      [
        "b03-b04-inclusive-exclude-zero",
        "b03_b04_inclusive_exclude_zero_vector",
      ],
      ["b04-strict-drop-lineage", "b04_strict_drop_lineage_vector"],
      ["b04-chronicle-blank", "b04_chronicle_blank_vector"],
      [
        "b05-parry-missing-capability",
        "b05_parry_missing_capability_refusal_vector",
      ],
      [
        "b05-parry-combined-label-refusal",
        "b05_parry_combined_label_refusal_vector",
      ],
      ["b05-chronicle-baseline", "b05_chronicle_baseline_vector"],
      ["schoedel-chronicle-prose", "schoedel_chronicle_prose_vector"],
      ["eyes-partial-replay", "eyes_partial_replay_vector"],
    ]);
    expect(expectations.arms.map(({ id }) => id).sort()).toEqual(
      [...witnessIdByArm.keys()].sort(),
    );
    for (const arm of expectations.arms) {
      expect(arm.witnessIds).toHaveLength(1);
      expect(arm.witnessIds[0]).toBe(witnessIdByArm.get(arm.id));
      if (arm.supportFixtureId) {
        expect(fixtureById.get(arm.supportFixtureId)?.boundRawInputSha256).toBe(
          fixtureById.get(arm.fixtureId)?.sha256,
        );
      }
      if (arm.expected.status === "executed") {
        expect(arm.expected.scientific).not.toBeNull();
        expect(arm.expected.scientific).toHaveProperty(
          "scientificArtifactCatalog",
        );
        expect(arm.expected.scientific?.scientificArtifactCatalog).toBeNull();
      }
    }
    const dropLineage = expectations.arms.find(
      ({ id }) => id === "b04-strict-drop-lineage",
    )?.expected.scientific as
      | { minimumDurationExcludedLineage?: Array<Record<string, unknown>> }
      | undefined;
    expect(dropLineage?.minimumDurationExcludedLineage).toMatchObject([
      {
        participantId: "P01",
        rawStartTimestampNs: "1772982000000000000",
        rawStopTimestampNs: "1772982004999999999",
      },
      {
        participantId: "P07",
        rawStartTimestampNs: "1772989200000000000",
        rawStopTimestampNs: "1772989204000000000",
      },
      {
        participantId: "P09",
        rawStartTimestampNs: "1772990400000000000",
        rawStopTimestampNs: "1772990400000000000",
      },
      {
        participantId: "P10",
        rawStartTimestampNs: "1772992804000000000",
        rawStopTimestampNs: "1772992808000000000",
      },
    ]);
  });

  it("requires bidirectional manifest/handle equality and rehashes every artifact", () => {
    const foundationalBytes = new TextEncoder().encode('{"receipt":"exact"}');
    const appBytes = new TextEncoder().encode("header\nvalue\n");
    const metadata: RuntimeArtifactMetadata[] = [
      {
        artifactId: `urn:chronicle:artifact:foundational:${sha256(foundationalBytes).slice(7)}`,
        kind: "foundational-semantics-receipt-json",
        mediaType: "application/json",
        digest: sha256(foundationalBytes),
        size: foundationalBytes.byteLength,
        derivedFrom: [],
      },
      {
        artifactId: `urn:chronicle:artifact:app:${sha256(appBytes).slice(7)}`,
        kind: "app-csv",
        mediaType: "text/csv",
        digest: sha256(appBytes),
        size: appBytes.byteLength,
        derivedFrom: [],
      },
    ];
    let takeCalls = 0;
    const handle = {
      artifact_count: metadata.length,
      artifact_metadata_json: (index: number) =>
        JSON.stringify(metadata[index]),
      take_artifact_bytes: (index: number) => {
        takeCalls += 1;
        return index === 0 ? foundationalBytes : appBytes;
      },
    };
    expect(verifyProofArtifactClosure(handle as never, metadata)).toEqual({
      "foundational-semantics-receipt-json": {
        artifactId: metadata[0]?.artifactId,
        mediaType: "application/json",
        digest: metadata[0]?.digest,
        size: foundationalBytes.byteLength,
        derivedFrom: [],
        scientificSourceBindings: [],
        rowCount: null,
      },
    });
    expect(takeCalls).toBe(2);
    expect(() =>
      verifyProofArtifactClosure(handle as never, metadata.slice(0, 1)),
    ).toThrow(/cardinality differs/);
    const tampered = metadata.map((entry) => ({ ...entry }));
    if (tampered[1]) tampered[1].digest = `sha256:${"0".repeat(64)}`;
    const tamperedHandle = {
      ...handle,
      artifact_metadata_json: (index: number) =>
        JSON.stringify(tampered[index]),
    };
    expect(() =>
      verifyProofArtifactClosure(tamperedHandle as never, tampered),
    ).toThrow(/digest drift/);
  });

  it("validates capability bindings against exact scientific query cones", () => {
    const artifactDigest = `sha256:${"1".repeat(64)}`;
    const assignmentId = `sha256:${"2".repeat(64)}`;
    const binding = {
      roleId: "input_capability_evidence_file",
      artifactDigest,
      assignmentId,
    };
    const arm = {
      id: "schoedel-chronicle-prose",
      options: {
        processAppUsage: true,
        processScreenUsage: false,
        episodeReconstructionStrategy:
          "schoedel_2026_app_within_screen_prose_v1",
        screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
      },
      expected: { preflight: { activeCapabilityRole: binding } },
    };
    const manifest = {
      roleAssignments: [
        {
          role_id: "input_capability_evidence_file",
          assignment_id: assignmentId,
          artifact: { digest: artifactDigest },
        },
      ],
    };
    const metadata = (scientificSourceBindings: (typeof binding)[]) => ({
      scientificSourceBindings,
    });
    const validCatalog = {
      "b05-screen-construction-evidence-json": metadata([]),
      "b05-schoedel-validation-receipt-json": metadata([binding]),
      "foundational-semantics-receipt-json": metadata([binding]),
      "schoedel-reconstruction-evidence-json": metadata([binding]),
      "zero-duration-cleanup-evidence-json": metadata([]),
    };
    expect(() =>
      validateExecutedCapabilityBindings(
        arm as never,
        manifest as never,
        validCatalog as never,
      ),
    ).not.toThrow();
    expect(() =>
      validateExecutedCapabilityBindings(
        arm as never,
        manifest as never,
        {
          ...validCatalog,
          "schoedel-reconstruction-evidence-json": metadata([]),
        } as never,
      ),
    ).toThrow(/omits active capability binding/);
    expect(() =>
      validateExecutedCapabilityBindings(
        arm as never,
        manifest as never,
        {
          ...validCatalog,
          "b05-screen-construction-evidence-json": metadata([binding]),
        } as never,
      ),
    ).toThrow(/non-causal capability binding/);
    expect(() =>
      validateExecutedCapabilityBindings(
        arm as never,
        manifest as never,
        {
          ...validCatalog,
          "schoedel-reconstruction-evidence-json": metadata([
            { ...binding, assignmentId: `sha256:${"3".repeat(64)}` },
          ]),
        } as never,
      ),
    ).toThrow(/capability binding.*drifted/s);
    expect(() =>
      validateExecutedCapabilityBindings(
        arm as never,
        manifest as never,
        {
          ...validCatalog,
          "schoedel-reconstruction-evidence-json": metadata([
            { ...binding, artifactDigest: `sha256:${"4".repeat(64)}` },
          ]),
        } as never,
      ),
    ).toThrow(/capability binding.*drifted/s);
  });

  it("refuses before execute when an expected refusal becomes executable", () => {
    let executeCalls = 0;
    const execute = (): void => {
      executeCalls += 1;
    };
    const expected = {
      disposition: "refused",
      eyesDisposition: "not_applicable",
    };
    const observed = {
      disposition: "executable",
      eyesDisposition: "not_applicable",
    };
    expect(() => {
      assertPreflightBeforeExecution(
        "refusal-vector",
        "refused",
        expected as never,
        observed as never,
      );
      execute();
    }).toThrow(/preflight before execution drifted/);
    expect(executeCalls).toBe(0);
  });

  it("binds refused preflights to verified request options and partition count", () => {
    const inputDigest = `sha256:${"5".repeat(64)}`;
    const requestJson = JSON.stringify({ options: { exact: "vector" } });
    const optionsDigest = sha256('{"exact":"vector"}');
    const roleIdentity = (roleId: string, artifactDigest: string) => ({
      artifactDigest,
      assignmentId: sha256(
        ["assignment", roleId, artifactDigest].join("\u001f"),
      ),
    });
    const receipt = runtimeScientificPreflightFixture();
    receipt.key = {
      protocolVersion: "chronicle-runtime-scientific-preflight/v2",
      optionsDigest,
      inputDigest,
      inputSizeBytes: 91,
      activeIngressRoles: {
        processing_options: roleIdentity("processing_options", optionsDigest),
        raw_chronicle_csv: roleIdentity("raw_chronicle_csv", inputDigest),
      },
      fragmentedParticipantCount: 0,
      fragmentedParticipantTokenScopeDigest:
        "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    };
    receipt.b05Schoedel.optionsDigest = optionsDigest;
    receipt.b05Schoedel.optionsDigestOrigin = "verified_request_jcs";
    receipt.eyesInputPartition.optionsDigest = optionsDigest;
    receipt.eyesInputPartition.optionsDigestOrigin = "verified_request_jcs";
    receipt.eyesInputPartition.inputDigest = inputDigest;
    receipt.eyesInputPartition.fragmentedParticipantCount = 0;
    const closeReceipt = (candidate: typeof receipt): typeof receipt => {
      const closed = structuredClone(candidate);
      closed.keyDigest = sha256(canonicalJson(closed.key));
      closed.b05SchoedelDigest = sha256(canonicalJson(closed.b05Schoedel));
      closed.eyesInputPartitionDigest = sha256(
        canonicalJson(closed.eyesInputPartition),
      );
      closed.commitDigest = sha256(
        canonicalJson({
          protocolVersion: closed.protocolVersion,
          keyDigest: closed.keyDigest,
          b05SchoedelDigest: closed.b05SchoedelDigest,
          eyesInputPartitionDigest: closed.eyesInputPartitionDigest,
        }),
      );
      return closed;
    };
    const closedReceipt = closeReceipt(receipt);
    const validate = (candidate: typeof receipt) =>
      validatePreflightIdentity(
        { id: "refusal-vector" } as never,
        candidate,
        requestJson,
        { entry: { sha256: inputDigest }, bytes: new Uint8Array(91) } as never,
        undefined,
      );
    expect(() => validate(closedReceipt)).not.toThrow();
    expect(() =>
      validate(
        closeReceipt({
          ...closedReceipt,
          b05Schoedel: {
            ...closedReceipt.b05Schoedel,
            optionsDigestOrigin: "kernel_router_component",
          },
        }),
      ),
    ).toThrow(/digest closure drifted/);
    expect(() =>
      validate(
        closeReceipt({
          ...closedReceipt,
          eyesInputPartition: {
            ...closedReceipt.eyesInputPartition,
            optionsDigestOrigin: "kernel_component",
          },
        }),
      ),
    ).toThrow(/digest closure drifted/);
    expect(() =>
      validate(
        closeReceipt({
          ...closedReceipt,
          eyesInputPartition: {
            ...closedReceipt.eyesInputPartition,
            fragmentedParticipantCount: 1,
          },
        }),
      ),
    ).toThrow(/digest closure drifted/);
  });

  it("authenticates runtime evidence roots and certified dependency state", () => {
    const runtimeIdentity = {
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      implementationDigest: `sha256:${"a".repeat(64)}`,
      buildEnvironmentDigest: `sha256:${"b".repeat(64)}`,
      productContractDigest: `sha256:${"c".repeat(64)}`,
      planDigest: `sha256:${"d".repeat(64)}`,
      profileDigest: `sha256:${"e".repeat(64)}`,
      profileLockDigest: `sha256:${"f".repeat(64)}`,
      runtimeAuthorityDigest: `sha256:${"1".repeat(64)}`,
      dependencyCertificateDigest: `sha256:${"2".repeat(64)}`,
    };
    const journalDigest = `sha256:${"3".repeat(64)}`;
    const inputDigest = `sha256:${"4".repeat(64)}`;
    const optionsDigest = `sha256:${"5".repeat(64)}`;
    const metadata = (
      kind: string,
      digest: string,
      mediaType = "application/json",
      derivedFrom: string[] = [],
    ): RuntimeArtifactMetadata => ({
      artifactId: `urn:chronicle:artifact:${kind}:${digest.slice(7)}`,
      kind,
      mediaType,
      digest,
      size: 1,
      derivedFrom,
    });
    const artifacts = [
      metadata("evidence-journal", journalDigest, "application/cbor", [
        inputDigest,
        optionsDigest,
      ]),
      metadata("chronicle-plan-json", runtimeIdentity.planDigest),
      metadata(
        "dependency-certificate-json",
        runtimeIdentity.dependencyCertificateDigest,
      ),
      metadata(
        "runtime-authority-json",
        runtimeIdentity.runtimeAuthorityDigest,
      ),
      metadata("semantic-profile-json", runtimeIdentity.profileDigest),
      metadata("semantic-profile-lock-json", runtimeIdentity.profileLockDigest),
    ];
    const manifest = {
      input: { digest: inputDigest },
      journalDigest,
      optionsDigest,
      productContractDigest: runtimeIdentity.productContractDigest,
    };
    expect(() =>
      validateRuntimeEvidenceRoots(
        "executed-arm",
        manifest as never,
        artifacts,
        runtimeIdentity,
      ),
    ).not.toThrow();
    expect(() =>
      validateRuntimeEvidenceRoots(
        "executed-arm",
        manifest as never,
        artifacts.filter(({ kind }) => kind !== "evidence-journal"),
        runtimeIdentity,
      ),
    ).toThrow(/evidence root evidence-journal is absent/);
    expect(() =>
      validateRuntimeEvidenceRoots(
        "executed-arm",
        manifest as never,
        artifacts.map((artifact) =>
          artifact.kind === "dependency-certificate-json"
            ? { ...artifact, kind: "foreign-certificate-json" }
            : artifact,
        ),
        runtimeIdentity,
      ),
    ).toThrow(/evidence root dependency-certificate-json is absent/);
    expect(() =>
      validateRuntimeEvidenceRoots(
        "executed-arm",
        manifest as never,
        artifacts.map((artifact) =>
          artifact.kind === "chronicle-plan-json"
            ? { ...artifact, digest: `sha256:${"0".repeat(64)}` }
            : artifact,
        ),
        runtimeIdentity,
      ),
    ).toThrow(/runtime evidence root chronicle-plan-json.*drifted/s);
    for (const derivedFrom of [
      [inputDigest],
      [inputDigest, optionsDigest, journalDigest],
      [optionsDigest, inputDigest],
    ]) {
      expect(() =>
        validateRuntimeEvidenceRoots(
          "executed-arm",
          manifest as never,
          artifacts.map((artifact) =>
            artifact.kind === "evidence-journal"
              ? { ...artifact, derivedFrom }
              : artifact,
          ),
          runtimeIdentity,
        ),
      ).toThrow(/runtime evidence root evidence-journal.*drifted/s);
    }

    const decision = {
      mode: "certified_narrow",
      certificate_digest: runtimeIdentity.dependencyCertificateDigest,
      binding_surface_digest: `sha256:${"6".repeat(64)}`,
      empirical_evidence_current: true,
      reasons: ["dependency_surface_structurally_certified"],
    };
    expect(() =>
      validateCertifiedDependencyDecision(
        "executed-arm",
        decision as never,
        runtimeIdentity,
      ),
    ).not.toThrow();
    expect(() =>
      validateCertifiedDependencyDecision(
        "executed-arm",
        { ...decision, empirical_evidence_current: false } as never,
        runtimeIdentity,
      ),
    ).toThrow(/certified dependency decision.*drifted/s);
    expect(() =>
      validateCertifiedDependencyDecision(
        "executed-arm",
        { ...decision, reasons: [...decision.reasons, "stale"] } as never,
        runtimeIdentity,
      ),
    ).toThrow(/certified dependency decision.*drifted/s);
  });

  it("authenticates the complete execution envelope and runtime identity", () => {
    const workspaceId = `sha256:${"8".repeat(64)}`;
    const requestJson = JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      requestId: "proof:inactive-foundational",
      command: "ExecuteWorkspace",
      workspaceId,
      workspaceRootDigest: null,
      inputSha256: `sha256:${"5".repeat(64)}`,
      options: { exact: "vector" },
    });
    const optionsDigest = sha256('{"exact":"vector"}');
    const processingAssignmentId = sha256(
      ["assignment", "processing_options", optionsDigest].join("\u001f"),
    );
    const rawDigest = `sha256:${"5".repeat(64)}`;
    const rawAssignmentId = sha256(
      ["assignment", "raw_chronicle_csv", rawDigest].join("\u001f"),
    );
    const fixture = { sha256: rawDigest, size: 123 };
    const artifact = (
      roleId: string,
      digest: string,
      mediaType: string,
      size: number,
    ) => ({
      artifact_id: `urn:chronicle:artifact:${roleId}:${digest.slice(7)}`,
      digest,
      media_type: mediaType,
      size,
      derived_from: [],
      qualifiers: {},
    });
    const rawArtifact = artifact(
      "raw_chronicle_csv",
      rawDigest,
      "text/csv",
      fixture.size,
    );
    const optionsArtifact = artifact(
      "processing_options",
      optionsDigest,
      "application/json",
      new TextEncoder().encode('{"exact":"vector"}').byteLength,
    );
    const runtimeIdentity = {
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      implementationDigest: `sha256:${"a".repeat(64)}`,
      buildEnvironmentDigest: `sha256:${"b".repeat(64)}`,
      productContractDigest: `sha256:${"c".repeat(64)}`,
      planDigest: `sha256:${"d".repeat(64)}`,
      profileDigest: `sha256:${"e".repeat(64)}`,
      profileLockDigest: `sha256:${"f".repeat(64)}`,
      runtimeAuthorityDigest: `sha256:${"1".repeat(64)}`,
      dependencyCertificateDigest: `sha256:${"2".repeat(64)}`,
    };
    const manifest = {
      protocolVersion: runtimeIdentity.protocolVersion,
      requestId: "proof:inactive-foundational",
      command: "ExecuteWorkspace",
      workspaceId,
      previousWorkspaceRootDigest: null,
      implementation: "chronicle_preprocessing_runtime_wasm/0.1.0",
      scope: "selected-runtime-csv-artifacts",
      implementationDigest: runtimeIdentity.implementationDigest,
      buildEnvironmentDigest: runtimeIdentity.buildEnvironmentDigest,
      productContractDigest: runtimeIdentity.productContractDigest,
      planDigest: runtimeIdentity.planDigest,
      profileDigest: runtimeIdentity.profileDigest,
      profileLockDigest: runtimeIdentity.profileLockDigest,
      runtimeAuthorityDigest: runtimeIdentity.runtimeAuthorityDigest,
      dependencyCertificateDigest: runtimeIdentity.dependencyCertificateDigest,
      optionsDigest,
      input: rawArtifact,
      roleAssignments: [
        {
          role_id: "processing_options",
          assignment_id: processingAssignmentId,
          artifact: optionsArtifact,
          qualifiers: {},
          revision: 2,
        },
        {
          role_id: "raw_chronicle_csv",
          assignment_id: rawAssignmentId,
          artifact: rawArtifact,
          qualifiers: {},
          revision: 1,
        },
      ],
    };
    expect(
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        manifest as never,
        runtimeIdentity,
      ),
    ).toBe(optionsDigest);
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        { ...manifest, optionsDigest: `sha256:${"0".repeat(64)}` } as never,
        runtimeIdentity,
      ),
    ).toThrow(/manifest options digest.*drifted/s);
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        { ...manifest, input: { ...rawArtifact, size: 122 } } as never,
        runtimeIdentity,
      ),
    ).toThrow(/manifest input.*drifted/s);
    for (const role of ["processing_options", "raw_chronicle_csv"]) {
      expect(() =>
        validateExecutionEnvelopeIdentity(
          "inactive-foundational",
          requestJson,
          fixture,
          {
            ...manifest,
            roleAssignments: manifest.roleAssignments.filter(
              ({ role_id: roleId }) => roleId !== role,
            ),
          } as never,
          runtimeIdentity,
        ),
      ).toThrow(/execution envelope identity drifted/);
    }
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        {
          ...manifest,
          roleAssignments: [
            ...manifest.roleAssignments,
            structuredClone(manifest.roleAssignments[0]!),
          ],
        } as never,
        runtimeIdentity,
      ),
    ).toThrow(/execution envelope identity drifted/);
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        {
          ...manifest,
          input: {
            ...rawArtifact,
            digest: `sha256:${"6".repeat(64)}`,
          },
        } as never,
        runtimeIdentity,
      ),
    ).toThrow(/manifest input.*drifted/s);
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        {
          ...manifest,
          roleAssignments: manifest.roleAssignments.map((assignment) =>
            assignment.role_id === "raw_chronicle_csv"
              ? { ...assignment, assignment_id: `sha256:${"7".repeat(64)}` }
              : assignment,
          ),
        } as never,
        runtimeIdentity,
      ),
    ).toThrow(/raw assignment.*drifted/s);
    for (const mutated of [
      { artifact: { ...rawArtifact, media_type: "application/json" } },
      { artifact: { ...rawArtifact, artifact_id: "urn:foreign" } },
      { artifact: { ...rawArtifact, derived_from: [optionsDigest] } },
      { artifact: { ...rawArtifact, qualifiers: { foreign: "true" } } },
      { qualifiers: { foreign: "true" } },
      { revision: 9 },
    ]) {
      expect(() =>
        validateExecutionEnvelopeIdentity(
          "inactive-foundational",
          requestJson,
          fixture,
          {
            ...manifest,
            roleAssignments: manifest.roleAssignments.map((assignment) =>
              assignment.role_id === "raw_chronicle_csv"
                ? { ...assignment, ...mutated }
                : assignment,
            ),
          } as never,
          runtimeIdentity,
        ),
      ).toThrow(/raw assignment.*drifted/s);
    }
    for (const mutated of [
      { artifact: { ...optionsArtifact, media_type: "text/plain" } },
      { artifact: { ...optionsArtifact, size: optionsArtifact.size + 1 } },
      { qualifiers: { foreign: "true" } },
      { revision: 1 },
    ]) {
      expect(() =>
        validateExecutionEnvelopeIdentity(
          "inactive-foundational",
          requestJson,
          fixture,
          {
            ...manifest,
            roleAssignments: manifest.roleAssignments.map((assignment) =>
              assignment.role_id === "processing_options"
                ? { ...assignment, ...mutated }
                : assignment,
            ),
          } as never,
          runtimeIdentity,
        ),
      ).toThrow(/processing assignment.*drifted/s);
    }
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        { ...manifest, requestId: "proof:foreign" } as never,
        runtimeIdentity,
      ),
    ).toThrow(/manifest request envelope.*drifted/s);
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        { ...manifest, workspaceId: `sha256:${"4".repeat(64)}` } as never,
        runtimeIdentity,
      ),
    ).toThrow(/manifest request envelope.*drifted/s);
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        {
          ...manifest,
          previousWorkspaceRootDigest: `sha256:${"9".repeat(64)}`,
        } as never,
        runtimeIdentity,
      ),
    ).toThrow(/manifest request envelope.*drifted/s);
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        {
          ...manifest,
          dependencyCertificateDigest: `sha256:${"3".repeat(64)}`,
        } as never,
        runtimeIdentity,
      ),
    ).toThrow(/manifest runtime identity.*drifted/s);
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson,
        fixture,
        {
          ...manifest,
          profileLockDigest: `sha256:${"3".repeat(64)}`,
        } as never,
        runtimeIdentity,
      ),
    ).toThrow(/manifest runtime identity.*drifted/s);
    expect(() =>
      validateExecutionEnvelopeIdentity(
        "inactive-foundational",
        requestJson.replace(rawDigest, `sha256:${"6".repeat(64)}`),
        fixture,
        manifest as never,
        runtimeIdentity,
      ),
    ).toThrow(/request input digest.*drifted/s);
  });
});
