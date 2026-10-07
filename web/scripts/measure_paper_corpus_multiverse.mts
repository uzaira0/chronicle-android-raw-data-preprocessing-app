/**
 * Fixed-census component multiverse.
 *
 * This deliberately does not call selectable runtime values "paper presets".
 * The 51-paper census establishes disclosure/applicability; the regenerated
 * t=3 covering array supplies controlled component vectors. Complete whole-
 * paper replay remains unavailable until complete-vector conformance passes.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import coveringT3 from "../combinatorial/covering_array_t3.json" with { type: "json" };
import {
  RESEARCH_AXIS_BROWSER_OPTION_KEYS,
  RESEARCH_AXIS_VALUES_BY_OPTION,
} from "../src/lib/generatedContract";
import type { BrowserProcessingOptions } from "../src/lib/generatedContract";
import type {
  OpenerSetPreflightDecision,
  RuntimeScientificPreflightReceipt,
} from "../src/lib/generatedRuntimeBoundary";
import { requiresLiveScientificPreflight } from "../src/lib/inputCapabilityEvidence";
import { decodeScientificPreflightReceipt } from "../src/lib/scientificPreflightBoundary";
import { buildRustV2Options } from "../src/lib/rustPipelineRuntime";
import { buildInputCapabilityEvidenceCsv } from "../src/testSupport/artifactInterventions";

type RuntimeModule = typeof import(
  "../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js"
);
type DayKey = string;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const ANALYSIS_TIMEZONE = "America/Chicago";
const DECLARED = new Set([33, 46]);
const ACKNOWLEDGED_UNSTATED = new Set([4]);
const DELEGATED_VENDOR = new Set([7, 15, 23, 39, 49]);
const DELEGATED_LIBRARY = new Set([16]);
const ABSENT = new Set([10, 11, 22, 27, 36, 43, 47]);
const DEVICE_DECLARED = new Set([30, 42, 45, 50, 51]);

function parseArgs(argv: string[]) {
  let raw = "";
  let json = "";
  let merge = "";
  let shardIndex = 0;
  let shardCount = 1;
  let thresholds = [60, 120];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--raw" && value) raw = value, index += 1;
    else if (argument === "--json" && value) json = value, index += 1;
    else if (argument === "--merge" && value) merge = value, index += 1;
    else if (argument === "--shard-index" && value) shardIndex = Number(value), index += 1;
    else if (argument === "--shard-count" && value) shardCount = Number(value), index += 1;
    else if (argument === "--thresholds" && value) {
      thresholds = value.split(",").map((entry) => Number(entry.trim()));
      index += 1;
    }
  }
  if (!json) throw new Error("--json <path> is required");
  if (!merge && !raw) throw new Error("--raw <path> is required");
  if (!Number.isSafeInteger(shardIndex) || !Number.isSafeInteger(shardCount) || shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error("shards require 0 <= --shard-index < --shard-count");
  }
  if (thresholds.some((entry) => !Number.isFinite(entry) || entry <= 0)) {
    throw new Error("--thresholds must be positive minutes");
  }
  return { raw, json, merge, shardIndex, shardCount, thresholds };
}

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') field += '"', index += 1;
        else quoted = false;
      } else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") row.push(field), field = "";
    else if (character === "\n") rows.push([...row, field]), row = [], field = "";
    else if (character !== "\r") field += character;
  }
  if (row.length > 0 || field.length > 0) rows.push([...row, field]);
  return rows.filter((entry) => entry.some((cell) => cell.length > 0));
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

async function paperCorpus() {
  const entries: Array<Record<string, unknown>> = [];
  const sourceDigests: Record<string, string> = {};
  for (let lane = 1; lane <= 5; lane += 1) {
    const source = path.join(REPO_ROOT, `docs/paper/citation-chase/lane-${lane}.md`);
    const text = await readFile(source, "utf8");
    sourceDigests[path.relative(REPO_ROOT, source)] = sha256(text);
    const headings = [...text.matchAll(/^## (\d+)\. (.+)$/gm)];
    for (let index = 0; index < headings.length; index += 1) {
      const match = headings[index]!;
      const id = Number(match[1]);
      const section = text.slice(match.index, headings[index + 1]?.index ?? text.length);
      const accessLine = section.match(/^\*\*Access(?::|\*\*:).*$/im)?.[0] ?? "";
      const normalizedAccess = accessLine.replaceAll("*", "").replace(/^-\s*/, "");
      // Entry 34 was read only in relevant sections of the open book. The
      // reconciled census therefore excludes it from the 35-document
      // full-text numerator even though its lane access note begins "FULL TEXT".
      const access = id !== 34 && /^Access:\s*full text/i.test(normalizedAccess)
        ? "full_text"
        : "abstract_or_metadata";
      const appDisclosure = DECLARED.has(id)
        ? "declared"
        : ACKNOWLEDGED_UNSTATED.has(id)
          ? "acknowledged_unstated"
          : DELEGATED_VENDOR.has(id)
            ? "delegated_vendor"
            : DELEGATED_LIBRARY.has(id)
              ? "delegated_library"
              : ABSENT.has(id)
                ? "absent"
                : "outside_app_event_stream_denominator";
      entries.push({
        id,
        lane,
        title: match[2]!.trim(),
        access,
        appDisclosure,
        deviceRuleDeclared: DEVICE_DECLARED.has(id),
        componentBindingStatus: DECLARED.has(id)
          ? "source_aligned_components_available_not_complete_vector"
          : "no_runnable_complete_vector",
        wholePaperReplayStatus: "unavailable_not_certified",
      });
    }
  }
  entries.sort((left, right) => Number(left.id) - Number(right.id));
  if (entries.length !== 51 || entries.some((entry, index) => entry.id !== index + 1)) {
    throw new Error(`paper census drift: expected IDs 1..51, got ${entries.map((entry) => entry.id).join(",")}`);
  }
  const fullText = entries.filter((entry) => entry.access === "full_text").length;
  if (fullText !== 35) throw new Error(`paper access census drift: expected 35 full text, got ${fullText}`);
  const appDenominator = entries.filter((entry) => entry.appDisclosure !== "outside_app_event_stream_denominator").length;
  if (appDenominator !== 16) throw new Error(`app-level denominator drift: expected 16, got ${appDenominator}`);
  return { entries, sourceDigests };
}

