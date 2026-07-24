/** Read-only projection of the execution ledger emitted by Rust. */
export type RustExecutionStatus =
  | "cached"
  | "recomputed"
  | "error"
  | "skipped"
  | "bypassed";

export type RustExpectationResult = {
  id: string;
  kind: "row_count" | "conservation" | "monotonic" | "custom";
  ok: boolean;
  expected: string;
  actual: string;
  message: string;
  severity: "warn";
};

export type RustStepTiming = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

export type RustStepExecutionRecord = {
  stepId: string;
  unit: string;
  status: "ran" | "bypassed";
  rowsIn: number | null;
  rowsOut: number | null;
  droppedRows: number | null;
  expectations: RustExpectationResult[];
  timing: RustStepTiming;
};

export type RustUnitExecutionRecord = {
  unit: string;
  status: RustExecutionStatus;
  rowsIn: number | null;
  rowsOut: number | null;
  expectations: RustExpectationResult[];
  steps: RustStepExecutionRecord[];
  timing: RustStepTiming;
};

export type RustExecutionLedger = RustUnitExecutionRecord[];
