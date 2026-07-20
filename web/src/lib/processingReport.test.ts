import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { ExecutionLedger } from "@/lib/pipelineGraph/executionRecords";
import {
  buildParameterSetRecord,
  buildProcessingReport,
  buildProcessingReportObject,
  buildProvenanceJsonLd,
  canonicalJson,
  readReportEnvironment,
  sha256Hex,
  type ProcessingReportInput,
} from "@/lib/processingReport";
import type { ProcessedFileResult } from "@/lib/types";

const FIXED_TIMING = {
  startedAt: "2026-04-24T00:32:52.000Z",
  endedAt: "2026-04-24T00:32:52.010Z",
  durationMs: 10,
};

/** A fixed two-scale ledger: one unit with two steps, one loss accounted. */
const FIXED_LEDGER: ExecutionLedger = [
  {
    unit: "parse_events",
    status: "recomputed",
    rowsIn: null,
    rowsOut: 98,
    expectations: [],
    steps: [
      {
        stepId: "csv_parse",
        unit: "parse_events",
        status: "ran",
        rowsIn: null,
        rowsOut: 100,
        droppedRows: null,
        expectations: [],
        timing: FIXED_TIMING,
      },
      {
        stepId: "drop_empty_timestamp",
        unit: "parse_events",
        status: "ran",
        rowsIn: 100,
        rowsOut: 98,
        droppedRows: 2,
        expectations: [
          {
            id: "no_row_creation",
            kind: "row_count",
            ok: true,
            expected: "rows_out (98) <= rows_in (100) — a lossy step never creates rows",
            actual: "rows_in 100, rows_out 98",
            message: "",
            severity: "warn",
          },
        ],
        timing: FIXED_TIMING,
      },
    ],
    timing: FIXED_TIMING,
  },
];

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

  it("projects each file's ExecutionLedger verbatim into `executions`", () => {
    const report = buildProcessingReportObject(
      makeInput({ results: [makeResult({ executionLedger: FIXED_LEDGER })] }),
    );
    expect(report.files[0]?.executions).toEqual(FIXED_LEDGER);
  });

  it("emits an empty executions list for results predating the ledger", () => {
    const report = buildProcessingReportObject(makeInput());
    expect(report.files[0]?.executions).toEqual([]);
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

  it("renders a bare non-object primitive as its own JSON scalar (not object form)", () => {
    // The `value !== null && typeof value === "object"` guard must be a real
    // test: a number is a scalar, not an object. Forcing the guard true would
    // send it through Object.entries(42) === [] and canonicalize it as "{}".
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hi")).toBe('"hi"');
    expect(canonicalJson(true)).toBe("true");
  });

  it("renders bare null as the JSON null literal, not the object branch", () => {
    // typeof null === "object", so the object-branch guard MUST also assert
    // `value !== null`. Forcing that left operand true routes null into
    // Object.entries(null), which throws — this call must simply return "null".
    expect(canonicalJson(null)).toBe("null");
  });

  it("orders scrambled object keys into a fully ascending canonical sequence", () => {
    // A three-key object in NON-sorted insertion order: the comparator must sort
    // strictly ascending. A comparator stuck at -1 (first cond → true) or one
    // that returns 0 for the less-than case (first cond → false) reorders these
    // three keys differently, so the exact string pins the real comparator.
    expect(canonicalJson({ c: 1, a: 2, b: 3 })).toBe('{"a":2,"b":3,"c":1}');
  });

  it("sorts reverse-ordered keys ascending (exercises the a>b comparator branch)", () => {
    // Descending insertion order drives the comparator through its `a > b`
    // branch. NOTE: the two ConditionalExpression mutants on `a > b` (→true /
    // →false) are EQUIVALENT for distinct keys — V8's sort only consults the
    // sign<0 result, so returning 1 vs 0 vs a real 1 never reorders distinct
    // keys (exhaustively verified). This remains a valid canonical-order pin.
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("renders a bare undefined (or unserializable) value as the JSON null literal", () => {
    // JSON.stringify(undefined) is undefined; the `?? "null"` fallback keeps the
    // canonical form total so nested undefineds never yield a broken string.
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(() => 1)).toBe("null");
    // Inside an array, an unserializable slot canonicalizes to the null literal.
    expect(canonicalJson([undefined])).toBe("[null]");
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

  it("pins the JSON-LD @context IRIs (they define what every prefixed term MEANS)", () => {
    const doc = JSON.parse(buildProvenanceJsonLd(input)) as { "@context": unknown };
    expect(doc["@context"]).toEqual({
      prov: "http://www.w3.org/ns/prov#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      dcterms: "http://purl.org/dc/terms/",
      chron: "https://w3id.org/chronicle-usage-ontology/core/",
      chronicle: "https://chronicle.local/schemas/",
    });
  });

  it("pins the run Activity's fixed IRIs, label and injected ended-time", () => {
    const graph = (JSON.parse(buildProvenanceJsonLd(input)) as {
      "@graph": Array<Record<string, unknown>>;
    })["@graph"];
    const activity = graph.find((node) => node["@type"] === "prov:Activity");
    expect(activity?.["@id"]).toBe("urn:uuid:run-fixed-id");
    expect(activity?.["rdfs:label"]).toBe("Chronicle Android raw data preprocessing run");
    // generatedAt is injected fixed, so this is deterministic (not a wall clock).
    expect(activity?.["prov:endedAtTime"]).toEqual({
      "@value": "2026-04-24T00:32:53.000Z",
      "@type": "xsd:dateTime",
    });
    // prov:used cites the ParameterSet by its exact content-address IRI (the
    // ternary array, not a placeholder literal).
    expect(activity?.["prov:used"]).toContainEqual({
      "@id": "urn:chronicle:parameterset:sha256:cafe01",
    });
  });

  it("pins the SoftwareAgent IRI, label and version slot", () => {
    const graph = (JSON.parse(buildProvenanceJsonLd(input)) as {
      "@graph": Array<Record<string, unknown>>;
    })["@graph"];
    const agent = graph.find(
      (node) => Array.isArray(node["@type"]) && node["@type"].includes("prov:SoftwareAgent"),
    );
    expect(agent?.["@id"]).toBe("urn:chronicle:agent:preprocessor:9.9.9");
    expect(agent?.["rdfs:label"]).toBe("Chronicle Android raw data preprocessor 9.9.9");
    // The version slot must be the canonical key, not a blanked one.
    expect(agent).toHaveProperty("chronicle:version", "9.9.9");
  });

  it("types the agent with the exact prov class pair (not a blanked first entry)", () => {
    const graph = (JSON.parse(buildProvenanceJsonLd(input)) as {
      "@graph": Array<Record<string, unknown>>;
    })["@graph"];
    const agent = graph.find(
      (node) => Array.isArray(node["@type"]) && node["@type"].includes("prov:SoftwareAgent"),
    );
    // Both class IRIs must be literal — blanking the first entry to "" would
    // leave an untyped agent that still `includes("prov:SoftwareAgent")`.
    expect(agent?.["@type"]).toEqual(["prov:Agent", "prov:SoftwareAgent"]);
  });

  it("omits the ParameterSet from prov:used entirely when none was supplied", () => {
    // With no parameterSetSha256 (and no ledger to force the contract throw),
    // the ternary takes its empty-array branch. A non-empty fallback would
    // inject a stray element, so prov:used must be the inputs alone.
    const doc = JSON.parse(buildProvenanceJsonLd(makeInput())) as {
      "@graph": Array<Record<string, unknown>>;
    };
    const activity = doc["@graph"].find((node) => node["@type"] === "prov:Activity");
    expect(activity?.["prov:used"]).toEqual([{ "@id": "urn:chronicle:input:sha256:abc123" }]);
  });

  it("types input entities as prov:Entity and carries their SHA-256 slot", () => {
    const graph = (JSON.parse(buildProvenanceJsonLd(input)) as {
      "@graph": Array<Record<string, unknown>>;
    })["@graph"];
    const inputEntity = graph.find((node) => node["@id"] === "urn:chronicle:input:sha256:abc123");
    expect(inputEntity?.["@type"]).toBe("prov:Entity");
    expect(inputEntity?.["chronicle:sha256"]).toBe("abc123");
  });

  it("types output entities as prov:Entity", () => {
    const graph = (JSON.parse(buildProvenanceJsonLd(input)) as {
      "@graph": Array<Record<string, unknown>>;
    })["@graph"];
    const output = graph.find(
      (node) => typeof node["@id"] === "string" && node["@id"].startsWith("urn:chronicle:output:"),
    );
    expect(output?.["@type"]).toBe("prov:Entity");
  });

  it("pins the ParameterSet entity's human label", () => {
    const graph = (JSON.parse(buildProvenanceJsonLd(input)) as {
      "@graph": Array<Record<string, unknown>>;
    })["@graph"];
    const parameterSet = graph.find(
      (node) => node["@id"] === "urn:chronicle:parameterset:sha256:cafe01",
    );
    expect(parameterSet?.["rdfs:label"]).toBe(
      "ParameterSet (full processing options, canonical JSON)",
    );
  });

  it("addresses an input with no SHA-256 by its URL-encoded file name", () => {
    // No ledger + no ParameterSet is legal (contract only bites with a ledger).
    const doc = JSON.parse(
      buildProvenanceJsonLd(makeInput({ results: [makeResult({ inputSha256: undefined })] })),
    ) as { "@graph": Array<Record<string, unknown>> };
    const inputEntity = doc["@graph"].find(
      (node) => node["rdfs:label"] === "Raw P001.csv" && node["@type"] === "prov:Entity",
    );
    // The name-fallback IRI (the else branch of the SHA ternary) must be emitted.
    expect(inputEntity?.["@id"]).toBe("urn:chronicle:input:name:Raw%20P001.csv");
  });

  it("emits no ParameterSet node — and no stray graph element — when no hash is supplied", () => {
    const doc = JSON.parse(buildProvenanceJsonLd(makeInput())) as {
      "@graph": Array<Record<string, unknown>>;
    };
    // Every @graph element is an object node; the empty else-branch must not
    // splice a placeholder string into the graph.
    expect(doc["@graph"].every((node) => typeof node === "object" && node !== null)).toBe(true);
    expect(
      doc["@graph"].some(
        (node) => Array.isArray(node["@type"]) && node["@type"].includes("chron:ParameterSet"),
      ),
    ).toBe(false);
  });

  describe("per-node chron:NodeExecution activities", () => {
    const ledgerInput = makeInput({
      parameterSetSha256: "cafe01",
      results: [makeResult({ inputSha256: "abc123", executionLedger: FIXED_LEDGER })],
    });
    const graphOf = (): Array<Record<string, unknown>> =>
      (JSON.parse(buildProvenanceJsonLd(ledgerInput)) as { "@graph": Array<Record<string, unknown>> })[
        "@graph"
      ];
    const UNIT_IRI = "urn:chronicle:nodeexec:run-fixed-id:Raw%20P001.csv:parse_events";

    it("emits one unit-level NodeExecution scoped by run + input file", () => {
      const unit = graphOf().find((node) => node["@id"] === UNIT_IRI);
      expect(unit).toMatchObject({
        "@type": ["prov:Activity", "chron:NodeExecution"],
        "chron:executes_step": { "@id": "urn:chronicle:step:parse_events" },
        "chron:used_parameter_set": { "@id": "urn:chronicle:parameterset:sha256:cafe01" },
        "chronicle:status": "recomputed",
        "chronicle:rowsOut": 98,
        "prov:startedAtTime": { "@value": FIXED_TIMING.startedAt, "@type": "xsd:dateTime" },
        "prov:endedAtTime": { "@value": FIXED_TIMING.endedAt, "@type": "xsd:dateTime" },
        "prov:wasInformedBy": { "@id": "urn:uuid:run-fixed-id" },
      });
    });

    it("labels the unit execution and omits chronicle:rowsIn when the unit's rowsIn is null", () => {
      const unit = graphOf().find((node) => node["@id"] === UNIT_IRI);
      expect(unit?.["rdfs:label"]).toBe("parse_events (recomputed)");
      // parse_events has rowsIn === null → the rowsIn key must be absent, not null.
      expect(unit).not.toHaveProperty("chronicle:rowsIn");
    });

    it("labels each step execution and omits droppedRows when the step's droppedRows is null", () => {
      const graph = graphOf();
      const step = graph.find((node) => node["@id"] === `${UNIT_IRI}:drop_empty_timestamp`);
      expect(step?.["rdfs:label"]).toBe("parse_events/drop_empty_timestamp (ran)");
      // csv_parse has droppedRows === null → the droppedRows key must be absent.
      const csvParse = graph.find((node) => node["@id"] === `${UNIT_IRI}:csv_parse`);
      expect(csvParse).not.toHaveProperty("chronicle:droppedRows");
    });

    it("keeps the FIRST unit as a shared step's parent (first-occurrence-wins dedup)", () => {
      // Two units both reference a step with the SAME id under different parents.
      // The StepDefinition's dcterms:isPartOf must record the FIRST unit seen;
      // an unconditional set would record the LAST.
      const dupLedger: ExecutionLedger = [
        {
          unit: "unit_a",
          status: "recomputed",
          rowsIn: null,
          rowsOut: 1,
          expectations: [],
          steps: [
            {
              stepId: "shared_step",
              unit: "unit_a",
              status: "ran",
              rowsIn: null,
              rowsOut: 1,
              droppedRows: null,
              expectations: [],
              timing: FIXED_TIMING,
            },
          ],
          timing: FIXED_TIMING,
        },
        {
          unit: "unit_b",
          status: "recomputed",
          rowsIn: null,
          rowsOut: 1,
          expectations: [],
          steps: [
            {
              stepId: "shared_step",
              unit: "unit_b",
              status: "ran",
              rowsIn: null,
              rowsOut: 1,
              droppedRows: null,
              expectations: [],
              timing: FIXED_TIMING,
            },
          ],
          timing: FIXED_TIMING,
        },
      ];
      const graph = (
        JSON.parse(
          buildProvenanceJsonLd(
            makeInput({
              parameterSetSha256: "cafe01",
              results: [makeResult({ inputSha256: "abc123", executionLedger: dupLedger })],
            }),
          ),
        ) as { "@graph": Array<Record<string, unknown>> }
      )["@graph"];
      const stepDef = graph.find((node) => node["@id"] === "urn:chronicle:step:shared_step");
      expect(stepDef?.["dcterms:isPartOf"]).toEqual({ "@id": "urn:chronicle:step:unit_a" });
    });

    it("nests step executions under the unit via dcterms:isPartOf with loss accounting", () => {
      const step = graphOf().find((node) => node["@id"] === `${UNIT_IRI}:drop_empty_timestamp`);
      expect(step).toMatchObject({
        "@type": ["prov:Activity", "chron:NodeExecution"],
        "chron:executes_step": { "@id": "urn:chronicle:step:drop_empty_timestamp" },
        "chronicle:status": "ran",
        "chronicle:rowsIn": 100,
        "chronicle:rowsOut": 98,
        "chronicle:droppedRows": 2,
        "dcterms:isPartOf": { "@id": UNIT_IRI },
        "prov:wasInformedBy": { "@id": "urn:uuid:run-fixed-id" },
      });
    });

    it("mints typed StepDefinition plan nodes composed via dcterms:isPartOf", () => {
      const graph = graphOf();
      const unitDef = graph.find((node) => node["@id"] === "urn:chronicle:step:parse_events");
      expect(unitDef).toMatchObject({
        "@type": "chron:StepDefinition",
        "chron:step_id": "parse_events",
      });
      expect(unitDef).not.toHaveProperty("dcterms:isPartOf");
      const stepDef = graph.find(
        (node) => node["@id"] === "urn:chronicle:step:drop_empty_timestamp",
      );
      // The ontology slot part_of_step declares slot_uri dcterms:isPartOf —
      // the sidecar must emit the canonical predicate, never chron:part_of_step.
      expect(stepDef).toMatchObject({
        "@type": "chron:StepDefinition",
        "chron:step_id": "drop_empty_timestamp",
        "dcterms:isPartOf": { "@id": "urn:chronicle:step:parse_events" },
      });
      expect(stepDef).not.toHaveProperty("chron:part_of_step");
    });

    it("types the ParameterSet with the ontology class and its sha slot", () => {
      const parameterSet = graphOf().find(
        (node) => node["@id"] === "urn:chronicle:parameterset:sha256:cafe01",
      );
      expect(parameterSet).toMatchObject({
        "@type": ["prov:Entity", "chron:ParameterSet"],
        "chron:parameter_set_sha256": "cafe01",
      });
    });

    it("emits one NodeExecution per unit and per step, and none without a ledger", () => {
      const executions = graphOf().filter(
        (node) => Array.isArray(node["@type"]) && node["@type"].includes("chron:NodeExecution"),
      );
      expect(executions).toHaveLength(3);
      const bare = JSON.parse(buildProvenanceJsonLd(input)) as {
        "@graph": Array<Record<string, unknown>>;
      };
      expect(
        bare["@graph"].some(
          (node) => Array.isArray(node["@type"]) && node["@type"].includes("chron:NodeExecution"),
        ),
      ).toBe(false);
    });

    it("omits rowsOut when a unit reports a null rowsOut", () => {
      // A unit with rowsOut === null must not emit the chronicle:rowsOut key.
      const nullOutLedger: ExecutionLedger = [
        {
          unit: "sink_unit",
          status: "recomputed",
          rowsIn: 7,
          rowsOut: null,
          expectations: [],
          steps: [],
          timing: FIXED_TIMING,
        },
      ];
      const graph = (
        JSON.parse(
          buildProvenanceJsonLd(
            makeInput({
              parameterSetSha256: "cafe01",
              results: [makeResult({ inputSha256: "abc123", executionLedger: nullOutLedger })],
            }),
          ),
        ) as { "@graph": Array<Record<string, unknown>> }
      )["@graph"];
      const unit = graph.find(
        (node) =>
          typeof node["@id"] === "string" &&
          node["@id"].startsWith("urn:chronicle:nodeexec:") &&
          node["@id"].endsWith(":sink_unit"),
      );
      expect(unit).toMatchObject({ "chronicle:rowsIn": 7 });
      expect(unit).not.toHaveProperty("chronicle:rowsOut");
    });

    it("dedupes shared unit/step StepDefinitions across multiple files", () => {
      // Two files whose ledgers reference the SAME unit and step ids: the
      // StepDefinition set must contain each id exactly once (later occurrences
      // hit the already-present branch and are skipped).
      const graph = (
        JSON.parse(
          buildProvenanceJsonLd(
            makeInput({
              parameterSetSha256: "cafe01",
              results: [
                makeResult({ inputFileName: "Raw A.csv", inputSha256: "a1", executionLedger: FIXED_LEDGER }),
                makeResult({ inputFileName: "Raw B.csv", inputSha256: "b2", executionLedger: FIXED_LEDGER }),
              ],
            }),
          ),
        ) as { "@graph": Array<Record<string, unknown>> }
      )["@graph"];
      const stepDefs = graph.filter((node) => node["@type"] === "chron:StepDefinition");
      const ids = stepDefs.map((n) => n["@id"]);
      // parse_events (unit) + csv_parse + drop_empty_timestamp (steps) = 3, deduped.
      expect(ids).toEqual([
        "urn:chronicle:step:parse_events",
        "urn:chronicle:step:csv_parse",
        "urn:chronicle:step:drop_empty_timestamp",
      ]);
      expect(new Set(ids).size).toBe(ids.length);
      // Both files still mint their own per-file NodeExecution activities.
      const execs = graph.filter(
        (node) => Array.isArray(node["@type"]) && node["@type"].includes("chron:NodeExecution"),
      );
      expect(execs).toHaveLength(6); // 3 per file × 2 files
    });
  });
});

describe("readReportEnvironment", () => {
  afterEach(() => vi.restoreAllMocks());

  it("captures navigator fields and the resolved time zone", () => {
    const env = readReportEnvironment();
    expect(env.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    // In this runtime navigator exists; the fields mirror it verbatim.
    expect(env.userAgent).toBe(navigator.userAgent);
    expect(env.hardwareConcurrency).toBe(navigator.hardwareConcurrency);
    expect(env.language).toBe(navigator.language);
  });

  it("leaves timeZone undefined when Intl resolution throws", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no ICU");
    });
    expect(readReportEnvironment().timeZone).toBeUndefined();
  });

  it("leaves navigator-derived fields undefined when navigator is absent", () => {
    // A non-browser context (no navigator global) takes the `undefined` arm, so
    // the userAgent/hardwareConcurrency/language fields are omitted safely while
    // the resolved time zone still comes through.
    vi.stubGlobal("navigator", undefined);
    const env = readReportEnvironment();
    expect(env.userAgent).toBeUndefined();
    expect(env.hardwareConcurrency).toBeUndefined();
    expect(env.language).toBeUndefined();
    expect(env.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    vi.unstubAllGlobals();
  });
});

describe("buildProvenanceJsonLd ParameterSet contract", () => {
  it("throws when a ledger is present but no ParameterSet hash was supplied", () => {
    const withLedger = {
      results: [
        {
          inputFileName: "Raw P01.csv",
          executionLedger: [
            {
              unit: "parse_events",
              status: "recomputed",
              rowsIn: null,
              rowsOut: 1,
              expectations: [],
              steps: [],
              timing: FIXED_TIMING,
            },
          ],
        } as unknown as ProcessedFileResult,
      ],
      options: DEFAULT_BROWSER_OPTIONS,
      preprocessorVersion: "1.0.0",
      generatedAt: "2026-04-24T00:32:53.000Z",
      runId: "00000000-0000-4000-8000-000000000000",
    } as ProcessingReportInput;
    expect(() => buildProvenanceJsonLd(withLedger)).toThrow(/parameterSetSha256/);
    // Pin the SECOND half of the message too, so blanking it cannot pass on the
    // surviving first half.
    expect(() => buildProvenanceJsonLd(withLedger)).toThrow(/NodeExecutionContractShape/);
    // Without a ledger the ParameterSet stays optional (no NodeExecutions emitted).
    expect(() =>
      buildProvenanceJsonLd({ ...withLedger, results: [makeResult()] }),
    ).not.toThrow();
  });

  it("throws when only SOME results carry a ledger and no ParameterSet hash was supplied", () => {
    // The guard uses `.some`, not `.every`: one ledger-bearing result is enough
    // to require the ParameterSet, even when another result has no ledger.
    const mixed = makeInput({
      results: [
        makeResult({ inputFileName: "Raw A.csv", inputSha256: "a1", executionLedger: FIXED_LEDGER }),
        makeResult({ inputFileName: "Raw B.csv", inputSha256: "b2" }),
      ],
    });
    // makeInput supplies no parameterSetSha256 by default.
    expect(() => buildProvenanceJsonLd(mixed)).toThrow(/NodeExecutionContractShape/);
  });
});
