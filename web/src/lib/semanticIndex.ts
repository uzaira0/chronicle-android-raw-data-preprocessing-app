export type SemanticIndexModule = {
  default(): Promise<unknown>;
  decompress_bundled_gzip?(packed: Uint8Array, expectedBytes: number): Uint8Array;
  rebuild_semantic_index(
    sourceJson: Uint8Array,
    scientificArtifactBundle: Uint8Array,
  ): Uint8Array;
  query_registered(index: Uint8Array, queryId: string): string;
  query_registered_view(
    index: Uint8Array,
    queryId: string,
    workspaceRootDigest: string,
    revision: bigint,
  ): string;
};

let modulePromise: Promise<SemanticIndexModule> | null = null;

/** Test-only dependency seam for initializing generated WASM from local bytes. */
export function setSemanticIndexForTesting(
  module: SemanticIndexModule | null,
): void {
  modulePromise = module ? Promise.resolve(module) : null;
}

async function loadModule(): Promise<SemanticIndexModule> {
  if (!modulePromise) {
    /* v8 ignore start -- Vite's lazy browser WASM loader is exercised by Playwright; unit tests inject and verify the same compiled module bytes. */
    const pending = (async () => {
      const module =
        (await import("@/wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm.js")) as unknown as SemanticIndexModule;
      await module.default();
      return module;
    })();
    modulePromise = pending;
    pending.catch(() => { if (modulePromise === pending) modulePromise = null; });
    /* v8 ignore stop */
  }
  return modulePromise;
}

/** The raw semantic package bootstraps gzip without depending on the runtime. */
export async function decompressBundledGzip(packed: Uint8Array, expectedBytes: number): Promise<Uint8Array> {
  const module = await loadModule();
  if (!module.decompress_bundled_gzip) throw new Error("semantic index gzip decoder is unavailable");
  return module.decompress_bundled_gzip(packed, expectedBytes);
}

export type RegisteredSemanticQueryResult = {
  queryId: string;
  workspaceRootDigest?: string;
  variables?: string[];
  rows?: Array<Record<string, string>>;
  boolean?: boolean;
};

type ScientificEvidenceBinding = {
  axis:
    | "b03_micro_use"
    | "b04_minimum_duration"
    | "concurrency_floor"
    | "zero_duration_cleanup"
    | "b05_screen_construction"
    | "schoedel_reconstruction"
    | "scientific_attestation"
    | "eyes_tagged_fau";
  receipt_id: string;
  status: string | boolean | null;
  artifact_id: string;
  lineage_artifact_id: string | null;
  dependency_id: string | null;
  lineage_dependency_id: string | null;
};

type ScientificSourceBinding = {
  graph_id: string;
  artifact_id: string;
  artifact_kind: string;
  assignment_id: string;
  role_id: string;
};

type ScientificViewEnvelopeBase = {
  protocol_version: "0.1";
  family: "incremental-dataflow";
  revision: number;
  root_digest: string;
};

export type ScientificEvidenceView = ScientificViewEnvelopeBase & {
  view_id: "chronicle.scientific-evidence.v1";
  schema_id: "urn:chronicle:view:scientific-evidence:v1";
  payload: { evidence_bindings: ScientificEvidenceBinding[] };
};

export type ScientificSourceBindingsView = ScientificViewEnvelopeBase & {
  view_id: "chronicle.scientific-source-bindings.v1";
  schema_id: "urn:chronicle:view:scientific-source-bindings:v1";
  payload: { source_bindings: ScientificSourceBinding[] };
};

export type TypedScientificView =
  | ScientificEvidenceView
  | ScientificSourceBindingsView;

export type RawRegisteredSemanticQueryId =
  | "open-obligations"
  | "actual-executions"
  | "role-assignments"
  | "qualification-traces"
  | "requirement-traces"
  | "reason-trace"
  | "has-open-obligations";

export async function rebuildSemanticIndex(
  sourceJson: Uint8Array,
  scientificArtifactBundle: Uint8Array,
): Promise<Uint8Array> {
  return (await loadModule()).rebuild_semantic_index(
    sourceJson,
    scientificArtifactBundle,
  );
}

export function queryRegisteredSemanticIndex(
  index: Uint8Array,
  queryId: "scientific-evidence",
  viewContext: { workspaceRootDigest: string; revision: number },
): Promise<ScientificEvidenceView>;
export function queryRegisteredSemanticIndex(
  index: Uint8Array,
  queryId: "scientific-source-bindings",
  viewContext: { workspaceRootDigest: string; revision: number },
): Promise<ScientificSourceBindingsView>;
export function queryRegisteredSemanticIndex(
  index: Uint8Array,
  queryId: RawRegisteredSemanticQueryId,
  viewContext?: undefined,
): Promise<RegisteredSemanticQueryResult>;
export function queryRegisteredSemanticIndex(
  index: Uint8Array,
  queryId: string,
  viewContext?: { workspaceRootDigest: string; revision: number },
): Promise<RegisteredSemanticQueryResult | TypedScientificView>;
export async function queryRegisteredSemanticIndex(
  index: Uint8Array,
  queryId: string,
  viewContext?: { workspaceRootDigest: string; revision: number },
): Promise<RegisteredSemanticQueryResult | TypedScientificView> {
  const module = await loadModule();
  return JSON.parse(
    viewContext
      ? module.query_registered_view(
          index,
          queryId,
          viewContext.workspaceRootDigest,
          BigInt(viewContext.revision),
        )
      : module.query_registered(index, queryId),
  ) as RegisteredSemanticQueryResult | TypedScientificView;
}
