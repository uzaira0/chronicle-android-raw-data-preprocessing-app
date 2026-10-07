import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  LITERATURE_INPUT_ADAPTER_CONTRACTS,
  literatureComponentExecutionForSettings,
} from "@/lib/literatureInputAdapters";
import {
  executeLiteratureComponentRuntime,
  exportPersistedRustWorkspace,
  importPersistedRustWorkspaceArchive,
  literatureComponentWorkspaceId,
  readPersistedRustArtifact,
  reopenLiteratureComponentResult,
  reopenImportedLiteratureComponent,
  setRustPersistenceForTesting,
  setRustRuntimeForTesting,
} from "@/lib/rustPipelineRuntime";
import { openOpfsWorkspace, persistRuntimeWorkspace, readRuntimeObject, recoverRuntimeWorkspace } from "@/lib/opfsArtifactStore";
import { MemoryDirectoryHandle, memoryDirectoryHandle } from "@/testSupport/memoryFileSystem";
import { dependencyCampaignRuntimeBytes } from "@/testSupport/dependencyCampaignRuntime";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

const fixture = (name: string) =>
  new URL(
    `../../../rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/${name}`,
    import.meta.url,
  );

/**
 * Shapes of the Rust-owned oracle fixtures this suite reads. They are declared
 * here rather than inferred from `JSON.parse` so a fixture whose shape moves
 * fails the type check instead of silently degrading every assertion below to
 * `any`.
 */
type OracleProbe = {
  name: string;
  status?: string;
  rows: (string | number | null)[][];
};
type PhoneStudyJoinOracle = {
  rawCsvLines: string[];
  esCsvLines: string[];
  columns: string[];
  cases: OracleProbe[];
};
type AdapterConformanceCase = {
  rawBinaryBytes?: number[];
  rawCsvLines?: string[];
  supportCsvLines?: Record<string, string[]>;
  expected: {
    sourceRowCount: number;
    emittedRowCount: number;
    outputContains: string[];
    outputExcludes: string[];
    derivedOutputContains?: string[];
    outputSha256?: string;
    derivedOutputSha256?: string;
  };
};
type AdapterConformanceFixture = {
  groups: { adapterId: string; cases: AdapterConformanceCase[] }[];
};
type AnchorWindowOracle = {
  componentId: string;
  exactCanonicalSettingIds: string[];
  rawCsvLines: string[];
  anchorCsvLines: string[];
  expectedDerivedCsvContains: string[];
};

const readFixture = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(fixture(name), "utf8")) as T;

beforeAll(() => {
  const wasm = dependencyCampaignRuntimeBytes();
  runtimeWasm.initSync({ module: wasm });
  setRustRuntimeForTesting(runtimeWasm);
});

afterEach(() => {
  setRustPersistenceForTesting(null);
  vi.unstubAllGlobals();
});