function normalizedOptions(source: BrowserProcessingOptions): BrowserProcessingOptions {
  return {
    ...source,
    interactionTypeRemovalMode: source.interactionTypeRemovalMode ?? "gap_preserving",
    studyName: "Fixed 51-paper census component multiverse",
    processAppUsage: true,
    processScreenUsage: true,
    correctDuplicateEventTimestamps: true,
    deduplicateExactRows: true,
    selectedTimezone: ANALYSIS_TIMEZONE,
    timezoneHandling: "selected-filter",
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
    includeCategoryColumn: false,
    enablePlotting: false,
    enableActivityHeatmap: false,
    exportPlotsAsSvg: false,
    enableAggregates: false,
    enableParticipantAmountSummary: false,
    enableParquetExport: false,
    enableSpssExport: false,
    enableInteractiveTimeline: false,
    parallelProcessing: false,
    enableScreenGatedCrediting: true,
    enableStudyWindowFilter: false,
    enablePersonAttribution: false,
    enableComplianceScoring: false,
    enableDayCoverage: false,
    addNoActivityPlaceholderDays: false,
  };
}

function researchVector(options: BrowserProcessingOptions): Record<string, unknown> {
  return Object.fromEntries(RESEARCH_AXIS_BROWSER_OPTION_KEYS.map((key) => [key, options[key]]));
}

