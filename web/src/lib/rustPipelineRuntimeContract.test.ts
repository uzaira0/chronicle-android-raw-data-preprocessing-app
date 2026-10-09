import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { suppliedCommunicationCsv } from "../../e2e/fixtures/ringer-state-interval";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { canonicalJson } from "@/lib/canonicalJson";
import { createSleepDiaryMethodProfileReceipt } from "@/lib/sleepDiaryReplication";
import type { BrowserProcessingOptions, MethodProfileReceipt } from "@/lib/types";
import {
  WORKFLOW_QUERY_GROUP_IDS,
  WORKFLOW_QUERY_IDS,
} from "@/lib/generatedInteractionTypes";
import { RUNTIME_BOUNDARY_MODEL } from "@/lib/generatedRuntimeBoundary";
import {
  decodeReviewRuntimeManifest,
  decodeRuntimeManifest,
  executeRustRuntime,
  queryPersistedRustReview,
  rustWasmMemoryBytes,
  queryRustReview,
  setRustPersistenceForTesting,
  setRustRuntimeForTesting,
  verifyRuntimeArtifactCatalog,
  type OpenerSetPreflightDecision,
  type RuntimeManifest,
} from "@/lib/rustPipelineRuntime";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

let manifest: RuntimeManifest;
let fullArtifacts: Map<string, Uint8Array>;
let reviewManifest: Record<string, unknown>;
let reviewSummaryBytes: Uint8Array;
let reviewArtifactBytes: Map<string, Uint8Array>;

function reviewSourceFixture(): Uint8Array {
  return new TextEncoder().encode(
    [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Review,P99,Target Child,Example,Activity Resumed,example.app,2026-03-08 10:00:00,America/Chicago",
      "Review,P99,Target Child,Example,Activity Paused,example.app,2026-03-08 10:01:00,America/Chicago",
    ].join("\n"),
  );
}

function reviewOptions() {
  return {
    ...DEFAULT_BROWSER_OPTIONS,
    studyName: "Review contract proof",
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-convert" as const,
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
    processScreenUsage: false,
    enablePlotting: false,
  };
}

const REVIEW_RUNTIME = {
  datetimeOfPreprocessing: "2026-07-26 00:00:00 UTC",
  persistRustWorkspace: false,
  incrementalEngine: true,
  provenanceEvidence: true,
} as const;

function fullSourceFixture(): Uint8Array {
  return new TextEncoder().encode(
    [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,Example,Unknown importance: 1,example.app,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Example,Unknown importance: 2,example.app,2026-03-07 10:01:00,America/Chicago",
    ].join("\n"),
  );
}

function continuationDisplacementFixture(): Uint8Array {
  return new TextEncoder().encode(
    new TextDecoder().decode(reviewSourceFixture()).replaceAll("P99", "P98"),
  );
}

function fullOptions() {
  return {
    ...DEFAULT_BROWSER_OPTIONS,
    studyName: "Runtime Contract Proof",
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-convert" as const,
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
    processScreenUsage: false,
    enablePlotting: false,
  };
}

const FULL_RUNTIME = {
  datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
  persistRustWorkspace: false,
  incrementalEngine: true,
  provenanceEvidence: true,
} as const;

class MemoryFileHandle {
  readonly kind = "file" as const;
  bytes = new Uint8Array();

  getFile(): Promise<File> {
    return Promise.resolve(new File([this.bytes], "object"));
  }

  createWritable(): Promise<FileSystemWritableFileStream> {
    let pending = new Uint8Array();
    return Promise.resolve({
      write(data: FileSystemWriteChunkType) {
        if (data instanceof Uint8Array) pending = Uint8Array.from(data);
        else if (data instanceof ArrayBuffer) pending = new Uint8Array(data);
        else throw new Error("unsupported test write");
        return Promise.resolve();
      },
      close: () => {
        this.bytes = pending;
        return Promise.resolve();
      },
    } as FileSystemWritableFileStream);
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory" as const;
  readonly directories = new Map<string, MemoryDirectoryHandle>();
  readonly files = new Map<string, MemoryFileHandle>();

  getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle> {
    let directory = this.directories.get(name);
    if (!directory && options?.create) {
      directory = new MemoryDirectoryHandle();
      this.directories.set(name, directory);
    }
    if (!directory) throw new DOMException("missing", "NotFoundError");
    return Promise.resolve(directory as unknown as FileSystemDirectoryHandle);
  }

  getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileSystemFileHandle> {
    let file = this.files.get(name);
    if (!file && options?.create) {
      file = new MemoryFileHandle();
      this.files.set(name, file);
    }
    if (!file) throw new DOMException("missing", "NotFoundError");
    return Promise.resolve(file as unknown as FileSystemFileHandle);
  }

  removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException("missing", "NotFoundError");
    }
    return Promise.resolve();
  }

  async *entries(): AsyncIterableIterator<
    [string, FileSystemFileHandle | FileSystemDirectoryHandle]
  > {
    await Promise.resolve();
    for (const [name, directory] of this.directories) {
      yield [name, directory as unknown as FileSystemDirectoryHandle];
    }
    for (const [name, file] of this.files) {
      yield [name, file as unknown as FileSystemFileHandle];
    }
  }
}

function memoryOpfsRoot(
  root: MemoryDirectoryHandle,
): FileSystemDirectoryHandle {
  return root as unknown as FileSystemDirectoryHandle;
}

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

function firstKey(value: Record<string, unknown>): string {
  const key = Object.keys(value)[0];
  if (key === undefined) throw new Error("fixture object has no keys");
  return key;
}

// Sizes and counts of the correspondence artifacts on the 600-event fixture
// below. `docs/semantic-federation/production-proof.md` and
// `final-review-matrix.md` publish these exact numbers, so they are pinned here
// rather than left to generous upper bounds — the witness schema change to v3
// moved its byte size and nothing failed, because a 262,144-byte ceiling
// happily accommodates any drift a reader would care about.
// `match_app_episodes` declares three row-field reads and a second query input
// since eyes_complement was bound to the reconstruction seam, which adds one
// source coordinate; `suppress_excluded_timing` then declared the six row
// fields culverhouse_trim_and_log reads, which adds one more. The B02 opener-set
// receipt contributes one further source-coordinate dependency, and the B07
// screen_gating_rule read on `credit.intersect_evidence` one more (4,895 ->
// 4,896), and the B14 day_boundary_attribution read on
// `assessment.divide_sessions_at_day_boundary` one more again (4,896 ->
// 4,897), and the participant-amount-summary `shape/rows` cell binding on
// `publish.build_participant_amount_summary` one more again (4,905 ->
// 4,906). The T22 `/interval_expansion_method` processing-option read adds
// one final source coordinate (4,906 -> 4,907). Result-cell counts are
// unchanged.
// 4,907 -> 4,916 for the nine processing-option reads this branch declares in
// `query_request_fields`: `aggregate_top_apps_limit`,
// `application_label_exclusions`, `filter_match_field`,
// `drop_out_of_source_order_events`, `interaction_type_removal_mode`,
// `screen_session_classification_policy`,
// `screen_session_maximum_duration_minutes`,
// `screen_session_maximum_duration_disposition`, and
// `locked_screen_audio_disposition`. Each one was measured to contribute
// exactly one coordinate: omitting any single key from this fixture's options
// object drops the count to 4,915. `query_field_reads` and
// `query_field_writes` are unchanged, so no row-field coordinate moved and the
// result-cell counts stay at 10,202.
const EXPECTED_SOURCE_COORDINATE_ROWS = 4_916;
const EXPECTED_SOURCE_COORDINATE_BYTES = 39_082;
// `app_usage_end_reason` ships on by default, so every app-usage row now
// carries one more cell to correspond: 9,902 + 300 rows on this fixture.
const EXPECTED_RESULT_CELL_ROWS = 10_202;
// Remeasured from standards-native decoding after the WASM IPC prefix repair.
const EXPECTED_RESULT_CELL_BYTES = 46_514;
// The policy-neutral matcher carve removed one obsolete dependency witness;
// binding eyes_complement to the reconstruction seam then added the new
// option's bindings, and binding culverhouse_trim_and_log to the
// interval-quality seam added its option binding plus the row fields
// `suppress_excluded_timing` now declares. Adding the opt-in
// `app_usage_end_reason` column then bound its option and the field
// `materialize_candidate_episodes` newly declares as written. The exact
// pre-B02 assertion was 1,026 rows in 66,746 bytes; the B02 opener-set option
// and receipt add eleven rows and 384 bytes. 70,266 → 70,330 bytes with the
// row count unchanged at 1,128 when `materialize_visualization_data` moved to
// the artifact-only request fields (c3d723e): the rows are identical apart
// from the `outputs` checkpoint terminal digest and the per-row evidence
// hashes, which bind the implementation digest, and the LZ4 frame that
// carries those hashes packs 64 bytes differently (verified by decoding both
// witnesses row by row). 70,330 → 70,266 again when the B06 maximum-duration
// axis changed the implementation digest: the fixture omits every B06 key,
// so no B06 option scope is bound and the row count stays 1,128; only the
// digest-bound hashes differ and the LZ4 frame packs back to the smaller
// size. Keep both current values exact because the published proof
// documents cite them. 1,128 -> 1,131 for B07: unlike the B06 vector, the
// `screen_gating_rule` key is always present on the wire, so its option scope
// really is bound on this fixture. 1,131 -> 1,135 for B14, which binds both
// the always-present `day_boundary_attribution` key and the new
// `divide_sessions_at_day_boundary` query it is read on. 1,274 -> 1,276 for
// the participant-amount summary: the always-present
// `enable_participant_amount_summary` key binds its option scope on this
// fixture, and the kind's cell bindings (including `shape/rows`) add their
// declared column scope. T22 then adds exactly two
// `/interval_expansion_method` rows: an App-CSV `cell-contribution-unresolved`
// row and an outputs-checkpoint `may-affect-checkpoint` row. Their identities
// are asserted in the native binary-export test; they move the exact witness
// from 1,276 rows / 76,026 bytes to 1,278 rows / 76,282 bytes. 1,278 -> 1,392
// for the same nine new processing-option reads as the source-coordinate bound
// above: every one of them is present on this fixture's wire options, so each
// binds its declared column scope. Measured per key by omitting it from this
// fixture's options object: `aggregate_top_apps_limit` 2,
// `interaction_type_removal_mode` 10, `drop_out_of_source_order_events` 18,
// and 14 each for `application_label_exclusions`, `filter_match_field`,
// `screen_session_classification_policy`,
// `screen_session_maximum_duration_minutes`,
// `screen_session_maximum_duration_disposition`, and
// `locked_screen_audio_disposition` — 114 rows in total, which is exactly the
// whole delta.
// Incoming output-only timestamp ownership removes exactly sixteen upstream
// processing-option checkpoint claims, not raw-row lineage: 1,392 -> 1,376.
// The decoded current witness has only the outputs timestamp checkpoint and
// its unchanged app-csv unresolved scope; native assertions pin both tuples.
// Byte size is independently measured after the standards-valid IPC repair.
const EXPECTED_INFLUENCE_WITNESS_ROWS = 1_376;
const EXPECTED_INFLUENCE_WITNESS_BYTES = 79_738;

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

type FakeReviewRuntimeOptions = {
  manifestJson?: string;
  mutateManifest?: (candidate: Record<string, unknown>) => void;
  preflightDecision?: Partial<OpenerSetPreflightDecision>;
  artifactCount?: number;
  mutateMetadata?: (
    candidate: Record<string, unknown>,
    index: number,
  ) => void;
  artifactMetadataJson?: (
    index: number,
    metadata: Record<string, unknown>,
  ) => string;
  artifactBytes?: Uint8Array;
  artifactBytesByKind?: ReadonlyMap<string, Uint8Array>;
  mutateArtifactBytes?: (
    kind: string,
    bytes: Uint8Array,
    index: number,
  ) => Uint8Array;
  onTakeArtifactBytes?: (kind: string, bytes: Uint8Array) => void;
  handleFreeError?: Error;
  supportFreeError?: Error;
};

const REVIEW_SCIENTIFIC_DIGEST_FIELD_BY_KIND = {
  "foundational-semantics-receipt-json":
    "foundationalSemanticsArtifactDigest",
  "minimum-duration-excluded-lineage-json":
    "minimumDurationExcludedLineageArtifactDigest",
  "zero-duration-cleanup-evidence-json":
    "zeroDurationCleanupEvidenceArtifactDigest",
  "zero-duration-removed-lineage-json":
    "zeroDurationRemovedLineageArtifactDigest",
  "b05-screen-construction-evidence-json":
    "b05ScreenConstructionArtifactDigest",
  "schoedel-reconstruction-evidence-json":
    "schoedelReconstructionArtifactDigest",
  "b05-schoedel-validation-receipt-json":
    "b05SchoedelValidationReceiptArtifactDigest",
  "eyes-tagged-fau-validation-receipt-json":
    "eyesTaggedFauValidationReceiptArtifactDigest",
} as const;

