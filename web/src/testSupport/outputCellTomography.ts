import Papa from "papaparse";

type ArtifactMetadata = {
  kind: string;
  mediaType: string;
};

export type RuntimeArtifactHandle = {
  readonly artifact_count: number;
  artifact_metadata_json(index: number): string;
  take_artifact_bytes(index: number): Uint8Array;
};

const CANONICAL_OUTPUT_KINDS = new Set([
  "app-csv",
  "screen-csv",
  "day-coverage-csv",
  "compliance-csv",
  "credited-app-csv",
  "review-summary-json",
  "visualization-data-json",
]);

function isCanonicalOutput(kind: string): boolean {
  return CANONICAL_OUTPUT_KINDS.has(kind) || kind.startsWith("aggregate-");
}

function escapeAddress(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function appendJsonCells(
  cells: Record<string, string>,
  kind: string,
  path: string,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    if (value.length === 0) cells[`${kind}#${path}`] = "[]";
    value.forEach((item, index) =>
      appendJsonCells(cells, kind, `${path}/${index}`, item),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length === 0) cells[`${kind}#${path}`] = "{}";
    for (const [key, nested] of entries) {
      appendJsonCells(cells, kind, `${path}/${escapeAddress(key)}`, nested);
    }
    return;
  }
  cells[`${kind}#${path}`] = JSON.stringify(value);
}

function csvCells(kind: string, bytes: Uint8Array): Record<string, string> {
  const parsed = Papa.parse<Record<string, string>>(new TextDecoder().decode(bytes), {
    header: true,
    skipEmptyLines: true,
  });
  const firstParseError = parsed.errors[0];
  if (firstParseError) {
    throw new Error(`${kind}: ${firstParseError.message}`);
  }
  const fields = parsed.meta.fields ?? [];
  const cells: Record<string, string> = {};
  for (const [rowIndex, row] of parsed.data.entries()) {
    for (const field of fields) {
      cells[`${kind}#/rows/${rowIndex}/${escapeAddress(field)}`] = row[field] ?? "";
    }
  }
  cells[`${kind}#/shape/rows`] = String(parsed.data.length);
  cells[`${kind}#/shape/columns`] = JSON.stringify(fields);
  return cells;
}

function jsonCells(kind: string, bytes: Uint8Array): Record<string, string> {
  const cells: Record<string, string> = {};
  appendJsonCells(cells, kind, "", JSON.parse(new TextDecoder().decode(bytes)));
  return cells;
}

/**
 * Read the canonical, researcher-visible cell surfaces before the WASM handle
 * is freed. Binary exports and the Arrow lineage sidecar remain independently
 * digest-bound; they are not falsely interpreted as cell-addressable tables.
 */
export function captureCanonicalOutputCells(
  handle: RuntimeArtifactHandle,
): Record<string, string> {
  const cells: Record<string, string> = {};
  for (let index = 0; index < handle.artifact_count; index += 1) {
    const metadata = JSON.parse(
      handle.artifact_metadata_json(index),
    ) as ArtifactMetadata;
    if (!isCanonicalOutput(metadata.kind)) continue;
    const bytes = handle.take_artifact_bytes(index);
    const artifactCells =
      metadata.mediaType === "text/csv"
        ? csvCells(metadata.kind, bytes)
        : metadata.mediaType === "application/json"
          ? jsonCells(metadata.kind, bytes)
          : {};
    Object.assign(cells, artifactCells);
  }
  return Object.fromEntries(Object.entries(cells).sort(([left], [right]) => left.localeCompare(right)));
}

export function changedCellAddresses(
  source: Readonly<Record<string, string>>,
  target: Readonly<Record<string, string>>,
): string[] {
  return [...new Set([...Object.keys(source), ...Object.keys(target)])]
    .filter((address) => source[address] !== target[address])
    .sort();
}

export function changedCellsByArtifact(addresses: readonly string[]): Record<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const address of addresses) {
    const separator = address.indexOf("#");
    const kind = separator >= 0 ? address.slice(0, separator) : address;
    const path = separator >= 0 ? address.slice(separator + 1) : "";
    grouped.set(kind, [...(grouped.get(kind) ?? []), path]);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, paths]) => [kind, paths.sort()]),
  );
}

/** Compact human-readable summary. Exact row/cell addresses stay in the
 * compressed correspondence sidecar and are committed by digest in the main
 * ledger; this summary intentionally replaces row/array indices with `*`. */
export function changedCellScopesByArtifact(
  addresses: readonly string[],
): Record<string, string[]> {
  const scopes = changedCellsByArtifact(addresses);
  return Object.fromEntries(
    Object.entries(scopes).map(([kind, paths]) => [
      kind,
      [...new Set(paths.map((path) => path.replace(/\/\d+(?=\/|$)/g, "/*")))].sort(),
    ]),
  );
}
