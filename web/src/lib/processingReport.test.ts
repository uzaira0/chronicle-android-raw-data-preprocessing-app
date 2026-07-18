import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  buildParameterSetRecord,
  buildProcessingReport,
  buildProcessingReportObject,
  buildProvenanceJsonLd,
  canonicalJson,
  sha256Hex,
  type ProcessingReportInput,
} from "@/lib/processingReport";
import type { ProcessedFileResult } from "@/lib/types";

function makeResult(overrides: Partial<ProcessedFileResult> = {}): ProcessedFileResult {
  return {
    inputFileName: "Raw P001.csv",
    outputs: [
      {
        kind: "app",
        outputFileName: "Raw P001 App Usage.csv",
        blob: new Blob(["x"]),
        rowCount: 12,
        previewRows: [],
      },
    ],
    originalRowCount: 100,
    processedRowCount: 90,
    availableTimezones: ["America/Chicago"],
    timezone: "America/Chicago",
    appRowCount: 12,
    screenRowCount: 0,
    timezoneAction: "none",
    rowsBeforeTimezoneHandling: 100,
    rowsAfterTimezoneHandling: 100,
    rowsRemovedByTimezone: 0,
    duplicateTimestampsCorrected: 0,
    exactDuplicateRowsRemoved: 0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ProcessingReportInput> = {}): ProcessingReportInput {
  return {
    results: [makeResult({ inputSha256: "abc123" })],
    options: DEFAULT_BROWSER_OPTIONS,
    preprocessorVersion: "9.9.9",
    generatedAt: "2026-04-24T00:32:53.000Z",
    runId: "run-fixed-id",
    environment: { userAgent: "test-agent", hardwareConcurrency: 8, timeZone: "UTC", language: "en" },
    ...overrides,
  };
}

describe("buildProcessingReportObject", () => {
  it("records run-level provenance (runId, version, timestamp, environment)", () => {
    const report = buildProcessingReportObject(makeInput());
    expect(report.runId).toBe("run-fixed-id");
    expect(report.preprocessorVersion).toBe("9.9.9");
    expect(report.generatedAt).toBe("2026-04-24T00:32:53.000Z");
    expect(report.environment).toEqual({
      userAgent: "test-agent",
      hardwareConcurrency: 8,
      timeZone: "UTC",
      language: "en",
    });
  });

  it("includes the per-file input SHA-256 when present", () => {
    const report = buildProcessingReportObject(makeInput());
    expect(report.files).toHaveLength(1);
    expect(report.files[0]?.inputSha256).toBe("abc123");
    expect(report.files[0]?.inputFileName).toBe("Raw P001.csv");
  });

  it("emits null for a missing hash rather than dropping the field", () => {
    const report = buildProcessingReportObject(
      makeInput({ results: [makeResult({ inputSha256: undefined })] }),
    );
    expect(report.files[0]).toHaveProperty("inputSha256", null);
  });

  it("maps each output's kind/name/rowCount", () => {
    const report = buildProcessingReportObject(makeInput());
    expect(report.files[0]?.outputs).toEqual([
      { kind: "app", outputFileName: "Raw P001 App Usage.csv", rowCount: 12 },
    ]);
  });

  it("is deterministic given fixed inputs (no Date.now/random/global reads)", () => {
    const a = buildProcessingReport(makeInput());
    const b = buildProcessingReport(makeInput());
    expect(a).toBe(b);
    expect(JSON.parse(a)).toMatchObject({ runId: "run-fixed-id", preprocessorVersion: "9.9.9" });
  });

  it("carries the ParameterSet hash when provided, null otherwise", () => {
    expect(buildProcessingReportObject(makeInput()).parameterSetSha256).toBeNull();
    expect(
      buildProcessingReportObject(makeInput({ parameterSetSha256: "deadbeef" })).parameterSetSha256,
    ).toBe("deadbeef");
  });
});

describe("canonicalJson + ParameterSet content hash", () => {
  it("sorts object keys recursively and is insertion-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it("drops undefined-valued keys (JSON has no undefined)", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("sha256Hex matches the known digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("ParameterSet hash is stable across runs and changes when an option changes", async () => {
    const a = await buildParameterSetRecord(DEFAULT_BROWSER_OPTIONS);
    const b = await buildParameterSetRecord(DEFAULT_BROWSER_OPTIONS);
    const c = await buildParameterSetRecord({ ...DEFAULT_BROWSER_OPTIONS, minimumUsageDuration: 61 });
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildProvenanceJsonLd (PROV-O sidecar)", () => {
  const input = makeInput({ parameterSetSha256: "cafe01" });

  it("models the run as an Activity that used the inputs and the ParameterSet", () => {
    const doc = JSON.parse(buildProvenanceJsonLd(input)) as {
      "@graph": Array<Record<string, unknown>>;
    };
    const activity = doc["@graph"].find((node) => node["@type"] === "prov:Activity");
    expect(activity).toBeDefined();
    expect(activity?.["@id"]).toBe("urn:uuid:run-fixed-id");
    expect(activity?.["prov:used"]).toEqual([
      { "@id": "urn:chronicle:input:sha256:abc123" },
      { "@id": "urn:chronicle:parameterset:sha256:cafe01" },
    ]);
  });

  it("links every output entity to the run and its source input", () => {
    const doc = JSON.parse(buildProvenanceJsonLd(input)) as {
      "@graph": Array<Record<string, unknown>>;
    };
    const output = doc["@graph"].find(
      (node) => typeof node["@id"] === "string" && node["@id"].startsWith("urn:chronicle:output:"),
    );
    expect(output).toMatchObject({
      "prov:wasGeneratedBy": { "@id": "urn:uuid:run-fixed-id" },
      "prov:wasDerivedFrom": { "@id": "urn:chronicle:input:sha256:abc123" },
      "chronicle:outputKind": "app",
      "chronicle:rowCount": 12,
    });
  });

  it("declares the preprocessor as a SoftwareAgent associated with the run", () => {
    const doc = JSON.parse(buildProvenanceJsonLd(input)) as {
      "@graph": Array<Record<string, unknown>>;
    };
    const agent = doc["@graph"].find(
      (node) => Array.isArray(node["@type"]) && node["@type"].includes("prov:SoftwareAgent"),
    );
    expect(agent).toMatchObject({ "chronicle:version": "9.9.9" });
    const activity = doc["@graph"].find((node) => node["@type"] === "prov:Activity");
    expect(activity?.["prov:wasAssociatedWith"]).toEqual({ "@id": agent?.["@id"] });
  });

  it("is deterministic given fixed inputs", () => {
    expect(buildProvenanceJsonLd(input)).toBe(buildProvenanceJsonLd(input));
  });
});
