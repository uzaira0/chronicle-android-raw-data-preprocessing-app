export type SemanticIndexModule = {
  default(): Promise<unknown>;
  rebuild_semantic_index(sourceJson: Uint8Array): Uint8Array;
  query_registered(index: Uint8Array, queryId: string): string;
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
    modulePromise = (async () => {
      const module =
        (await import("@/wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm.js")) as unknown as SemanticIndexModule;
      await module.default();
      return module;
    })();
    /* v8 ignore stop */
  }
  return modulePromise;
}

export type RegisteredSemanticQueryResult = {
  queryId: string;
  workspaceRootDigest?: string;
  variables?: string[];
  rows?: Array<Record<string, string>>;
  boolean?: boolean;
};

export async function rebuildSemanticIndex(
  sourceJson: Uint8Array,
): Promise<Uint8Array> {
  return (await loadModule()).rebuild_semantic_index(sourceJson);
}

export async function queryRegisteredSemanticIndex(
  index: Uint8Array,
  queryId: string,
): Promise<RegisteredSemanticQueryResult> {
  return JSON.parse(
    (await loadModule()).query_registered(index, queryId),
  ) as RegisteredSemanticQueryResult;
}