async function testSha256Digest(bytes: Uint8Array): Promise<string> {
  const owned =
    bytes.buffer instanceof ArrayBuffer
      ? (bytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function setReviewArtifactDigestClaim(
  candidate: Record<string, unknown>,
  kind: string,
  digest: string,
): void {
  if (kind === "review-summary-json") {
    candidate.reviewSummaryDigest = digest;
    return;
  }
  const eyes = record(candidate.eyesEvidence);
  if (kind === "eyes-tagged-fau-evidence-json") {
    eyes.taggedFauArtifactDigest = digest;
    return;
  }
  if (kind === "eyes-tagged-fau-validation-receipt-json") {
    eyes.validationReceiptArtifactDigest = digest;
  }
  const field =
    REVIEW_SCIENTIFIC_DIGEST_FIELD_BY_KIND[
      kind as keyof typeof REVIEW_SCIENTIFIC_DIGEST_FIELD_BY_KIND
    ];
  if (field) record(candidate.scientificEvidence)[field] = digest;
}

async function normalizedReviewFixture(
  manifestJson: string,
  summaryBytes: Uint8Array,
): Promise<{
  manifest: Record<string, unknown>;
  manifestJson: string;
  bytes: Map<string, Uint8Array>;
}> {
  const candidate = JSON.parse(manifestJson) as Record<string, unknown>;
  const metadata = array(candidate.artifacts).map(record);
  const bytes = new Map<string, Uint8Array>();
  for (const entry of metadata) {
    const kind = String(entry.kind);
    const artifactBytes =
      kind === "review-summary-json"
        ? Uint8Array.from(summaryBytes)
        : new TextEncoder().encode(
            JSON.stringify({ fixture: "review-scientific-sidecar", kind }),
          );
    const digest = await testSha256Digest(artifactBytes);
    entry.digest = digest;
    entry.size = artifactBytes.byteLength;
    setReviewArtifactDigestClaim(candidate, kind, digest);
    bytes.set(kind, artifactBytes);
  }
  const scientificKinds = metadata.filter(
    ({ kind }) => kind !== "review-summary-json",
  );
  if (scientificKinds.length < 2) {
    throw new Error("review fixture must expose nonvacuous scientific sidecars");
  }
  return { manifest: candidate, manifestJson: JSON.stringify(candidate), bytes };
}

function reusedReviewFixture(): {
  manifest: Record<string, unknown>;
  manifestJson: string;
  bytes: Map<string, Uint8Array>;
} {
  const candidate = structuredClone(reviewManifest);
  candidate.reviewSummaryReused = true;
  candidate.artifacts = array(candidate.artifacts).filter(
    (value) => record(value).kind !== "review-summary-json",
  );
  const bytes = new Map(reviewArtifactBytes);
  bytes.delete("review-summary-json");
  return { manifest: candidate, manifestJson: JSON.stringify(candidate), bytes };
}

type ReviewHandleFixture = {
  manifestJson: string;
  metadata: Record<string, unknown>[];
  bytes: Map<string, Uint8Array>;
};

function reviewHandleFixtureForExecution(
  execution: {
    manifestJson: string;
    reviewSummaryDigest: string;
    reviewSummaryJsonBytes?: Uint8Array;
  },
  reused = false,
): ReviewHandleFixture {
  const candidate = JSON.parse(execution.manifestJson) as Record<
    string,
    unknown
  >;
  candidate.eyesEvidence = structuredClone(reviewManifest.eyesEvidence);
  candidate.scientificEvidence = structuredClone(
    reviewManifest.scientificEvidence,
  );
  const metadata = array(reviewManifest.artifacts)
    .map((value) => structuredClone(record(value)))
    .filter(({ kind }) => kind !== "review-summary-json");
  const bytes = new Map<string, Uint8Array>();
  for (const entry of metadata) {
    const kind = String(entry.kind);
    const source = reviewArtifactBytes.get(kind);
    if (!source) throw new Error(`missing review sidecar fixture: ${kind}`);
    bytes.set(kind, source);
  }
  if (!reused) {
    const summaryBytes = execution.reviewSummaryJsonBytes;
    if (!summaryBytes) throw new Error("cold review fixture has no summary bytes");
    const summaryMetadata = structuredClone(
      array(reviewManifest.artifacts)
        .map(record)
        .find(({ kind }) => kind === "review-summary-json"),
    );
    if (!summaryMetadata) throw new Error("review fixture has no summary metadata");
    summaryMetadata.digest = execution.reviewSummaryDigest;
    summaryMetadata.size = summaryBytes.byteLength;
    metadata.unshift(summaryMetadata);
    bytes.set("review-summary-json", summaryBytes);
  }
  candidate.artifacts = metadata;
  candidate.reviewSummaryReused = reused;
  return { manifestJson: JSON.stringify(candidate), metadata, bytes };
}

function kernelHandleFromReviewFixture(
  fixture: ReviewHandleFixture,
  free: () => void = () => undefined,
  artifactCount = fixture.metadata.length,
) {
  return {
    artifact_count: artifactCount,
    manifest_json: () => fixture.manifestJson,
    artifact_metadata_json: (index: number) => {
      const metadata = fixture.metadata[index];
      if (!metadata) throw new Error(`no review metadata at index ${index}`);
      return JSON.stringify(metadata);
    },
    take_artifact_bytes: (index: number) => {
      const kind = String(fixture.metadata[index]?.kind);
      const bytes = fixture.bytes.get(kind);
      if (!bytes) throw new Error(`missing review artifact bytes for ${kind}`);
      return Uint8Array.from(bytes);
    },
    free,
  };
}

function openerSetPreflightJson(
  requestJson: string,
  optionsDigest: string,
  override: Partial<OpenerSetPreflightDecision> = {},
): string {
  const request = JSON.parse(requestJson) as {
    options?: { opener_set?: unknown };
  };
  const requested = request.options?.opener_set;
  if (typeof requested !== "string") {
    throw new Error("fake runtime request has no opener_set");
  }
  return JSON.stringify({
    status: "executable",
    requestedOpenerSetId: requested,
    resolvedOpenerSetId: requested,
    effectiveOpenerSetId: requested,
    relation: "baseline_native",
    reasonCode: null,
    optionsDigest,
    ...override,
  } satisfies OpenerSetPreflightDecision);
}

function installFakeReviewRuntime({
  manifestJson,
  mutateManifest,
  preflightDecision,
  artifactCount,
  mutateMetadata,
  artifactMetadataJson,
  artifactBytes = reviewSummaryBytes,
  artifactBytesByKind = reviewArtifactBytes,
  mutateArtifactBytes,
  onTakeArtifactBytes,
  handleFreeError,
  supportFreeError,
}: FakeReviewRuntimeOptions = {}) {
  const candidate = structuredClone(reviewManifest);
  mutateManifest?.(candidate);
  const metadata = array(candidate.artifacts).map((value, index) => {
    const entry = structuredClone(record(value));
    if (index === 0) mutateMetadata?.(entry, index);
    return entry;
  });
  const handleFree = vi.fn(() => {
    if (handleFreeError) throw handleFreeError;
  });
  const supportFree = vi.fn(() => {
    if (supportFreeError) throw supportFreeError;
  });
  const preflight = vi.fn((requestJson: string) =>
    openerSetPreflightJson(
      requestJson,
      String(reviewManifest.optionsDigest),
      preflightDecision,
    ),
  );
  const executeWorkspace = vi.fn(() => ({
    artifact_count: artifactCount ?? metadata.length,
    manifest_json: () => manifestJson ?? JSON.stringify(candidate),
    artifact_metadata_json: (index: number) => {
      const entry = metadata[index];
      if (!entry) throw new Error(`no review metadata at index ${index}`);
      return artifactMetadataJson?.(index, entry) ?? JSON.stringify(entry);
    },
    take_artifact_bytes: (index: number) => {
      const kind = String(metadata[index]?.kind);
      const source =
        kind === "review-summary-json"
          ? artifactBytes
          : artifactBytesByKind.get(kind);
      if (!source) throw new Error(`missing review fixture bytes for ${kind}`);
      const owned = Uint8Array.from(source);
      const result = mutateArtifactBytes?.(kind, owned, index) ?? owned;
      onTakeArtifactBytes?.(kind, result);
      return result;
    },
    free: handleFree,
  }));
  const fakeRuntime = {
    implementation_build_digest: () => reviewManifest.implementationDigest,
    build_environment_digest: () => reviewManifest.buildEnvironmentDigest,
    RuntimeSupportFiles: class {
      put() {}
      put_with_name() {}
      free() {
        supportFree();
      }
    },
    opener_set_applicability_json: preflight,
    execute_workspace: executeWorkspace,
  } as unknown as Parameters<typeof setRustRuntimeForTesting>[0];
  setRustRuntimeForTesting(fakeRuntime);
  return { executeWorkspace, handleFree, preflight, supportFree };
}

async function expectFakeReviewFailure(
  options: FakeReviewRuntimeOptions,
  expected: RegExp,
  runtimeOverride: Record<string, unknown> = {},
): Promise<void> {
  installFakeReviewRuntime(options);
  try {
    await expect(
      queryRustReview(
        reviewSourceFixture(),
        "review-contract.csv",
        reviewOptions(),
        undefined,
        { ...REVIEW_RUNTIME, ...runtimeOverride },
      ),
    ).rejects.toThrow(expected);
  } finally {
    setRustRuntimeForTesting(runtimeWasm);
  }
}

/** The four B06 keys that together make a maximum-duration request explicit. */
const EXPLICIT_B06_OPTIONS = {
  maximumDurationPolicy: "post_reconstruction_strict_max_v1",
  maximumDurationDisposition: "truncate_to_threshold",
  maximumDurationThresholdSource: "fixed_parameter",
  maximumDurationThresholdNs: "21600000000000",
} as const satisfies Partial<BrowserProcessingOptions>;

function maximumDurationApplicabilityFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    protocolVersion: "chronicle-maximum-duration/v1",
    shape: "explicit_generic_fixed",
    requestedPolicy: "post_reconstruction_strict_max_v1",
    effectivePolicy: "post_reconstruction_strict_max_v1",
    disposition: "truncate_to_threshold",
    thresholdSource: "fixed_parameter",
    thresholdNs: "21600000000000",
    relation: "controlled_derivative",
    refusalReason: null,
    b06EffectiveStage: "post_reconstruction",
    reconstructionNativeStage: "post_reconstruction",
    checkedI128Preflight: null,
    legacyThresholdHoursCanonical: null,
    legacyThresholdNsCanonical: null,
    legacyOrigin: "absent",
    ...overrides,
  };
}

function explicitMaximumDurationJson(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    status: "executable",
    applicability: maximumDurationApplicabilityFixture(),
    reasonCode: null,
    optionsDigest: manifest.optionsDigest,
    ...overrides,
  });
}

function maximumDurationReceiptFixture(
  applicabilityOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    protocolVersion: "chronicle-maximum-duration/v1",
    applicability: maximumDurationApplicabilityFixture(applicabilityOverrides),
    checkpoint: "post_reconstruction",
    boundedEpisodeCount: 0,
    unboundedEpisodeCount: 0,
    qualifyingCount: 0,
    outcomeCounts: {},
    rawDurationTotalNs: "0",
    effectiveDurationTotalNs: "0",
    trimmedTotalNs: "0",
    droppedRawTotalNs: "0",
    headlineCreditedTotalNs: "0",
    excludedLineageDigest: `sha256:${"a".repeat(64)}`,
  };
}

type FakeFullRuntimeOptions = {
  mutateManifest?: (candidate: RuntimeManifest) => void;
  preflightDecision?: Partial<OpenerSetPreflightDecision>;
  artifactMetadataJson?: (
    index: number,
    metadata: RuntimeManifest["artifacts"][number],
  ) => string;
  mutateArtifactBytes?: (kind: string, bytes: Uint8Array) => Uint8Array;
  /** Answer the B06 preflight so an explicit request reaches execution. */
  maximumDurationApplicabilityJson?: () => string;
  browserOptions?: Partial<BrowserProcessingOptions>;
};

function installFakeFullRuntime({
  mutateManifest,
  preflightDecision,
  artifactMetadataJson,
  mutateArtifactBytes,
  maximumDurationApplicabilityJson,
}: FakeFullRuntimeOptions = {}) {
  // The recorded fixture manifest was captured on a cold run, so it declares
  // `previousWorkspaceRootDigest: null`. Earlier runs in this file leave an
  // ephemeral workspace continuation behind, which would make the runtime
  // expect that continuation's root and trip the previous-root identity check
  // before the boundary check each case is actually about. Reset the
  // persistence seam so the fake manifest's previous-root identity is the true
  // one for this run.
  setRustPersistenceForTesting(null);
  const candidate = cloneManifest();
  mutateManifest?.(candidate);
  const metadata = structuredClone(candidate.artifacts);
  const preflight = vi.fn((requestJson: string) =>
    openerSetPreflightJson(
      requestJson,
      manifest.optionsDigest,
      preflightDecision,
    ),
  );
  const executeWorkspace = vi.fn(() => ({
    artifact_count: metadata.length,
    manifest_json: () => JSON.stringify(candidate),
    artifact_metadata_json: (index: number) => {
      const entry = metadata[index];
      if (entry === undefined) throw new Error(`no fixture metadata at index ${index}`);
      return artifactMetadataJson?.(index, entry) ?? JSON.stringify(entry);
    },
    take_artifact_bytes: (index: number) => {
      const kind = metadata[index]?.kind;
      if (kind === undefined) throw new Error(`no fixture metadata at index ${index}`);
      const bytes = fullArtifacts.get(kind);
      if (!bytes) throw new Error(`missing fixture bytes for ${kind}`);
      const owned = Uint8Array.from(bytes);
      return mutateArtifactBytes?.(kind, owned) ?? owned;
    },
    free() {},
  }));
  const fakeRuntime = {
    implementation_build_digest: () => manifest.implementationDigest,
    build_environment_digest: () => manifest.buildEnvironmentDigest,
    runtime_identity: () => runtimeWasm.runtime_identity(),
    runtime_identity_json: () => runtimeWasm.runtime_identity_json(),
    workflow_contract_json: () => runtimeWasm.workflow_contract_json(),
    RuntimeSupportFiles: class {
      put() {}
      put_with_name() {}
      free() {}
    },
    opener_set_applicability_json: preflight,
    maximum_duration_applicability_json:
      maximumDurationApplicabilityJson ??
      (() => {
        throw new Error("maximum-duration preflight must not run here");
      }),
    execute_workspace: executeWorkspace,
    verify_evidence_journal_cbor: () => 1,
  } as unknown as Parameters<typeof setRustRuntimeForTesting>[0];
  setRustRuntimeForTesting(fakeRuntime);
  return { executeWorkspace, preflight };
}

async function expectFakeFullFailure(
  options: FakeFullRuntimeOptions,
  expected: RegExp,
): Promise<void> {
  installFakeFullRuntime(options);
  try {
    await expect(
      executeRustRuntime(
        fullSourceFixture(),
        "runtime-contract.csv",
        { ...fullOptions(), ...options.browserOptions },
        undefined,
        FULL_RUNTIME,
      ),
    ).rejects.toThrow(expected);
  } finally {
    setRustRuntimeForTesting(runtimeWasm);
  }
}

async function expectFakeStreamFullFailure(
  options: FakeFullRuntimeOptions,
  expected: RegExp,
): Promise<void> {
  const root = new MemoryDirectoryHandle();
  const priorNavigator = globalThis.navigator;
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: () => Promise.resolve(memoryOpfsRoot(root)),
    },
    locks: {
      request: (
        _name: string,
        _options: LockOptions,
        operation: () => Promise<unknown>,
      ) => operation(),
    },
  });
  installFakeFullRuntime(options);
  try {
    await expect(
      executeRustRuntime(
        fullSourceFixture(),
        "runtime-contract.csv",
        fullOptions(),
        undefined,
        { ...FULL_RUNTIME, persistRustWorkspace: true },
      ),
    ).rejects.toThrow(expected);
  } finally {
    setRustRuntimeForTesting(runtimeWasm);
    vi.stubGlobal("navigator", priorNavigator);
  }
}

const INVALID_CASES: Array<
  [string, (candidate: Record<string, unknown>) => void, RegExp]
> = [
  [
    "protocol drift",
    (candidate) => {
      candidate.protocolVersion = "chronicle-preprocessing-runtime/v1";
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
    "unknown query-group execution status",
    (candidate) => {
      firstRecord(candidate, "queryGroupExecutions").status = "silently_stale";
    },
    /queryGroupExecutions\[0\]\.status.*unknown execution status/,
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
      const checkpoints = record(summary.workflowQueryGroupCheckpoints);
      const nodeId = firstKey(checkpoints);
      record(checkpoints[nodeId]).terminalDigest = `sha256:${"f".repeat(64)}`;
    },
    /checkpoint identity or terminal digest/,
  ],
  [
    "checkpoint component uses the wrong digest family",
    (candidate) => {
      const checkpoints = record(
        record(candidate.processingSummary).workflowQueryGroupCheckpoints,
      );
      const nodeId = firstKey(checkpoints);
      record(checkpoints[nodeId]).payloadDigest = `sha256:${"a".repeat(64)}`;
    },
    /payloadDigest.*lowercase xxh3-128 digest/,
  ],
  [
    "checkpoint protocol is unsupported",
    (candidate) => {
      const checkpoints = record(
        record(candidate.processingSummary).workflowQueryGroupCheckpoints,
      );
      const nodeId = firstKey(checkpoints);
      record(checkpoints[nodeId]).protocolVersion =
        "chronicle-workflow-checkpoint/v99";
    },
    /protocolVersion.*unsupported checkpoint protocol/,
  ],
  [
    "checkpoint stage identity substitution",
    (candidate) => {
      const checkpoints = record(
        record(candidate.processingSummary).workflowQueryGroupCheckpoints,
      );
      const nodeId = firstKey(checkpoints);
      record(checkpoints[nodeId]).subjectId = "different-subject";
    },
    /checkpoint identity or terminal digest/,
  ],
  [
    "empty stage checkpoint domain",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      summary.workflowQueryGroupDigests = {};
      summary.workflowQueryGroupCheckpoints = {};
    },
    /digest, checkpoint, and execution-registry domains must contain the same identities/,
  ],
  [
    "stage digest and checkpoint domain mismatch",
    (candidate) => {
      const summary = record(candidate.processingSummary);
      const checkpoints = record(summary.workflowQueryGroupCheckpoints);
      delete checkpoints[firstKey(checkpoints)];
    },
    /digest, checkpoint, and execution-registry domains must contain the same identities/,
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
    "query execution has an unknown status",
    (candidate) => {
      firstRecord(candidate, "queryExecutions").status = "silently_stale";
    },
    /queryExecutions\[0\]\.status.*unknown execution status/,
  ],
  [
    "query execution domain is incomplete",
    (candidate) => {
      array(candidate.queryExecutions).pop();
    },
    /query executions do not match the generated workflow registry/,
  ],
  [
    "query execution output disagrees with its Rust checkpoint",
    (candidate) => {
      firstRecord(candidate, "queryExecutions").output_digest =
        `sha256:${"a".repeat(64)}`;
    },
    /query execution output does not match its Rust checkpoint/,
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
    "duplicate query-group execution",
    (candidate) => {
      const executions = array(candidate.queryGroupExecutions);
      const duplicate = structuredClone(record(executions[0]));
      duplicate.capability_id = "duplicate-node-capability";
      executions.push(duplicate);
    },
    /query-group executions do not match the generated workflow registry/,
  ],
  [
    "missing materialization trace surface",
    (candidate) => {
      delete candidate.requirementTraces;
    },
    /requirementTraces/,
  ],
];

type FixtureBoundaryValue =
  | { kind: "string" | "looseString" | "sha256Digest" }
  | { kind: "integer" | "signedInteger" | "number" | "boolean" }
  | { kind: "nullable"; inner: FixtureBoundaryValue }
  | { kind: "array"; items: FixtureBoundaryValue }
  | { kind: "map"; values: FixtureBoundaryValue }
  | { kind: "struct" | "enum"; name: string };

type FixtureBoundaryType =
  | {
      kind: "struct";
      fields: Array<{
        name: string;
        optional?: boolean;
        value: FixtureBoundaryValue;
      }>;
    }
  | { kind: "enum"; variants: string[] };

const fixtureBoundaryTypes = (
  RUNTIME_BOUNDARY_MODEL as unknown as {
    types: Record<string, FixtureBoundaryType>;
  }
).types;

function boundaryFixtureValue(value: FixtureBoundaryValue): unknown {
  switch (value.kind) {
    case "string":
      return "fixture";
    case "looseString":
      return "";
    case "sha256Digest":
      return `sha256:${"a".repeat(64)}`;
    case "integer":
    case "signedInteger":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "nullable":
      return null;
    case "array":
      return [];
    case "map":
      return {};
    case "struct":
      return boundaryStructFixture(value.name);
    case "enum": {
      const definition = fixtureBoundaryTypes[value.name];
      if (!definition || definition.kind !== "enum" || !definition.variants[0]) {
        throw new Error(`fixture enum is unavailable: ${value.name}`);
      }
      return definition.variants[0];
    }
  }
}

function boundaryStructFixture(name: string): Record<string, unknown> {
  const definition = fixtureBoundaryTypes[name];
  if (!definition || definition.kind !== "struct") {
    throw new Error(`fixture struct is unavailable: ${name}`);
  }
  return Object.fromEntries(
    definition.fields
      .filter(({ optional }) => optional !== true)
      .map((field) => [field.name, boundaryFixtureValue(field.value)]),
  );
}

const C20_REVIEW_SCIENTIFIC_KINDS = [
  "foundational-semantics-receipt-json",
  "minimum-duration-excluded-lineage-json",
  "zero-duration-cleanup-evidence-json",
  "zero-duration-removed-lineage-json",
  "b05-screen-construction-evidence-json",
  "b05-schoedel-validation-receipt-json",
] as const;

