/**
 * Unit tests for the runtime-lineage SSOT (executionRecords.ts): row-count
 * derivation, ledger assembly (engine unit records × step-runner step
 * records), the conservation expectation, and violation collection.
 */

import { describe, expect, it } from "vitest";

import {
  assembleLedger,
  deriveRowCount,
  deriveRowsIn,
  deriveRowsInPrimary,
  evaluateConservation,
  evaluateNoRowCreation,
  evaluateStepExpectation,
  ledgerViolations,
  monotonicNonDecreasing,
  type ExpectationResult,
  type StepExecutionRecord,
  type UnitExecutionRecord,
} from "@/lib/pipelineGraph/executionRecords";

const TIMING = { startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:00.010Z", durationMs: 10 };

function unitRecord(overrides: Partial<UnitExecutionRecord> & { unit: string }): UnitExecutionRecord {
  return {
    status: "recomputed",
    rowsIn: null,
    rowsOut: null,
    expectations: [],
    steps: [],
    timing: TIMING,
    ...overrides,
  };
}

function stepRecord(overrides: Partial<StepExecutionRecord> & { stepId: string; unit: string }): StepExecutionRecord {
  return {
    status: "ran",
    rowsIn: null,
    rowsOut: null,
    droppedRows: null,
    expectations: [],
    timing: TIMING,
    ...overrides,
  };
}

function failedExpectation(id: string): ExpectationResult {
  return {
    id,
    kind: "custom",
    ok: false,
    expected: "x",
    actual: "y",
    message: `${id} violated`,
    severity: "warn",
  };
}

describe("deriveRowCount", () => {
  it("counts arrays", () => {
    expect(deriveRowCount([1, 2, 3])).toBe(3);
    expect(deriveRowCount([])).toBe(0);
  });

  it("counts the rows array of {rows, ...} unit outputs", () => {
    expect(deriveRowCount({ rows: ["a", "b"], report: null })).toBe(2);
    expect(deriveRowCount({ rows: [] })).toBe(0);
  });

  it("returns null for non-row-shaped values (never guesses)", () => {
    expect(deriveRowCount(null)).toBeNull();
    expect(deriveRowCount(undefined)).toBeNull();
    expect(deriveRowCount(42)).toBeNull();
    expect(deriveRowCount("rows")).toBeNull();
    expect(deriveRowCount({ count: 5 })).toBeNull();
    // A `rows` field that is not an array is not row-shaped either.
    expect(deriveRowCount({ rows: 7 })).toBeNull();
  });
});

describe("deriveRowsIn", () => {
  it("sums row counts across row-shaped inputs (join-shaped conservation)", () => {
    expect(deriveRowsIn({ a: [1, 2], b: { rows: [3, 4, 5] }, c: "options" })).toBe(5);
  });

  it("ignores non-row-shaped inputs but still counts empty arrays", () => {
    expect(deriveRowsIn({ a: [], b: { knob: true } })).toBe(0);
  });

  it("returns null when no input is row-shaped", () => {
    expect(deriveRowsIn({})).toBeNull();
    expect(deriveRowsIn({ options: { flag: true }, label: "x" })).toBeNull();
  });
});

describe("assembleLedger", () => {
  it("nests step records under their unit, preserving unit order", () => {
    const units = [unitRecord({ unit: "parse_events" }), unitRecord({ unit: "dedup_and_order" })];
    const steps = [
      stepRecord({ stepId: "sort_rows", unit: "dedup_and_order" }),
      stepRecord({ stepId: "read_csv", unit: "parse_events" }),
      stepRecord({ stepId: "exact_dedupe", unit: "dedup_and_order" }),
    ];
    const ledger = assembleLedger(units, steps);
    expect(ledger.map((u) => u.unit)).toEqual(["parse_events", "dedup_and_order"]);
    expect(ledger.map((u) => u.steps.map((s) => s.stepId))).toEqual([
      ["read_csv"],
      // Step declaration/run order is preserved within a unit.
      ["sort_rows", "exact_dedupe"],
    ]);
  });

  it("leaves cached units with empty step lists", () => {
    const ledger = assembleLedger([unitRecord({ unit: "parse_events", status: "cached" })], []);
    expect(ledger.map((u) => u.steps)).toEqual([[]]);
  });

  it("does not mutate the engine's unit records", () => {
    const unit = unitRecord({ unit: "parse_events" });
    assembleLedger([unit], [stepRecord({ stepId: "read_csv", unit: "parse_events" })]);
    expect(unit.steps).toEqual([]);
  });

  it("surfaces orphan step records as a diagnostic record instead of throwing", () => {
    // Lineage is observation-only: wiring drift must never abort processing.
    const ghost = stepRecord({ stepId: "ghost", unit: "no_such_unit" });
    const ledger = assembleLedger([unitRecord({ unit: "parse_events" })], [ghost]);
    expect(ledger).toHaveLength(2);
    const diagnostic = ledger.find((unit) => unit.unit === "no_such_unit")!;
    expect(diagnostic.status).toBe("error");
    expect(diagnostic.steps).toEqual([ghost]);
    expect(diagnostic.expectations).toHaveLength(1);
    expect(diagnostic.expectations[0]).toMatchObject({
      id: "unit_record_present",
      ok: false,
      severity: "warn",
    });
    expect(diagnostic.expectations[0].message).toContain("no_such_unit");
  });
});

describe("evaluateConservation", () => {
  it("passes when rowsIn === rowsOut + dropped", () => {
    const result = evaluateConservation(10, 7, 3);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect(result!.kind).toBe("conservation");
    expect(result!.severity).toBe("warn");
    expect(result!.message).toBe("");
  });

  it("fails with the unaccounted delta named — but stays warn-only", () => {
    const result = evaluateConservation(10, 7, 1);
    expect(result!.ok).toBe(false);
    expect(result!.severity).toBe("warn");
    expect(result!.message).toContain("unaccounted 2 rows");
  });

  it("returns null when either side is not row-shaped", () => {
    expect(evaluateConservation(null, 7, 0)).toBeNull();
    expect(evaluateConservation(10, null, 0)).toBeNull();
  });
});

describe("evaluateNoRowCreation", () => {
  it("passes when a lossy step shrinks or preserves the row count", () => {
    expect(evaluateNoRowCreation(10, 7)!.ok).toBe(true);
    expect(evaluateNoRowCreation(10, 10)!.ok).toBe(true);
  });

  it("fails (warn-only) when a lossy step creates rows", () => {
    const result = evaluateNoRowCreation(10, 12)!;
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("CREATED 2 rows");
  });

  it("returns null when either side is not row-shaped", () => {
    expect(evaluateNoRowCreation(null, 5)).toBeNull();
    expect(evaluateNoRowCreation(5, null)).toBeNull();
  });
});

describe("evaluateStepExpectation", () => {
  it("builds a passing result with empty message", () => {
    const result = evaluateStepExpectation(
      {
        id: "check",
        kind: "custom",
        expected: "always fine",
        check: () => ({ ok: true, actual: "fine" }),
      },
      [],
    );
    expect(result).toEqual({
      id: "check",
      kind: "custom",
      ok: true,
      expected: "always fine",
      actual: "fine",
      message: "",
      severity: "warn",
    });
  });

  it("returns null when the check reports not-applicable", () => {
    expect(
      evaluateStepExpectation(
        { id: "na", kind: "custom", expected: "n/a", check: () => null },
        [],
      ),
    ).toBeNull();
  });

  it("converts a THROWING check into a violated warn result — never a throw", () => {
    const result = evaluateStepExpectation(
      {
        id: "boom",
        kind: "custom",
        expected: "must not throw",
        check: () => {
          throw new Error("kaput");
        },
      },
      [],
    );
    expect(result!.ok).toBe(false);
    expect(result!.severity).toBe("warn");
    expect(result!.message).toContain("kaput");
  });
});

describe("monotonicNonDecreasing", () => {
  const sorted = monotonicNonDecreasing<{ ts: bigint }>({
    id: "sorted",
    describe: "ts",
    value: (row) => row.ts,
  });

  it("passes on non-decreasing (including tied and empty) sequences", () => {
    expect(sorted.check([{ ts: 1n }, { ts: 1n }, { ts: 5n }])!.ok).toBe(true);
    expect(sorted.check([])!.ok).toBe(true);
  });

  it("fails naming the first violating index", () => {
    const outcome = sorted.check([{ ts: 1n }, { ts: 5n }, { ts: 3n }])!;
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("index 2");
  });
});

describe("ledgerViolations", () => {
  it("collects violated expectations from units and steps, skipping ok ones", () => {
    const okExpectation: ExpectationResult = { ...failedExpectation("fine"), ok: true, message: "" };
    const ledger = assembleLedger(
      [
        unitRecord({ unit: "u1", expectations: [failedExpectation("unit_bad"), okExpectation] }),
        unitRecord({ unit: "u2" }),
      ],
      [stepRecord({ stepId: "s1", unit: "u2", expectations: [failedExpectation("step_bad")] })],
    );
    const violations = ledgerViolations(ledger);
    expect(violations.map((v) => ({ unit: v.unit, stepId: v.stepId, id: v.result.id }))).toEqual([
      { unit: "u1", stepId: null, id: "unit_bad" },
      { unit: "u2", stepId: "s1", id: "step_bad" },
    ]);
  });

  it("returns empty for a clean ledger", () => {
    expect(ledgerViolations(assembleLedger([unitRecord({ unit: "u1" })], []))).toEqual([]);
  });
});

describe("deriveRowsInPrimary", () => {
  it("takes the max row-shaped input (unit records must not double-count)", () => {
    expect(deriveRowsInPrimary({ a: [1, 2], b: { rows: [3, 4, 5] }, c: "options" })).toBe(3);
    expect(deriveRowsInPrimary({ a: [], b: { knob: true } })).toBe(0);
    expect(deriveRowsInPrimary({})).toBeNull();
    expect(deriveRowsInPrimary({ options: { flag: true } })).toBeNull();
  });
});

describe("mutation coverage — assembleLedger orphan diagnostic", () => {
  // ids 343 (L166 expected), 345 (L168 actual), 346 (L169 message): the
  // orphan-diagnostic expectation must carry descriptive text on every field.
  it("orphan diagnostic carries descriptive expected/actual/message (ids 343, 345, 346)", () => {
    const ghost = stepRecord({ stepId: "ghost", unit: "no_such_unit" });
    const ledger = assembleLedger([unitRecord({ unit: "parse_events" })], [ghost]);
    const diagnostic = ledger.find((unit) => unit.unit === "no_such_unit")!;
    const expectation = diagnostic.expectations[0];
    expect(expectation.expected).toContain('engine emitted a unit record for "no_such_unit"');
    expect(expectation.actual).toContain("1 step record(s) with no matching unit record");
    expect(expectation.message).toContain("step/unit wiring drift");
    expect(expectation.message).toContain("no_such_unit");
    // The diagnostic is a bespoke lineage check, not a row/schema one: its kind
    // must be the literal "custom". Blanking it to "" would mislabel the record.
    expect(expectation.kind).toBe("custom");
  });

  // id 349 (L175 LogicalOperator `??`→`&&`): the diagnostic reuses the first
  // orphan step's timing when present — `&&` would substitute the zeroed
  // fallback instead.
  it("orphan diagnostic reuses the first orphan step's timing (id 349)", () => {
    const timing = {
      startedAt: "2026-02-02T00:00:00.000Z",
      endedAt: "2026-02-02T00:00:00.005Z",
      durationMs: 5,
    };
    const ghost = stepRecord({ stepId: "ghost", unit: "no_such_unit", timing });
    const ledger = assembleLedger([unitRecord({ unit: "u" })], [ghost]);
    const diagnostic = ledger.find((unit) => unit.unit === "no_such_unit")!;
    expect(diagnostic.timing).toEqual(timing);
  });

  // ids 351 (L175 ObjectLiteral → {}), 352/353 (L175 StringLiteral): the
  // zeroed-timing fallback taken when the first orphan step lacks timing.
  it("orphan diagnostic falls back to zeroed timing when the step has none (ids 351, 352, 353)", () => {
    const ghost = {
      ...stepRecord({ stepId: "ghost", unit: "no_such_unit" }),
      timing: undefined as unknown as StepExecutionRecord["timing"],
    };
    const ledger = assembleLedger([unitRecord({ unit: "u" })], [ghost]);
    const diagnostic = ledger.find((unit) => unit.unit === "no_such_unit")!;
    expect(diagnostic.timing).toEqual({ startedAt: "", endedAt: "", durationMs: 0 });
  });
});

describe("mutation coverage — evaluateStepExpectation messages", () => {
  // id 362 (L222 StringLiteral): the `<id> violated` default fires when a
  // failing check omits its own message.
  it("uses the '<id> violated' default when a failing check omits a message (id 362)", () => {
    const result = evaluateStepExpectation(
      { id: "myCheck", kind: "custom", expected: "e", check: () => ({ ok: false, actual: "a" }) },
      [],
    )!;
    expect(result.ok).toBe(false);
    expect(result.message).toBe("myCheck violated");
  });

  // id 361 (L222 LogicalOperator `??`→`&&`): an explicit failure message is
  // preserved, not replaced by the default.
  it("preserves an explicit failure message from the check (id 361)", () => {
    const result = evaluateStepExpectation(
      {
        id: "myCheck",
        kind: "custom",
        expected: "e",
        check: () => ({ ok: false, actual: "a", message: "explicit boom" }),
      },
      [],
    )!;
    expect(result.message).toBe("explicit boom");
  });

  // id 367 (L231 StringLiteral): a throwing check labels `actual` distinctly.
  it("labels a throwing check's actual as 'expectation check threw' (id 367)", () => {
    const result = evaluateStepExpectation(
      {
        id: "t",
        kind: "custom",
        expected: "e",
        check: () => {
          throw new Error("x");
        },
      },
      [],
    )!;
    expect(result.actual).toBe("expectation check threw");
  });
});

describe("mutation coverage — monotonicNonDecreasing actual text", () => {
  const sorted = monotonicNonDecreasing<{ ts: bigint }>({
    id: "sorted",
    describe: "ts",
    value: (row) => row.ts,
  });

  // id 392 (L262 StringLiteral): passing actual reports the row count.
  it("passing check reports the row count as actual (id 392)", () => {
    const outcome = sorted.check([{ ts: 1n }, { ts: 2n }])!;
    expect(outcome.ok).toBe(true);
    expect(outcome.actual).toBe("2 rows non-decreasing");
  });

  // id 388 (L257 StringLiteral): failing actual names the decreasing quantity.
  it("failing check names the decreasing quantity in actual (id 388)", () => {
    const outcome = sorted.check([{ ts: 2n }, { ts: 1n }])!;
    expect(outcome.ok).toBe(false);
    expect(outcome.actual).toBe("ts decreases at row 1");
  });
});

describe("mutation coverage — evaluateNoRowCreation strings", () => {
  // ids 408 (L282 expected), 409 (L283 actual), 410 (L284 ok-branch message "").
  it("passing result carries expected/actual text and an empty message (ids 408, 409, 410)", () => {
    const result = evaluateNoRowCreation(10, 7)!;
    expect(result.expected).toContain("rows_out (7) <= rows_in (10)");
    expect(result.actual).toBe("rows_in 10, rows_out 7");
    expect(result.message).toBe("");
  });
});

describe("mutation coverage — evaluateConservation strings + null guard", () => {
  // ids 433 (L305 expected), 434 (L306 actual).
  it("passing result carries expected/actual text (ids 433, 434)", () => {
    const result = evaluateConservation(10, 7, 3)!;
    expect(result.expected).toContain("rows_in (10) = rows_out (7) + dropped (3)");
    expect(result.actual).toBe("rows_in 10, rows_out 7, dropped 3");
  });

  // id 424 (L299 ConditionalExpression → false): null result whenever any of
  // the three counts is null (dropped=null is the previously untested side).
  it("returns null when any of rowsIn/rowsOut/dropped is null (id 424)", () => {
    expect(evaluateConservation(null, 7, 0)).toBeNull();
    expect(evaluateConservation(10, null, 0)).toBeNull();
    expect(evaluateConservation(10, 7, null)).toBeNull();
  });
});
