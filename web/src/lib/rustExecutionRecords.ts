/** Read-only projection of the execution ledger emitted by Rust. */
export type RustExecutionStatus =
  | "cached"
  | "recomputed"
  | "error"
  | "skipped"
  | "bypassed";

type RustExpectationResult = {
  id: string;
  kind: "row_count" | "conservation" | "monotonic" | "custom";
  ok: boolean;
  expected: string;
  actual: string;
  message: string;
  severity: "warn";
};

type RustQueryTiming = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

type RustQueryExecutionRecord = {
  queryId: string;
  queryGroupId: string;
  status: RustExecutionStatus;
  inputKey: string | null;
  outputDigest: string | null;
  reasonId: string | null;
  applicable: boolean;
  rowsIn: number | null;
  rowsOut: number | null;
  droppedRows: number | null;
  expectations: RustExpectationResult[];
  timing: RustQueryTiming;
};

type RustQueryGroupExecutionRecord = {
  queryGroupId: string;
  status: RustExecutionStatus;
  rowsIn: number | null;
  rowsOut: number | null;
  expectations: RustExpectationResult[];
  queries: RustQueryExecutionRecord[];
  timing: RustQueryTiming;
};

export type RustExecutionLedger = RustQueryGroupExecutionRecord[];
