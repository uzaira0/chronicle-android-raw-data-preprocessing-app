/**
 * Fail-closed structural decoder for the Rust/WASM runtime boundary.
 *
 * The shape it enforces is NOT written here: it is
 * `RUNTIME_BOUNDARY_MODEL` in `@/lib/generatedRuntimeBoundary`, emitted from
 * the Rust serialization model by
 * `rust/chronicle_preprocessing_runtime_wasm/examples/boundary_model.rs` and
 * kept honest by `npm run check:boundary`. This module owns only the walk and
 * the rejection vocabulary, so a field added, renamed, retyped, or made
 * nullable in Rust changes the browser's validation without anyone editing
 * TypeScript.
 *
 * Semantic cross-checks — protocol pins, dependency-certificate agreement,
 * checkpoint domains and their digest families, query-registry completeness, row
 * accounting, artifact-catalog agreement — are NOT structural and stay
 * hand-written in `rustPipelineRuntime.ts` on top of this layer.
 */

type BoundaryValueModel =
  | { kind: "string" }
  | { kind: "looseString" }
  | { kind: "sha256Digest" }
  | { kind: "integer" }
  | { kind: "boolean" }
  | { kind: "nullable"; inner: BoundaryValueModel }
  | { kind: "array"; items: BoundaryValueModel }
  | { kind: "map"; values: BoundaryValueModel }
  | { kind: "struct"; name: string }
  | { kind: "enum"; name: string };

type BoundaryFieldModel = {
  /** Serialized JSON key (serde `rename`/`rename_all` already applied). */
  name: string;
  /** Rust field identifier, retained so a drift report can name the source. */
  rustName: string;
  /** `skip_serializing_if = "Option::is_none"`: the key may be absent. */
  optional?: boolean;
  value: BoundaryValueModel;
};

type BoundaryTypeModel =
  | { kind: "struct"; fields: BoundaryFieldModel[] }
  | { kind: "enum"; label: string; variants: string[] };

export type BoundaryModel = {
  protocolVersion: string;
  roots: Record<string, string>;
  types: Record<string, BoundaryTypeModel>;
};

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CHECKPOINT_COMPONENT_PATTERN = /^xxh3:[0-9a-f]{32}$/;

export type JsonObject = Record<string, unknown>;

export function contractError(path: string, expectation: string): never {
  throw new Error(
    `runtime manifest contract violation at ${path}: ${expectation}`,
  );
}

export function objectAt(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    contractError(path, "expected an object");
  }
  return value as JsonObject;
}

export function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) contractError(path, "expected an array");
  return value;
}

export function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    contractError(path, "expected a non-empty string");
  }
  return value;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") contractError(path, "expected a boolean");
  return value;
}

export function integerAt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    contractError(path, "expected a non-negative safe integer");
  }
  return value as number;
}

export function digestAt(value: unknown, path: string): string {
  const digest = stringAt(value, path);
  if (!SHA256_PATTERN.test(digest)) {
    contractError(path, "expected a lowercase sha256 digest");
  }
  return digest;
}

export function checkpointComponentDigestAt(
  value: unknown,
  path: string,
): string {
  const digest = stringAt(value, path);
  if (!CHECKPOINT_COMPONENT_PATTERN.test(digest)) {
    contractError(path, "expected a lowercase xxh3-128 digest");
  }
  return digest;
}

function typeModel(
  model: BoundaryModel,
  name: string,
  kind: "struct" | "enum",
): BoundaryTypeModel {
  const definition = model.types[name];
  // A missing or mistyped reference means the generated artifact itself is
  // broken, which is a build fault rather than untrusted runtime input.
  if (definition === undefined || definition.kind !== kind) {
    throw new Error(`runtime boundary model has no ${kind} named ${name}`);
  }
  return definition;
}

function decodeValue(
  model: BoundaryModel,
  spec: BoundaryValueModel,
  value: unknown,
  path: string,
): unknown {
  switch (spec.kind) {
    case "string":
      return stringAt(value, path);
    case "looseString":
      if (typeof value !== "string") contractError(path, "expected a string");
      return value;
    case "sha256Digest":
      return digestAt(value, path);
    case "integer":
      return integerAt(value, path);
    case "boolean":
      return booleanAt(value, path);
    case "nullable":
      return value === null ? null : decodeValue(model, spec.inner, value, path);
    case "array":
      return arrayAt(value, path).map((item, index) =>
        decodeValue(model, spec.items, item, `${path}[${index}]`),
      );
    case "map":
      return Object.fromEntries(
        Object.entries(objectAt(value, path)).map(([key, item]) => [
          key,
          decodeValue(model, spec.values, item, `${path}.${key}`),
        ]),
      );
    case "struct":
      return decodeStruct(model, spec.name, value, path);
    case "enum": {
      const definition = typeModel(model, spec.name, "enum");
      if (definition.kind !== "enum") throw new Error("unreachable");
      const variant = stringAt(value, path);
      if (!definition.variants.includes(variant)) {
        contractError(path, `unknown ${definition.label}`);
      }
      return variant;
    }
  }
}

function decodeStruct(
  model: BoundaryModel,
  name: string,
  value: unknown,
  path: string,
): JsonObject {
  const definition = typeModel(model, name, "struct");
  if (definition.kind !== "struct") throw new Error("unreachable");
  const source = objectAt(value, path);
  const decoded: JsonObject = {};
  for (const field of definition.fields) {
    const raw = source[field.name];
    // Absent optional keys stay absent; forward-transportable unknown keys are
    // dropped, exactly as the hand-written decoder did before generation.
    if (field.optional === true && raw === undefined) continue;
    decoded[field.name] = decodeValue(
      model,
      field.value,
      raw,
      `${path}.${field.name}`,
    );
  }
  return decoded;
}

/**
 * Decode `value` as the named generated struct, rejecting anything the Rust
 * serialization model does not describe.
 *
 * The single cast is sound by construction: `T` and the model entry are
 * emitted from the same Rust type by the same generator run, and
 * `npm run check:boundary` fails when they drift from the Rust source.
 */
export function decodeBoundaryStruct<T>(
  model: BoundaryModel,
  name: string,
  value: unknown,
  path: string,
): T {
  return decodeStruct(model, name, value, path) as T;
}
