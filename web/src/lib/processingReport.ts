import type { ExecutionLedger, UnitExecutionRecord } from "@/lib/pipelineGraph/executionRecords";
import type { BrowserProcessingOptions, ProcessedFileResult } from "@/lib/types";

/**
 * Environment provenance captured at report time (main-thread values). All
 * fields optional so the builder stays pure and testable with fixed inputs.
 */
export type ReportEnvironment = {
  userAgent?: string;
  hardwareConcurrency?: number;
  timeZone?: string;
  language?: string;
};

export type ProcessingReportInput = {
  results: ProcessedFileResult[];
  options: BrowserProcessingOptions;
  preprocessorVersion: string;
  /** ISO timestamp; injected so the report is deterministic in tests. */
  generatedAt: string;
  /** Unique id for this processing run (provenance / audit trail). */
  runId: string;
  environment: ReportEnvironment;
  /**
   * Canonical-JSON SHA-256 of the full options object (see
   * {@link buildParameterSetRecord}) — a content address for the exact
   * configuration, so two runs are byte-comparable by a single id.
   */
  parameterSetSha256?: string;
};

/**
 * Deterministic JSON: object keys sorted recursively, arrays kept in order,
 * no whitespace. Two options objects that differ only in key insertion order
 * canonicalize identically, so the ParameterSet hash is a true content
 * address.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** SHA-256 hex digest of a UTF-8 string (WebCrypto; available in browser + node). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Content-addressed ParameterSet: canonical JSON of the options + its SHA-256. */
export async function buildParameterSetRecord(
  options: BrowserProcessingOptions,
): Promise<{ canonical: string; sha256: string }> {
  const canonical = canonicalJson(options);
  return { canonical, sha256: await sha256Hex(canonical) };
}

/**
 * The run-manifest provenance sidecar (`chronicle-processing-report.json`)
 * bundled into every output ZIP. Records the preprocessor version, the full
 * settings, the runtime environment, and per-file provenance including the
 * SHA-256 of each raw input so a run can be audited and reproduced.
 *
 * Pure: takes every non-deterministic value (timestamp, runId, environment)
 * as input rather than reading globals, so it is unit-testable.
 */
export function buildProcessingReportObject(input: ProcessingReportInput): {
  runId: string;
  generatedAt: string;
  preprocessorVersion: string;
  environment: ReportEnvironment;
  options: BrowserProcessingOptions;
  parameterSetSha256: string | null;
  files: Array<Record<string, unknown>>;
} {
  const { results, options, preprocessorVersion, generatedAt, runId, environment } = input;
  return {
    runId,
    generatedAt,
    preprocessorVersion,
    environment,
    options,
    parameterSetSha256: input.parameterSetSha256 ?? null,
    files: results.map((result) => ({
      inputFileName: result.inputFileName,
      inputSha256: result.inputSha256 ?? null,
      timezone: result.timezone,
      availableTimezones: result.availableTimezones,
      originalRowCount: result.originalRowCount,
      processedRowCount: result.processedRowCount,
      appRowCount: result.appRowCount,
      screenRowCount: result.screenRowCount,
      timezoneAction: result.timezoneAction,
      rowsBeforeTimezoneHandling: result.rowsBeforeTimezoneHandling,
      rowsAfterTimezoneHandling: result.rowsAfterTimezoneHandling,
      rowsRemovedByTimezone: result.rowsRemovedByTimezone,
      duplicateTimestampsCorrected: result.duplicateTimestampsCorrected,
      exactDuplicateRowsRemoved: result.exactDuplicateRowsRemoved,
      outputs: result.outputs.map((output) => ({
        kind: output.kind,
        outputFileName: output.outputFileName,
        rowCount: output.rowCount,
      })),
      // The ExecutionLedger, verbatim: per-unit/per-step statuses, row
      // counts, loss accounting and expectation results. Deterministic
      // core except the nested `timing` objects, which determinism
      // assertions exclude by key. [] for results predating the ledger.
      executions: result.executionLedger ?? [],
    })),
  };
}

/** Pretty-printed JSON string of {@link buildProcessingReportObject}. */
export function buildProcessingReport(input: ProcessingReportInput): string {
  return JSON.stringify(buildProcessingReportObject(input), null, 2);
}

