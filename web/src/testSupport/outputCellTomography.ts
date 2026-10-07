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

/** Exported so the unit suite can pin CANONICAL ⊆ OUTPUT_ARTIFACT: the
 * campaign capture loops gate on the artifact set before extracting cells. */
export const CANONICAL_OUTPUT_KINDS: ReadonlySet<string> = new Set([
  "app-csv",
  "screen-csv",
  "day-coverage-csv",
  "compliance-csv",
  "credited-app-csv",
  // notification-contact-csv and polled-emulation-csv are deliberately NOT
  // cell-addressable yet: the campaigns' declared-reach gate
  // (fieldMixedTomography) admits only cells the contract's
  // output_cell_bindings() declare, and those two kinds have no bindings in
  // ROW_ADDRESSED_OUTPUT_KINDS -- adding them here without the contract-side
  // declarations reds the reach gate with 65 undeclared cells per affected
  // source column. They ARE covered by the byte-level warm-vs-cold oracle
  // (OUTPUT_ARTIFACT_KINDS) and the runtime's researcher-output `publishes`
  // provenance edges (NOT `indexes-cells-of`, which tracks cell addressing
  // and correctly excludes them); promoting
  // them to cell-addressable is the recorded four-declaration decision in
  // the verification-sweep goal doc (which also records the runtime's
  // pre-existing half-inclusion of these kinds in canonical_cell_outputs()).
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

/** Whether this artifact kind is one of the canonical, cell-addressable,
 * researcher-visible outputs. Exported so a caller that must take each
 * artifact's bytes exactly once (`take_artifact_bytes` empties the slot) can
 * decide what to feed {@link canonicalOutputCells} without a second pass. */
export function isCanonicalOutputKind(kind: string): boolean {
  return isCanonicalOutput(kind);
}

/**
 * Cells of ONE already-taken canonical artifact. The single extractor: both
 * {@link captureCanonicalOutputCells} and callers that own the artifact loop
 * themselves go through this, so there is exactly one address grammar.
 */
export function canonicalOutputCells(
  kind: string,
  mediaType: string,
  bytes: Uint8Array,
): Record<string, string> {
  if (!isCanonicalOutput(kind)) return {};
  if (mediaType === "text/csv") return csvCells(kind, bytes);
  if (mediaType === "application/json") return jsonCells(kind, bytes);
  // Fail loud: a canonical kind with an unrecognized media type (for example a
  // future "text/csv;charset=utf-8") would otherwise contribute zero cells
  // symmetrically on warm and cold, silently de-validating every comparison.
  throw new Error(
    `canonical output kind ${kind} has unaddressable media type ${mediaType}`,
  );
}

/** Sort cells into the canonical address order the comparators assume. */
export function sortCanonicalOutputCells(
  cells: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cells).sort(([left], [right]) => left.localeCompare(right)),
  );
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
    Object.assign(
      cells,
      canonicalOutputCells(
        metadata.kind,
        metadata.mediaType,
        handle.take_artifact_bytes(index),
      ),
    );
  }
  return sortCanonicalOutputCells(cells);
}

/**
 * Kinds whose RAW canonical payloads differ, as readable descriptors
 * ("app-csv: first difference at byte 128", "screen-csv: absent from target").
 * Empty when every captured payload is byte-identical.
 *
 * This is deliberately not a digest comparison. A manifest's `artifacts[].digest`
 * is a claim a run makes about its own bytes; comparing two such claims cannot
 * see a payload that was wrongly reused while keeping its recorded digest.
 * Comparing what the artifact handle actually hands a consumer can.
 */
export function changedCanonicalArtifactBytes(
  source: ReadonlyMap<string, Uint8Array>,
  target: ReadonlyMap<string, Uint8Array>,
): string[] {
  const kinds = [...new Set([...source.keys(), ...target.keys()])].sort();
  const differences: string[] = [];
  for (const kind of kinds) {
    const left = source.get(kind);
    const right = target.get(kind);
    if (!left) {
      differences.push(`${kind}: absent from source`);
      continue;
    }
    if (!right) {
      differences.push(`${kind}: absent from target`);
      continue;
    }
    const shared = Math.min(left.byteLength, right.byteLength);
    let index = 0;
    while (index < shared && left[index] === right[index]) index += 1;
    if (index < shared) {
      differences.push(`${kind}: first difference at byte ${index}`);
    } else if (left.byteLength !== right.byteLength) {
      differences.push(
        `${kind}: length ${left.byteLength} vs ${right.byteLength}`,
      );
    }
  }
  return differences;
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