async function initializeSelfContainedReviewFixtures(): Promise<void> {
  setRustPersistenceForTesting(null);
  const inputDigest = await testSha256Digest(reviewSourceFixture());
  const workspaceId = await testSha256Digest(
    new TextEncoder().encode(
      `chronicle-workflow-v1-workspace:${inputDigest.slice("sha256:".length)}`,
    ),
  );
  reviewSummaryBytes = new TextEncoder().encode(
    JSON.stringify({ fixture: "cold-review-summary" }),
  );
  const artifactBytes = new Map<string, Uint8Array>([
    ["review-summary-json", reviewSummaryBytes],
    ...C20_REVIEW_SCIENTIFIC_KINDS.map(
      (kind) =>
        [
          kind,
          new TextEncoder().encode(JSON.stringify({ fixture: "C20", kind })),
        ] as const,
    ),
  ]);
  const digests = new Map<string, string>();
  for (const [kind, bytes] of artifactBytes) {
    digests.set(kind, await testSha256Digest(bytes));
  }
  const metadata = [...artifactBytes].map(([kind, bytes]) => ({
    artifactId: `artifact:${kind}`,
    kind,
    mediaType: "application/json",
    digest: digests.get(kind)!,
    size: bytes.byteLength,
    derivedFrom: [],
  }));
  const candidate = boundaryStructFixture("ReviewRuntimeManifest");
  Object.assign(candidate, {
    protocolVersion: "chronicle-preprocessing-runtime/v2",
    command: "QueryReview",
    workspaceId,
    previousWorkspaceRootDigest: null,
    inputDigest,
    artifacts: metadata,
    cacheSources: [],
    timezoneAction: "none",
    reviewSummaryDigest: digests.get("review-summary-json"),
    reviewSummaryReused: false,
    queryGroupExecutions: WORKFLOW_QUERY_GROUP_IDS.map((queryGroupId) => ({
      query_group_id: queryGroupId,
      capability_id: `capability:${queryGroupId}`,
      status: "recomputed",
      input_key: `sha256:${"c".repeat(64)}`,
      output: null,
      reason_id: "fixture",
    })),
    queryExecutions: WORKFLOW_QUERY_IDS.map((queryId) => ({
      query_id: queryId,
      // Exact group identity for the fabricated rows; the firewall under
      // test checks manifest shape, not per-query group membership.
      query_group_id: "parse_events",
      status: "recomputed",
      input_key: `sha256:${"c".repeat(64)}`,
      output_digest: `sha256:${"b".repeat(64)}`,
      reason_id: `sha256:${"d".repeat(64)}`,
    })),
    openerSetReceipt: {
      applicability: {
        requested: "strategy_defined",
        effective: "strategy_defined",
        relation: "baseline_native",
        refusalReason: null,
      },
      suppressedDeviceOpenerCount: 0,
      selectedOpenerTypeCounts: {},
      materializedOpenerTypeCounts: {},
    },
  });
  Object.assign(record(candidate.eyesEvidence), {
    protocolVersion: "chronicle-eyes-runtime-summary/v2",
    status: "not_applicable",
    episodeReconstructionStrategy: "fused_matcher",
    taggedFauArtifactDigest: null,
    validationReceipt: null,
    validationReceiptArtifactDigest: null,
  });
  const scientific = record(candidate.scientificEvidence);
  Object.assign(scientific, {
    protocolVersion: "chronicle-runtime-scientific-evidence-summary/v2",
    foundationalSemanticsArtifactDigest: digests.get(
      "foundational-semantics-receipt-json",
    ),
    minimumDurationExcludedLineageArtifactDigest: digests.get(
      "minimum-duration-excluded-lineage-json",
    ),
    zeroDurationCleanupEvidenceArtifactDigest: digests.get(
      "zero-duration-cleanup-evidence-json",
    ),
    zeroDurationRemovedLineageArtifactDigest: digests.get(
      "zero-duration-removed-lineage-json",
    ),
    b05ScreenConstructionReceipt: boundaryStructFixture(
      "RuntimeScreenConstructionReceipt",
    ),
    b05ScreenConstructionArtifactDigest: digests.get(
      "b05-screen-construction-evidence-json",
    ),
    schoedelReconstructionReceipt: null,
    schoedelReconstructionArtifactDigest: null,
    eyesInputPartition: null,
    eyesTaggedFauValidationReceipt: null,
    eyesTaggedFauValidationReceiptArtifactDigest: null,
    b05SchoedelValidationReceiptArtifactDigest: digests.get(
      "b05-schoedel-validation-receipt-json",
    ),
  });
  Object.assign(record(scientific.b05ScreenConstructionReceipt), {
    protocolVersion: "chronicle-b05-foundational-semantics/v1",
  });
  record(scientific.microUseReceipt).protocolVersion =
    "chronicle-micro-use-receipt/v2";
  Object.assign(record(scientific.b05SchoedelValidationReceipt), {
    protocolVersion: "chronicle-b05-schoedel-validation-receipt/v1",
    status: "screen_validated",
    selectedB05StrategyId: "chronicle_screen_interactive_v1",
    minimumDurationExcludedEpisodeCount: 1,
    zeroDurationRemovedRowCount: 1,
    trustedSchoedelRetainedEventCount: null,
    schoedelDecisiveParticipantCount: 0,
  });
  Object.assign(record(scientific.finalizedB05Schoedel), {
    protocolVersion: "chronicle-b05-schoedel-preflight/v1",
    disposition: "executable",
    optionsDigest: candidate.computationOptionsDigest,
    optionsDigestOrigin: "verified_request_jcs",
    requestedScreenStrategyId: "chronicle_screen_interactive_v1",
    effectiveScreenStrategyId: "chronicle_screen_interactive_v1",
    requestedEpisodeStrategyId: "fused_matcher",
    effectiveEpisodeStrategyId: null,
    screenConstructionPhase: "finalized",
    schoedelReconstructionPhase: "not_applicable",
    screenApplicability: {
      protocolVersion: "chronicle-b05-foundational-semantics/v1",
      relation: "baseline_native",
      executable: true,
      refusalReason: null,
      refusalDetail: null,
    },
    schoedelApplicability: null,
  });
  Object.assign(record(scientific.b05ScreenConstructionReceipt), {
    strategyId: "chronicle_screen_interactive_v1",
  });
  Object.assign(record(scientific.minimumDurationReceipt), {
    protocolVersion: "chronicle-minimum-duration-receipt/v2",
    retainedExcludedCount: 1,
  });
  record(scientific.concurrentSubintervalFloorReceipt).protocolVersion =
    "chronicle-concurrent-subinterval-floor-receipt/v1";
  Object.assign(record(scientific.zeroDurationCleanupReceipt), {
    protocolVersion: "chronicle-zero-duration-cleanup-receipt/v1",
    removedRowCount: 1,
  });
  reviewManifest = candidate;
  reviewArtifactBytes = artifactBytes;
}

function activateSchoedelReviewEvidence(
  candidate: Record<string, unknown>,
  relation = "controlled_derivative",
): void {
  const scientific = record(candidate.scientificEvidence);
  scientific.schoedelReconstructionArtifactDigest =
    `sha256:${"c".repeat(64)}`;
  const schoedelReceipt = boundaryStructFixture(
    "RuntimeSchoedelReconstructionReceipt",
  );
  scientific.schoedelReconstructionReceipt = schoedelReceipt;
  const validation = record(scientific.b05SchoedelValidationReceipt);
  Object.assign(validation, {
    status: "screen_and_schoedel_validated",
    trustedSchoedelRetainedEventCount: 1,
    schoedelDecisiveParticipantCount: 1,
  });
  Object.assign(record(scientific.finalizedB05Schoedel), {
    requestedEpisodeStrategyId: "schoedel_2026_app_within_screen_prose_v1",
    effectiveEpisodeStrategyId: "schoedel_2026_app_within_screen_prose_v1",
    schoedelReconstructionPhase: "finalized",
    schoedelApplicability: {
      protocolVersion: "chronicle-b05-foundational-semantics/v1",
      relation,
      executable: true,
      refusalReason: null,
      refusalDetail: null,
    },
  });
  record(candidate.eyesEvidence).episodeReconstructionStrategy =
    "schoedel_2026_app_within_screen_prose_v1";
  Object.assign(schoedelReceipt, {
    protocolVersion: "chronicle-schoedel-reconstruction-receipt/v1",
    strategyId: "schoedel_2026_app_within_screen_prose_v1",
    relation,
    inputScreenIntervalCount: record(
      scientific.b05ScreenConstructionReceipt,
    ).intervalCount,
    inputEventCount: validation.trustedSchoedelRetainedEventCount,
    episodeCount: validation.foundationalEpisodeCount,
    boundedEpisodeCount: validation.foundationalBoundedEpisodeCount,
    rightCensoredEvidenceCount: validation.foundationalUnboundedEpisodeCount,
    singletonZeroLengthCount: 0,
  });
}

async function initializeCompiledRuntimeFixtures(): Promise<void> {
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
  const full = await executeRustRuntime(
    fullSourceFixture(),
    "runtime-contract.csv",
    fullOptions(),
    undefined,
    FULL_RUNTIME,
  );
  manifest = full.manifest;
  fullArtifacts = full.artifacts;
  const review = await queryRustReview(
    reviewSourceFixture(),
    "review-contract.csv",
    reviewOptions(),
    undefined,
    REVIEW_RUNTIME,
  );
  reviewSummaryBytes = review.reviewSummaryJsonBytes!;
  const normalizedReview = await normalizedReviewFixture(
    review.manifestJson,
    reviewSummaryBytes,
  );
  reviewManifest = normalizedReview.manifest;
  reviewArtifactBytes = normalizedReview.bytes;
  // Move the process-local continuation to a different input so fake full-run
  // checks replay the captured manifest's original null predecessor exactly.
  await executeRustRuntime(
    continuationDisplacementFixture(),
    "continuation-displacement.csv",
    fullOptions(),
    undefined,
    FULL_RUNTIME,
  );
}

describe("adapter-only support ingress", () => {
  it("assigns an uploaded Call/SMS eligibility file under its registered role and name", async () => {
    const source = await readFile(
      new URL("./rustPipelineRuntime.ts", import.meta.url),
      "utf8",
    );
    // The three facts asserted per adapter-only role are unchanged; they now
    // live in `collectRuntimeIngress`, which `executeRustRuntimeUnlocked`
    // calls, so the expected text tracks that function's indentation and its
    // `optionalIngress` table.
    expect(source).toContain(
      "const callSmsEligibilityBytes = fileBytes(\n    supportFiles?.callSmsEligibilityFile,",
    );
    expect(source).toContain(
      '["call_sms_eligibility_file", callSmsEligibilityBytes],',
    );
    expect(source).toContain(
      'supportFiles?.callSmsEligibilityFile?.name ??\n        "call_sms_eligibility.csv",',
    );
    expect(source).toContain(
      "const phoneStudyPsCommunicationBytes = fileBytes(\n    supportFiles?.phoneStudyPsCommunicationFile,",
    );
    expect(source).toContain(
      '["phonestudy_ps_communication_file", phoneStudyPsCommunicationBytes],',
    );
    expect(source).toContain(
      'supportFiles?.phoneStudyPsCommunicationFile?.name ??\n        "ps_communication.csv",',
    );
    expect(source).toContain(
      "const phoneStudyEsBytes = fileBytes(supportFiles?.phoneStudyEsFile);",
    );
    expect(source).toContain('["phonestudy_es_file", phoneStudyEsBytes],');
    expect(source).toContain(
      'supportFiles?.phoneStudyEsFile?.name ?? "phonestudy_es.csv"',
    );
    expect(source).toContain(
      "const anchorEventsBytes = fileBytes(supportFiles?.anchorEventsFile);",
    );
    expect(source).toContain('["anchor_events_file", anchorEventsBytes],');
    expect(source).toContain(
      'supportFiles?.anchorEventsFile?.name ?? "anchor_events.csv"',
    );
    // Every optional role in that table is only added when bytes are present.
    expect(source).toContain(
      "for (const [role, bytes] of optionalIngress) {\n    if (bytes.byteLength > 0) ingressBytesByRole.set(role, bytes);",
    );
  });
});