function rawFrame(inputBytes: Uint8Array): DayKey[] {
  const rows = parseCsv(new TextDecoder().decode(inputBytes));
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const participantColumn = header.indexOf("participant_id");
  const timestampColumn = header.indexOf("event_timestamp");
  const timezoneColumn = header.indexOf("timezone");
  if (participantColumn < 0 || timestampColumn < 0 || timezoneColumn < 0) {
    throw new Error("raw input lacks participant_id/event_timestamp/timezone");
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYSIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const days = new Set<DayKey>();
  for (const row of rows.slice(1)) {
    if (row[timezoneColumn]?.trim() !== ANALYSIS_TIMEZONE) continue;
    const participant = row[participantColumn]?.trim();
    const rawTimestamp = row[timestampColumn]?.trim() ?? "";
    const match = rawTimestamp.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/);
    const instant = match
      ? new Date(`${match[1]}T${match[2]}.${(match[3] ?? "").slice(0, 3).padEnd(3, "0")}Z`)
      : new Date(Number.NaN);
    if (!participant || Number.isNaN(instant.valueOf())) throw new Error(`unparseable raw frame row for ${participant ?? "missing participant"}`);
    const parts = formatter.formatToParts(instant);
    const value = (kind: string) => parts.find((part) => part.type === kind)?.value;
    days.add(`${participant}\u0000${value("year")}-${value("month")}-${value("day")}`);
  }
  if (days.size === 0) throw new Error("selected-timezone raw participant-day frame is empty");
  return [...days].sort();
}

