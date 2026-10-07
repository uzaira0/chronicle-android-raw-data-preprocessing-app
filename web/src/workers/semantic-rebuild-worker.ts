import * as Comlink from "comlink";
import { rebuildSemanticIndex } from "@/lib/semanticIndex";

function bestEffortZero(bytes: Uint8Array): void {
  try {
    bytes.fill(0);
  } catch {
    // A transferred/detached buffer has already left this realm. The worker is
    // terminated by its caller after this RPC settles, reclaiming WASM memory.
  }
}

const api = {
  async rebuild(
    source: Uint8Array,
    scientificArtifactBundle: Uint8Array,
  ): Promise<Uint8Array> {
    try {
      const index = await rebuildSemanticIndex(
        source,
        scientificArtifactBundle,
      );
      return Comlink.transfer(index, [index.buffer as ArrayBuffer]);
    } finally {
      // Rust also wipes wasm-bindgen's copied input Vec. These JS copies are
      // erased here; terminating this dedicated worker then destroys every
      // nested String/Vec allocated while deserializing raw-equivalent evidence.
      bestEffortZero(source);
      bestEffortZero(scientificArtifactBundle);
    }
  },
};

export type SemanticRebuildWorkerApi = typeof api;

Comlink.expose(api);