describe("QueryReview artifact compatibility (fake handle)", () => {
  beforeAll(initializeSelfContainedReviewFixtures);

  it("returns only the cold summary and wipes all six scientific sidecars", async () => {
    const extracted = new Map<string, Uint8Array>();
    installFakeReviewRuntime({
      onTakeArtifactBytes: (kind, bytes) => extracted.set(kind, bytes),
    });
    const execution = await queryRustReview(
      reviewSourceFixture(),
      "review-contract.csv",
      reviewOptions(),
      undefined,
      REVIEW_RUNTIME,
    );
    expect(execution.reviewSummaryJsonBytes).toEqual(reviewSummaryBytes);
    expect(extracted.size).toBe(1 + C20_REVIEW_SCIENTIFIC_KINDS.length);
    for (const kind of C20_REVIEW_SCIENTIFIC_KINDS) {
      expect(extracted.get(kind)?.every((byte) => byte === 0), kind).toBe(true);
    }
    expect(
      extracted.get("review-summary-json")?.some((byte) => byte !== 0),
    ).toBe(true);
  });

  it("requires a known reused digest and still drains and wipes all six sidecars", async () => {
    const reused = reusedReviewFixture();
    const extracted = new Map<string, Uint8Array>();
    const install = () =>
      installFakeReviewRuntime({
        manifestJson: reused.manifestJson,
        mutateManifest: (candidate) => Object.assign(candidate, reused.manifest),
        onTakeArtifactBytes: (kind, bytes) => extracted.set(kind, bytes),
      });
    install();
    await expect(
      queryRustReview(
        reviewSourceFixture(),
        "review-contract.csv",
        reviewOptions(),
        undefined,
        REVIEW_RUNTIME,
      ),
    ).rejects.toThrow(/reused a summary digest the caller never offered/);

    install();
    const execution = await queryRustReview(
      reviewSourceFixture(),
      "review-contract.csv",
      reviewOptions(),
      undefined,
      REVIEW_RUNTIME,
      undefined,
      undefined,
      [String(reused.manifest.reviewSummaryDigest)],
    );
    expect(execution.reviewSummaryJsonBytes).toBeUndefined();
    expect(extracted.size).toBe(C20_REVIEW_SCIENTIFIC_KINDS.length);
    for (const [kind, bytes] of extracted) {
      expect(bytes.every((byte) => byte === 0), kind).toBe(true);
    }
  });

  it("accepts decoded-row receipts that include rows removed for missing timestamps", () => {
    const candidate = structuredClone(reviewManifest);
    const scientific = record(candidate.scientificEvidence);
    const decodedCount = Number(record(candidate.counts).original) + 1;
    record(scientific.b05SchoedelValidationReceipt).decodedInputRowCount =
      decodedCount;
    record(scientific.b05ScreenConstructionReceipt).inputRowCount =
      decodedCount;
    expect(() => decodeReviewRuntimeManifest(candidate)).not.toThrow();
  });

  it.each([
    ["chronicle_screen_interactive_v1", "baseline_equivalent"],
    ["parry_toth_2025_session_glance_v1", "source_aligned_adapter"],
    ["zhu_2018_unlock_lock_v1", "source_aligned_adapter"],
  ] as const)(
    "accepts the source-owned %s screen relation",
    (strategyId, relation) => {
      const candidate = structuredClone(reviewManifest);
      const scientific = record(candidate.scientificEvidence);
      record(scientific.b05SchoedelValidationReceipt).selectedB05StrategyId =
        strategyId;
      Object.assign(record(scientific.finalizedB05Schoedel), {
        requestedScreenStrategyId: strategyId,
        effectiveScreenStrategyId: strategyId,
        screenApplicability: {
          protocolVersion: "chronicle-b05-foundational-semantics/v1",
          relation,
          executable: true,
          refusalReason: null,
          refusalDetail: null,
        },
      });
      Object.assign(record(scientific.b05ScreenConstructionReceipt), {
        strategyId,
        relation,
      });
      expect(() => decodeReviewRuntimeManifest(candidate)).not.toThrow();
    },
  );

  it.each([
    [
      "duplicate catalog kind",
      (candidate: Record<string, unknown>) => {
        const artifacts = array(candidate.artifacts);
        artifacts.push(structuredClone(artifacts[1]));
      },
      /duplicate review artifact kind/,
    ],
    [
      "unexpected catalog kind",
      (candidate: Record<string, unknown>) => {
        const artifact = record(array(candidate.artifacts)[1]);
        artifact.kind = "unexpected-json";
      },
      /unexpected review artifact kind/,
    ],
    [
      "non-JSON catalog media",
      (candidate: Record<string, unknown>) => {
        firstRecord(candidate, "artifacts").mediaType = "text/plain";
      },
      /review artifact media type is invalid/,
    ],
    [
      "zero-sized JSON artifact",
      (candidate: Record<string, unknown>) => {
        firstRecord(candidate, "artifacts").size = 0;
      },
      /review artifact size is invalid/,
    ],
    [
      "missing digest-claimed sidecar",
      (candidate: Record<string, unknown>) => {
        candidate.artifacts = array(candidate.artifacts).filter(
          (value) =>
            record(value).kind !== "foundational-semantics-receipt-json",
        );
      },
      /review manifest artifact catalog is missing: foundational-semantics-receipt-json/,
    ],
    [
      "extra digest claim",
      (candidate: Record<string, unknown>) => {
        activateSchoedelReviewEvidence(candidate);
      },
      /review manifest artifact catalog is missing: schoedel-reconstruction-evidence-json/,
    ],
    [
      "summary/reuse disagreement",
      (candidate: Record<string, unknown>) => {
        candidate.reviewSummaryReused = true;
      },
      /review summary catalog and reuse status disagree/,
    ],
    [
      "B05 validation protocol drift",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence)
            .b05SchoedelValidationReceipt,
        ).protocolVersion = "chronicle-b05-schoedel-validation-receipt/v0";
      },
      /unsupported B05\/Schoedel validation receipt protocol/,
    ],
    [
      "micro-use receipt protocol drift",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence).microUseReceipt,
        ).protocolVersion = "chronicle-micro-use-receipt/v1";
      },
      /unsupported micro-use receipt protocol/,
    ],
    [
      "minimum-duration receipt protocol drift",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence).minimumDurationReceipt,
        ).protocolVersion = "chronicle-minimum-duration-receipt/v1";
      },
      /unsupported minimum-duration receipt protocol/,
    ],
    [
      "concurrent-subinterval receipt protocol drift",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence)
            .concurrentSubintervalFloorReceipt,
        ).protocolVersion = "chronicle-concurrent-subinterval-floor-receipt/v0";
      },
      /unsupported concurrent-subinterval-floor receipt protocol/,
    ],
    [
      "zero-duration cleanup receipt protocol drift",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence).zeroDurationCleanupReceipt,
        ).protocolVersion = "chronicle-zero-duration-cleanup-receipt/v0";
      },
      /unsupported zero-duration cleanup receipt protocol/,
    ],
    [
      "B05 validation status/presence disagreement",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence)
            .b05SchoedelValidationReceipt,
        ).status = "not_applicable";
      },
      /B05\/Schoedel validation status and artifact presence disagree/,
    ],
    [
      "finalized B05 identity detached from the computation options digest",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence).finalizedB05Schoedel,
        ).optionsDigest = `sha256:${"e".repeat(64)}`;
      },
      /finalized B05\/Schoedel identity is invalid/,
    ],
    [
      "finalized B05 phase/status disagreement",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence).finalizedB05Schoedel,
        ).screenConstructionPhase = "not_applicable";
      },
      /finalized B05\/Schoedel phase and validation status disagree/,
    ],
    [
      "B05 receipt/applicability relation disagreement",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence).b05ScreenConstructionReceipt,
        ).relation = "source_aligned_adapter";
      },
      /B05\/Schoedel validation receipt disagrees with finalized evidence/,
    ],
    [
      "jointly altered Chronicle relation",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence).b05ScreenConstructionReceipt,
        ).relation = "controlled_derivative";
        record(
          record(candidate.scientificEvidence).finalizedB05Schoedel,
        ).screenApplicability = {
          protocolVersion: "chronicle-b05-foundational-semantics/v1",
          relation: "controlled_derivative",
          executable: true,
          refusalReason: null,
          refusalDetail: null,
        };
      },
      /screen applicability relation disagrees with the selected B05 strategy/,
    ],
    [
      "jointly altered Schoedel relation",
      (candidate: Record<string, unknown>) => {
        activateSchoedelReviewEvidence(candidate, "source_aligned_adapter");
      },
      /Schoedel applicability relation is not the controlled derivative/,
    ],
    [
      "Schoedel retained-input count disagreement",
      (candidate: Record<string, unknown>) => {
        activateSchoedelReviewEvidence(candidate);
        record(
          record(candidate.scientificEvidence).schoedelReconstructionReceipt,
        ).inputEventCount = 2;
      },
      /B05\/Schoedel validation receipt disagrees with finalized evidence/,
    ],
    [
      "EYES status/presence disagreement",
      (candidate: Record<string, unknown>) => {
        record(candidate.eyesEvidence).status = "partial_replay";
        record(candidate.eyesEvidence).episodeReconstructionStrategy =
          "eyes_complement";
        record(
          record(candidate.scientificEvidence).finalizedB05Schoedel,
        ).requestedEpisodeStrategyId = "eyes_complement";
      },
      /EYES status, strategy, receipt, and artifact presence disagree/,
    ],
    [
      "EYES evidence summary protocol drift",
      (candidate: Record<string, unknown>) => {
        record(candidate.eyesEvidence).protocolVersion =
          "chronicle-eyes-runtime-summary/v1";
      },
      /unsupported EYES evidence summary protocol/,
    ],
    [
      "a minimum-duration receipt whose excluded rows lost their lineage digest",
      (candidate: Record<string, unknown>) => {
        record(candidate.scientificEvidence)
          .minimumDurationExcludedLineageArtifactDigest = null;
      },
      /minimum-duration lineage digest presence disagrees with its receipt/,
    ],
    [
      "a zero-duration lineage digest with no removed row behind it",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence).zeroDurationCleanupReceipt,
        ).removedRowCount = 0;
      },
      /zero-duration lineage digest presence disagrees with its receipt/,
    ],
    [
      "a B05 screen-construction digest with no receipt behind it",
      (candidate: Record<string, unknown>) => {
        record(candidate.scientificEvidence).b05ScreenConstructionReceipt = null;
      },
      /scientific receipt and artifact digest presence disagree/,
    ],
    [
      "a Schoedel reconstruction receipt with no artifact digest",
      (candidate: Record<string, unknown>) => {
        activateSchoedelReviewEvidence(candidate);
        record(candidate.scientificEvidence).schoedelReconstructionArtifactDigest =
          null;
      },
      /scientific receipt and artifact digest presence disagree/,
    ],
    [
      "B05 screen-construction receipt protocol drift",
      (candidate: Record<string, unknown>) => {
        record(
          record(candidate.scientificEvidence).b05ScreenConstructionReceipt,
        ).protocolVersion = "chronicle-b05-foundational-semantics/v0";
      },
      /unsupported B05 screen-construction receipt protocol/,
    ],
    [
      "Schoedel reconstruction receipt protocol drift",
      (candidate: Record<string, unknown>) => {
        activateSchoedelReviewEvidence(candidate);
        record(
          record(candidate.scientificEvidence).schoedelReconstructionReceipt,
        ).protocolVersion = "chronicle-schoedel-reconstruction-receipt/v0";
      },
      /unsupported Schoedel reconstruction receipt protocol/,
    ],
    [
      "finalized screen applicability that is not executable",
      (candidate: Record<string, unknown>) => {
        record(
          record(
            record(candidate.scientificEvidence).finalizedB05Schoedel,
          ).screenApplicability,
        ).executable = false;
      },
      /finalized applicability is invalid/,
    ],
    [
      "finalized screen applicability carrying a refusal reason",
      (candidate: Record<string, unknown>) => {
        record(
          record(
            record(candidate.scientificEvidence).finalizedB05Schoedel,
          ).screenApplicability,
        ).refusalReason = "input_capability_evidence_absent";
      },
      /finalized applicability is invalid/,
    ],
    [
      "duplicate review artifact id",
      (candidate: Record<string, unknown>) => {
        const artifacts = array(candidate.artifacts);
        const duplicate = structuredClone(record(artifacts[1]));
        duplicate.kind = "unexpected-json";
        artifacts.push(duplicate);
      },
      /duplicate review artifact id/,
    ],
    [
      "a query group the generated workflow registry does not declare",
      (candidate: Record<string, unknown>) => {
        record(array(candidate.queryGroupExecutions)[0]).query_group_id =
          "query-group-absent";
      },
      /query-group executions do not match the generated workflow registry/,
    ],
  ] as const)("rejects %s", (_name, mutate, expected) => {
    const candidate = structuredClone(reviewManifest);
    mutate(candidate);
    expect(() => decodeReviewRuntimeManifest(candidate)).toThrow(expected);
  });

  it.each([
    [
      "malformed metadata",
      { artifactMetadataJson: () => "not-json" },
      /review artifact metadata is not valid JSON at index 0/,
    ],
    [
      "manifest/handle metadata mismatch",
      {
        mutateMetadata: (metadata: Record<string, unknown>) => {
          metadata.digest = `sha256:${"d".repeat(64)}`;
        },
      },
      /review manifest\/handle artifact catalog mismatch/,
    ],
    [
      "byte size tampering",
      {
        mutateArtifactBytes: (kind: string, bytes: Uint8Array) =>
          kind === "review-summary-json"
            ? Uint8Array.from([...bytes, 0])
            : bytes,
      },
      /review artifact integrity mismatch: review-summary-json/,
    ],
    [
      "byte digest tampering",
      {
        mutateArtifactBytes: (kind: string, bytes: Uint8Array) => {
          if (kind === "review-summary-json") bytes[0] = bytes[0]! ^ 1;
          return bytes;
        },
      },
      /review artifact integrity mismatch: review-summary-json/,
    ],
    [
      "a handle that repeats one artifact id under a second kind",
      {
        artifactMetadataJson: (
          index: number,
          metadata: Record<string, unknown>,
        ) =>
          JSON.stringify(
            index === 0
              ? metadata
              : {
                  ...metadata,
                  artifactId: record(array(reviewManifest.artifacts)[0])
                    .artifactId,
                },
          ),
      },
      /duplicate review handle artifact id/,
    ],
    [
      "a handle that hands back something other than a byte buffer",
      {
        mutateArtifactBytes: (kind: string, bytes: Uint8Array) =>
          kind === "review-summary-json"
            ? ("not-bytes" as unknown as Uint8Array)
            : bytes,
      },
      /review artifact did not expose a byte buffer: review-summary-json/,
    ],
  ] as const)("rejects %s", async (_name, options, expected) => {
    await expectFakeReviewFailure(options, expected);
  });

  /**
   * A request that carries a method-profile receipt expects the runtime to
   * publish it back as `method-profile-receipt-json`, so the review manifest's
   * artifact catalog has to account for exactly that artifact and no other.
   */
  describe("review artifact catalog against a request-side receipt", () => {
    const withReceipt = { methodProfileReceipt: registeredConformanceReceipt() };

    it("refuses a manifest that publishes no method-profile receipt artifact", async () => {
      await expectFakeReviewFailure(
        {},
        /review manifest artifact catalog is missing: method-profile-receipt-json/,
        withReceipt,
      );
    });

    it("refuses a manifest that publishes an artifact the request never asked for", async () => {
      await expectFakeReviewFailure(
        {
          mutateManifest: (candidate) => {
            const artifacts = array(candidate.artifacts);
            candidate.artifacts = [
              ...artifacts,
              {
                ...record(structuredClone(artifacts[0])),
                kind: "method-profile-receipt-json",
                artifactId:
                  "urn:chronicle:artifact:method-profile-receipt-json:extra",
              },
              {
                ...record(structuredClone(artifacts[0])),
                kind: "unrequested-sidecar-json",
                artifactId: "urn:chronicle:artifact:unrequested-sidecar-json:extra",
              },
            ];
          },
        },
        /unexpected review artifact kind: unrequested-sidecar-json/,
        withReceipt,
      );
    });
  });

  it("wipes the retained summary if a later sidecar fails", async () => {
    let retainedSummary: Uint8Array | undefined;
    installFakeReviewRuntime({
      mutateArtifactBytes: (kind, bytes) => {
        if (kind !== "review-summary-json") bytes[0] = bytes[0]! ^ 1;
        return bytes;
      },
      onTakeArtifactBytes: (kind, bytes) => {
        if (kind === "review-summary-json") retainedSummary = bytes;
      },
    });
    await expect(
      queryRustReview(
        reviewSourceFixture(),
        "review-contract.csv",
        reviewOptions(),
        undefined,
        REVIEW_RUNTIME,
      ),
    ).rejects.toThrow(/review artifact integrity mismatch/);
    expect(retainedSummary?.every((byte) => byte === 0)).toBe(true);
  });

  it("binds and drains all nine active-EYES artifacts and rejects receipt-byte substitution", async () => {
    const candidate = structuredClone(reviewManifest);
    const scientific = record(candidate.scientificEvidence);
    const eyes = record(candidate.eyesEvidence);
    record(scientific.finalizedB05Schoedel).requestedEpisodeStrategyId =
      "eyes_complement";
    const partition = boundaryStructFixture("EyesInputPartitionPreflightResult");
    Object.assign(partition, {
      protocolVersion: "chronicle-eyes-input-partition-preflight/v2",
      disposition: "executable",
      inputDigest: candidate.inputDigest,
      optionsDigest: candidate.computationOptionsDigest,
      optionsDigestOrigin: "verified_request_jcs",
      requestedEpisodeStrategyId: "eyes_complement",
      effectiveEpisodeStrategyId: "eyes_complement",
      relation: "partial_replay",
      refusalReason: null,
      refusalDetail: null,
      fragmentedParticipantCount: 0,
    });
    const receipt = boundaryStructFixture("EyesTaggedFauValidationReceipt");
    const taggedFauBytes = new TextEncoder().encode(
      canonicalJson({ fixture: "active-eyes-tagged-fau" }),
    );
    const taggedFauDigest = await testSha256Digest(taggedFauBytes);
    Object.assign(receipt, {
      protocolVersion: "chronicle-eyes-tagged-fau-validation-receipt/v1",
      status: "validated",
      verifiedRawInputDigest: candidate.inputDigest,
      decodedInputRowCount: Number(record(candidate.counts).original) + 1,
      requestOptionsDigest: candidate.computationOptionsDigest,
      optionsDigestOrigin: "verified_request_jcs",
      finalPartitionResolutionDigest: partition.resolutionDigest,
      taggedFauArtifactJcsDigest: taggedFauDigest,
    });
    Object.assign(record(scientific.b05SchoedelValidationReceipt), {
      decodedInputRowCount: receipt.decodedInputRowCount,
    });
    Object.assign(record(scientific.b05ScreenConstructionReceipt), {
      inputRowCount: receipt.decodedInputRowCount,
    });
    const receiptBytes = new TextEncoder().encode(canonicalJson(receipt));
    const receiptDigest = await testSha256Digest(receiptBytes);
    Object.assign(eyes, {
      status: "partial_replay",
      episodeReconstructionStrategy: "eyes_complement",
      taggedFauArtifactDigest: taggedFauDigest,
      validationReceipt: receipt,
      validationReceiptArtifactDigest: receiptDigest,
    });
    Object.assign(scientific, {
      eyesInputPartition: partition,
      eyesTaggedFauValidationReceipt: structuredClone(receipt),
      eyesTaggedFauValidationReceiptArtifactDigest:
        eyes.validationReceiptArtifactDigest,
    });
    candidate.artifacts = [
      ...array(candidate.artifacts),
      {
        artifactId: "artifact:eyes-tagged-fau-evidence-json",
        kind: "eyes-tagged-fau-evidence-json",
        mediaType: "application/json",
        digest: eyes.taggedFauArtifactDigest,
        size: taggedFauBytes.byteLength,
        derivedFrom: [],
      },
      {
        artifactId: "artifact:eyes-tagged-fau-validation-receipt-json",
        kind: "eyes-tagged-fau-validation-receipt-json",
        mediaType: "application/json",
        digest: eyes.validationReceiptArtifactDigest,
        size: receiptBytes.byteLength,
        derivedFrom: [],
      },
    ];
    expect(() => decodeReviewRuntimeManifest(candidate)).not.toThrow();

    const mismatchedDecodedCount = structuredClone(candidate);
    const mismatchedScientific = record(
      mismatchedDecodedCount.scientificEvidence,
    );
    const mismatchedValidation = record(
      mismatchedScientific.b05SchoedelValidationReceipt,
    );
    const decodedInputRowCount =
      Number(mismatchedValidation.decodedInputRowCount) + 1;
    mismatchedValidation.decodedInputRowCount = decodedInputRowCount;
    record(
      mismatchedScientific.b05ScreenConstructionReceipt,
    ).inputRowCount = decodedInputRowCount;
    expect(() => decodeReviewRuntimeManifest(mismatchedDecodedCount)).toThrow(
      /active EYES validation receipt protocol, status, or artifact digest is invalid/,
    );

    const activeBytes = new Map(reviewArtifactBytes);
    activeBytes.set("eyes-tagged-fau-evidence-json", taggedFauBytes);
    activeBytes.set(
      "eyes-tagged-fau-validation-receipt-json",
      receiptBytes,
    );
    const extracted = new Map<string, Uint8Array>();
    installFakeReviewRuntime({
      manifestJson: JSON.stringify(candidate),
      mutateManifest: (target) => Object.assign(target, candidate),
      artifactBytesByKind: activeBytes,
      onTakeArtifactBytes: (kind, bytes) => extracted.set(kind, bytes),
    });
    const execution = await queryRustReview(
      reviewSourceFixture(),
      "review-contract.csv",
      reviewOptions(),
      undefined,
      REVIEW_RUNTIME,
    );
    expect(execution.reviewSummaryJsonBytes).toEqual(reviewSummaryBytes);
    expect(extracted.size).toBe(9);
    for (const [kind, bytes] of extracted) {
      if (kind !== "review-summary-json") {
        expect(bytes.every((byte) => byte === 0), kind).toBe(true);
      }
    }

    const substituted = structuredClone(candidate);
    const substitutedReceipt = structuredClone(receipt);
    substitutedReceipt.sourceVersion = "substituted-version";
    const substitutedBytes = new TextEncoder().encode(
      canonicalJson(substitutedReceipt),
    );
    const substitutedDigest = await testSha256Digest(substitutedBytes);
    const substitutedMetadata = array(substituted.artifacts)
      .map(record)
      .find(
        ({ kind }) => kind === "eyes-tagged-fau-validation-receipt-json",
      );
    if (!substitutedMetadata) throw new Error("active EYES metadata is absent");
    substitutedMetadata.digest = substitutedDigest;
    substitutedMetadata.size = substitutedBytes.byteLength;
    record(substituted.eyesEvidence).validationReceiptArtifactDigest =
      substitutedDigest;
    record(
      substituted.scientificEvidence,
    ).eyesTaggedFauValidationReceiptArtifactDigest = substitutedDigest;
    const substitutedArtifactBytes = new Map(activeBytes);
    substitutedArtifactBytes.set(
      "eyes-tagged-fau-validation-receipt-json",
      substitutedBytes,
    );
    installFakeReviewRuntime({
      manifestJson: JSON.stringify(substituted),
      mutateManifest: (target) => Object.assign(target, substituted),
      artifactBytesByKind: substitutedArtifactBytes,
    });
    await expect(
      queryRustReview(
        reviewSourceFixture(),
        "review-contract.csv",
        reviewOptions(),
        undefined,
        REVIEW_RUNTIME,
      ),
    ).rejects.toThrow(
      /review artifact bytes disagree with canonical manifest receipt/,
    );

    record(record(candidate.scientificEvidence).eyesInputPartition).inputDigest =
      `sha256:${"8".repeat(64)}`;
    expect(() => decodeReviewRuntimeManifest(candidate)).toThrow(
      /active EYES partition protocol or disposition is invalid/,
    );
  });

  it("wipes an artifact even when performance tracing throws after extraction", async () => {
    const info = vi.spyOn(console, "info").mockImplementation((message) => {
      if (String(message).includes('"phase":"artifact-extract"')) {
        throw new Error("trace sink failed");
      }
    });
    let extracted: Uint8Array | undefined;
    installFakeReviewRuntime({
      onTakeArtifactBytes: (_kind, bytes) => {
        extracted ??= bytes;
      },
    });
    try {
      await expect(
        queryRustReview(
          reviewSourceFixture(),
          "review-contract.csv",
          reviewOptions(),
          undefined,
          { ...REVIEW_RUNTIME, performanceTraceId: "trace-wipe-proof" },
        ),
      ).rejects.toThrow(/trace sink failed/);
      expect(extracted).toBeDefined();
      expect(extracted!.every((byte) => byte === 0)).toBe(true);
    } finally {
      info.mockRestore();
      setRustRuntimeForTesting(runtimeWasm);
    }
  });
});