function dailyMinutes(bytes: Uint8Array): Record<DayKey, number> {
  const rows = parseCsv(new TextDecoder().decode(bytes));
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const participantColumn = header.indexOf("participant_id");
  const dateColumn = header.indexOf("date");
  const minutesColumn = header.indexOf("duration_minutes");
  if (participantColumn < 0 || dateColumn < 0 || minutesColumn < 0) {
    throw new Error(`app-csv lacks participant_id/date/duration_minutes: ${header.join(",")}`);
  }
  const daily: Record<DayKey, number> = {};
  for (const row of rows.slice(1)) {
    const rawMinutes = row[minutesColumn]?.trim();
    if (!rawMinutes) continue;
    const minutes = Number(rawMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error(`invalid duration_minutes ${rawMinutes}`);
    const key = `${row[participantColumn]?.trim()}\u0000${row[dateColumn]?.trim()}`;
    daily[key] = (daily[key] ?? 0) + minutes;
  }
  return daily;
}

async function executeShard(args: ReturnType<typeof parseArgs>) {
  const corpus = await paperCorpus();
  const rawPath = path.resolve(args.raw);
  const inputBytes = new Uint8Array(await readFile(rawPath));
  const rawText = new TextDecoder().decode(inputBytes);
  const inputSha256 = sha256(inputBytes);
  const capabilityBytes = new TextEncoder().encode(buildInputCapabilityEvidenceCsv(rawText));
  const wasmPath = path.resolve(HERE, "../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm");
  const wasmBytes = await readFile(wasmPath);
  const runtime = (await import(
    "../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js"
  )) as RuntimeModule;
  runtime.initSync({ module: wasmBytes });
  const runtimeIdentity = JSON.parse(runtime.runtime_identity_json());
  const frameDays = rawFrame(inputBytes);
  const sourceRows = coveringT3.configs.map((configuration) => ({
    id: configuration.id,
    options: normalizedOptions(configuration.options as unknown as BrowserProcessingOptions),
  }));
  const vectorIdentities = sourceRows.map(({ options }) => JSON.stringify(researchVector(options)));
  if (new Set(vectorIdentities).size !== sourceRows.length) {
    throw new Error("research-axis projection contains duplicate vectors");
  }
  // Drift is caught against derived sets, not against a pinned row/axis count:
  // the covering array is regenerated (it already moved from 276 to 326 rows)
  // and the axis list is generated from the LinkML contract, so a literal
  // cardinality only encodes when this file was last edited. What must hold is
  // that the generated axis list and its generated value domains name the same
  // options, and that the regenerated covering array actually varies every one
  // of them — an axis pinned to a single value silently stops being measured.
  const declaredAxisValueKeys = new Set(Object.keys(RESEARCH_AXIS_VALUES_BY_OPTION));
  const axesWithoutValues = RESEARCH_AXIS_BROWSER_OPTION_KEYS.filter(
    (key) => !declaredAxisValueKeys.has(key),
  );
  const valuesWithoutAxis = [...declaredAxisValueKeys].filter(
    (key) => !(RESEARCH_AXIS_BROWSER_OPTION_KEYS as readonly string[]).includes(key),
  );
  if (axesWithoutValues.length > 0 || valuesWithoutAxis.length > 0) {
    throw new Error(
      `matrix drift: axis keys and declared axis values disagree (${axesWithoutValues.join(", ")} | ${valuesWithoutAxis.join(", ")})`,
    );
  }
  const unvariedAxes = RESEARCH_AXIS_BROWSER_OPTION_KEYS.filter(
    (key) =>
      new Set(sourceRows.map(({ options }) => JSON.stringify(options[key]))).size < 2,
  );
  if (sourceRows.length === 0 || unvariedAxes.length > 0) {
    throw new Error(
      `matrix drift: ${sourceRows.length} rows, unvaried axes ${unvariedAxes.join(", ")}`,
    );
  }
  if (new Set(coveringT3.configs.map(({ id }) => id)).size !== sourceRows.length) {
    throw new Error("matrix drift: covering array configuration ids are not unique");
  }
  const selected = sourceRows.filter((_, index) => index % args.shardCount === args.shardIndex);
  const cells: Array<Record<string, unknown>> = [];
  for (const [localIndex, configuration] of selected.entries()) {
    const { id, options } = configuration;
    const vector = researchVector(options);
    const request = JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      requestId: `paper-corpus-${id}`,
      command: "ExecuteWorkspace",
      workspaceRootDigest: null,
      workspaceId: sha256(`paper-corpus:${inputSha256}:${id}:${JSON.stringify(vector)}`),
      inputFileName: path.basename(rawPath),
      inputSha256,
      options: buildRustV2Options(options, { datetimeOfPreprocessing: "2026-08-28 00:00:00 UTC" }),
    });
    const applicability = JSON.parse(runtime.opener_set_applicability_json(request)) as OpenerSetPreflightDecision;
    if (applicability.status === "refused") {
      cells.push({ id, status: "refused", refusalSource: "opener_set", reason: applicability.reasonCode, vector, optionsDigest: applicability.optionsDigest });
      continue;
    }
    const supports = new runtime.RuntimeSupportFiles();
    try {
      let preflight: RuntimeScientificPreflightReceipt | null = null;
      if (requiresLiveScientificPreflight(options)) {
        supports.put_with_name("input_capability_evidence_file", "synthetic-input-capability-evidence.csv", capabilityBytes);
        preflight = decodeScientificPreflightReceipt(JSON.parse(runtime.scientific_preflight_json(request, inputBytes, supports)));
        const refusal = preflight.b05Schoedel.disposition === "refused"
          ? preflight.b05Schoedel.schoedelApplicability?.refusalReason ??
            preflight.b05Schoedel.screenApplicability?.refusalReason ??
            "b05_schoedel_refused"
          : preflight.eyesInputPartition.disposition === "refused"
            ? preflight.eyesInputPartition.refusalReason
            : null;
        if (refusal) {
          // A refused one-shot preflight remains the runtime's pending typed
          // commitment and therefore still borrows this WASM support handle.
          // There is no execution call that can consume it. Let the short-lived
          // shard process reclaim the handle instead of invoking `free()` while
          // Rust still holds the borrow.
          cells.push({ id, status: "refused", refusalSource: "scientific_preflight", reason: refusal, vector, optionsDigest: applicability.optionsDigest });
          continue;
        }
      }
      const handle = runtime.execute_workspace(request, inputBytes, supports);
      try {
        const manifest = JSON.parse(handle.manifest_json());
        const artifacts: Record<string, { digest: string; rowCount: number | null }> = {};
        let appIndex = -1;
        let appDigest = "";
        for (let index = 0; index < handle.artifact_count; index += 1) {
          const metadata = JSON.parse(handle.artifact_metadata_json(index)) as { kind: string; digest: string; rowCount?: number };
          artifacts[metadata.kind] = { digest: metadata.digest, rowCount: metadata.rowCount ?? null };
          if (metadata.kind === "app-csv") appIndex = index, appDigest = metadata.digest;
        }
        if (appIndex < 0) throw new Error(`${id}: no app-csv artifact`);
        const appBytes = handle.take_artifact_bytes(appIndex);
        if (sha256(appBytes) !== appDigest) throw new Error(`${id}: app-csv digest mismatch`);
        const daily = dailyMinutes(appBytes);
        const outside = Object.keys(daily).filter((key) => !frameDays.includes(key));
        if (outside.length > 0) throw new Error(`${id}: emitted days outside frozen raw frame`);
        cells.push({
          id,
          status: "executable",
          vector,
          optionsDigest: manifest.optionsDigest,
          workspaceRootDigest: manifest.workspaceRootDigest,
          totalAppMinutes: Object.values(daily).reduce((sum, value) => sum + value, 0),
          appRows: artifacts["app-csv"]?.rowCount ?? null,
          daily,
          artifacts,
        });
      } finally {
        handle.free?.();
      }
    } catch (error) {
      // A Rust panic poisons this WASM instance. The production campaign runs
      // one matrix cell per short-lived process so the trap is a recorded cell
      // outcome and cannot erase unrelated cells or contaminate a later run.
      if (selected.length !== 1) throw error;
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      cells.push({
        id,
        status: "execution_error",
        refusalSource: "execute_workspace",
        reason,
        vector,
        optionsDigest: applicability.optionsDigest,
      });
      console.error(`${id}: ${reason}`);
    } finally {
      // A one-shot preflight may retain a Rust borrow on this handle on both
      // typed-refusal and exceptional exits. Shards are intentionally bounded
      // to 69 cells, so retain their tiny support handles until process teardown
      // instead of risking an ownership violation during explicit `free()`.
    }
    if ((localIndex + 1) % 10 === 0 || localIndex + 1 === selected.length) {
      console.error(`shard ${args.shardIndex + 1}/${args.shardCount}: ${localIndex + 1}/${selected.length}`);
    }
  }
  const result = {
    protocolVersion: "chronicle-paper-corpus-multiverse-shard/v1",
    generatedAt: new Date().toISOString(),
    shard: { index: args.shardIndex, count: args.shardCount },
    raw: path.relative(REPO_ROOT, rawPath),
    inputSha256,
    inputBytes: inputBytes.byteLength,
    inputDataRows: parseCsv(rawText).length - 1,
    wasmSha256: sha256(wasmBytes),
    runtimeIdentity,
    coveringArraySha256: sha256(await readFile(path.resolve(HERE, "../combinatorial/covering_array_t3.json"))),
    matrix: {
      strength: 3,
      sourceRows: sourceRows.length,
      researchAxes: [...RESEARCH_AXIS_BROWSER_OPTION_KEYS],
      domains: RESEARCH_AXIS_VALUES_BY_OPTION,
      timestampCorrection: "enabled; exact duplicates removed first; retained ties ordered Resume -> neutral -> configured stop -> physical order at 1 microsecond spacing",
    },
    paperCorpus: corpus,
    frameDays,
    cells,
  };
  await mkdir(path.dirname(path.resolve(args.json)), { recursive: true });
  await writeFile(path.resolve(args.json), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ shard: result.shard, cells: cells.length, executable: cells.filter((cell) => cell.status === "executable").length, refused: cells.filter((cell) => cell.status === "refused").length, executionErrors: cells.filter((cell) => cell.status === "execution_error").length, output: path.resolve(args.json) }));
}

