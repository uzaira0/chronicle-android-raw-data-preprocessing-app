/**
 * Typed Apache Parquet export (#7). A thin, deterministic wrapper over
 * `hyparquet-writer` (pure-JS, no WASM) that writes one column per
 * {@link ParquetColumnSpec} with an EXPLICIT per-column type — never inferring
 * from the first value, which would mis-type a column whose first cell is null.
 *
 * The writer is dynamically imported so it only loads into the worker chunk when
 * a run actually requests Parquet output; CSV-only runs never pay for it.
 *
 * Verified by round-tripping through the companion `hyparquet` reader in tests
 * (value equality, not byte equality — the writer embeds an uncontrolled
 * `created_by` string, so the bytes are intentionally not asserted).
 */

/** The Parquet basic types this app emits. Subset of hyparquet-writer's BasicType. */
export type ParquetColumnType = "STRING" | "INT32" | "INT64" | "DOUBLE" | "BOOLEAN";

/** A single cell value. `null` is written as a Parquet null (columns are nullable). */
export type ParquetCellValue = string | number | bigint | boolean | null;

export type ParquetColumnSpec = { name: string; type: ParquetColumnType };

/**
 * Build a Parquet file (as bytes) from ordered column specs and row records.
 * Column order follows `columns`; each row supplies values by column name, with
 * a missing key treated as null.
 */
export async function buildParquetBuffer(
  columns: readonly ParquetColumnSpec[],
  rows: ReadonlyArray<Record<string, ParquetCellValue>>,
): Promise<ArrayBuffer> {
  const { parquetWriteBuffer } = await import("hyparquet-writer");
  const columnData = columns.map((col) => ({
    name: col.name,
    type: col.type,
    nullable: true,
    data: rows.map((row) => (col.name in row ? row[col.name] : null)),
  }));
  return parquetWriteBuffer({ columnData });
}