/**
 * Per-node/per-step `chron:NodeExecution` activities for one file's
 * ExecutionLedger — the runtime half of the research ontology's
 * StepDefinition/NodeExecution pair (docs/pipeline-graph/13, expansion #4
 * of doc 09). IRIs: `urn:chronicle:nodeexec:{runId}:{file}:{unitId}[:{stepId}]`
 * (the encoded input file name scopes the per-file ledgers so multi-file
 * runs cannot mint colliding activity IRIs);
 * `chron:executes_step` points at the (recursive) StepDefinition IRI
 * `urn:chronicle:step:{id}` — unit and step ids share one namespace with
 * no collisions, mirroring the ontology's "one kind of step, any scale".
 * Step executions are `dcterms:isPartOf` their unit execution (the
 * runtime mirror of the ontology's `part_of_step`).
 */
function buildNodeExecutionNodes(
  ledger: ExecutionLedger,
  runIri: string,
  scope: string,
  parameterSetIri: string | null,
): Array<Record<string, unknown>> {
  const shared = (iri: string, stepIri: string, timing: UnitExecutionRecord["timing"]) => ({
    "@id": iri,
    "@type": ["prov:Activity", "chron:NodeExecution"],
    "chron:executes_step": { "@id": stepIri },
    ...(parameterSetIri ? { "chron:used_parameter_set": { "@id": parameterSetIri } } : {}),
    "prov:startedAtTime": { "@value": timing.startedAt, "@type": "xsd:dateTime" },
    "prov:endedAtTime": { "@value": timing.endedAt, "@type": "xsd:dateTime" },
    "prov:wasInformedBy": { "@id": runIri },
  });
  const rowCounts = (record: { rowsIn: number | null; rowsOut: number | null }) => ({
    ...(record.rowsIn !== null ? { "chronicle:rowsIn": record.rowsIn } : {}),
    ...(record.rowsOut !== null ? { "chronicle:rowsOut": record.rowsOut } : {}),
  });
  return ledger.flatMap((unit) => {
    const unitIri = `urn:chronicle:nodeexec:${scope}:${unit.unit}`;
    return [
      {
        ...shared(unitIri, `urn:chronicle:step:${unit.unit}`, unit.timing),
        "rdfs:label": `${unit.unit} (${unit.status})`,
        "chronicle:status": unit.status,
        ...rowCounts(unit),
      },
      ...unit.steps.map((step) => ({
        ...shared(
          `urn:chronicle:nodeexec:${scope}:${unit.unit}:${step.stepId}`,
          `urn:chronicle:step:${step.stepId}`,
          step.timing,
        ),
        "rdfs:label": `${unit.unit}/${step.stepId} (${step.status})`,
        "chronicle:status": step.status,
        ...rowCounts(step),
        ...(step.droppedRows !== null ? { "chronicle:droppedRows": step.droppedRows } : {}),
        "dcterms:isPartOf": { "@id": unitIri },
      })),
    ];
  });
}

/**
 * Minted `chron:StepDefinition` nodes for every unit and step the ledgers
 * reference — the plan half of the StepDefinition/NodeExecution pair, so
 * `chron:executes_step` targets are typed instances (the generated SHACL
 * property shapes carry `sh:class chron:StepDefinition`). Steps declare
 * `dcterms:isPartOf` → their unit — the ontology slot `part_of_step`
 * declares `slot_uri: dcterms:isPartOf`, so the sidecar must emit the
 * canonical predicate (and it matches the step-execution composition edge
 * above). Deduped across files.
 */
function buildStepDefinitionNodes(
  ledgers: readonly ExecutionLedger[],
): Array<Record<string, unknown>> {
  const partOfById = new Map<string, string | null>();
  for (const ledger of ledgers) {
    for (const unit of ledger) {
      if (!partOfById.has(unit.unit)) partOfById.set(unit.unit, null);
      for (const step of unit.steps) {
        if (!partOfById.has(step.stepId)) partOfById.set(step.stepId, unit.unit);
      }
    }
  }
  return [...partOfById.entries()].map(([id, partOf]) => ({
    "@id": `urn:chronicle:step:${id}`,
    "@type": "chron:StepDefinition",
    "chron:step_id": id,
    "rdfs:label": id,
    ...(partOf ? { "dcterms:isPartOf": { "@id": `urn:chronicle:step:${partOf}` } } : {}),
  }));
}

/**
 * W3C PROV-O provenance sidecar (`chronicle-provenance.jsonld`), bundled next
 * to the run manifest in every output ZIP. Models the run as a
 * prov:Activity that prov:used each raw input (content-addressed by SHA-256)
 * and the ParameterSet entity, was associated with the preprocessor
 * SoftwareAgent, and generated each output entity — plus one
 * `chron:NodeExecution` activity per executed pipeline unit and step (the
 * append-only lineage ledger, projected from each result's
 * ExecutionLedger) and the minted `chron:StepDefinition` plan nodes they
 * execute. Pure — same injected inputs as the report builder.
 */
