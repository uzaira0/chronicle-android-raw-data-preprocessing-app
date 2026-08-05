import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { SUPPORT_ROLE_IDS } from "@/testSupport/artifactInterventions";
import { dependencyCampaignRuntimeBytes } from "@/testSupport/dependencyCampaignRuntime";
import {
  outputCellDependencies,
  outputColumnMatches,
  type OutputCellBinding,
  type RustWorkflowContract,
} from "@/testSupport/workflowContract";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

const FAMILY_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "family-expected",
);
const EXPECTED_FILE = join(FAMILY_DIR, "field-level-provenance-ledger.json");
const CORRESPONDENCE_SIDECARS = [
  "artifact-output-cell-correspondence.json.gz",
  "raw-boundary-output-cell-correspondence.json.gz",
] as const;
const UPDATE = process.env.UPDATE_FIELD_PROVENANCE === "1";

type CorrespondenceCase = {
  caseId: string;
  changedComponents: string[];
  sourceFields: string[];
  changedOutputCellAddresses: string[];
};

type CorrespondenceSidecar = {
  protocolVersion: string;
  implementationReceipt?: Record<string, string>;
  claimBoundary: string;
  cases: CorrespondenceCase[];
};

/** `(kind, column)` of one canonical output cell family. */
type CellFamily = { kind: string; column: string };