describe("compiled literature component browser boundary", () => {
  it.each([
    "chronicle.clear-all-active-notification-grouping",
    "chronicle.notification-payload-cleaning",
    "chronicle.on-bounded-short-off-bridge",
    "chronicle.ethica-foreground-interval-preparation",
    "chronicle.touchstroke-sensor-magnitude",
    "chronicle.touchstroke-four-stroke-timing",
    "chronicle.pvt-relative-response-time",
    "chronicle.rabbit-hole-prepared-features",
    "chronicle.clear-all-unique-notification-items",
    "chronicle.clear-all-notification-appearance-age",
    "chronicle.clear-all-empty-snapshot-fractions",
    "chronicle.hmog-sensor-magnitude",
    "chronicle.hmog-supplied-window-reductions",
    "chronicle.hmog-supplied-stability-search",
    "chronicle.hmog-paired-key-hold",
    "chronicle.hmog-consecutive-press-digraph",
    "chronicle.keyboard-stress-axis-statistics",
    "chronicle.class-ringer-fractions",
    "chronicle.app-postpone-fraction",
    "chronicle.twenty-trial-time-mean",
    "chronicle.non-country-unicity-mean",
    "chronicle.country-unicity-mean",
    "chronicle.frame-unique-app-count",
    "chronicle.session-unique-app-count",
    "chronicle.idle-compressed-clock",
    "chronicle.screenlife-capture-gap-partition",
    "chronicle.resolved-unlock-upper-bound",
    "chronicle.smartphone-usage-reductions",
    "chronicle.prosit-unlock-reductions",
    "chronicle.batterylogger-weighted-estimate",
    "chronicle.attelia-activity-transition-lookup",
    "chronicle.backapp-runtime-arithmetic",
    "chronicle.healthymind-notification-rates",
    "chronicle.healthymind-response-delay",
    "chronicle.fischer-notification-phase-times",
    "chronicle.s3-prepared-sensor-window",
    "chronicle.autosen-prepared-normalization",
    "chronicle.s-adl-literal-selection",
    "chronicle.affectpro-ordered-touch-features",
    "chronicle.supplied-app-fingerprint-unicity",
    "chronicle.s-adl-pair-differences",
    "chronicle.okoshi-notification-latencies",
    "chronicle.large-scale-notification-click-time",
    "chronicle.content-notification-removal-time",
    "chronicle.screen-missing-second-repair",
    "chronicle.fukazawa-supplied-acceleration-magnitude",
    "chronicle.accessibility-phrase-set-difference",
    "chronicle.bod-shape-direction-run-collapse",
    "chronicle.uniform-five-minute-byte-allocation",
    "chronicle.capped-closed-screen-packet-gate",
    "chronicle.ohapp-matched-navigation-time",
    "chronicle.jones-ordered-interlaunch-time",
    "chronicle.touch-box-displacement",
    "chronicle.screenomics-text-image-statistics",
    "chronicle.dismissed-supplied-burst-last",
    "chronicle.annotif-supplied-summary-hash-filter",
    "chronicle.dingler-supplied-foreground-exclusion",
    "chronicle.myphoneme-supplied-response-times",
    "chronicle.monarca-prepared-rms",
    "chronicle.moa2-prepared-calendar",
    "chronicle.rapids-supplied-foreground-reductions",
    "chronicle.rapids-supplied-data-yield",
    "chronicle.rapids-prepared-resample-categories",
    "chronicle.hamilton-supplied-no-use-hour-policy",
    "chronicle.shin-prepared-no-app-day",
    "chronicle.sdu-supplied-period-reductions",
    "chronicle.sdu-supplied-validation-arithmetic",
    "chronicle.usage-logger-released-numeric",
    "chronicle.nextapp-supplied-opening-counts",
    "chronicle.van-berkel-resolved-session-gap",
    "chronicle.corrected-password-entry-time",
    "chronicle.ordered-app-presence-vector",
    "chronicle.supplied-pre-sample-longest-window",
    "chronicle.habitual-android-duration-bag",
    "chronicle.finesse-later-feature-time",
    "chronicle.supplied-last-syn-rtt",
    "chronicle.supplied-app-session-tap-rate",
    "chronicle.carat-normalized-entropy",
    "chronicle.carat-pair-regularity",
    "chronicle.carat-day-regularity-mean",
    "chronicle.stdd-prepared-axis",
    "chronicle.touchstroke-prepared-mean",
  ])("runs and reopens the source-bound Android component %s", async (adapterId) => {
    const source = await readFixture<AdapterConformanceFixture>("literature_input_adapter_conformance.json");
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find((group) => group.adapterId === adapterId)!;
    expect(group).toBeDefined();
    const settingIds = [...group.methodSettingIds, ...(group.componentExecution!.additionalMethodSettingIds ?? [])];
    const component = literatureComponentExecutionForSettings(settingIds)!;
    const testCase = source.groups.find((group) => group.adapterId === component.componentId)!.cases[0]!;
    // Those per-formula fixtures bind one owner; the public components execute
    // all 18 Table 4 formulas, or all four S3 formulas on four supplied groups.
    const emittedRowCount = adapterId === "chronicle.keyboard-stress-axis-statistics" ? 18
      : adapterId === "chronicle.s3-prepared-sensor-window" ? 16
      : adapterId === "chronicle.monarca-prepared-rms" ? 5
      : adapterId === "chronicle.stdd-prepared-axis" ? 9 : testCase.expected.emittedRowCount;
    const raw = new TextEncoder().encode(testCase.rawCsvLines!.join("\n") + "\n");
    const studyDates = testCase.supportCsvLines?.study_dates_file;
    const support = studyDates ? { studyDatesFile: {
      name: "component-configuration.csv", bytes: new TextEncoder().encode(studyDates.join("\n") + "\n").buffer,
    } } : {};
    const workspaceId = await literatureComponentWorkspaceId(component.componentId, createHash("sha256").update(raw).digest("hex"));
    const memory = memoryDirectoryHandle(new MemoryDirectoryHandle());
    const storage = { getDirectory: () => Promise.resolve(memory) };
    vi.stubGlobal("navigator", {
      storage,
      locks: { request: (_name: string, _options: unknown, callback: () => unknown) => Promise.resolve(callback()) },
    });
    const root = await openOpfsWorkspace(workspaceId);
    setRustPersistenceForTesting({ openRoot: () => Promise.resolve(root), recover: recoverRuntimeWorkspace, persist: persistRuntimeWorkspace });
    const execution = await executeLiteratureComponentRuntime(component, raw, "source-rows.csv", support, true);
    expect(execution.componentExecutionReceipt).toMatchObject({
      componentId: component.componentId, settingIds, fullProfileExecutionStatus: "blocked", kernelInputEligible: false,
      derivedResultRowCount: emittedRowCount,
    });
    expect(execution.manifest.sourceRowCount).toBe(testCase.expected.sourceRowCount);
    const output = execution.artifacts.find(({ metadata }) => metadata.kind === component.derivedResultKind)!;
    const bytes = await readRuntimeObject(root, output.metadata.digest);
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(output.metadata.digest);
    const text = new TextDecoder().decode(bytes);
    for (const value of testCase.expected.outputContains) expect(text).toContain(value);
    for (const value of testCase.expected.outputExcludes) expect(text).not.toContain(value);
    expect(await readRuntimeObject(root, execution.componentExecutionReceipt.originalInputDigest)).toEqual(raw);
    const reopened = await reopenLiteratureComponentResult(execution.manifestJson);
    expect(reopened.componentExecutionReceipt).toEqual(execution.componentExecutionReceipt);
    expect(await readPersistedRustArtifact(workspaceId, component.derivedResultKind, reopened.manifest.workspaceRootDigest)).toEqual(bytes);
    if (["chronicle.keyboard-stress-axis-statistics", "chronicle.s-adl-literal-selection", "chronicle.supplied-app-fingerprint-unicity", "chronicle.batterylogger-weighted-estimate", "chronicle.hamilton-supplied-no-use-hour-policy", "chronicle.shin-prepared-no-app-day", "chronicle.sdu-supplied-period-reductions", "chronicle.sdu-supplied-validation-arithmetic", "chronicle.usage-logger-released-numeric", "chronicle.rapids-prepared-resample-categories"].includes(adapterId)) {
      const archive = await exportPersistedRustWorkspace(workspaceId, execution.manifest.workspaceRootDigest);
      const importedMemory = memoryDirectoryHandle(new MemoryDirectoryHandle());
      storage.getDirectory = () => Promise.resolve(importedMemory);
      const imported = await importPersistedRustWorkspaceArchive(archive);
      const restored = await reopenImportedLiteratureComponent(imported.workspaceId, imported.slot.workspaceRootDigest);
      expect(restored?.componentExecutionReceipt).toEqual(execution.componentExecutionReceipt);
      expect(restored?.manifest.artifacts).toEqual(execution.manifest.artifacts);
      expect(await readPersistedRustArtifact(imported.workspaceId, component.derivedResultKind, imported.slot.workspaceRootDigest)).toEqual(bytes);
      storage.getDirectory = () => Promise.resolve(memory);
    }
    await expect(reopenLiteratureComponentResult(JSON.stringify({ ...execution.manifest, sourceRowCount: execution.manifest.sourceRowCount + 1 }))).rejects.toThrow("source count mismatch");
  });

  it("executes the complete PhoneStudy join-to-features job against all original-R probes", async () => {
    const source = await readFixture<PhoneStudyJoinOracle>("phonestudy_join_oracle.json");
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(({ adapterId }) => adapterId === "chronicle.phonestudy-phone-features")!;
    const settingIds = [...group.methodSettingIds, ...group.componentExecution!.additionalMethodSettingIds!];
    expect(literatureComponentExecutionForSettings(group.methodSettingIds)).toBeUndefined();
    const registration = literatureComponentExecutionForSettings(settingIds)!;
    const rawRows: Record<string, string>[] = Papa.parse<Record<string, string>>(source.rawCsvLines.join("\n"), { header: true, skipEmptyLines: true }).data
      .map((row, index) => ({ ...row, fixture_row: String(index + 1) }));
    const encoder = new TextEncoder();
    const raw = encoder.encode(Papa.unparse(rawRows));
    const es = encoder.encode(source.esCsvLines.join("\n") + "\n");
    const root = memoryDirectoryHandle(new MemoryDirectoryHandle());
    setRustPersistenceForTesting({ openRoot: () => Promise.resolve(root), recover: recoverRuntimeWorkspace, persist: persistRuntimeWorkspace });
    for (const probe of source.cases) {
      const extra = probe.name.startsWith("collision_") ? probe.name.slice(10) : probe.name === "new_unused_column" ? "unused_payload" : undefined;
      let rows = rawRows.map((row, index) => ({ id: row.communication_id!, ...(extra ? { [extra]: row[extra] ?? String(index + 1) } : {}) }));
      if (probe.name === "empty_right") rows = [];
      if (probe.name === "unmatched_right") rows = [{ id: "100001" }];
      if (probe.name.startsWith("duplicate_key_")) rows.push(rows[Number(probe.name.slice(14)) - 1]!);
      const right = encoder.encode(Papa.unparse({ fields: ["id", ...(extra ? [extra] : [])], data: rows }));
      const persist = probe.name === "baseline";
      const run = executeLiteratureComponentRuntime(registration, raw, "ps_activity.csv", {
        phoneStudyPsCommunicationFile: { name: "ps_communication.csv", bytes: right.buffer },
        phoneStudyEsFile: { name: "es.csv", bytes: es.buffer },
      }, persist);
      if (probe.status === "error") {
        await expect(run).rejects.toThrow();
        continue;
      }
      const execution = await run;
      expect(execution.componentExecutionReceipt).toMatchObject({ settingIds, kernelInputEligible: false, fullProfileExecutionStatus: "blocked", derivedResultRowCount: 3 });
      expect(Object.keys(execution.componentExecutionReceipt.supportArtifactDigests).sort()).toEqual(["phonestudy_es_file", "phonestudy_ps_communication_file"]);
      const derived = execution.artifacts.find(({ metadata }) => metadata.kind === registration.derivedResultKind)!;
      const bytes = derived.bytes ?? await readRuntimeObject(root, derived.metadata.digest);
      const parsed = Papa.parse<string[]>(new TextDecoder().decode(bytes), { skipEmptyLines: true });
      expect(parsed.data[0]).toEqual(source.columns);
      expect(parsed.data.slice(1)).toHaveLength(probe.rows.length);
      for (let row = 0; row < probe.rows.length; row += 1) {
        for (let column = 0; column < source.columns.length; column += 1) {
          const expected = probe.rows[row]![column];
          const actual = parsed.data[row + 1]![column]!;
          if (typeof expected === "number") expect(Math.abs(Number(actual) - expected), `${probe.name}: ${column}`).toBeLessThanOrEqual(1e-12);
          else if (expected === null) expect(["", "NA"]).toContain(actual);
          else expect(actual).toBe(expected);
        }
      }
      if (persist) expect(execution.persistedWorkspace?.generation).toBe(1);
    }
    const right = encoder.encode(Papa.unparse(rawRows.map((row) => ({ id: row.communication_id! }))));
    const support = {
      phoneStudyPsCommunicationFile: { name: "ps_communication.csv", bytes: right.buffer },
      phoneStudyEsFile: { name: "es.csv", bytes: es.buffer },
    };
    // Exercise recovery and input authority through the complete seven-setting job.
    const reopened = await executeLiteratureComponentRuntime(registration, raw, "ps_activity.csv", support, true);
    expect(reopened.persistedWorkspace?.generation).toBe(2);
    await expect(executeLiteratureComponentRuntime(registration, raw, "ps_activity.csv", {}, false)).rejects.toThrow();
    for (const invalidRows of [
      [...rawRows, rawRows[0]!],
      rawRows.map((row) => ({ ...row, phonestudy_ps_activity_source_row: "1" })),
    ]) {
      await expect(executeLiteratureComponentRuntime(registration, encoder.encode(Papa.unparse(invalidRows)), "ps_activity.csv", support, false)).rejects.toThrow();
    }
  });

  it.runIf(Boolean(process.env.CHRONICLE_DEKKER_ORACLE_DIR))("matches the complete retained Dekker released-input R result through WASM", async () => {
    const directory = process.env.CHRONICLE_DEKKER_ORACLE_DIR!;
    const raw = Uint8Array.from(await readFile(`${directory}/data_week_incl_week3.csv`));
    expect(createHash("sha256").update(raw).digest("hex")).toBe("7b38e7127814b84e636aed275e5d538cb9f3b570c81b2c7069e66b582ab5f81a");
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(({ adapterId }) => adapterId === "chronicle.dekker-post-persistence")!;
    const registration = literatureComponentExecutionForSettings(group.methodSettingIds)!;
    const execution = await executeLiteratureComponentRuntime(registration, raw, "data_week_incl_week3.csv", {}, false);
    expect(execution.manifest.sourceRowCount).toBe(606);
    expect(execution.manifest.derivedResultRowCount).toBe(3);
    for (const [kind, file, expectedRows, numeric] of [
      [registration.adaptedResultKind!, "row-results.csv", 108, ["week", "m_notif_day", "reduction_w3"]],
      [registration.derivedResultKind, "summary-results.csv", 3, ["n", "percentage"]],
    ] as const) {
      const artifact = execution.artifacts.find(({ metadata }) => metadata.kind === kind)!;
      expect(artifact.metadata.rowCount).toBe(expectedRows);
      expect(`sha256:${createHash("sha256").update(artifact.bytes!).digest("hex")}`).toBe(artifact.metadata.digest);
      const parse = (csv: string) => Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
      const expected = parse(await readFile(`${directory}/${file}`, "utf8"));
      const actual = parse(new TextDecoder().decode(artifact.bytes));
      expect(actual).toHaveLength(expectedRows);
      let mismatches = 0;
      for (let index = 0; index < expected.length; index += 1) {
        for (const field of Object.keys(actual[index]!)) {
          const left = actual[index]![field]!;
          const right = expected[index]![field]!;
          const numbers = (numeric as readonly string[]).includes(field) && Number.isFinite(Number(left)) && Number.isFinite(Number(right));
          if (numbers ? Math.abs(Number(left) - Number(right)) > 1e-12 : left !== right) mismatches += 1;
        }
      }
      // Do not print participant-level records in a failed comparison.
      expect(mismatches).toBe(0);
    }
  });

  it.each([
    ["chronicle.dekker-post-persistence", "clean_participant_weeks.csv", 5, 4],
    ["chronicle.screen-academic-preparation", "typed_analysis.arrow", 6, 4],
  ] as const)("saves/reopens both %s tables, imports their history and refuses corruption", async (adapterId, fileName, courseRows, participantRows) => {
    const conformance = await readFixture<AdapterConformanceFixture>("literature_input_adapter_conformance.json");
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find((group) => group.adapterId === adapterId)!;
    const settingIds = [...group.methodSettingIds, ...(group.componentExecution!.additionalMethodSettingIds ?? [])];
    const registration = literatureComponentExecutionForSettings(settingIds)!;
    const source = conformance.groups.find((entry) => entry.adapterId === registration.componentId)!.cases[0]!;
    const raw = source.rawBinaryBytes ? Uint8Array.from(source.rawBinaryBytes) : new TextEncoder().encode(source.rawCsvLines!.join("\n") + "\n");
    const memory = new MemoryDirectoryHandle();
    const storage = { getDirectory: () => Promise.resolve(memoryDirectoryHandle(memory)) };
    vi.stubGlobal("navigator", {
      storage,
      locks: { request: (_name: string, _options: unknown, callback: () => unknown) => Promise.resolve(callback()) },
    });
    const workspaceId = await literatureComponentWorkspaceId(registration.componentId, createHash("sha256").update(raw).digest("hex"));
    const root = await openOpfsWorkspace(workspaceId);
    setRustPersistenceForTesting({ openRoot: () => Promise.resolve(root), recover: recoverRuntimeWorkspace, persist: persistRuntimeWorkspace });
    const run = () => executeLiteratureComponentRuntime(registration, raw, fileName, {}, true);
    const first = await run();
    expect(first.componentExecutionReceipt).toMatchObject({ settingIds, fullProfileExecutionStatus: "blocked", kernelInputEligible: false, derivedResultRowCount: participantRows });
    expect(first.manifest.artifacts).toHaveLength(7);
    const rows = first.artifacts.find(({ metadata }) => metadata.kind === registration.adaptedResultKind)!;
    const summary = first.artifacts.find(({ metadata }) => metadata.kind === registration.derivedResultKind)!;
    expect(rows.metadata.rowCount).toBe(courseRows);
    const rowBytes = await readRuntimeObject(root, rows.metadata.digest);
    const savedRows = new TextDecoder().decode(rowBytes);
    const summaryBytes = await readRuntimeObject(root, summary.metadata.digest);
    const savedSummary = new TextDecoder().decode(summaryBytes);
    for (const value of source.expected.outputContains) expect(savedRows).toContain(value);
    for (const value of source.expected.outputExcludes) expect(savedRows).not.toContain(value);
    for (const value of source.expected.derivedOutputContains ?? []) expect(savedSummary).toContain(value);
    if (source.rawBinaryBytes) {
      expect(rows.metadata.mediaType).toBe("application/vnd.apache.arrow.file");
      expect(summary.metadata.mediaType).toBe("application/vnd.apache.arrow.file");
      expect(`sha256:${createHash("sha256").update(rowBytes).digest("hex")}`).toBe(source.expected.outputSha256);
      expect(`sha256:${createHash("sha256").update(summaryBytes).digest("hex")}`).toBe(source.expected.derivedOutputSha256);
      const rootJson = JSON.parse(new TextDecoder().decode(await readRuntimeObject(root, first.manifest.workspaceRootDigest))) as { assignmentDigests: Record<string, unknown> };
      expect(Object.keys(rootJson.assignmentDigests)).toEqual(["typed_analysis_table"]);
      await expect(executeLiteratureComponentRuntime(registration, new TextEncoder().encode("user_idx,grade\nU1,4\n"), "wrong.csv", {}, false)).rejects.toThrow();
    }
    const second = await run();
    expect(second.persistedWorkspace?.generation).toBe(2);
    const reopened = await reopenLiteratureComponentResult(first.manifestJson);
    expect(reopened.manifest).toEqual(first.manifest);
    expect(reopened.componentExecutionReceipt).toEqual(first.componentExecutionReceipt);
    expect(reopened.artifacts.every((artifact) => artifact.persistedArtifact && !artifact.bytes)).toBe(true);
    await expect(reopenLiteratureComponentResult(JSON.stringify({ ...first.manifest, sourceRowCount: first.manifest.sourceRowCount + 1 }))).rejects.toThrow("source count mismatch");
    await expect(exportPersistedRustWorkspace(workspaceId, first.manifest.workspaceRootDigest)).rejects.toThrow("has changed since this result was displayed");
    const archive = await exportPersistedRustWorkspace(workspaceId, second.manifest.workspaceRootDigest);
    const importedMemory = new MemoryDirectoryHandle();
    storage.getDirectory = () => Promise.resolve(memoryDirectoryHandle(importedMemory));
    const imported = await importPersistedRustWorkspaceArchive(archive);
    const restoredFromArchiveOnly = await reopenImportedLiteratureComponent(imported.workspaceId, imported.slot.workspaceRootDigest);
    expect(restoredFromArchiveOnly?.componentExecutionReceipt).toEqual(second.componentExecutionReceipt);
    expect(restoredFromArchiveOnly?.manifest.artifacts).toEqual(second.manifest.artifacts);
    expect((await reopenLiteratureComponentResult(second.manifestJson)).manifest).toEqual(second.manifest);
    expect(imported.slot.workspaceRootDigest).toBe(second.manifest.workspaceRootDigest);
    expect(imported.slot.previousWorkspaceRootDigest).toBe(first.manifest.workspaceRootDigest);
    await expect(readPersistedRustArtifact(workspaceId, rows.metadata.kind, imported.slot.workspaceRootDigest)).resolves.toEqual(rowBytes);
    await expect(readPersistedRustArtifact(workspaceId, summary.metadata.kind, imported.slot.workspaceRootDigest)).resolves.toEqual(summaryBytes);
    const rootFile = await readPersistedRustArtifact(workspaceId, "workspace-root-json", imported.slot.workspaceRootDigest);
    expect(createHash("sha256").update(rootFile).digest("hex")).toBe(imported.slot.workspaceRootDigest.slice(7));
    // Corrupt the actual saved object, not a mocked runtime receipt.
    const corrupt = (directory: MemoryDirectoryHandle): boolean => {
      for (const file of directory.files.values()) {
        if (file.bytes.length === rowBytes.length && file.bytes.every((byte, index) => byte === rowBytes[index])) {
          file.bytes[0] = file.bytes[0]! ^ 1;
          return true;
        }
      }
      return [...directory.directories.values()].some(corrupt);
    };
    expect(corrupt(memory)).toBe(true);
    await expect(run()).rejects.toThrow("no valid artifact closure can be recovered");
  });

  it("refuses to export a displayed result whose own save was lost, naming the earlier save it fell back to", async () => {
    const conformance = await readFixture<AdapterConformanceFixture>("literature_input_adapter_conformance.json");
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find((entry) => entry.adapterId === "chronicle.dekker-post-persistence")!;
    const registration = literatureComponentExecutionForSettings([...group.methodSettingIds, ...(group.componentExecution!.additionalMethodSettingIds ?? [])])!;
    const source = conformance.groups.find((entry) => entry.adapterId === registration.componentId)!.cases[0]!;
    const raw = new TextEncoder().encode(source.rawCsvLines!.join("\n") + "\n");
    const memory = new MemoryDirectoryHandle();
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.resolve(memoryDirectoryHandle(memory)) },
      locks: { request: (_name: string, _options: unknown, callback: () => unknown) => Promise.resolve(callback()) },
    });
    const workspaceId = await literatureComponentWorkspaceId(registration.componentId, createHash("sha256").update(raw).digest("hex"));
    const root = await openOpfsWorkspace(workspaceId);
    setRustPersistenceForTesting({ openRoot: () => Promise.resolve(root), recover: recoverRuntimeWorkspace, persist: persistRuntimeWorkspace });
    const run = () => executeLiteratureComponentRuntime(registration, raw, "clean_participant_weeks.csv", {}, true);
    const first = await run();
    const second = await run();
    expect(second.persistedWorkspace?.generation).toBe(2);
    expect(second.manifest.workspaceRootDigest).not.toBe(first.manifest.workspaceRootDigest);
    // Bit rot in the generation-2 slot (root-b.json); every object stays intact.
    const findFile = (directory: MemoryDirectoryHandle, name: string): { bytes: Uint8Array } | undefined =>
      directory.files.get(name) ?? [...directory.directories.values()].map((child) => findFile(child, name)).find(Boolean);
    const slot = findFile(memory, "root-b.json")!;
    expect(JSON.parse(new TextDecoder().decode(slot.bytes))).toMatchObject({ generation: 2 });
    const middle = Math.floor(slot.bytes.length / 2);
    slot.bytes[middle] = slot.bytes[middle]! ^ 0xff;
    expect((await recoverRuntimeWorkspace(root))?.workspaceRootDigest).toBe(first.manifest.workspaceRootDigest);
    // The second result is still the one a restored page would show.
    await expect(exportPersistedRustWorkspace(workspaceId, second.manifest.workspaceRootDigest)).rejects.toThrow(
      "The newest saved workspace could not be recovered, so this browser fell back to the earlier save at generation 1.",
    );
    // The recovered head itself exports.
    const archive = await exportPersistedRustWorkspace(workspaceId, first.manifest.workspaceRootDigest);
    expect(archive.size).toBeGreaterThan(0);
  });

  it("executes and persists the Elmer joint threshold batch without flattening missing categories", async () => {
    const source = await readFixture<AnchorWindowOracle>("langener_anchor_relative_category_window_component.json");
    const registration = literatureComponentExecutionForSettings(source.exactCanonicalSettingIds)!;
    expect(registration.componentId).toBe(source.componentId);
    const encoder = new TextEncoder();
    const raw = encoder.encode(source.rawCsvLines.join("\n") + "\n");
    const anchors = encoder.encode(source.anchorCsvLines.join("\n") + "\n");
    const root = memoryDirectoryHandle(new MemoryDirectoryHandle());
    setRustPersistenceForTesting({
      openRoot: () => Promise.resolve(root),
      recover: recoverRuntimeWorkspace,
      persist: persistRuntimeWorkspace,
    });
    const execution = await executeLiteratureComponentRuntime(registration, raw, "categorized_usage.csv", {
      anchorEventsFile: { name: "anchor_events.csv", bytes: anchors.buffer },
    }, true);
    expect(execution.componentExecutionReceipt).toMatchObject({
      componentExecutionStatus: "executed",
      fullProfileExecutionStatus: "blocked",
      settingIds: source.exactCanonicalSettingIds,
      derivedResultRowCount: 54,
    });
    expect(execution.persistedWorkspace?.generation).toBe(1);
    const derived = execution.artifacts.find(({ metadata }) => metadata.kind === registration.derivedResultKind)!;
    const saved = new TextDecoder().decode(await readRuntimeObject(root, derived.metadata.digest));
    expect(saved.trimEnd().split("\n")).toHaveLength(55);
    for (const row of source.expectedDerivedCsvContains) expect(saved.split("\n")).toContain(row);
    const receipt = JSON.parse(new TextDecoder().decode(await readRuntimeObject(root, execution.componentExecutionReceipt.componentMethodReceiptDigest))) as { settingIds: string[] };
    expect(receipt.settingIds).toEqual(source.exactCanonicalSettingIds);
    await expect(readRuntimeObject(root, execution.componentExecutionReceipt.originalInputDigest)).resolves.toEqual(raw);
    await expect(readRuntimeObject(root, execution.componentExecutionReceipt.supportArtifactDigests.anchor_events_file!)).resolves.toEqual(anchors);
    expect(await recoverRuntimeWorkspace(root)).not.toBeNull();
  });

  it("executes the source-shaped Schoedel fixture through the strict browser decoder", async () => {
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(
      ({ semanticType }) => semanticType === "schoedel_screen_preprocessing",
    );
    expect(group).toBeDefined();
    const registration = literatureComponentExecutionForSettings(
      group!.methodSettingIds,
    );
    expect(registration).toBeDefined();

    const [rawFile, communicationFile, expectedFile] = await Promise.all([
      readFile(fixture("schoedel_component_patterns_raw.csv")),
      readFile(fixture("schoedel_component_patterns_communication.csv")),
      readFile(fixture("schoedel_component_patterns_expected.csv")),
    ]);
    const raw = Uint8Array.from(rawFile);
    const communication = Uint8Array.from(communicationFile);
    const expected = Uint8Array.from(expectedFile);

    const execution = await executeLiteratureComponentRuntime(
      registration!,
      raw,
      "schoedel_component_patterns_raw.csv",
      {
        phoneStudyPsCommunicationFile: {
          name: "schoedel_component_patterns_communication.csv",
          bytes: communication.buffer,
        },
      },
      false,
    );

    expect(execution.manifest.command).toBe("ExecuteLiteratureComponent");
    expect(execution.manifest.artifacts).toHaveLength(6);
    expect(execution.componentExecutionReceipt).toMatchObject({
      componentExecutionStatus: "executed",
      fullProfileExecutionStatus: "blocked",
      kernelInputEligible: false,
      canonicalKernelInputDigest: null,
    });
    const derived = execution.artifacts.find(
      ({ metadata }) => metadata.kind === registration!.derivedResultKind,
    );
    expect(derived?.bytes).toEqual(expected);
  });
});