export function buildProvenanceJsonLd(input: ProcessingReportInput): string {
  const { results, preprocessorVersion, generatedAt, runId, parameterSetSha256 } = input;
  const runIri = `urn:uuid:${runId}`;
  const agentIri = `urn:chronicle:agent:preprocessor:${preprocessorVersion}`;
  const parameterSetIri = parameterSetSha256
    ? `urn:chronicle:parameterset:sha256:${parameterSetSha256}`
    : null;
  // NodeExecutionContractShape (contract.shacl.ttl) requires every
  // chron:NodeExecution to cite its ParameterSet (sh:minCount 1). Emitting a
  // sidecar that silently violates its own contract is worse than failing
  // loudly here — every real caller hashes the ParameterSet first.
  if (!parameterSetIri && results.some((result) => (result.executionLedger?.length ?? 0) > 0)) {
    throw new Error(
      "buildProvenanceJsonLd: results carry an executionLedger but no parameterSetSha256 was supplied — " +
        "NodeExecution activities must cite their ParameterSet (NodeExecutionContractShape)",
    );
  }

  const nodeExecutions = results.flatMap((result) =>
    buildNodeExecutionNodes(
      result.executionLedger ?? [],
      runIri,
      `${runId}:${encodeURIComponent(result.inputFileName)}`,
      parameterSetIri,
    ),
  );
  const stepDefinitions = buildStepDefinitionNodes(
    results.map((result) => result.executionLedger ?? []),
  );

  const inputEntities = results.map((result) => ({
    "@id": result.inputSha256
      ? `urn:chronicle:input:sha256:${result.inputSha256}`
      : `urn:chronicle:input:name:${encodeURIComponent(result.inputFileName)}`,
    "@type": "prov:Entity",
    "rdfs:label": result.inputFileName,
    ...(result.inputSha256 ? { "chronicle:sha256": result.inputSha256 } : {}),
  }));

  const outputEntities = results.flatMap((result) =>
    result.outputs.map((output) => ({
      "@id": `urn:chronicle:output:${runId}:${encodeURIComponent(output.outputFileName)}`,
      "@type": "prov:Entity",
      "rdfs:label": output.outputFileName,
      "chronicle:outputKind": output.kind,
      "chronicle:rowCount": output.rowCount,
      "prov:wasGeneratedBy": { "@id": runIri },
      "prov:wasDerivedFrom": { "@id": inputEntities[results.indexOf(result)]["@id"] },
    })),
  );

  const graph: Array<Record<string, unknown>> = [
    {
      "@id": runIri,
      "@type": "prov:Activity",
      "rdfs:label": "Chronicle Android raw data preprocessing run",
      "prov:endedAtTime": { "@value": generatedAt, "@type": "xsd:dateTime" },
      "prov:wasAssociatedWith": { "@id": agentIri },
      "prov:used": [
        ...inputEntities.map((entity) => ({ "@id": entity["@id"] })),
        ...(parameterSetIri ? [{ "@id": parameterSetIri }] : []),
      ],
    },
    {
      "@id": agentIri,
      "@type": ["prov:Agent", "prov:SoftwareAgent"],
      "rdfs:label": `Chronicle Android raw data preprocessor ${preprocessorVersion}`,
      "chronicle:version": preprocessorVersion,
    },
    ...(parameterSetIri
      ? [
          {
            "@id": parameterSetIri,
            // Typed with the ontology class too, so chron:used_parameter_set
            // references satisfy the generated `sh:class chron:ParameterSet`.
            "@type": ["prov:Entity", "chron:ParameterSet"],
            "rdfs:label": "ParameterSet (full processing options, canonical JSON)",
            "chronicle:sha256": parameterSetSha256,
            "chron:parameter_set_sha256": parameterSetSha256,
          },
        ]
      : []),
    ...inputEntities,
    ...outputEntities,
    ...stepDefinitions,
    ...nodeExecutions,
  ];

  return JSON.stringify(
    {
      "@context": {
        prov: "http://www.w3.org/ns/prov#",
        rdfs: "http://www.w3.org/2000/01/rdf-schema#",
        xsd: "http://www.w3.org/2001/XMLSchema#",
        dcterms: "http://purl.org/dc/terms/",
        chron: "https://w3id.org/chronicle-usage-ontology/core/",
        chronicle: "https://chronicle.local/schemas/",
      },
      "@graph": graph,
    },
    null,
    2,
  );
}

/** Read the current browser environment for the report (main thread only). */
export function readReportEnvironment(): ReportEnvironment {
  const nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator;
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return {
    userAgent: nav?.userAgent,
    hardwareConcurrency: nav?.hardwareConcurrency,
    language: nav?.language,
    timeZone,
  };
}