function sha256Uri(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * The address grammar `captureCanonicalOutputCells` emits: CSV cells are
 * `<kind>#/rows/<index>/<column>` plus the two `#/shape/...` summaries; JSON
 * cells are `<kind>#<pointer>`. The column part is what an output cell binding
 * names.
 */
function cellFamilyOf(address: string): CellFamily {
  const separator = address.indexOf("#");
  if (separator < 0) throw new Error(`malformed cell address ${address}`);
  const kind = address.slice(0, separator);
  const path = address.slice(separator + 1);
  if (!kind.endsWith("-csv")) return { kind, column: path };
  const segments = path.split("/");
  if (segments.length >= 4 && segments[1] === "rows") {
    return { kind, column: segments[segments.length - 1] ?? "" };
  }
  return { kind, column: segments.slice(1).join("/") };
}

describe("field-level provenance reconciliation", () => {
  let contract: RustWorkflowContract;
  let declaredFields: Set<string>;
  let edges: Array<{ from: string[]; to: string }>;
  let bindings: OutputCellBinding[];
  let knownRoles: Set<string>;

  beforeAll(() => {
    runtime.initSync({ module: dependencyCampaignRuntimeBytes() });
    contract = JSON.parse(
      runtime.workflow_contract_json(),
    ) as RustWorkflowContract;
    expect(contract.protocolVersion).toBe(
      "chronicle-workflow-contract/v1",
    );
    expect(contract.execution.queries.length).toBeGreaterThan(0);
    bindings = contract.semantic.outputCellBindings;
    edges = contract.execution.queries.flatMap((step) =>
      step.fieldEdges.map((edge) => ({ from: edge.from, to: edge.to })),
    );
    declaredFields = new Set<string>([
      ...contract.execution.queries.flatMap((step) => [
        ...step.fieldReads,
        ...step.fieldWrites,
      ]),
      ...bindings.flatMap((binding) => binding.from),
      ...contract.semantic.rowSetFields,
    ]);
    knownRoles = new Set<string>([
      ...contract.semantic.rootRoles.map(({ roleId }) => roleId),
      ...SUPPORT_ROLE_IDS,
    ]);
  });

  /**
   * Forward reachability over the declared per-step field edges. A field is
   * reached when any declared contributor of it is reached, which is exactly
   * the "could this input have changed that field" question the empirical
   * changed-cell evidence answers.
   */
  function reachableFields(seed: readonly string[]): Set<string> {
    const reached = new Set(seed);
    let grew = true;
    while (grew) {
      grew = false;
      for (const edge of edges) {
        if (reached.has(edge.to)) continue;
        if (edge.from.some((field) => reached.has(field))) {
          reached.add(edge.to);
          grew = true;
        }
      }
    }
    return reached;
  }

  function reachableCellFamilies(reached: ReadonlySet<string>): CellFamily[] {
    return bindings
      .filter((binding) =>
        outputCellDependencies(contract, binding).some((field) =>
          reached.has(field),
        ),
      )
      .map((binding) => ({ kind: binding.outputKind, column: binding.column }));
  }

  function loadSidecar(name: string): CorrespondenceSidecar {
    const path = join(FAMILY_DIR, name);
    expect(existsSync(path), `missing correspondence sidecar ${name}`).toBe(
      true,
    );
    const sidecar = JSON.parse(
      gunzipSync(readFileSync(path)).toString("utf8"),
    ) as CorrespondenceSidecar;
    expect(
      sidecar.protocolVersion,
      `${name}: unexpected correspondence protocol`,
    ).toBe("chronicle-output-cell-correspondence/v2");
    return sidecar;
  }

  it("reconciles the declared field graph against every recorded per-column intervention", () => {
    // Direction 1 — soundness. Every output cell an intervention actually
    // changed must be reachable from the intervened source columns through the
    // declared field edges. A miss means the declaration understates what the
    // implementation reads, so it is a hard failure, never a recorded note.
    const unreachable: string[] = [];
    const unreadWithEffect: string[] = [];
    const unknownSourceFields: string[] = [];
    const unboundKinds: string[] = [];
    /** `<sourceField>\u0000<kind>\u0000<column>` observed at least once. */
    const witnessedEdges = new Set<string>();
    const interventionsByField = new Map<string, number>();
    const confirmedUnread = new Map<string, number>();
    /** Every intervened column no step declares as read, including the ones an
     * intervention rewrote alongside columns that are read. */
    const unreadColumns = new Map<string, number>();
    let caseCount = 0;
    let addressCount = 0;

    for (const name of CORRESPONDENCE_SIDECARS) {
      for (const entry of loadSidecar(name).cases) {
        caseCount += 1;
        addressCount += entry.changedOutputCellAddresses.length;
        for (const field of entry.sourceFields) {
          const role = field.split(".")[0] ?? "";
          if (!declaredFields.has(field) && !knownRoles.has(role)) {
            unknownSourceFields.push(
              `${entry.caseId}: ${field} names neither a declared field nor a known source role`,
            );
          }
        }
        const seed = entry.sourceFields.filter((field) =>
          declaredFields.has(field),
        );
        for (const field of entry.sourceFields) {
          if (declaredFields.has(field) || !field.includes(".")) continue;
          unreadColumns.set(field, (unreadColumns.get(field) ?? 0) + 1);
        }
        for (const field of seed) {
          interventionsByField.set(
            field,
            (interventionsByField.get(field) ?? 0) + 1,
          );
        }
        if (seed.length === 0) {
          for (const field of entry.sourceFields) {
            confirmedUnread.set(field, (confirmedUnread.get(field) ?? 0) + 1);
          }
          if (entry.changedOutputCellAddresses.length > 0) {
            unreadWithEffect.push(
              `${entry.caseId}: rewrote only undeclared columns ${JSON.stringify(
                entry.sourceFields,
              )} yet changed ${entry.changedOutputCellAddresses.length} output cells`,
            );
          }
          continue;
        }
        const families = reachableCellFamilies(reachableFields(seed));
        for (const address of entry.changedOutputCellAddresses) {
          const observed = cellFamilyOf(address);
          if (!bindings.some((binding) => binding.outputKind === observed.kind)) {
            unboundKinds.push(
              `${entry.caseId}: output kind ${observed.kind} has no declared output cell binding`,
            );
            continue;
          }
          const hit = families.find(
            (family) =>
              family.kind === observed.kind &&
              outputColumnMatches(family.column, observed.column),
          );
          if (!hit) {
            unreachable.push(
              `${entry.caseId}: ${observed.kind}#${observed.column} is not reachable from ${JSON.stringify(
                seed,
              )}`,
            );
            continue;
          }
          for (const field of seed) {
            witnessedEdges.add(`${field}\u0000${hit.kind}\u0000${hit.column}`);
          }
        }
      }
    }

    expect(
      unknownSourceFields,
      "every intervened source column must name a modelled field or a declared source role",
    ).toEqual([]);
    expect(
      unboundKinds,
      "every changed canonical output kind must have declared cell bindings",
    ).toEqual([]);
    expect(
      unreadWithEffect,
      "a mutation confined to columns no step declares as read must change no output cell",
    ).toEqual([]);
    expect(
      unreachable,
      "every observed changed output cell must be reachable from the intervened columns through the declared field edges",
    ).toEqual([]);
    expect(caseCount).toBeGreaterThan(0);

    // Direction 2 — completeness. Every declared source column's declared reach
    // is enumerated here, split into what the recorded interventions actually
    // witnessed and what stands structurally declared but unwitnessed. The
    // second list is checked-in evidence, never a silent pass: it grows only
    // when a declaration widens without a campaign that exercises it.
    const sourceColumns = [...declaredFields]
      .filter((field) => {
        const role = field.split(".")[0] ?? "";
        return knownRoles.has(role) || field.startsWith("source.");
      })
      .sort();
    const reach = sourceColumns.map((field) => {
      const declared = reachableCellFamilies(reachableFields([field]))
        .map(({ kind, column }) => `${kind}#${column}`)
        .sort();
      const witnessed = declared.filter((family) => {
        const [kind, column] = family.split("#") as [string, string];
        return witnessedEdges.has(`${field}\u0000${kind}\u0000${column}`);
      });
      const unwitnessed = declared.filter(
        (family) => !witnessed.includes(family),
      );
      return {
        sourceField: field,
        interventionCases: interventionsByField.get(field) ?? 0,
        declaredCellFamilies: declared.length,
        witnessedCellFamilies: witnessed.length,
        structurallyDeclaredButUnwitnessed: unwitnessed,
      };
    });

    const ledger = {
      protocolVersion: "chronicle-field-level-provenance/v1",
      workflowContractProtocol: contract.protocolVersion,
      correspondenceProtocol: "chronicle-output-cell-correspondence/v2",
      preprocessorVersion: contract.preprocessorVersion,
      claimBoundary:
        "Declared per-step field-level read/write edges reconciled against the recorded per-column artifact and raw-boundary changed-cell evidence. Direction 1 is a hard gate: every changed output cell of every recorded case is reachable from that case's intervened source columns through the declared edges. Direction 2 is enumerated, not asserted: a declared reach no recorded intervention exercised is listed as structurally declared but unwitnessed, and is not a claim that the edge is real. Reachability is a may-influence over-approximation; it never asserts that a declared edge must change a cell.",
      evidence: {
        sidecars: [...CORRESPONDENCE_SIDECARS],
        cases: caseCount,
        changedCellAddresses: addressCount,
      },
      counts: {
        declaredFields: declaredFields.size,
        declaredFieldEdges: edges.length,
        outputCellBindings: bindings.length,
        sourceColumns: sourceColumns.length,
        columnsWithoutAnyIntervention: reach.filter(
          ({ interventionCases }) => interventionCases === 0,
        ).length,
      },
      // Every intervened column no step declares as read. The subset an
      // intervention rewrote *alone* is the empirically confirmed half: those
      // cases changed no output cell, which the gate above asserts. The rest
      // were rewritten alongside read columns, so their non-effect is a
      // declaration, not an observation — `filter_file.filter_bool` and
      // `filter_file.app_filter_category` are the checked examples, present in
      // the shipped filter file and the review UI but read by no kernel step.
      unreadInterventionColumns: [...unreadColumns]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sourceField, cases]) => ({
          sourceField,
          cases,
          confirmedByIsolatedIntervention: confirmedUnread.has(sourceField),
        })),
      confirmedUnreadColumns: [...confirmedUnread]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sourceField, cases]) => ({ sourceField, cases })),
      reach,
    };
    const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
    if (UPDATE) {
      mkdirSync(FAMILY_DIR, { recursive: true });
      writeFileSync(EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(
      existsSync(EXPECTED_FILE),
      "missing field-level provenance ledger",
    ).toBe(true);
    expect(sha256Uri(serialized)).toBe(
      sha256Uri(readFileSync(EXPECTED_FILE, "utf8")),
    );
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
    // Explicit budget, matching every other campaign reconciliation in this
    // directory (240_000 to 1_800_000 ms). This was the only test here still on
    // vitest's 5 s default while doing the same class of work: it gunzips both
    // multi-megabyte correspondence sidecars synchronously and reconciles ~202k
    // changed cell addresses. Measured ~2.5-3 s alone, 6.6-9 s while the box is
    // busy — which failed the whole suite on two separate full runs, and timed
    // out under `make dependency-evidence`, where it is scheduled immediately
    // after the six parallel WASM campaigns and took the entire regeneration
    // down with it. The work is bounded and deterministic; how long it takes
    // depends on what else is running, which must not decide whether it passes.
  }, 600_000);

  it("keeps the three unread raw columns out of the declared field graph", () => {
    // `RawRow` carries eight of the eleven raw columns. The parser never reads
    // `possible_device_model`, `start_timestamp`, or `stop_timestamp`; the app
    // CSV's identically named columns are computed, not copied. The campaigns
    // intervene on all three and observe no changed cell, so this is a checked
    // non-reachability result, not an omission.
    for (const column of [
      "possible_device_model",
      "start_timestamp",
      "stop_timestamp",
    ]) {
      expect(
        declaredFields.has(`raw_chronicle_csv.${column}`),
        `raw_chronicle_csv.${column} must stay outside the declared field graph`,
      ).toBe(false);
    }
    expect(
      [...declaredFields].filter((field) =>
        field.startsWith("raw_chronicle_csv."),
      ).length,
    ).toBe(8);
  });
});