async function mergeShards(args: ReturnType<typeof parseArgs>) {
  const paths = args.merge.split(",").map((entry) => path.resolve(entry.trim())).filter(Boolean);
  const shards = await Promise.all(paths.map(async (source) => JSON.parse(await readFile(source, "utf8"))));
  if (shards.length === 0) throw new Error("--merge requires comma-separated shard reports");
  const first = shards[0];
  for (const shard of shards) {
    for (const key of ["inputSha256", "wasmSha256", "coveringArraySha256"] as const) {
      if (shard[key] !== first[key]) throw new Error(`shard ${key} mismatch`);
    }
  }
  const cells = shards.flatMap((shard) => shard.cells).sort((left, right) => Number(left.id.slice(5)) - Number(right.id.slice(5)));
  if (cells.length !== 276 || new Set(cells.map((cell) => cell.id)).size !== 276) {
    throw new Error(`merged matrix drift: ${cells.length} cells, ${new Set(cells.map((cell) => cell.id)).size} unique`);
  }
  const executable = cells.filter((cell) => cell.status === "executable");
  const refused = cells.filter((cell) => cell.status === "refused");
  const executionErrors = cells.filter((cell) => cell.status === "execution_error");
  const participantDaySpans = first.frameDays.map((day: string) => {
    const values = executable.map((cell) => Number(cell.daily[day] ?? 0));
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    return { day, minimumMinutes: minimum, maximumMinutes: maximum, spanMinutes: maximum - minimum };
  });
  const spans = participantDaySpans.map((row: { spanMinutes: number }) => row.spanMinutes);
  const thresholdFlips = args.thresholds.map((thresholdMinutes) => ({
    thresholdMinutes,
    flippedDays: participantDaySpans.filter((row: { minimumMinutes: number; maximumMinutes: number }) => row.minimumMinutes < thresholdMinutes && row.maximumMinutes >= thresholdMinutes).length,
    totalDays: participantDaySpans.length,
  }));
  const disclosureCounts = Object.entries(first.paperCorpus.entries.reduce((counts: Record<string, number>, entry: { appDisclosure: string }) => {
    counts[entry.appDisclosure] = (counts[entry.appDisclosure] ?? 0) + 1;
    return counts;
  }, {})).map(([status, count]) => ({ status, count }));
  const report = {
    protocolVersion: "chronicle-paper-corpus-multiverse/v1",
    generatedAt: new Date().toISOString(),
    interpretationGuard: {
      syntheticInput: "Divergence magnitudes are generator-defined and are not empirical estimates about people or papers.",
      paperBindings: "The 51 papers define the fixed disclosure census. The 276 cells are controlled component vectors, not 51 complete paper replays.",
      wholePaperReplay: "No paper is labeled executable as a complete-vector preset; source-aligned components remain separate from certified whole-paper conformance.",
    },
    raw: first.raw,
    inputSha256: first.inputSha256,
    inputBytes: first.inputBytes,
    inputDataRows: first.inputDataRows,
    wasmSha256: first.wasmSha256,
    runtimeIdentity: first.runtimeIdentity,
    coveringArraySha256: first.coveringArraySha256,
    matrix: first.matrix,
    paperCorpus: { ...first.paperCorpus, disclosureCounts },
    analysisFrame: { timezone: ANALYSIS_TIMEZONE, participantDays: first.frameDays.length },
    tupleCounts: { expected: 276, unique: 276, executable: executable.length, refused: refused.length, executionError: executionErrors.length },
    refusalCounts: Object.entries(refused.reduce((counts: Record<string, number>, cell) => {
      const key = `${cell.refusalSource}:${cell.reason}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {})).map(([reason, count]) => ({ reason, count })),
    executionErrorCounts: Object.entries(executionErrors.reduce((counts: Record<string, number>, cell) => {
      const key = String(cell.reason);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {})).map(([reason, count]) => ({ reason, count })),
    appMinuteSpans: {
      mean: spans.reduce((sum: number, value: number) => sum + value, 0) / spans.length,
      median: percentile(spans, 0.5),
      p90: percentile(spans, 0.9),
      maximum: Math.max(...spans),
      daysWithAnyDisagreement: spans.filter((value: number) => value > 0).length,
    },
    thresholdFlips,
    participantDaySpans,
    cells: cells.map(({ daily: _daily, ...cell }) => cell),
  };
  await mkdir(path.dirname(path.resolve(args.json)), { recursive: true });
  await writeFile(path.resolve(args.json), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ papers: 51, axes: RESEARCH_AXIS_BROWSER_OPTION_KEYS.length, cells: 276, executable: executable.length, refused: refused.length, executionErrors: executionErrors.length, participantDays: first.frameDays.length, output: path.resolve(args.json) }));
}

const args = parseArgs(process.argv.slice(2));
if (args.merge) await mergeShards(args);
else await executeShard(args);