function registeredConformanceReceipt(): MethodProfileReceipt {
  const variant = "reconstruction.minimum-foreground-strict-gt5s.v1";
  const identity = `conformance-fixture:${variant}`;
  const settingId = "method-setting-5b16e47b354adfd836637c21";
  const fixtureDigest = "sha256:7552b4e6311fc39312dce3a81a0c6be034ed12c0fee700b2d12e68eb310fd3e0";
  return {
    methodProfileId: identity,
    sourceWorkId: identity,
    sourceMethodVariantId: variant,
    sourceMethodVariantIds: [variant],
    methodProfileVersion: "v1",
    settingIds: [settingId],
    bindings: [
      ["minimum_usage_duration", 5],
      ["minimum_duration_comparator", "inclusive_le"],
      ["minimum_duration_disposition", "drop_row"],
    ].map(([slot, value]) => ({
      settingId,
      slot: String(slot),
      value,
      conformanceFixtureId: variant,
      conformanceResultDigest: fixtureDigest,
    })),
  };
}

describe("Rust/WASM runtime manifest contract firewall", () => {
  beforeAll(initializeCompiledRuntimeFixtures);

  it("validates supplied SMS source-row and conversation relationships in the actual raw execution owner", async () => {
    const options = { ...fullOptions(), openerSet: "activity_resumed_only" as const };
    const bytes = (csv: string) => new TextEncoder().encode(csv);
    const result = await executeRustRuntime(bytes(suppliedCommunicationCsv), "supplied-communication.csv", options, undefined, FULL_RUNTIME);
    expect(result.manifest.input.digest).toBe(await testSha256Digest(bytes(suppliedCommunicationCsv)));
    for (const csv of [
      suppliedCommunicationCsv.replace("peer-one,1,conversation-one", "peer-one,2,conversation-one"),
      suppliedCommunicationCsv.replace("peer-one,1,conversation-one", "peer-one,3,conversation-one"),
      suppliedCommunicationCsv.replace("peer-one,1,conversation-one", "peer-one,99,conversation-one"),
      suppliedCommunicationCsv.replace("peer-one,1,conversation-one", "peer-one,1.0,conversation-one"),
      suppliedCommunicationCsv.replace("sms,sent,peer-one,1", "sms,received,peer-one,1"),
      suppliedCommunicationCsv.replace("sms,received,peer-one", "call,received,peer-one"),
      suppliedCommunicationCsv.replace("example-participant,Example,Messages,Activity Resumed", "foreign-person,Example,Messages,Activity Resumed"),
      suppliedCommunicationCsv.replace("sms,sent,peer-one,1", "sms,sent,foreign-peer,1"),
      suppliedCommunicationCsv.replace("peer-one,1,conversation-one", "peer-one,1,conversation-two"),
    ]) {
      await expect(executeRustRuntime(bytes(csv), "supplied-communication.csv", options, undefined, FULL_RUNTIME)).rejects.toThrow(/supplied SMS/);
    }
    // Unknown peer is allowed, no inferred timing: first sent timestamp precedes received.
    await expect(executeRustRuntime(bytes(suppliedCommunicationCsv.replace("sms,sent,peer-one,1", "sms,sent,,1")),
      "unknown-peer.csv", options, undefined, FULL_RUNTIME)).resolves.toBeDefined();
  });

  it("commits the exact source-method variant receipt in shipped WASM", async () => {
    const result = await executeRustRuntime(
      fullSourceFixture(),
      "runtime-contract-profiled.csv",
      {
        ...fullOptions(),
        minimumUsageDuration: 5,
        minimumDurationComparator: "inclusive_le",
        minimumDurationDisposition: "drop_row",
      },
      undefined,
      {
        ...FULL_RUNTIME,
        methodProfileReceipt: registeredConformanceReceipt(),
      },
    );
    const receiptBytes = result.artifacts.get("method-profile-receipt-json");
    expect(receiptBytes).toBeDefined();
    expect(JSON.parse(new TextDecoder().decode(receiptBytes))).toMatchObject({
      sourceWorkId: "conformance-fixture:reconstruction.minimum-foreground-strict-gt5s.v1",
      sourceMethodVariantId: "reconstruction.minimum-foreground-strict-gt5s.v1",
      sourceMethodVariantIds: ["reconstruction.minimum-foreground-strict-gt5s.v1"],
      settingIds: ["method-setting-5b16e47b354adfd836637c21"],
    });
  });

  it("rejects an unregistered Android source identity in shipped WASM", async () => {
    await expect(executeRustRuntime(
      fullSourceFixture(),
      "runtime-contract-forged-profile.csv",
      { ...fullOptions(), minimumUsageDuration: 60 },
      undefined,
      {
        ...FULL_RUNTIME,
        methodProfileReceipt: {
          methodProfileId: "method-profile:doi:forged",
          sourceWorkId: "doi:forged",
          sourceMethodVariantId: "source-configuration-space-forged",
          sourceMethodVariantIds: ["source-method-variant-forged"],
          methodProfileVersion: "literature-sublation-v3-atomic",
          settingIds: ["setting:minimum"],
          bindings: [{
            settingId: "setting:minimum",
            slot: "minimum_usage_duration",
            value: 60,
            conformanceFixtureId: "fixture:forged",
            conformanceResultDigest: `sha256:${"a".repeat(64)}`,
          }],
        },
      },
    )).rejects.toThrow(/Android profile is not registered/);
  });

  it("fixture-verifies MiNap but rejects its blocked receipt at ExecuteWorkspace in shipped WASM", async () => {
    const methodProfileReceipt = await createSleepDiaryMethodProfileReceipt(
      "version-zenodo-minap-v1.0",
      "minap-v1-event-sheet",
    );
    expect(methodProfileReceipt).toMatchObject({
      methodProfileId: "chronicle-diary-replication:version-zenodo-minap-v1.0:minap-v1-event-sheet",
      sourceWorkId: "work-zenodo-minap-go",
      sourceMethodVariantId: "version-zenodo-minap-v1.0",
      methodProfileVersion: "1",
      diaryReplicationBinding: {
        versionDefinitionId: "version-zenodo-minap-v1.0",
        mappingProfileId: "minap-v1-event-sheet",
        profileExecutionStatus: "blocked",
        fixtureId: "minap-v1-event-pairing-basic",
        fixtureInputSha256: "d86b705334e83e808a50107b09dfaa168d267239c842abf93a1c4c83ee8abe89",
        fixtureNormalizedSha256: "1b11aa4392b5409d8c96149ae27ffa42eb8144cc0fc9d8e3444b4840d958459d",
      },
    });
    expect(methodProfileReceipt.diaryReplicationBinding?.blockerCodes).toHaveLength(29);

    await expect(executeRustRuntime(
      fullSourceFixture(),
      "runtime-contract-minap-profiled.csv",
      fullOptions(),
      undefined,
      { ...FULL_RUNTIME, methodProfileReceipt },
    )).rejects.toThrow(/diary_replication_profile_not_executable:blocked/);
  });

  it("commits composite Android and SleepDiaries JSON receipts for review but blocks execution", async () => {
    const androidReceipt = registeredConformanceReceipt();
    const diaryReceipt = await createSleepDiaryMethodProfileReceipt(
      "version-zenodo-sleepdiaries-v1.1.3",
      "sleepdiaries-v1-json",
    );
    expect(diaryReceipt).toMatchObject({
      sourceMethodVariantIds: ["version-zenodo-sleepdiaries-v1.1.3"],
      diaryReplicationBinding: {
        fixtureId: "sleepdiaries-v1-json-basic",
        fixtureInputSha256: "dff812d78b3c0e4110cf3a359c3d523fd30cc635a7f3fd42e742d18571a411d3",
        fixtureNormalizedSha256: "95fd59f4d79815cda57eaae68dc18505632db6a6160bb79ac5b3f4663b038d2e",
      },
    });
    expect(diaryReceipt.diaryReplicationBinding?.blockerCodes).toHaveLength(36);

    const review = await queryRustReview(
      reviewSourceFixture(),
      "review-contract-composite.csv",
      {
        ...reviewOptions(),
        minimumUsageDuration: 5,
        minimumDurationComparator: "inclusive_le",
        minimumDurationDisposition: "drop_row",
      },
      undefined,
      { ...REVIEW_RUNTIME, methodProfileReceipts: [androidReceipt, diaryReceipt] },
    );
    expect(((JSON.parse(review.manifestJson) as { artifacts: Array<{ kind?: string }> }).artifacts)
      .some(({ kind }) => kind === "method-profile-receipts-json")).toBe(true);

    await expect(executeRustRuntime(
      fullSourceFixture(),
      "runtime-contract-composite.csv",
      {
        ...fullOptions(),
        minimumUsageDuration: 5,
        minimumDurationComparator: "inclusive_le",
        minimumDurationDisposition: "drop_row",
      },
      undefined,
      { ...FULL_RUNTIME, methodProfileReceipts: [androidReceipt, diaryReceipt] },
    )).rejects.toThrow(/diary_replication_profile_not_executable:blocked/);
  });
  it.each([
    [
      "protocol drift",
      (candidate: Record<string, unknown>) => {
        candidate.protocolVersion = "chronicle-preprocessing-runtime/v1";
      },
      /reviewManifest\.protocolVersion.*unsupported protocol version/,
    ],
    [
      "the wrong command",
      (candidate: Record<string, unknown>) => {
        candidate.command = "ExecuteWorkspace";
      },
      /reviewManifest\.command.*expected QueryReview/,
    ],
    [
      "an unknown timezone action",
      (candidate: Record<string, unknown>) => {
        candidate.timezoneAction = "guess";
      },
      /reviewManifest\.timezoneAction.*unknown timezone action/,
    ],
    [
      "an unknown execution status",
      (candidate: Record<string, unknown>) => {
        firstRecord(candidate, "queryExecutions").status = "silently_stale";
      },
      /reviewManifest\.queryExecutions\[0\]\.status.*unknown execution status/,
    ],
    [
      "an incomplete query domain",
      (candidate: Record<string, unknown>) => {
        array(candidate.queryExecutions).pop();
      },
      /query executions do not match the generated workflow registry/,
    ],
    [
      "duplicate query identities",
      (candidate: Record<string, unknown>) => {
        const queries = array(candidate.queryExecutions);
        const source = queries.find(
          (query) => record(query).query_id === "validate_remap_rules",
        );
        const target = queries.find(
          (query) => record(query).query_id !== "validate_remap_rules",
        );
        if (source === undefined || target === undefined) {
          throw new Error("query execution fixture lacks distinct registered identities");
        }
        record(target).query_id = record(source).query_id;
      },
      /query executions do not match the generated workflow registry/,
    ],
    [
      "an unknown cache source",
      (candidate: Record<string, unknown>) => {
        candidate.cacheSources = ["unverified-cache"];
      },
      /reviewManifest\.cacheSources.*unknown or duplicate cache source/,
    ],
    [
      "duplicate cache sources",
      (candidate: Record<string, unknown>) => {
        candidate.cacheSources = ["salsa-memory", "salsa-memory"];
      },
      /reviewManifest\.cacheSources.*unknown or duplicate cache source/,
    ],
    [
      "a stale scientific evidence protocol",
      (candidate: Record<string, unknown>) => {
        record(candidate.scientificEvidence).protocolVersion =
          "chronicle-runtime-scientific-evidence-summary/v1";
      },
      /scientificEvidence\.protocolVersion.*unsupported scientific evidence summary protocol/,
    ],
    [
      "an inconsistent EYES status",
      (candidate: Record<string, unknown>) => {
        record(candidate.eyesEvidence).status = "partial_replay";
      },
      /EYES status, strategy, receipt, and artifact presence disagree/,
    ],
    [
      "a duplicate review artifact kind",
      (candidate: Record<string, unknown>) => {
        const artifacts = array(candidate.artifacts);
        const scientific = artifacts.find(
          (value) => record(value).kind !== "review-summary-json",
        );
        if (!scientific) throw new Error("fixture has no scientific artifact");
        artifacts.push(structuredClone(scientific));
      },
      /duplicate review artifact kind/,
    ],
    [
      "an unexpected review artifact kind",
      (candidate: Record<string, unknown>) => {
        const artifacts = array(candidate.artifacts);
        const unexpected = structuredClone(record(artifacts[1]));
        unexpected.artifactId = "artifact:unexpected-science-json";
        unexpected.kind = "unexpected-science-json";
        artifacts.push(unexpected);
      },
      /unexpected review artifact kind/,
    ],
    [
      "a scientific catalog media mismatch",
      (candidate: Record<string, unknown>) => {
        const scientific = array(candidate.artifacts)
          .map(record)
          .find(({ kind }) => kind !== "review-summary-json");
        if (!scientific) throw new Error("fixture has no scientific artifact");
        scientific.mediaType = "text/plain";
      },
      /review artifact media type is invalid/,
    ],
    [
      "a missing required digest claim artifact",
      (candidate: Record<string, unknown>) => {
        candidate.artifacts = array(candidate.artifacts).filter(
          (value) =>
            record(value).kind !== "foundational-semantics-receipt-json",
        );
      },
      /review manifest artifact catalog is missing: foundational-semantics-receipt-json/,
    ],
    [
      "a digest claim that disagrees with its catalog",
      (candidate: Record<string, unknown>) => {
        record(candidate.scientificEvidence).foundationalSemanticsArtifactDigest =
          `sha256:${"7".repeat(64)}`;
      },
      /review manifest artifact digest claim mismatch: foundational-semantics-receipt-json/,
    ],
    [
      "a reused summary that remains cataloged",
      (candidate: Record<string, unknown>) => {
        candidate.reviewSummaryReused = true;
      },
      /review summary catalog and reuse status disagree/,
    ],
  ] as const)(
    "rejects a compact review manifest with %s",
    (_name, mutate, expected) => {
      const candidate = structuredClone(reviewManifest);
      mutate(candidate);
      expect(() => decodeReviewRuntimeManifest(candidate)).toThrow(expected);
    },
  );

  it("maps every valid review execution status to its exact step identity", () => {
    const candidate = structuredClone(reviewManifest);
    const queries = array(candidate.queryExecutions).map(record);
    const queryAt = (index: number): Record<string, unknown> => {
      const step = queries[index];
      if (step === undefined) throw new Error(`fixture manifest has no step ${index}`);
      return step;
    };
    const statuses = ["recomputed", "cached", "bypassed", "skipped", "error"];
    statuses.forEach((status, index) => {
      queryAt(index).status = status;
    });

    const decoded = decodeReviewRuntimeManifest(candidate);
    expect(decoded.recomputedQueryIds).toContain(queryAt(0).query_id);
    expect(decoded.cachedQueryIds).toContain(queryAt(1).query_id);
    expect(decoded.bypassedQueryIds).toContain(queryAt(2).query_id);
    expect(decoded.skippedQueryIds).toContain(queryAt(3).query_id);
    expect(decoded.errorQueryIds).toEqual([queryAt(4).query_id]);
  });

  it("executes only after preflight and binds the review receipt to that decision", async () => {
    const { executeWorkspace, handleFree, preflight, supportFree } =
      installFakeReviewRuntime();
    try {
      const execution = await queryRustReview(
        reviewSourceFixture(),
        "review-contract.csv",
        reviewOptions(),
        undefined,
        REVIEW_RUNTIME,
      );

      expect(execution.openerSetReceipt.applicability).toEqual({
        requested: "strategy_defined",
        effective: "strategy_defined",
        relation: "baseline_native",
        refusalReason: null,
      });
      expect(preflight).toHaveBeenCalledOnce();
      expect(executeWorkspace).toHaveBeenCalledOnce();
      expect(preflight.mock.invocationCallOrder[0]).toBeLessThan(
        executeWorkspace.mock.invocationCallOrder[0]!,
      );
      expect(handleFree).toHaveBeenCalledOnce();
      expect(supportFree).toHaveBeenCalledOnce();
    } finally {
      setRustRuntimeForTesting(runtimeWasm);
    }
  });

  it("returns only the cold summary and zeroizes every verified scientific sidecar", async () => {
    const extracted = new Map<string, Uint8Array>();
    installFakeReviewRuntime({
      onTakeArtifactBytes: (kind, bytes) => extracted.set(kind, bytes),
    });
    try {
      const execution = await queryRustReview(
        reviewSourceFixture(),
        "review-contract.csv",
        reviewOptions(),
        undefined,
        REVIEW_RUNTIME,
      );
      expect(execution.reviewSummaryJsonBytes).toEqual(reviewSummaryBytes);
      expect(extracted.size).toBe(reviewArtifactBytes.size);
      for (const [kind, bytes] of extracted) {
        if (kind === "review-summary-json") {
          expect(bytes).toBe(execution.reviewSummaryJsonBytes);
          expect(bytes.some((byte) => byte !== 0)).toBe(true);
        } else {
          expect(bytes.every((byte) => byte === 0), kind).toBe(true);
        }
      }
    } finally {
      setRustRuntimeForTesting(runtimeWasm);
    }
  });

  it("drains and zeroizes reused scientific sidecars while omitting summary bytes", async () => {
    const reused = reusedReviewFixture();
    const extracted = new Map<string, Uint8Array>();
    installFakeReviewRuntime({
      manifestJson: reused.manifestJson,
      mutateManifest: (candidate) => Object.assign(candidate, reused.manifest),
      onTakeArtifactBytes: (kind, bytes) => extracted.set(kind, bytes),
    });
    try {
      const execution = await queryRustReview(
        reviewSourceFixture(),
        "review-contract.csv",
        reviewOptions(),
        undefined,
        REVIEW_RUNTIME,
        undefined,
        undefined,
        [String(reused.manifest.reviewSummaryDigest)],
      );
      expect(execution.reviewSummaryReused).toBe(true);
      expect(execution.reviewSummaryJsonBytes).toBeUndefined();
      expect(extracted.size).toBe(reused.bytes.size);
      expect(extracted.has("review-summary-json")).toBe(false);
      for (const [kind, bytes] of extracted) {
        expect(bytes.every((byte) => byte === 0), kind).toBe(true);
      }
    } finally {
      setRustRuntimeForTesting(runtimeWasm);
    }
  });

  it("wipes a retained summary when a later scientific sidecar fails integrity", async () => {
    let returnedSummary: Uint8Array | undefined;
    installFakeReviewRuntime({
      mutateArtifactBytes: (kind, bytes) => {
        if (kind !== "review-summary-json" && bytes.length > 0) {
          bytes[0] = bytes[0]! ^ 1;
        }
        return bytes;
      },
      onTakeArtifactBytes: (kind, bytes) => {
        if (kind === "review-summary-json") returnedSummary = bytes;
      },
    });
    try {
      await expect(
        queryRustReview(
          reviewSourceFixture(),
          "review-contract.csv",
          reviewOptions(),
          undefined,
          REVIEW_RUNTIME,
        ),
      ).rejects.toThrow(/review artifact integrity mismatch/);
      expect(returnedSummary).toBeDefined();
      expect(returnedSummary!.every((byte) => byte === 0)).toBe(true);
    } finally {
      setRustRuntimeForTesting(runtimeWasm);
    }
  });

  it.each([
    [
      "preflight options identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.optionsDigest = `sha256:${"f".repeat(64)}`;
        },
      },
      /review manifest options identity disagrees with opener preflight/,
    ],
    [
      "opener-set execution receipt",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          const receipt = record(candidate.openerSetReceipt);
          record(receipt.applicability).relation = "source_equivalent";
        },
      },
      /opener-set execution receipt disagrees with preflight/,
    ],
    [
      "workspace identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.workspaceId = `sha256:${"1".repeat(64)}`;
        },
      },
      /review manifest workspace identity mismatch/,
    ],
    [
      "input identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.inputDigest = `sha256:${"2".repeat(64)}`;
        },
      },
      /review manifest input identity mismatch/,
    ],
    [
      "previous-root identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.previousWorkspaceRootDigest = `sha256:${"3".repeat(64)}`;
        },
      },
      /review manifest previous-root identity mismatch/,
    ],
    [
      "implementation identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.implementationDigest = `sha256:${"4".repeat(64)}`;
        },
      },
      /review manifest implementation identity mismatch/,
    ],
    [
      "build-environment identity",
      {
        mutateManifest: (candidate: Record<string, unknown>): void => {
          candidate.buildEnvironmentDigest = `sha256:${"5".repeat(64)}`;
        },
      },
      /review manifest build-environment identity mismatch/,
    ],
    [
      "artifact count",
      { artifactCount: 0 },
      /review manifest\/handle artifact count mismatch/,
    ],
    [
      "artifact kind",
      {
        mutateMetadata: (candidate: Record<string, unknown>): void => {
          candidate.kind = "wrong-kind";
        },
      },
      /review manifest\/handle artifact catalog mismatch/,
    ],
    [
      "artifact digest identity",
      {
        mutateMetadata: (candidate: Record<string, unknown>): void => {
          candidate.digest = `sha256:${"6".repeat(64)}`;
        },
      },
      /review manifest\/handle artifact catalog mismatch/,
    ],
    [
      "artifact media type",
      {
        mutateMetadata: (candidate: Record<string, unknown>): void => {
          candidate.mediaType = "text/plain";
        },
      },
      /review handle artifact media type is invalid/,
    ],
    [
      "malformed artifact metadata",
      { artifactMetadataJson: () => "not-json" },
      /review artifact metadata is not valid JSON at index 0/,
    ],
    [
      "duplicate handle artifact kind",
      {
        artifactMetadataJson: (index: number, metadata: Record<string, unknown>) =>
          JSON.stringify(
            index === 1 ? record(array(reviewManifest.artifacts)[0]) : metadata,
          ),
      },
      /duplicate review handle artifact kind/,
    ],
    [
      "artifact byte size",
      {
        mutateArtifactBytes: (kind: string, bytes: Uint8Array): Uint8Array =>
          kind === "review-summary-json"
            ? Uint8Array.from([...bytes, 0])
            : bytes,
      },
      /review artifact integrity mismatch: review-summary-json/,
    ],
    [
      "artifact content digest",
      {
        mutateArtifactBytes: (kind: string, bytes: Uint8Array): Uint8Array => {
          if (kind === "review-summary-json" && bytes.length > 0) {
            bytes[0] = bytes[0]! ^ 1;
          }
          return bytes;
        },
      },
      /review artifact integrity mismatch: review-summary-json/,
    ],
  ] as const)(
    "fails closed at the review execution boundary for %s",
    async (_name, options, expected) => {
      await expectFakeReviewFailure(options, expected);
    },
  );

  it("preserves the primary manifest error when both WASM cleanup calls fail", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { handleFree, supportFree } = installFakeReviewRuntime({
      manifestJson: "not-json",
      handleFreeError: new Error("handle cleanup failed"),
      supportFreeError: new Error("support cleanup failed"),
    });
    try {
      await expect(
        queryRustReview(
          reviewSourceFixture(),
          "review-contract.csv",
          reviewOptions(),
          undefined,
          REVIEW_RUNTIME,
        ),
      ).rejects.toThrow(/runtime manifest is not valid JSON/);
      expect(handleFree).toHaveBeenCalledOnce();
      expect(supportFree).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledTimes(2);
    } finally {
      warning.mockRestore();
      setRustRuntimeForTesting(runtimeWasm);
    }
  });

  it.each([
    [
      "preflight options identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.optionsDigest = `sha256:${"f".repeat(64)}`;
        },
      },
      /runtime manifest options identity disagrees with opener preflight/,
    ],
    [
      "opener-set execution receipt",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.processingSummary.openerSetReceipt.applicability.relation =
            "source_equivalent";
        },
      },
      /opener-set execution receipt disagrees with preflight/,
    ],
    [
      "a maximum-duration receipt for a request that omitted every B06 key",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          (
            candidate.processingSummary as unknown as Record<string, unknown>
          ).maximumDurationReceipt = {
            protocolVersion: "chronicle-maximum-duration/v1",
            applicability: {
              protocolVersion: "chronicle-maximum-duration/v1",
              shape: "omitted_legacy",
              requestedPolicy: "strategy_native",
              effectivePolicy: "strategy_native",
              disposition: "not_applicable",
              thresholdSource: "strategy_native",
              thresholdNs: null,
              relation: "baseline_native",
              refusalReason: null,
              b06EffectiveStage: "post_reconstruction",
              reconstructionNativeStage: "post_reconstruction",
              checkedI128Preflight: null,
              legacyThresholdHoursCanonical: null,
              legacyThresholdNsCanonical: null,
              legacyOrigin: "absent",
            },
            checkpoint: "post_reconstruction",
            boundedEpisodeCount: 0,
            unboundedEpisodeCount: 0,
            qualifyingCount: 0,
            outcomeCounts: {},
            rawDurationTotalNs: "0",
            effectiveDurationTotalNs: "0",
            trimmedTotalNs: "0",
            droppedRawTotalNs: "0",
            headlineCreditedTotalNs: "0",
            excludedLineageDigest: `sha256:${"a".repeat(64)}`,
          };
        },
      },
      /maximum-duration receipt present for an omitted request/,
    ],
    [
      "an explicit B06 request whose manifest carries no receipt",
      {
        browserOptions: EXPLICIT_B06_OPTIONS,
        maximumDurationApplicabilityJson: () => explicitMaximumDurationJson(),
      },
      /maximum-duration receipt missing for an explicit request/,
    ],
    [
      "a maximum-duration answer computed for other browser settings",
      {
        browserOptions: EXPLICIT_B06_OPTIONS,
        maximumDurationApplicabilityJson: () =>
          explicitMaximumDurationJson({
            optionsDigest: `sha256:${"e".repeat(64)}`,
          }),
      },
      /runtime manifest options identity disagrees with maximum-duration preflight/,
    ],
    [
      "a maximum-duration receipt that disagrees with the preflight",
      {
        browserOptions: EXPLICIT_B06_OPTIONS,
        maximumDurationApplicabilityJson: () => explicitMaximumDurationJson(),
        mutateManifest: (candidate: RuntimeManifest): void => {
          (
            candidate.processingSummary as unknown as Record<string, unknown>
          ).maximumDurationReceipt = maximumDurationReceiptFixture({
            disposition: "drop_row",
          });
        },
      },
      /maximum-duration execution receipt disagrees with preflight/,
    ],
    [
      "request identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.requestId = "wrong-request";
        },
      },
      /runtime manifest request identity mismatch/,
    ],
    [
      "workspace identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.workspaceId = `sha256:${"7".repeat(64)}`;
        },
      },
      /runtime manifest workspace identity mismatch/,
    ],
    [
      "implementation identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.implementationDigest = `sha256:${"8".repeat(64)}`;
        },
      },
      /runtime manifest implementation identity mismatch/,
    ],
    [
      "build-environment identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.buildEnvironmentDigest = `sha256:${"9".repeat(64)}`;
        },
      },
      /runtime manifest build-environment identity mismatch/,
    ],
    [
      "input digest",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.input.digest = `sha256:${"a".repeat(64)}`;
        },
      },
      /runtime manifest input identity mismatch/,
    ],
    [
      "input size",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.input.size += 1;
        },
      },
      /runtime manifest input identity mismatch/,
    ],
    [
      "previous-root identity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.previousWorkspaceRootDigest = `sha256:${"b".repeat(64)}`;
        },
      },
      /runtime manifest previous-root identity mismatch/,
    ],
    [
      "invalid artifact metadata JSON",
      { artifactMetadataJson: () => "not-json" },
      /runtime artifact metadata is not valid JSON at index 0/,
    ],
    [
      "duplicate artifact kinds",
      {
        artifactMetadataJson: (
          index: number,
          metadata: RuntimeManifest["artifacts"][number],
        ): string =>
          JSON.stringify(index === 1 ? manifest.artifacts[0] : metadata),
      },
      /duplicate runtime artifact kind/,
    ],
    [
      "artifact byte size",
      {
        mutateArtifactBytes: (_kind: string, bytes: Uint8Array): Uint8Array =>
          bytes.subarray(0, Math.max(0, bytes.byteLength - 1)),
      },
      /runtime artifact integrity mismatch/,
    ],
    [
      "artifact content digest",
      {
        mutateArtifactBytes: (_kind: string, bytes: Uint8Array): Uint8Array => {
          if (bytes.byteLength > 0) bytes[0] = (bytes[0] ?? 0) ^ 1;
          return bytes;
        },
      },
      /runtime artifact integrity mismatch/,
    ],
    [
      "unknown ingress role",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          const assignment = candidate.roleAssignments.find(
            ({ role_id }) => role_id !== "processing_options",
          );
          if (!assignment) throw new Error("fixture has no ingress assignment");
          assignment.role_id = "unknown_ingress";
        },
      },
      /runtime declared an unknown ingress role/,
    ],
    [
      "ingress byte size",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          const assignment = candidate.roleAssignments.find(
            ({ role_id }) => role_id !== "processing_options",
          );
          if (!assignment) throw new Error("fixture has no ingress assignment");
          assignment.artifact.size += 1;
        },
      },
      /runtime ingress assignment size mismatch/,
    ],
    [
      "missing workspace root artifact",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.artifacts = candidate.artifacts.filter(
            ({ kind }) => kind !== "workspace-root-json",
          );
        },
      },
      /runtime artifact set is missing its workspace root/,
    ],
    [
      "missing referenced closure artifact",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          candidate.artifacts = candidate.artifacts.filter(
            ({ kind }) => kind !== "source-coordinate-index-arrow",
          );
        },
      },
      /runtime artifact set is missing sha256:/,
    ],
  ] as Array<[string, FakeFullRuntimeOptions, RegExp]>)(
    "fails closed at the full execution boundary for %s",
    async (_name, options, expected) => {
      await expectFakeFullFailure(options, expected);
    },
  );

  it.each([
    [
      "artifact integrity",
      {
        mutateArtifactBytes: (_kind: string, bytes: Uint8Array): Uint8Array =>
          bytes.subarray(0, Math.max(0, bytes.byteLength - 1)),
      },
      /artifact size mismatch/,
    ],
    [
      "artifact digest integrity",
      {
        mutateArtifactBytes: (_kind: string, bytes: Uint8Array): Uint8Array => {
          const changed = Uint8Array.from(bytes);
          if (changed.byteLength > 0) changed[0] = (changed[0] ?? 0) ^ 1;
          return changed;
        },
      },
      /OPFS verification failed/,
    ],
    [
      "unknown ingress role",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          const assignment = candidate.roleAssignments.find(
            ({ role_id }) => role_id !== "processing_options",
          );
          if (!assignment) throw new Error("fixture has no ingress assignment");
          assignment.role_id = "unknown_ingress";
        },
      },
      /runtime declared an unknown ingress role/,
    ],
    [
      "ingress integrity",
      {
        mutateManifest: (candidate: RuntimeManifest): void => {
          const assignment = candidate.roleAssignments.find(
            ({ role_id }) => role_id !== "processing_options",
          );
          if (!assignment) throw new Error("fixture has no ingress assignment");
          assignment.artifact.size += 1;
        },
      },
      /runtime ingress assignment integrity mismatch/,
    ],
  ] as Array<[string, FakeFullRuntimeOptions, RegExp]>)(
    "fails closed while streaming to OPFS for %s",
    async (_name, options, expected) => {
      await expectFakeStreamFullFailure(options, expected);
    },
  );

  it("rejects unknown persisted-base selections, frees the prepared handle, and treats none as a clean miss", async () => {
    const root = new MemoryDirectoryHandle();
    const priorNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve(memoryOpfsRoot(root)),
      },
      locks: {
        request: (
          _name: string,
          _options: LockOptions,
          operation: () => Promise<unknown>,
        ) => operation(),
      },
    });
    const raw = fullSourceFixture();
    const runtime = { ...REVIEW_RUNTIME, persistRustWorkspace: true };
    try {
      const persisted = await executeRustRuntime(
        raw,
        "runtime-contract.csv",
        reviewOptions(),
        undefined,
        runtime,
      );
      const inputDigest = persisted.manifest.input.digest.replace(
        /^sha256:/,
        "",
      );
      const realReview = await queryPersistedRustReview(
        raw.byteLength,
        "runtime-contract.csv",
        reviewOptions(),
        undefined,
        runtime,
        inputDigest,
      );
      if (!realReview) throw new Error("fixture review unexpectedly missed");
      const coldReviewFixture = reviewHandleFixtureForExecution(realReview);
      const installPreparedRuntime = (required: string) => {
        const preparedFree = vi.fn();
        const fakeRuntime = {
          implementation_build_digest: () => manifest.implementationDigest,
          build_environment_digest: () => manifest.buildEnvironmentDigest,
          opener_set_applicability_json: (requestJson: string) =>
            openerSetPreflightJson(requestJson, realReview.optionsDigest),
          review_base_probe_spec_json: () =>
            runtimeWasm.review_base_probe_spec_json(),
          RuntimeSupportFiles: class {
            put() {}
            put_with_name() {}
            free() {}
          },
          prepare_persisted_workspace_review: () => ({
            required_base_kind: () => required,
            execute_selected_base: () => {
              throw new Error("test must not execute a base");
            },
            free: preparedFree,
          }),
        } as unknown as Parameters<typeof setRustRuntimeForTesting>[0];
        setRustRuntimeForTesting(fakeRuntime);
        return preparedFree;
      };

      const unknownFree = installPreparedRuntime("mystery-base");
      await expect(
        queryPersistedRustReview(
          raw.byteLength,
          "runtime-contract.csv",
          reviewOptions(),
          undefined,
          runtime,
          inputDigest,
        ),
      ).rejects.toThrow(/Rust selected an unknown review base: mystery-base/);
      expect(unknownFree).toHaveBeenCalledOnce();

      const noneFree = installPreparedRuntime("none");
      await expect(
        queryPersistedRustReview(
          raw.byteLength,
          "runtime-contract.csv",
          reviewOptions(),
          undefined,
          runtime,
          inputDigest,
        ),
      ).resolves.toBeNull();
      expect(noneFree).toHaveBeenCalledOnce();

      const supportConstructed = vi.fn();
      const supportPut = vi.fn();
      const supportFreed = vi.fn();
      const warmPreparedFreed = vi.fn();
      const warmHandleFreed = vi.fn();
      const selectedBaseSizes: number[] = [];
      setRustRuntimeForTesting({
        implementation_build_digest: () => manifest.implementationDigest,
        build_environment_digest: () => manifest.buildEnvironmentDigest,
        opener_set_applicability_json: (requestJson: string) =>
          openerSetPreflightJson(requestJson, realReview.optionsDigest),
        review_base_probe_spec_json: () =>
          runtimeWasm.review_base_probe_spec_json(),
        RuntimeSupportFiles: class {
          constructor() {
            supportConstructed();
          }
          put() {}
          put_with_name(role: string, name: string, bytes: Uint8Array) {
            supportPut(role, name, Array.from(bytes));
          }
          free() {
            supportFreed();
          }
        },
        prepare_persisted_workspace_review: () => ({
          required_base_kind: () => "salsa-memory",
          execute_selected_base: (bytes: Uint8Array) => {
            selectedBaseSizes.push(bytes.byteLength);
            return kernelHandleFromReviewFixture(
              coldReviewFixture,
              warmHandleFreed,
            );
          },
          free: warmPreparedFreed,
        }),
      } as unknown as Parameters<typeof setRustRuntimeForTesting>[0]);
      const supportBundle = {
        anchorEventsFile: {
          name: "anchors.csv",
          bytes: new TextEncoder().encode(
            "participant_id,anchor_timestamp\nP01,2026-01-01 12:00:00\n",
          ).buffer,
        },
      };
      const verifiedSupportKey = `sha256:${"a".repeat(64)}`;
      for (let index = 0; index < 2; index += 1) {
        await expect(
          queryPersistedRustReview(
            raw.byteLength,
            "runtime-contract.csv",
            reviewOptions(),
            supportBundle,
            runtime,
            inputDigest,
            verifiedSupportKey,
          ),
        ).resolves.not.toBeNull();
      }
      expect(selectedBaseSizes).toEqual([0, 0]);
      expect(supportConstructed).toHaveBeenCalledOnce();
      expect(supportPut).toHaveBeenCalledOnce();
      expect(supportPut).toHaveBeenCalledWith(
        "anchor_events_file",
        "anchors.csv",
        Array.from(
          new TextEncoder().encode(
            "participant_id,anchor_timestamp\nP01,2026-01-01 12:00:00\n",
          ),
        ),
      );
      expect(warmPreparedFreed).toHaveBeenCalledTimes(2);
      expect(warmHandleFreed).toHaveBeenCalledTimes(2);
      expect(supportFreed).not.toHaveBeenCalled();

      const fallbackPreparedFree = vi.fn();
      const fallbackHandleFree = vi.fn();
      const fallbackRuntime = {
        implementation_build_digest: () => manifest.implementationDigest,
        build_environment_digest: () => manifest.buildEnvironmentDigest,
        opener_set_applicability_json: (requestJson: string) =>
          openerSetPreflightJson(requestJson, realReview.optionsDigest),
        review_base_probe_spec_json: () =>
          runtimeWasm.review_base_probe_spec_json(),
        RuntimeSupportFiles: class {
          put() {}
          put_with_name() {}
          free() {}
        },
        prepare_persisted_workspace_review: () => ({
          required_base_kind: () => "none",
          execute_selected_base: () => {
            throw new Error("test must fall back to raw bytes");
          },
          free: fallbackPreparedFree,
        }),
        execute_workspace: () =>
          kernelHandleFromReviewFixture(
            coldReviewFixture,
            fallbackHandleFree,
          ),
      } as unknown as Parameters<typeof setRustRuntimeForTesting>[0];
      setRustRuntimeForTesting(fallbackRuntime);
      expect(supportFreed).toHaveBeenCalledOnce();
      const trace = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      const fallback = await queryRustReview(
        raw,
        "runtime-contract.csv",
        reviewOptions(),
        undefined,
        { ...runtime, performanceTraceId: "review-fallback-contract" },
        inputDigest,
      );
      trace.mockRestore();
      expect(fallback.reviewSummaryJsonBytes).toEqual(
        realReview.reviewSummaryJsonBytes,
      );
      expect(fallbackPreparedFree).toHaveBeenCalledOnce();
      expect(fallbackHandleFree).toHaveBeenCalledOnce();
    } finally {
      setRustRuntimeForTesting(runtimeWasm);
      vi.stubGlobal("navigator", priorNavigator);
    }
  });

  it("supplies persisted review bases to the kernel and gates reused review summaries", async () => {
    const root = new MemoryDirectoryHandle();
    const priorNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve(memoryOpfsRoot(root)),
      },
      locks: {
        request: (
          _name: string,
          _options: LockOptions,
          operation: () => Promise<unknown>,
        ) => operation(),
      },
    });
    const raw = fullSourceFixture();
    const runtime = { ...REVIEW_RUNTIME, persistRustWorkspace: true };
    try {
      const persisted = await executeRustRuntime(
        raw,
        "review-base-contract.csv",
        reviewOptions(),
        undefined,
        runtime,
      );
      const inputDigest = persisted.manifest.input.digest.replace(
        /^sha256:/,
        "",
      );
      const realReview = await queryPersistedRustReview(
        raw.byteLength,
        "review-base-contract.csv",
        reviewOptions(),
        undefined,
        runtime,
        inputDigest,
      );
      if (!realReview) throw new Error("fixture review unexpectedly missed");
      const coldReviewFixture = reviewHandleFixtureForExecution(realReview);
      const reusedReviewHandleFixture = reviewHandleFixtureForExecution(
        realReview,
        true,
      );
      const installRuntime = (input: {
        required: string;
        fixture?: ReviewHandleFixture;
        artifactCount?: number;
        onSelected?: (bytes: Uint8Array) => void;
        onPair?: (
          reviewBytes: Uint8Array,
          reconstructionBytes: Uint8Array,
        ) => void;
      }) =>
        setRustRuntimeForTesting({
          implementation_build_digest: () => manifest.implementationDigest,
          build_environment_digest: () => manifest.buildEnvironmentDigest,
          opener_set_applicability_json: (requestJson: string) =>
            openerSetPreflightJson(requestJson, realReview.optionsDigest),
          review_base_probe_spec_json: () =>
            runtimeWasm.review_base_probe_spec_json(),
          RuntimeSupportFiles: class {
            put() {}
            put_with_name() {}
            free() {}
          },
          prepare_persisted_workspace_review: () => ({
            required_base_kind: () => input.required,
            execute_selected_base: (bytes: Uint8Array) => {
              input.onSelected?.(bytes);
              const fixture = input.fixture ?? coldReviewFixture;
              return kernelHandleFromReviewFixture(
                fixture,
                undefined,
                input.artifactCount ?? fixture.metadata.length,
              );
            },
            execute_selected_base_pair: (
              reviewBytes: Uint8Array,
              reconstructionBytes: Uint8Array,
            ) => {
              input.onPair?.(reviewBytes, reconstructionBytes);
              const fixture = input.fixture ?? coldReviewFixture;
              return kernelHandleFromReviewFixture(
                fixture,
                undefined,
                input.artifactCount ?? fixture.metadata.length,
              );
            },
            free: () => {},
          }),
        } as unknown as Parameters<typeof setRustRuntimeForTesting>[0]);

      // A required review-base is read out of the persisted workspace and
      // handed to the kernel. Each query commits a new root, so the second
      // call re-reads a fresh base rather than serving the cached one.
      const suppliedSizes: number[] = [];
      installRuntime({
        required: "review-base",
        onSelected: (bytes) => suppliedSizes.push(bytes.byteLength),
      });
      const query = () =>
        queryPersistedRustReview(
          raw.byteLength,
          "review-base-contract.csv",
          reviewOptions(),
          undefined,
          runtime,
          inputDigest,
        );
      // Both counters start at the probe prefix already read for that kind,
      // so a selected base is reported as probe + selected bytes.
      const probeSpec = JSON.parse(
        runtimeWasm.review_base_probe_spec_json(),
      ) as { reviewBaseBytes: number; reconstructionBaseBytes: number };
      const first = await query();
      expect(suppliedSizes).toHaveLength(1);
      expect(suppliedSizes[0]).toBeGreaterThan(0);
      expect(first?.suppliedReviewBaseBytes).toBe(
        probeSpec.reviewBaseBytes + (suppliedSizes[0] ?? 0),
      );
      expect(first?.suppliedReconstructionBaseBytes).toBe(
        probeSpec.reconstructionBaseBytes,
      );

      suppliedSizes.length = 0;
      const second = await query();
      expect(suppliedSizes).toHaveLength(1);
      expect(second?.suppliedReviewBaseBytes).toBe(
        probeSpec.reviewBaseBytes + (suppliedSizes[0] ?? 0),
      );

      // A reconstruction-base selection transfers BOTH complete envelopes —
      // the reconstruction base plus its review-base companion (the kernel
      // fails closed on a header-only review base) — and each counter
      // attributes probe + full envelope for its kind.
      const pairSizes: Array<[number, number]> = [];
      installRuntime({
        required: "reconstruction-base",
        onPair: (reviewBytes, reconstructionBytes) =>
          pairSizes.push([
            reviewBytes.byteLength,
            reconstructionBytes.byteLength,
          ]),
      });
      const reconstruction = await query();
      expect(pairSizes).toHaveLength(1);
      expect(pairSizes[0]?.[0]).toBeGreaterThan(0);
      expect(pairSizes[0]?.[1]).toBeGreaterThan(0);
      expect(reconstruction?.suppliedReconstructionBaseBytes).toBe(
        probeSpec.reconstructionBaseBytes + (pairSizes[0]?.[1] ?? 0),
      );
      expect(reconstruction?.suppliedReviewBaseBytes).toBe(
        probeSpec.reviewBaseBytes + (pairSizes[0]?.[0] ?? 0),
      );

      // Reused-summary manifests are only honoured for a digest the caller
      // actually offered. They omit only summary bytes and still drain every
      // scientific sidecar in the manifest catalog.
      const reusedQuery = (knownDigests?: string[]) =>
        queryPersistedRustReview(
          raw.byteLength,
          "review-base-contract.csv",
          reviewOptions(),
          undefined,
          runtime,
          inputDigest,
          undefined,
          knownDigests,
        );

      installRuntime({
        required: "review-base",
        fixture: reusedReviewHandleFixture,
      });
      await expect(reusedQuery()).rejects.toThrow(
        /reused a summary digest the caller never offered/,
      );
      await expect(reusedQuery(["sha256:not-the-one"])).rejects.toThrow(
        /reused a summary digest the caller never offered/,
      );

      installRuntime({
        required: "review-base",
        fixture: reusedReviewHandleFixture,
        artifactCount: reusedReviewHandleFixture.metadata.length + 1,
      });
      await expect(
        reusedQuery([realReview.reviewSummaryDigest]),
      ).rejects.toThrow(/review manifest\/handle artifact count mismatch/);

      installRuntime({
        required: "review-base",
        fixture: reusedReviewHandleFixture,
      });
      const reused = await reusedQuery([realReview.reviewSummaryDigest]);
      expect(reused?.reviewSummaryReused).toBe(true);
      expect(reused?.reviewSummaryDigest).toBe(realReview.reviewSummaryDigest);
    } finally {
      setRustRuntimeForTesting(runtimeWasm);
      vi.stubGlobal("navigator", priorNavigator);
    }
  });

  it("bounds the support-file cache, rejects unverified keys, and drops failed entries", async () => {
    const root = new MemoryDirectoryHandle();
    const priorNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve(memoryOpfsRoot(root)),
      },
      locks: {
        request: (
          _name: string,
          _options: LockOptions,
          operation: () => Promise<unknown>,
        ) => operation(),
      },
    });
    const raw = fullSourceFixture();
    const runtime = { ...REVIEW_RUNTIME, persistRustWorkspace: true };
    try {
      const persisted = await executeRustRuntime(
        raw,
        "support-cache-contract.csv",
        reviewOptions(),
        undefined,
        runtime,
      );
      // A second durable full run recovers the prior root and re-verifies it.
      const recovered = await executeRustRuntime(
        raw,
        "support-cache-contract.csv",
        reviewOptions(),
        undefined,
        runtime,
      );
      expect(recovered.manifest.previousWorkspaceRootDigest).toBe(
        persisted.manifest.workspaceRootDigest,
      );
      const inputDigest = persisted.manifest.input.digest.replace(
        /^sha256:/,
        "",
      );
      const realReview = await queryPersistedRustReview(
        raw.byteLength,
        "support-cache-contract.csv",
        reviewOptions(),
        undefined,
        runtime,
        inputDigest,
      );
      if (!realReview) throw new Error("fixture review unexpectedly missed");
      const coldReviewFixture = reviewHandleFixtureForExecution(realReview);

      // The runtime only reports wasm memory for a genuinely loaded kernel;
      // an injected test kernel has none.
      expect(rustWasmMemoryBytes()).toBeNull();

      const supportBundle = (label: string) => ({
        surveyAttributionFile: {
          name: `${label}.csv`,
          bytes: new TextEncoder().encode(`participant_id,survey_id\nP01,${label}`)
            .buffer,
        },
      });
      const freed: string[] = [];
      const installRuntime = (fail: boolean) =>
        setRustRuntimeForTesting({
          implementation_build_digest: () => manifest.implementationDigest,
          build_environment_digest: () => manifest.buildEnvironmentDigest,
          opener_set_applicability_json: (requestJson: string) =>
            openerSetPreflightJson(requestJson, realReview.optionsDigest),
          review_base_probe_spec_json: () =>
            runtimeWasm.review_base_probe_spec_json(),
          RuntimeSupportFiles: class {
            put() {}
            put_with_name() {}
            free() {
              freed.push("support");
            }
          },
          prepare_persisted_workspace_review: () => ({
            required_base_kind: () => "salsa-memory",
            execute_selected_base: () => {
              if (fail) throw new Error("support-cache run failed");
              return kernelHandleFromReviewFixture(coldReviewFixture);
            },
            free: () => {},
          }),
        } as unknown as Parameters<typeof setRustRuntimeForTesting>[0]);

      const review = (supportKey: string | undefined, label: string) =>
        queryPersistedRustReview(
          raw.byteLength,
          "support-cache-contract.csv",
          reviewOptions(),
          supportBundle(label),
          runtime,
          inputDigest,
          supportKey,
        );

      installRuntime(false);
      // An unverified support key never reaches the kernel.
      await expect(review("not-a-verified-key", "a")).rejects.toThrow(
        /verified support cache key is invalid/,
      );

      // The cache holds at most two bundles, so a third distinct key evicts
      // (and frees) the least recently used one.
      const keys = ["a", "b", "c"].map((c) => `sha256:${c.repeat(64)}`);
      for (const [index, key] of keys.entries()) {
        await expect(review(key, `bundle-${index}`)).resolves.not.toBeNull();
      }
      expect(freed).toHaveLength(1);

      // A failed run marks its cached bundle invalid, so it is dropped and
      // freed on release rather than served to the next query.
      const freedBeforeFailure = freed.length;
      installRuntime(true);
      await expect(review(keys[0], "bundle-0")).rejects.toThrow(
        /support-cache run failed/,
      );
      expect(freed.length).toBeGreaterThan(freedBeforeFailure);
    } finally {
      setRustRuntimeForTesting(runtimeWasm);
      vi.stubGlobal("navigator", priorNavigator);
    }
  });

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

  it("keeps the entire query registry warm when OPFS persistence is disabled", async () => {
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
      incrementalEngine: true,
      provenanceEvidence: true,
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
      second.manifest.queryExecutions.filter(
        ({ status }) => status === "recomputed" || status === "error",
      ),
    ).toEqual([]);
    const runSpecificArtifacts = new Set([
      "execution-ledger-json",
      "workflow-provenance-jsonld",
      "semantic-index-source-json",
      "correspondence-index-json",
      "evidence-journal",
      "execution-state-json",
      "workflow-explorer-view-json",
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

  it("recomputes the entire query registry on every run when the incremental engine is off or unset", async () => {
    const raw = new TextEncoder().encode(
      [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,Example,Unknown importance: 1,example.app,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,Example,Unknown importance: 2,example.app,2026-03-07 10:01:00,America/Chicago",
      ].join("\n"),
    );
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
      studyName: "Sequential engine proof",
      selectedTimezone: "America/Chicago",
      timezoneHandling: "selected-convert" as const,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
      processScreenUsage: false,
      enablePlotting: false,
    };
    const incremental = await executeRustRuntime(
      raw,
      "sequential-engine.csv",
      options,
      undefined,
      {
        datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
        persistRustWorkspace: false,
        incrementalEngine: true,
        provenanceEvidence: true,
      },
    );
    const runtime = {
      datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
      persistRustWorkspace: false,
      incrementalEngine: false,
    };
    const first = await executeRustRuntime(
      raw,
      "sequential-engine.csv",
      options,
      undefined,
      runtime,
    );
    const second = await executeRustRuntime(
      raw,
      "sequential-engine.csv",
      options,
      undefined,
      runtime,
    );
    // Omitting the flag selects the sequential engine, not Salsa.
    const omitted = await executeRustRuntime(
      raw,
      "sequential-engine.csv",
      options,
      undefined,
      {
        datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
        persistRustWorkspace: false,
      },
    );
    const outputDigests = (manifest: typeof first.manifest) =>
      Object.fromEntries(
        manifest.queryExecutions.map(({ query_id, output_digest }) => [
          query_id,
          output_digest,
        ]),
      );
    for (const run of [first, second, omitted]) {
      expect(
        run.manifest.queryExecutions.filter(
          ({ status }) => status !== "recomputed" && status !== "bypassed",
        ),
      ).toEqual([]);
      expect(outputDigests(run.manifest)).toEqual(
        outputDigests(incremental.manifest),
      );
      expect(run.artifacts.has("review-base")).toBe(false);
    }
    expect(incremental.artifacts.has("review-base")).toBe(true);
  });

  it("omits provenance evidence by default while publishing row lineage", async () => {
    const optionalKinds = [
      "source-coordinate-index-arrow",
      "result-cell-correspondence-arrow",
      "source-result-influence-arrow",
    ];
    const executeWorkspace = vi.fn(
      (...args: Parameters<typeof runtimeWasm.execute_workspace>) =>
        runtimeWasm.execute_workspace(...args),
    );
    setRustRuntimeForTesting({
      ...runtimeWasm,
      execute_workspace: executeWorkspace,
    });
    try {
      const run = await executeRustRuntime(
        fullSourceFixture(),
        "default-provenance-evidence.csv",
        fullOptions(),
        undefined,
        {
          datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
          persistRustWorkspace: false,
        },
      );
      const request = JSON.parse(
        executeWorkspace.mock.calls[0]?.[0] ?? "{}",
      ) as { provenanceEvidence?: boolean };
      expect(request.provenanceEvidence).toBe(false);
      expect(run.artifacts.has("row-lineage-arrow")).toBe(true);
      for (const kind of optionalKinds) {
        expect(
          run.manifest.artifacts.some((artifact) => artifact.kind === kind),
        ).toBe(false);
        expect(run.artifacts.has(kind)).toBe(false);
      }
    } finally {
      setRustRuntimeForTesting(runtimeWasm);
    }
  });

  it("runs the app's default options through the sequential engine and the live scientific preflight", async () => {
    const raw = new TextEncoder().encode(
      [
        "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
        "Study,P01,Target Child,,Screen Interactive,android,2026-03-07 10:00:00,America/Chicago",
        "Study,P01,Target Child,,Keyguard Hidden,android,2026-03-07 10:00:01,America/Chicago",
        "Study,P01,Target Child,Example,Activity Resumed,example.app,2026-03-07 10:00:02,America/Chicago",
        "Study,P01,Target Child,Example,Activity Paused,example.app,2026-03-07 10:03:00,America/Chicago",
        "Study,P01,Target Child,,Keyguard Shown,android,2026-03-07 10:04:00,America/Chicago",
        "Study,P01,Target Child,,Screen Non-Interactive,android,2026-03-07 10:04:01,America/Chicago",
      ].join("\n"),
    );
    const options = {
      ...DEFAULT_BROWSER_OPTIONS,
      studyName: "Sequential default options",
      selectedTimezone: "America/Chicago",
      timezoneHandling: "selected-convert" as const,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
    };
    expect(options.processScreenUsage).toBe(true);
    const run = await executeRustRuntime(
      raw,
      "sequential-default-options.csv",
      options,
      undefined,
      {
        datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
        persistRustWorkspace: false,
        incrementalEngine: false,
      },
    );
    expect(
      run.manifest.queryExecutions.filter(
        ({ status }) => status === "cached" || status === "error",
      ),
    ).toEqual([]);
    expect(run.artifacts.has("review-base")).toBe(false);
    expect(run.artifacts.has("screen-csv")).toBe(true);
  });

  it("streams a complete Rust run into OPFS and resumes review from its verified bases", async () => {
    const root = new MemoryDirectoryHandle();
    const priorNavigator = globalThis.navigator;
    const lockRequest = vi.fn(
      async (
        _name: string,
        _options: LockOptions,
        operation: () => Promise<unknown>,
      ) => operation(),
    );
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve(memoryOpfsRoot(root)),
      },
      locks: { request: lockRequest },
    });
    try {
      const raw = new TextEncoder().encode(
        [
          "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
          "Study,P01,Target Child,Example,Activity Resumed,example.app,2026-03-07 10:00:00,America/Chicago",
          "Study,P01,Target Child,Example,Activity Paused,example.app,2026-03-07 10:01:00,America/Chicago",
        ].join("\n"),
      );
      const options = {
        ...DEFAULT_BROWSER_OPTIONS,
        studyName: "Persisted runtime proof",
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
        persistRustWorkspace: true,
        incrementalEngine: true,
        provenanceEvidence: true,
      };

      const first = await executeRustRuntime(
        raw,
        "persisted-runtime-proof.csv",
        options,
        undefined,
        runtime,
      );
      expect(first.persistedWorkspace?.workspaceRootDigest).toBe(
        first.manifest.workspaceRootDigest,
      );
      expect([...first.artifacts.keys()].sort()).toEqual([
        "execution-ledger-json",
        "workflow-explorer-view-json",
      ]);

      const review = await queryPersistedRustReview(
        raw.byteLength,
        "persisted-runtime-proof.csv",
        { ...options, minimumUsageDuration: 0.25 },
        undefined,
        runtime,
        first.manifest.input.digest.replace(/^sha256:/, ""),
      );
      expect(review).not.toBeNull();
      if (!review) throw new Error("persisted review unexpectedly missed");
      expect(review.previousWorkspaceRootDigest).toBe(
        first.manifest.workspaceRootDigest,
      );
      expect(review.suppliedReviewBaseBytes).toBeGreaterThan(0);
      expect(review.suppliedReconstructionBaseBytes).toBeGreaterThan(0);
      expect(review.cacheSources).toEqual(["salsa-memory"]);
      const timezoneReview = await queryPersistedRustReview(
        raw.byteLength,
        "persisted-runtime-proof.csv",
        { ...options, timezoneHandling: "primary-convert" },
        undefined,
        runtime,
        first.manifest.input.digest.replace(/^sha256:/, ""),
      );
      expect(timezoneReview).not.toBeNull();
      expect(timezoneReview?.cacheSources).toEqual(["salsa-memory"]);
      expect(timezoneReview?.recomputedQueryIds).toEqual([
        "resolve_timezone_strategy",
        "standardize_event_clock",
        "summarize_row_selection",
        "classify_episode_durations",
        "apply_app_inclusion_policy",
        "order_app_episodes",
        // The B03–B05 foundational semantics made the concurrent-subinterval
        // floor consume the ordered episodes, so a timezone flip now also
        // recomputes the concurrency segmentation.
        "segment_concurrent_usage",
        "assemble_result_manifest",
      ]);
      expect(lockRequest).toHaveBeenCalledTimes(3);
      expect(lockRequest.mock.calls.map(([, options]) => options.mode)).toEqual(
        ["exclusive", "shared", "shared"],
      );
    } finally {
      vi.stubGlobal("navigator", priorNavigator);
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
      incrementalEngine: true,
      provenanceEvidence: true,
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
    expect(review.reviewSummaryJsonBytes).toEqual(
      full.artifacts.get("review-summary-json"),
    );
    expect(review.recomputedQueryIds).toEqual([
      // See the timezone pin above: the concurrent-subinterval floor made
      // the concurrency segmentation participate in the review warm path.
      "segment_concurrent_usage",
      // The session numbering reads `review_only` to pick its checkpoint
      // shape, so it recomputes on a review for the same reason B14 does.
      "assign_usage_session_ids",
      "resolve_participant_windows",
      "apply_participant_windows",
      "resolve_sharing_status",
      "classify_person_attribution",
      // B14 reads `review_only` to pick its passthrough checkpoint shape, so
      // it recomputes on a review exactly like the placeholder step it feeds.
      "divide_sessions_at_day_boundary",
      "synthesize_placeholder_rows",
      "assemble_result_manifest",
    ]);
    expect(review.skippedQueryIds).toEqual(["index_raw_dates"]);
    expect(review.errorQueryIds).toEqual([]);
    expect(
      review.cachedQueryIds.length +
        review.recomputedQueryIds.length +
        review.bypassedQueryIds.length +
        review.skippedQueryIds.length +
        review.errorQueryIds.length,
    ).toBe(WORKFLOW_QUERY_IDS.length);
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
        query_group_id: "filter-rows",
        state: "open",
        reason_id: "reason:missing-filter-file",
      },
      {
        obligation_id: "obligation:workspace",
        role_id: "role:workspace",
        query_group_id: null,
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
          query_group_id: null,
          state: "blocked",
        },
      ],
    });
  });

  it("accepts an explicit no-output node execution without inventing an artifact", () => {
    const candidate = cloneManifest();
    const firstExecution = candidate.queryGroupExecutions[0];
    if (firstExecution === undefined) throw new Error("fixture manifest has no node executions");
    firstExecution.output = null;

    expect(
      decodeRuntimeManifest(candidate).queryGroupExecutions[0]?.output,
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
    const priorNavigator = globalThis.navigator;
    setRustPersistenceForTesting(null);
    vi.stubGlobal("navigator", {});
    try {
      await expect(
        executeRustRuntime(
          new TextEncoder().encode("header\n"),
          "no-web-locks.csv",
          {
            ...DEFAULT_BROWSER_OPTIONS,
            timezoneHandling: "primary-convert",
            useAppCodebook: false,
          },
          undefined,
          {
            datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
            persistRustWorkspace: true,
          },
        ),
      ).rejects.toThrow(/Durable processing requires the browser Web Locks API/);
    } finally {
      vi.stubGlobal("navigator", priorNavigator);
    }
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
        incrementalEngine: true,
        provenanceEvidence: true,
      },
    );
    const metadata = execution.manifest.artifacts.find(
      ({ kind }) => kind === "source-coordinate-index-arrow",
    );
    const bytes = execution.artifacts.get("source-coordinate-index-arrow");
    const influenceMetadata = execution.manifest.artifacts.find(
      ({ kind }) => kind === "source-result-influence-arrow",
    );
    const influenceBytes = execution.artifacts.get(
      "source-result-influence-arrow",
    );
    const dependencyDigests = [
      "source-coordinate-index-arrow",
      "result-cell-correspondence-arrow",
      "row-lineage-arrow",
    ].map(
      (kind) =>
        execution.manifest.artifacts.find((artifact) => artifact.kind === kind)!
          .digest,
    );
    const resultCellMetadata = execution.manifest.artifacts.find(
      ({ kind }) => kind === "result-cell-correspondence-arrow",
    );
    expect(metadata).toBeDefined();
    expect(bytes).toBeDefined();
    expect(metadata?.rowCount).toBeGreaterThanOrEqual(4_800);
    expect(metadata?.size).toBe(bytes?.byteLength);
    expect(metadata?.size).toBeLessThanOrEqual(raw.byteLength * 3 + 65_536);
    // Pinned exactly for the same reason as the witness size below: the
    // semantic-federation documents publish these counts and byte sizes, and
    // only an upper bound stood between a schema change and a stale published
    // figure.
    expect(metadata?.rowCount).toBe(EXPECTED_SOURCE_COORDINATE_ROWS);
    expect(metadata?.size).toBe(EXPECTED_SOURCE_COORDINATE_BYTES);
    expect(resultCellMetadata?.rowCount).toBe(EXPECTED_RESULT_CELL_ROWS);
    expect(resultCellMetadata?.size).toBe(EXPECTED_RESULT_CELL_BYTES);
    expect(influenceMetadata).toBeDefined();
    expect(influenceBytes).toBeDefined();
    // Native FileReader independently decodes this selector dictionary to
    // 2,275 bytes. IPC requires an eight-byte signed length before LZ4; the
    // old target-width usize prefix was four bytes on the actual WASM build.
    const firstLz4Frame = influenceBytes!.findIndex(
      (byte, index, arrow) =>
        byte === 0x04 &&
        arrow[index + 1] === 0x22 &&
        arrow[index + 2] === 0x4d &&
        arrow[index + 3] === 0x18,
    );
    expect(firstLz4Frame).toBeGreaterThanOrEqual(8);
    expect(
      new DataView(
        influenceBytes!.buffer,
        influenceBytes!.byteOffset,
        influenceBytes!.byteLength,
      ).getBigInt64(firstLz4Frame - 8, true),
    ).toBe(2_275n);
    // v2 of the witness added the three field-level precision classes on top of
    // the v1 scope/checkpoint and row-lineage rows: exact single-source field
    // contributions, conservative lineage-search windows, and declared column
    // scope for the output kinds that have no row lineage. v3 then moved the
    // search-window bounds into their own `lineage-search-window` key kind and
    // named index space, which changes the encoded size but not the row count.
    // 985 → 996 when eyes_complement was bound to the reconstruction seam:
    // `episode_reconstruction_strategy` binds to two queries and its column
    // scope reaches every downstream output family. 996 → 1004 when
    // `interval_quality_policy` bound to `suppress_excluded_timing`: the option
    // itself plus the row fields that query newly declares as read and written.
    // 1004 → 1006 when the opt-in `app_usage_end_reason` column landed:
    // `include_app_usage_end_reason` binds to `assemble_result_manifest`, and
    // `materialize_candidate_episodes` newly declares the field it writes.
    // Those historical steps are not the complete artifact total: the exact
    // pre-B02 assertion was 1,026 rows. The B02 opener-set option and receipt
    // then add eleven bindings across the reconstruction, manifest,
    // provenance, and semantic-index surfaces. 1,037 → 1,128 when the
    // B02–B14 convergence landed the B03–B05 axes: the foundational
    // micro-use/minimum-duration columns, the screen-interval columns, the
    // review-summary receipt cell families, and the capability-evidence root
    // role each bind new field reads and writes; the source-coordinate
    // sidecar grew 4,891 → 4,895 rows with the four foundational app
    // columns for the same reason.
    expect(influenceMetadata?.rowCount).toBe(
      EXPECTED_INFLUENCE_WITNESS_ROWS,
    );
    expect(influenceMetadata?.size).toBe(influenceBytes?.byteLength);
    // Pinned exactly, not merely bounded. `docs/semantic-federation` publishes
    // this byte count, and a bound of 262,144 let the published figure drift
    // away from the artifact unnoticed while every test stayed green.
    expect(influenceMetadata?.size).toBe(EXPECTED_INFLUENCE_WITNESS_BYTES);
    expect(influenceMetadata?.size).toBeLessThanOrEqual(262_144);
    expect(influenceMetadata?.derivedFrom).toEqual(
      expect.arrayContaining(dependencyDigests),
    );
  });

  it.each(INVALID_CASES)("rejects %s", (_name, mutate, expected) => {
    const candidate = cloneManifest() as unknown as Record<string, unknown>;
    mutate(candidate);
    expect(() => decodeRuntimeManifest(candidate)).toThrow(expected);
  });

  it("rejects disagreement between manifest metadata and exposed WASM bytes", () => {
    const exposed = structuredClone(manifest.artifacts);
    const firstExposed = exposed[0];
    if (firstExposed === undefined) throw new Error("fixture manifest has no artifacts");
    firstExposed.size += 1;
    expect(() => verifyRuntimeArtifactCatalog(manifest, exposed)).toThrow(
      /artifact catalog mismatch/,
    );

    const firstArtifact = manifest.artifacts[0];
    if (firstArtifact === undefined) throw new Error("fixture manifest has no artifacts");
    expect(() =>
      verifyRuntimeArtifactCatalog(manifest, [
        ...structuredClone(manifest.artifacts),
        structuredClone(firstArtifact),
      ]),
    ).toThrow(/artifact catalog length mismatch/);

    const missingEvidence = cloneManifest();
    missingEvidence.journalDigest = `sha256:${"f".repeat(64)}`;
    expect(() =>
      verifyRuntimeArtifactCatalog(missingEvidence, manifest.artifacts),
    ).toThrow(/omits evidence or dependency certificate/);
  });
});
