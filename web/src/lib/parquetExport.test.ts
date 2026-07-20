import { describe, expect, it } from "vitest";
import { parquetReadObjects } from "hyparquet";

import { buildParquetBuffer, type ParquetColumnSpec } from "@/lib/parquetExport";

const COLUMNS: ParquetColumnSpec[] = [
  { name: "participant_id", type: "STRING" },
  { name: "ts_ns", type: "INT64" },
  { name: "duration", type: "DOUBLE" },
  { name: "count", type: "INT32" },
  { name: "valid", type: "BOOLEAN" },
];

async function readBack(buffer: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const file = {
    byteLength: buffer.byteLength,
    slice: (start: number, end?: number) => buffer.slice(start, end),
  };
  return (await parquetReadObjects({ file })) as Record<string, unknown>[];
}

describe("buildParquetBuffer", () => {
  it("round-trips typed columns including nulls in numeric columns", async () => {
    const buffer = await buildParquetBuffer(COLUMNS, [
      { participant_id: "P1", ts_ns: 10n, duration: 1.5, count: 1, valid: true },
      { participant_id: "P2", ts_ns: 20n, duration: null, count: 2, valid: false },
      { participant_id: "P3", ts_ns: null, duration: 3.25, count: 3, valid: true },
    ]);
    const rows = await readBack(buffer);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ participant_id: "P1", count: 1, valid: true });
    expect(rows[0].ts_ns).toBe(10n);
    expect(rows[1].duration ?? null).toBe(null);
    expect(rows[2].ts_ns ?? null).toBe(null);
    expect(rows[2].duration).toBe(3.25);
  });

  it("writes a valid, readable file with zero rows", async () => {
    const buffer = await buildParquetBuffer(COLUMNS, []);
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(await readBack(buffer)).toEqual([]);
  });

  it("treats a missing column key as null", async () => {
    const buffer = await buildParquetBuffer(
      [
        { name: "a", type: "STRING" },
        { name: "b", type: "INT32" },
      ],
      [{ a: "x" }],
    );
    const rows = await readBack(buffer);
    expect(rows[0].a).toBe("x");
    expect(rows[0].b ?? null).toBe(null);
  });
});
