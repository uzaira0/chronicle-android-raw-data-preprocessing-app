/**
 * Binding multiverse — how far apart do selectable source-aligned and controlled
 * reconstruction bindings put the same participant-day?
 *
 * Runs one raw CSV through every generated (event_retention_set × opener_set ×
 * episode_reconstruction_strategy × interval_quality_policy) arm against one
 * engine, retaining structured refusal receipts for inapplicable cells. It
 * then reports, per participant-day, the spread in daily app-usage minutes and
 * whether the day changes side of a declared analytic threshold.
 *
 * WHAT THIS CAN AND CANNOT ESTABLISH ON SYNTHETIC INPUT
 * -----------------------------------------------------
 * On a generated fixture the spread is a property of the GENERATOR, not of
 * children. Turning `injectLongAndMissingStops` on or off moves it directly.
 * So a synthetic run establishes exactly three things and no more:
 *   1. the harness runs and the arms really do dispatch differently;
 *   2. separate controlled invocations can localize divergence by contrasting
 *      fixtures that differ in one injected pathology;
 *   3. a falsification check — if the arms agree even with every pathology
 *      injected, the thesis is in trouble and that must be reported.
 * It cannot produce the headline magnitude. That needs real study data, where
 * the pathology rates are whatever they are rather than whatever we injected.
 * Any number this script prints must carry that caveat into the paper.
 *
 * Usage:
 *   npx vite-node scripts/measure_binding_multiverse.mts -- \
 *     --raw .tmp/paper/base.csv --thresholds 60,120 [--json out.json]
 *   ... --assert-b02-fixture # enable exact synthetic witness assertions
 *   ... --list-artifacts    # print artifact kinds for one arm and exit
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  DEFAULT_BROWSER_OPTIONS,
  EPISODE_RECONSTRUCTION_STRATEGY_VALUES,
  EVENT_RETENTION_SET_VALUES,
  INTERVAL_QUALITY_POLICY_VALUES,
  OPENER_SET_VALUES,
} from "../src/lib/generatedContract";
import type {
  BrowserProcessingOptions,
  EpisodeReconstructionStrategy,
  EventRetentionSet,
  IntervalQualityPolicy,
  OpenerSet,
} from "../src/lib/generatedContract";
import type {
  OpenerSetEvidence,
  OpenerSetPreflightDecision,
  RuntimeScientificPreflightReceipt,
} from "../src/lib/generatedRuntimeBoundary";
import { canonicalJson } from "../src/lib/canonicalJson";
import { requiresLiveScientificPreflight } from "../src/lib/inputCapabilityEvidence";
import { decodeScientificPreflightReceipt } from "../src/lib/scientificPreflightBoundary";
import { buildRustV2Options } from "../src/lib/rustPipelineRuntime";

type RuntimeModule = typeof import(
  "../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js"
);

type BindingVector = {
  eventRetentionSet: EventRetentionSet;
  openerSet: OpenerSet;
  episodeReconstructionStrategy: EpisodeReconstructionStrategy;
  intervalQualityPolicy: IntervalQualityPolicy;
};

type RuntimeIdentity = {
  protocolVersion: string;
  implementationDigest: string;
  buildEnvironmentDigest: string;
  productContractDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  dependencyCertificateDigest: string;
};

const ANALYSIS_TIMEZONE = "America/Chicago";
const ANALYSIS_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: ANALYSIS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const B02_FIXTURE_SHA256 =
  "sha256:f06238b1af5dc1cfc435d64a8f8759eba8fa4eb0bd89db284f787e92bc18657a";
const RUNTIME_IDENTITY_DIGEST_FIELDS = [
  "implementationDigest",
  "buildEnvironmentDigest",
  "productContractDigest",
  "planDigest",
  "profileDigest",
  "profileLockDigest",
  "runtimeAuthorityDigest",
  "dependencyCertificateDigest",
] as const;
const WORKFLOW_CONTRACT_DIGEST_FIELDS = [
  "semantic",
  "presentation",
  "execution",
  "checkpointPolicy",
  "evidence",
  "workspaceCompatibility",
] as const;

function parseArgs(argv: string[]) {
  let raw = "";
  let json = "";
  let thresholds = [60, 120];
  let listArtifacts = false;
  let assertB02Fixture = false;
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    const next = argv[i + 1];
    if (argument === "--raw" && next) {
      raw = next;
      i += 1;
    } else if (argument === "--json" && next) {
      json = next;
      i += 1;
    } else if (argument === "--thresholds" && next) {
      thresholds = next.split(",").map((value) => Number(value.trim()));
      i += 1;
    } else if (argument === "--list-artifacts") {
      listArtifacts = true;
    } else if (argument === "--assert-b02-fixture") {
      assertB02Fixture = true;
    }
  }
  if (!raw) throw new Error("--raw <path> is required");
  if (thresholds.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("--thresholds must be positive minute values");
  }
  return { raw, json, thresholds, listArtifacts, assertB02Fixture };
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Minimal RFC4180 reader. The pipeline quotes fields containing commas and the
 * synthetic corpus deliberately injects quoted and unicode labels, so splitting
 * on "," would silently misalign columns and produce a wrong daily total —
 * which would look like a binding disagreement rather than a parsing bug.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.length > 0));
}

const args = parseArgs(process.argv.slice(2));
const runtime = (await import(
  "../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js"
)) as RuntimeModule;
const wasmBytes = await readFile(
  "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
);
runtime.initSync({ module: wasmBytes });

const inputBytes = new Uint8Array(await readFile(args.raw));
const inputSha256 = sha256(inputBytes);
const wasmSha256 = sha256(wasmBytes);
const runtimeIdentity = JSON.parse(runtime.runtime_identity_json()) as RuntimeIdentity;
const workflowContract = JSON.parse(runtime.workflow_contract_json()) as {
  digests: Record<string, string>;
};
assertSha256("input digest", inputSha256);
assertSha256("compiled WASM digest", wasmSha256);
if (args.assertB02Fixture && inputSha256 !== B02_FIXTURE_SHA256) {
  throw new Error(
    `--assert-b02-fixture requires ${B02_FIXTURE_SHA256}, received ${inputSha256}`,
  );
}
if (runtimeIdentity.protocolVersion !== "chronicle-preprocessing-runtime/v2") {
  throw new Error(`unsupported runtime identity protocol ${runtimeIdentity.protocolVersion}`);
}
const runtimeIdentityFields = Object.keys(runtimeIdentity).sort();
const expectedRuntimeIdentityFields = [
  "protocolVersion",
  ...RUNTIME_IDENTITY_DIGEST_FIELDS,
].sort();
if (canonicalJson(runtimeIdentityFields) !== canonicalJson(expectedRuntimeIdentityFields)) {
  throw new Error(
    `runtime identity fields drifted: expected ${expectedRuntimeIdentityFields.join(",")}, got ${runtimeIdentityFields.join(",")}`,
  );
}
for (const field of RUNTIME_IDENTITY_DIGEST_FIELDS) {
  assertSha256(`runtime identity ${field}`, runtimeIdentity[field]);
}
const workflowDigestFields = Object.keys(workflowContract.digests).sort();
if (
  canonicalJson(workflowDigestFields) !==
  canonicalJson([...WORKFLOW_CONTRACT_DIGEST_FIELDS].sort())
) {
  throw new Error(
    `workflow-contract digest fields drifted: got ${workflowDigestFields.join(",")}`,
  );
}
for (const field of WORKFLOW_CONTRACT_DIGEST_FIELDS) {
  assertSha256(`workflow-contract ${field}`, workflowContract.digests[field]);
}
const supports = new runtime.RuntimeSupportFiles();

type DayKey = string; // `${participantId}\u0000${date}`
type ExecutableArmResult = {
  status: "executable";
  arm: string;
  vector: BindingVector;
  applicability: OpenerSetPreflightDecision;
  openerReceipt: OpenerSetEvidence;
  scientificPreflight: RuntimeScientificPreflightReceipt | null;
  daily: Map<DayKey, number>;
  rows: number;
  maxRowMinutes: number;
  appArtifactRowCount: number;
  digests: {
    options: string;
    implementation: string;
    productContract: string;
    workspaceRoot: string;
    runtimeIdentity: RuntimeIdentity;
    workflowContract: Record<string, string>;
    wasm: string;
    appOutput: string;
    openerReceipt: string;
  };
};
type RefusedArmResult = {
  status: "refused";
  refusalSource: "opener_set" | "scientific_preflight";
  arm: string;
  vector: BindingVector;
  applicability: OpenerSetPreflightDecision;
  scientificPreflight: RuntimeScientificPreflightReceipt | null;
  digests: {
    options: string;
    runtimeIdentity: RuntimeIdentity;
    workflowContract: Record<string, string>;
    wasm: string;
  };
};
type ArmResult = ExecutableArmResult | RefusedArmResult;

function armId(vector: BindingVector): string {
  return [
    `retention=${vector.eventRetentionSet}`,
    `opener=${vector.openerSet}`,
    `reconstruction=${vector.episodeReconstructionStrategy}`,
    `quality=${vector.intervalQualityPolicy}`,
  ].join("|");
}

function assertSha256(label: string, digest: unknown): asserts digest is string {
  if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`${label} is not a canonical SHA-256 digest: ${String(digest)}`);
  }
}

function expectedOpenerRelation(vector: BindingVector): string {
  if (vector.openerSet === "strategy_defined") return "baseline_native";
  if (vector.openerSet === "activity_resumed_only") {
    if (vector.episodeReconstructionStrategy === "fused_matcher") {
      return "baseline_equivalent";
    }
    if (vector.episodeReconstructionStrategy === "gesis_start_stop_repair") {
      return "controlled_derivative";
    }
    return "source_equivalent";
  }
  if (vector.openerSet === "gesis_app_scoped_starts") {
    if (vector.episodeReconstructionStrategy === "eyes_complement") return "refused";
    if (vector.episodeReconstructionStrategy === "gesis_start_stop_repair") {
      return "source_aligned_adapter";
    }
    return "controlled_derivative";
  }
  throw new Error(`unknown opener set ${vector.openerSet}`);
}

function validateApplicability(
  arm: string,
  vector: BindingVector,
  decision: OpenerSetPreflightDecision,
): void {
  const expectedRelation = expectedOpenerRelation(vector);
  const refused = expectedRelation === "refused";
  if (decision.requestedOpenerSetId !== vector.openerSet) {
    throw new Error(
      `arm ${arm}: requested opener ${decision.requestedOpenerSetId} disagrees with ${vector.openerSet}`,
    );
  }
  if (decision.resolvedOpenerSetId !== vector.openerSet) {
    throw new Error(
      `arm ${arm}: resolved opener ${decision.resolvedOpenerSetId} disagrees with ${vector.openerSet}`,
    );
  }
  const expectedEffective = refused ? null : vector.openerSet;
  if (decision.effectiveOpenerSetId !== expectedEffective) {
    throw new Error(
      `arm ${arm}: effective opener ${String(decision.effectiveOpenerSetId)} disagrees with ${String(expectedEffective)}`,
    );
  }
  if (decision.relation !== expectedRelation) {
    throw new Error(
      `arm ${arm}: relation ${decision.relation} disagrees with ${expectedRelation}`,
    );
  }
  if (decision.status !== (refused ? "refused" : "executable")) {
    throw new Error(
      `arm ${arm}: status ${decision.status} disagrees with relation ${expectedRelation}`,
    );
  }
  if (refused && decision.reasonCode !== "eyes_requires_lifecycle_triplets") {
    throw new Error(
      `arm ${arm}: refused cell has unexpected reason ${String(decision.reasonCode)}`,
    );
  }
  if (!refused && decision.reasonCode !== null) {
    throw new Error(`arm ${arm}: executable cell unexpectedly has reason ${decision.reasonCode}`);
  }
  assertSha256(`arm ${arm} options digest`, decision.optionsDigest);
}

function assertCountMap(arm: string, label: string, counts: Record<string, number>): void {
  for (const [kind, count] of Object.entries(counts)) {
    if (!kind || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`arm ${arm}: invalid ${label} count ${kind}=${String(count)}`);
    }
  }
}

function validateOpenerReceipt(
  arm: string,
  vector: BindingVector,
  decision: OpenerSetPreflightDecision,
  receipt: OpenerSetEvidence,
): void {
  if (!receipt || typeof receipt !== "object") {
    throw new Error(`arm ${arm}: missing typed opener-set receipt`);
  }
  const applicability = receipt.applicability;
  if (
    applicability.requested !== decision.requestedOpenerSetId ||
    applicability.effective !== decision.effectiveOpenerSetId ||
    applicability.relation !== decision.relation ||
    applicability.refusalReason !== decision.reasonCode
  ) {
    throw new Error(`arm ${arm}: execution receipt disagrees with preflight applicability`);
  }
  if (
    !Number.isSafeInteger(receipt.suppressedDeviceOpenerCount) ||
    receipt.suppressedDeviceOpenerCount < 0
  ) {
    throw new Error(`arm ${arm}: invalid suppressed-device opener count`);
  }
  assertCountMap(arm, "selected opener", receipt.selectedOpenerTypeCounts);
  assertCountMap(arm, "materialized opener", receipt.materializedOpenerTypeCounts);
  const deviceKinds = [
    "Screen Interactive",
    "Screen Interactive/Keyguard Shown",
    "Keyguard Hidden",
    "Device Startup",
  ];
  for (const deviceKind of deviceKinds) {
    if ((receipt.materializedOpenerTypeCounts[deviceKind] ?? 0) !== 0) {
      throw new Error(`arm ${arm}: device kind ${deviceKind} materialized as app usage`);
    }
  }
  if (vector.openerSet === "activity_resumed_only") {
    const allowed = new Set(["Activity Resumed", "Filtered App Resumed"]);
    const unexpected = Object.keys(receipt.selectedOpenerTypeCounts).filter(
      (kind) => !allowed.has(kind),
    );
    if (unexpected.length > 0) {
      throw new Error(`arm ${arm}: resumed-only selected unexpected kinds ${unexpected.join(",")}`);
    }
  }
  if (vector.openerSet === "gesis_app_scoped_starts") {
    for (const deviceKind of deviceKinds) {
      if ((receipt.selectedOpenerTypeCounts[deviceKind] ?? 0) !== 0) {
        throw new Error(`arm ${arm}: device kind ${deviceKind} entered selected app openers`);
      }
    }
  }
  if (!args.assertB02Fixture) return;
  if (vector.openerSet === "activity_resumed_only") {
    if ((receipt.selectedOpenerTypeCounts["Activity Resumed"] ?? 0) === 0) {
      throw new Error(`arm ${arm}: resumed-only fixture selected no Activity Resumed opener`);
    }
  }
  if (vector.openerSet === "gesis_app_scoped_starts") {
    const expectedSuppressedByRetention: Record<string, number> = {
      none: 8,
      parry_toth_7: 8,
      usage_logger_5: 2,
      toth_trifonova_app: 0,
      foreground_background_only: 0,
    };
    const expectedSuppressed = expectedSuppressedByRetention[vector.eventRetentionSet];
    if (receipt.suppressedDeviceOpenerCount !== expectedSuppressed) {
      throw new Error(
        `arm ${arm}: suppressed-device count ${receipt.suppressedDeviceOpenerCount} disagrees with retained fixture count ${String(expectedSuppressed)}`,
      );
    }
    const selectedType19 = receipt.selectedOpenerTypeCounts["Foreground Service Start"] ?? 0;
    const materializedType19 =
      receipt.materializedOpenerTypeCounts["Foreground Service Start"] ?? 0;
    if (vector.eventRetentionSet === "none") {
      if (selectedType19 === 0) {
        throw new Error(`arm ${arm}: wider fixture did not activate its type-19 opener`);
      }
      // The fixture's type-19 rows belong to participants with no witnessed
      // B05 screen interval. Schoedel correctly selects those rows under the
      // wider opener set but cannot materialize an app-within-screen episode.
      const requiresWitnessedScreenInterval =
        vector.episodeReconstructionStrategy ===
        "schoedel_2026_app_within_screen_prose_v1";
      if (!requiresWitnessedScreenInterval && materializedType19 === 0) {
        throw new Error(`arm ${arm}: wider strategy classified but did not consume type 19`);
      }
      if (requiresWitnessedScreenInterval && materializedType19 !== 0) {
        throw new Error(
          `arm ${arm}: Schoedel materialized a type-19 opener outside any witnessed screen interval`,
        );
      }
    } else if (selectedType19 !== 0 || materializedType19 !== 0) {
      throw new Error(`arm ${arm}: B01 should have removed type 19 before B02`);
    }
  }
}

function rawParticipantDayFrame(bytes: Uint8Array): Set<DayKey> {
  const rows = parseCsv(new TextDecoder().decode(bytes));
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase());
  if (!header) throw new Error("raw input is empty — no participant-day frame");
  const participantColumn = header.indexOf("participant_id");
  const timestampColumn = header.indexOf("event_timestamp");
  const timezoneColumn = header.indexOf("timezone");
  if (participantColumn < 0 || timestampColumn < 0 || timezoneColumn < 0) {
    throw new Error(
      "raw input must expose participant_id, event_timestamp, and timezone for the frozen analysis frame",
    );
  }
  const frame = new Set<DayKey>();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row[timezoneColumn]?.trim() !== ANALYSIS_TIMEZONE) continue;
    const participantId = row[participantColumn]?.trim();
    const rawTimestamp = row[timestampColumn]?.trim() ?? "";
    const timestampMatch = rawTimestamp.match(
      /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/,
    );
    const instant = timestampMatch
      ? new Date(
          `${timestampMatch[1]}T${timestampMatch[2]}.${(timestampMatch[3] ?? "")
            .slice(0, 3)
            .padEnd(3, "0")}Z`,
        )
      : new Date(Number.NaN);
    const dateParts = Number.isNaN(instant.valueOf())
      ? []
      : ANALYSIS_DATE_FORMATTER.formatToParts(instant);
    const year = dateParts.find((part) => part.type === "year")?.value;
    const month = dateParts.find((part) => part.type === "month")?.value;
    const day = dateParts.find((part) => part.type === "day")?.value;
    const date = year && month && day ? `${year}-${month}-${day}` : "";
    if (!participantId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(
        `raw selected-timezone row ${rowIndex + 1} has no participant or parseable UTC event timestamp`,
      );
    }
    frame.add(`${participantId}\u0000${date}`);
  }
  if (frame.size === 0) {
    throw new Error(`raw input contains no participant-days in ${ANALYSIS_TIMEZONE}`);
  }
  return frame;
}

function runArm(vector: BindingVector, listOnly: boolean): ArmResult | null {
  const options: BrowserProcessingOptions = {
    ...DEFAULT_BROWSER_OPTIONS,
    selectedTimezone: ANALYSIS_TIMEZONE,
    timezoneHandling: "selected-filter" as const,
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
    enableDayCoverage: false,
    // Overridable so the long-duration cap can be varied: whether that cap
    // actually bounds a forward-paired episode is the question, not an assumption.
    longDurationThresholdHours: Number(process.env.LONG_DURATION_HOURS ?? 12),
    eventRetentionSet: vector.eventRetentionSet,
    openerSet: vector.openerSet,
    episodeReconstructionStrategy: vector.episodeReconstructionStrategy,
    intervalQualityPolicy: vector.intervalQualityPolicy,
  };
  const arm = armId(vector);
  const request = JSON.stringify({
    protocolVersion: "chronicle-preprocessing-runtime/v2",
    requestId: `multiverse-${arm}`,
    command: "ExecuteWorkspace",
    executionEngine: "incremental",
    provenanceEvidence: true,
    workspaceRootDigest: null,
    // Distinct workspace per arm: a shared id would let a warm cache answer a
    // later arm with an earlier arm's value, which is precisely the difference
    // being measured.
    workspaceId: sha256(`multiverse:${inputSha256}:${arm}`),
    inputFileName: path.basename(args.raw),
    inputSha256,
    options: buildRustV2Options(options, {
      datetimeOfPreprocessing: "2026-08-08 00:00:00 UTC",
    }),
  });

  const applicability = JSON.parse(
    runtime.opener_set_applicability_json(request),
  ) as OpenerSetPreflightDecision;
  validateApplicability(arm, vector, applicability);
  if (applicability.status === "refused") {
    if (listOnly) {
      throw new Error(`arm ${arm} is refused: ${applicability.reasonCode ?? "unknown reason"}`);
    }
    return {
      status: "refused",
      refusalSource: "opener_set",
      arm,
      vector,
      applicability,
      scientificPreflight: null,
      digests: {
        options: applicability.optionsDigest,
        runtimeIdentity,
        workflowContract: workflowContract.digests,
        wasm: wasmSha256,
      },
    };
  }
  if (applicability.status !== "executable") {
    throw new Error(`arm ${arm}: unknown applicability status ${String(applicability.status)}`);
  }

  // Production requires the input-dependent scientific preflight immediately
  // before execution whenever screen processing or a source-sensitive app arm
  // is active. Reuse this exact request, byte buffer, support handle, and WASM
  // instance so the runtime can consume the verified pending receipt.
  let scientificPreflight: RuntimeScientificPreflightReceipt | null = null;
  if (requiresLiveScientificPreflight(options)) {
    scientificPreflight = decodeScientificPreflightReceipt(
      JSON.parse(runtime.scientific_preflight_json(request, inputBytes, supports)),
    );
    if (
      scientificPreflight.key.inputDigest !== inputSha256 ||
      scientificPreflight.key.inputSizeBytes !== inputBytes.byteLength ||
      scientificPreflight.eyesInputPartition.inputDigest !== inputSha256
    ) {
      throw new Error(`arm ${arm}: scientific preflight identity disagrees with the request`);
    }
    const expectedEyesDisposition =
      vector.episodeReconstructionStrategy === "eyes_complement"
        ? "executable"
        : "not_applicable";
    const b05Refused = scientificPreflight.b05Schoedel.disposition === "refused";
    const eyesRefused = scientificPreflight.eyesInputPartition.disposition === "refused";
    if (b05Refused || eyesRefused) {
      return {
        status: "refused",
        refusalSource: "scientific_preflight",
        arm,
        vector,
        applicability,
        scientificPreflight,
        digests: {
          options: applicability.optionsDigest,
          runtimeIdentity,
          workflowContract: workflowContract.digests,
          wasm: wasmSha256,
        },
      };
    }
    if (scientificPreflight.b05Schoedel.disposition !== "executable") {
      throw new Error(
        `arm ${arm}: B05 scientific preflight ${scientificPreflight.b05Schoedel.disposition}`,
      );
    }
    if (scientificPreflight.eyesInputPartition.disposition !== expectedEyesDisposition) {
      throw new Error(
        `arm ${arm}: EYES scientific preflight expected ${expectedEyesDisposition}, got ${scientificPreflight.eyesInputPartition.disposition}`,
      );
    }
  }

  const handle = runtime.execute_workspace(request, inputBytes, supports);
  try {
    if (listOnly) {
      for (let i = 0; i < handle.artifact_count; i += 1) {
        const meta = JSON.parse(handle.artifact_metadata_json(i));
        console.log(`  ${meta.kind}  (${meta.size ?? "?"} bytes)`);
      }
      return null;
    }

    // `app-csv` is the headline app-usage table. Named exactly rather than
    // pattern-matched: a loose /app/ test also catches `node-output:app_policy`,
    // and a credited-usage variant would silently become the measured quantity.
    const manifest = JSON.parse(handle.manifest_json()) as {
      optionsDigest: string;
      implementationDigest: string;
      buildEnvironmentDigest: string;
      planDigest: string;
      profileDigest: string;
      profileLockDigest: string;
      runtimeAuthorityDigest: string;
      productContractDigest: string;
      dependencyCertificateDigest: string;
      workspaceRootDigest: string;
      processingSummary: { openerSetReceipt: OpenerSetEvidence };
    };
    assertSha256(`arm ${arm} runtime options digest`, manifest.optionsDigest);
    assertSha256(`arm ${arm} implementation digest`, manifest.implementationDigest);
    assertSha256(`arm ${arm} product-contract digest`, manifest.productContractDigest);
    assertSha256(`arm ${arm} workspace-root digest`, manifest.workspaceRootDigest);
    for (const field of RUNTIME_IDENTITY_DIGEST_FIELDS) {
      if (manifest[field] !== runtimeIdentity[field]) {
        throw new Error(
          `arm ${arm}: manifest ${field} ${manifest[field]} disagrees with runtime identity ${runtimeIdentity[field]}`,
        );
      }
    }
    if (manifest.optionsDigest !== applicability.optionsDigest) {
      throw new Error(
        `arm ${arm}: preflight options digest ${applicability.optionsDigest} disagrees with runtime ${manifest.optionsDigest}`,
      );
    }
    validateOpenerReceipt(
      arm,
      vector,
      applicability,
      manifest.processingSummary.openerSetReceipt,
    );

    let appUsageIndex = -1;
    let openerReceiptIndex = -1;
    let appUsageMetadata: { digest: string; rowCount?: number } | undefined;
    let openerReceiptMetadata: { digest: string } | undefined;
    const kinds: string[] = [];
    for (let i = 0; i < handle.artifact_count; i += 1) {
      const metadata = JSON.parse(handle.artifact_metadata_json(i)) as {
        kind: string;
        digest: string;
        rowCount?: number;
      };
      const kind = String(metadata.kind);
      kinds.push(kind);
      if (kind === "app-csv") {
        appUsageIndex = i;
        appUsageMetadata = metadata;
      } else if (kind === "opener-set-receipt-json") {
        openerReceiptIndex = i;
        openerReceiptMetadata = metadata;
      }
    }
    if (appUsageIndex < 0) {
      throw new Error(`arm ${arm}: no 'app-csv' artifact; kinds were ${kinds.join(", ")}`);
    }
    if (openerReceiptIndex < 0) {
      throw new Error(
        `arm ${arm}: no 'opener-set-receipt-json' artifact; kinds were ${kinds.join(", ")}`,
      );
    }
    const appUsageKind = "app-csv";

    const openerReceiptBytes = handle.take_artifact_bytes(openerReceiptIndex);
    const openerReceiptDigest = sha256(openerReceiptBytes);
    assertSha256(`arm ${arm} opener receipt artifact digest`, openerReceiptMetadata?.digest);
    if (openerReceiptDigest !== openerReceiptMetadata?.digest) {
      throw new Error(
        `arm ${arm}: opener receipt digest ${openerReceiptDigest} disagrees with artifact metadata ${openerReceiptMetadata?.digest ?? "missing"}`,
      );
    }
    const artifactReceipt = JSON.parse(
      new TextDecoder().decode(openerReceiptBytes),
    ) as OpenerSetEvidence;
    validateOpenerReceipt(arm, vector, applicability, artifactReceipt);
    if (
      canonicalJson(artifactReceipt) !==
      canonicalJson(manifest.processingSummary.openerSetReceipt)
    ) {
      throw new Error(`arm ${arm}: receipt artifact disagrees with manifest receipt`);
    }

    const appUsageBytes = handle.take_artifact_bytes(appUsageIndex);
    const appOutputDigest = sha256(appUsageBytes);
    if (!appUsageMetadata || appOutputDigest !== appUsageMetadata.digest) {
      throw new Error(
        `arm ${arm}: app output digest ${appOutputDigest} disagrees with artifact metadata ${appUsageMetadata?.digest ?? "missing"}`,
      );
    }
    const csv = new TextDecoder().decode(appUsageBytes);
    const rows = parseCsv(csv);
    const headerRow = rows[0];
    if (!headerRow) {
      throw new Error(`arm ${arm}: artifact ${appUsageKind} was empty — no header row`);
    }
    const header = headerRow.map((cell) => cell.trim().toLowerCase());
    const pidCol = header.indexOf("participant_id");
    const minutesCol = header.indexOf("duration_minutes");
    // Use the engine's own `date` column, not a prefix of `start_timestamp`:
    // start_timestamp renders MM-DD-YYYY, and day attribution is itself a
    // pipeline decision (timezone handling) this script must not re-derive.
    const dateCol = header.indexOf("date");
    if (pidCol < 0 || minutesCol < 0 || dateCol < 0) {
      throw new Error(
        `arm ${arm}: artifact ${appUsageKind} lacks participant_id/duration_minutes/date; got ${header.join(",")}`,
      );
    }

    const daily = new Map<DayKey, number>();
    let credited = 0;
    let maxRowMinutes = 0;
    for (let r = 1; r < rows.length; r += 1) {
      const cells = rows[r];
      if (!cells) continue;
      const rawMinutes = cells[minutesCol]?.trim();
      // A blank duration is a deliberate engine output (the floor refused to
      // credit the row). It contributes zero, and must not become NaN.
      if (!rawMinutes) continue;
      const minutes = Number(rawMinutes);
      if (!Number.isFinite(minutes) || minutes < 0) {
        throw new Error(`arm ${arm}: invalid duration_minutes value ${rawMinutes}`);
      }
      const date = String(cells[dateCol]).trim();
      const participantId = cells[pidCol]?.trim();
      if (!participantId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(
          `arm ${arm}: app row ${r + 1} has no participant or canonical date`,
        );
      }
      const key = `${participantId}\u0000${date}`;
      daily.set(key, (daily.get(key) ?? 0) + minutes);
      credited += 1;
      if (minutes > maxRowMinutes) maxRowMinutes = minutes;
    }
    const appArtifactRowCount = appUsageMetadata.rowCount ?? rows.length - 1;
    if (appArtifactRowCount !== rows.length - 1) {
      throw new Error(
        `arm ${arm}: artifact metadata says ${appArtifactRowCount} rows but CSV has ${rows.length - 1}`,
      );
    }
    // Zero credited rows can be a valid scientific result after retention or
    // cleaning. The completed runtime manifest plus exact artifact row count
    // distinguishes it from an unexecuted or unparsable arm.
    return {
      status: "executable",
      arm,
      vector,
      applicability,
      openerReceipt: manifest.processingSummary.openerSetReceipt,
      scientificPreflight,
      daily,
      rows: credited,
      maxRowMinutes,
      appArtifactRowCount,
      digests: {
        options: manifest.optionsDigest,
        implementation: manifest.implementationDigest,
        productContract: manifest.productContractDigest,
        workspaceRoot: manifest.workspaceRootDigest,
        runtimeIdentity,
        workflowContract: workflowContract.digests,
        wasm: wasmSha256,
        appOutput: appOutputDigest,
        openerReceipt: openerReceiptDigest,
      },
    };
  } finally {
    handle.free?.();
  }
}

try {
  if (args.listArtifacts) {
    console.log("artifact kinds for default B01+B02+reconstruction+quality:");
    runArm(
      {
        eventRetentionSet: "none",
        openerSet: "strategy_defined",
        episodeReconstructionStrategy: "fused_matcher",
        intervalQualityPolicy: "none",
      },
      true,
    );
  } else {
    const results: ArmResult[] = [];
    for (const eventRetentionSet of EVENT_RETENTION_SET_VALUES) {
      for (const openerSet of OPENER_SET_VALUES) {
        for (const episodeReconstructionStrategy of EPISODE_RECONSTRUCTION_STRATEGY_VALUES) {
          for (const intervalQualityPolicy of INTERVAL_QUALITY_POLICY_VALUES) {
            const result = runArm(
              {
                eventRetentionSet,
                openerSet,
                episodeReconstructionStrategy,
                intervalQualityPolicy,
              },
              false,
            );
            if (result) results.push(result);
          }
        }
      }
    }

    const generatedTupleCount =
      EVENT_RETENTION_SET_VALUES.length *
      OPENER_SET_VALUES.length *
      EPISODE_RECONSTRUCTION_STRATEGY_VALUES.length *
      INTERVAL_QUALITY_POLICY_VALUES.length;
    const expectedTupleCount = 240;
    if (
      EVENT_RETENTION_SET_VALUES.length !== 5 ||
      OPENER_SET_VALUES.length !== 3 ||
      EPISODE_RECONSTRUCTION_STRATEGY_VALUES.length !== 8 ||
      INTERVAL_QUALITY_POLICY_VALUES.length !== 2 ||
      generatedTupleCount !== expectedTupleCount
    ) {
      throw new Error(
        `generated binding domain drift: expected 5×3×8×2=${expectedTupleCount}, got ` +
          `${EVENT_RETENTION_SET_VALUES.length}×${OPENER_SET_VALUES.length}×` +
          `${EPISODE_RECONSTRUCTION_STRATEGY_VALUES.length}×${INTERVAL_QUALITY_POLICY_VALUES.length}=` +
          `${generatedTupleCount}`,
      );
    }
    const uniqueArms = new Set(results.map((result) => result.arm));
    if (results.length !== expectedTupleCount || uniqueArms.size !== expectedTupleCount) {
      throw new Error(
        `binding enumeration drift: expected ${expectedTupleCount}, ran ${results.length}, unique ${uniqueArms.size}`,
      );
    }
    const executableResults = results.filter(
      (result): result is ExecutableArmResult => result.status === "executable",
    );
    const refusedResults = results.filter(
      (result): result is RefusedArmResult => result.status === "refused",
    );
    for (const result of refusedResults) {
      if (result.refusalSource !== "scientific_preflight") continue;
      throw new Error(
        `arm ${result.arm}: unexpected scientific refusal after deterministic timestamp correction: ` +
          canonicalJson(result.scientificPreflight),
      );
    }
    const optionDigests = results.map((result) => result.applicability.optionsDigest);
    const uniqueOptionDigests = new Set(optionDigests);
    if (uniqueOptionDigests.size !== expectedTupleCount) {
      throw new Error(
        `exact options identity drift: expected ${expectedTupleCount} distinct vector digests, got ${uniqueOptionDigests.size}`,
      );
    }
    const expectedOpenerRefusalArms = new Set<string>();
    for (const eventRetentionSet of EVENT_RETENTION_SET_VALUES) {
      for (const intervalQualityPolicy of INTERVAL_QUALITY_POLICY_VALUES) {
        expectedOpenerRefusalArms.add(
          armId({
            eventRetentionSet,
            openerSet: "gesis_app_scoped_starts",
            episodeReconstructionStrategy: "eyes_complement",
            intervalQualityPolicy,
          }),
        );
      }
    }
    const expectedScientificRefusalArms = new Set<string>();
    const actualOpenerRefusalArms = new Set(
      refusedResults
        .filter((result) => result.refusalSource === "opener_set")
        .map((result) => result.arm),
    );
    const actualScientificRefusalArms = new Set(
      refusedResults
        .filter((result) => result.refusalSource === "scientific_preflight")
        .map((result) => result.arm),
    );
    const missingRefusals = [
      ...[...expectedOpenerRefusalArms].filter(
        (arm) => !actualOpenerRefusalArms.has(arm),
      ),
      ...[...expectedScientificRefusalArms].filter(
        (arm) => !actualScientificRefusalArms.has(arm),
      ),
    ];
    const unexpectedRefusals = [
      ...[...actualOpenerRefusalArms].filter(
        (arm) => !expectedOpenerRefusalArms.has(arm),
      ),
      ...[...actualScientificRefusalArms].filter(
        (arm) => !expectedScientificRefusalArms.has(arm),
      ),
    ];
    const expectedRefusalCount =
      expectedOpenerRefusalArms.size + expectedScientificRefusalArms.size;
    const expectedExecutableCount = expectedTupleCount - expectedRefusalCount;
    if (
      refusedResults.length !== expectedRefusalCount ||
      executableResults.length !== expectedExecutableCount ||
      missingRefusals.length > 0 ||
      unexpectedRefusals.length > 0
    ) {
      throw new Error(
        `applicability matrix drift: executable ${executableResults.length}/${expectedExecutableCount}, ` +
          `refused ${refusedResults.length}/${expectedRefusalCount}, ` +
          `missing [${missingRefusals.join(", ")}], unexpected [${unexpectedRefusals.join(", ")}]`,
      );
    }

    // Freeze the participant-day denominator from selected-timezone raw rows,
    // before any binding can retain, reconstruct, clean, or erase output. Every
    // successful arm contributes an explicit zero on a frame day it does not emit.
    const allDays = rawParticipantDayFrame(inputBytes);
    for (const result of executableResults) {
      const outsideFrame = [...result.daily.keys()].filter((key) => !allDays.has(key));
      if (outsideFrame.length > 0) {
        throw new Error(
          `arm ${result.arm}: emitted participant-days outside the frozen raw frame: ${outsideFrame.join(", ")}`,
        );
      }
    }
    if (args.assertB02Fixture) {
      const witnessParticipantByStrategy: Record<string, string> = {
        fused_matcher: "P02",
        parry_toth_forward_pairing: "P02",
        morrison_lock_tolerant: "P02",
        foreground_background_pairing: "P03",
        draxler_interruption_aware: "P03",
        gesis_start_stop_repair: "P04",
      };
      for (const wider of executableResults.filter(
        (result) =>
          result.vector.eventRetentionSet === "none" &&
          result.vector.openerSet === "gesis_app_scoped_starts",
      )) {
        const participantId =
          witnessParticipantByStrategy[wider.vector.episodeReconstructionStrategy];
        if (!participantId) {
          if (
            wider.vector.episodeReconstructionStrategy ===
            "schoedel_2026_app_within_screen_prose_v1"
          ) {
            // This B02 fixture deliberately has no screen interval for its
            // type-19 participants, so selection is the strongest Schoedel
            // assertion available here; materialization is checked above.
            continue;
          }
          throw new Error(`proof fixture has no witness participant for ${wider.arm}`);
        }
        const resumedOnly = executableResults.find(
          (candidate) =>
            candidate.vector.eventRetentionSet === wider.vector.eventRetentionSet &&
            candidate.vector.openerSet === "activity_resumed_only" &&
            candidate.vector.episodeReconstructionStrategy ===
              wider.vector.episodeReconstructionStrategy &&
            candidate.vector.intervalQualityPolicy === wider.vector.intervalQualityPolicy,
        );
        if (!resumedOnly) throw new Error(`proof fixture has no resumed-only pair for ${wider.arm}`);
        const witnessDay = `${participantId}\u00002026-03-07`;
        const widerMinutes = wider.daily.get(witnessDay) ?? 0;
        const resumedMinutes = resumedOnly.daily.get(witnessDay) ?? 0;
        if (!(widerMinutes > resumedMinutes)) {
          throw new Error(
            `arm ${wider.arm}: ${participantId} witness did not add usage (${widerMinutes} <= ${resumedMinutes})`,
          );
        }
      }
      const zeroDay = "P07\u00002026-03-07";
      if (!allDays.has(zeroDay)) throw new Error("proof fixture lost P07 from the raw-day frame");
      const nonzeroArms = executableResults.filter(
        (result) => (result.daily.get(zeroDay) ?? 0) !== 0,
      );
      if (nonzeroArms.length > 0) {
        throw new Error(
          `proof fixture P07 materialized app usage under ${nonzeroArms.map(({ arm }) => arm).join(", ")}`,
        );
      }
    }

    const perDay = [...allDays].sort().map((key) => {
      const [participantId, date] = key.split("\u0000");
      const values = executableResults.map((result) => result.daily.get(key) ?? 0);
      const min = Math.min(...values);
      const max = Math.max(...values);
      return { participantId, date, values, min, max, span: max - min };
    });

    const spans = perDay.map((day) => day.span).sort((a, b) => a - b);
    const quantile = (q: number) =>
      spans.length === 0 ? 0 : spans[Math.min(spans.length - 1, Math.floor(q * spans.length))];

    const thresholdFlips = args.thresholds.map((threshold) => {
      const flipped = perDay.filter((day) => day.min < threshold && day.max >= threshold);
      return {
        thresholdMinutes: threshold,
        flippedDays: flipped.length,
        totalDays: perDay.length,
        flippedFraction: perDay.length === 0 ? 0 : flipped.length / perDay.length,
      };
    });

    const report = {
      raw: args.raw,
      inputSha256,
      analysisFrame: {
        source: "raw selected-timezone participant-day rows",
        timezone: ANALYSIS_TIMEZONE,
        participantDays: allDays.size,
      },
      proofMode: args.assertB02Fixture ? "b02_synthetic_fixture" : "general_input",
      interpretationGuard: {
        syntheticInput:
          "A synthetic run proves dispatch, refusal, and branch activation only; its divergence magnitude is generator-defined and is not an empirical study result.",
        empiricalInput:
          "A headline magnitude requires the frozen admissibility protocol, preregistered estimand, and authorized observed study data.",
      },
      generatedDomains: {
        eventRetentionSet: EVENT_RETENTION_SET_VALUES,
        openerSet: OPENER_SET_VALUES,
        episodeReconstructionStrategy: EPISODE_RECONSTRUCTION_STRATEGY_VALUES,
        intervalQualityPolicy: INTERVAL_QUALITY_POLICY_VALUES,
      },
      tupleCounts: {
        expected: expectedTupleCount,
        unique: uniqueArms.size,
        executable: executableResults.length,
        refused: refusedResults.length,
      },
      executableArmOrder: executableResults.map((result) => result.arm),
      refusalReceipts: refusedResults.map((result) => ({
        arm: result.arm,
        vector: result.vector,
        refusalSource: result.refusalSource,
        applicability: result.applicability,
        scientificPreflight: result.scientificPreflight,
        digests: result.digests,
      })),
      participantDays: perDay.length,
      participantDaySpans: perDay.map(({ values: _values, ...day }) => day),
      spanMinutes: {
        mean: spans.length === 0 ? 0 : spans.reduce((a, b) => a + b, 0) / spans.length,
        median: quantile(0.5),
        p90: quantile(0.9),
        max: spans.length === 0 ? 0 : spans[spans.length - 1],
        daysWithAnyDisagreement: spans.filter((value) => value > 1e-9).length,
      },
      thresholdFlips,
      perArm: Object.fromEntries(
        executableResults.map((result) => [
          result.arm,
          {
            vector: result.vector,
            applicability: result.applicability,
            openerReceipt: result.openerReceipt,
            scientificPreflight: result.scientificPreflight,
            digests: result.digests,
            totalMinutes: [...result.daily.values()].reduce((a, b) => a + b, 0),
            creditedRows: result.rows,
            appArtifactRows: result.appArtifactRowCount,
            maxSingleRowMinutes: result.maxRowMinutes,
            // A row longer than 24 h is a diagnostic consistent with an
            // unclosed episode reaching a later opener; it is not a unique cause.
            maxSingleRowHours: result.maxRowMinutes / 60,
          },
        ]),
      ),
    };

    console.log(JSON.stringify(report, null, 2));
    if (args.json) {
      await mkdir(path.dirname(args.json), { recursive: true });
      await writeFile(args.json, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
} finally {
  supports.free();
}
