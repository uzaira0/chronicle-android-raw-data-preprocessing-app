import * as Comlink from "comlink";
import type { SemanticRebuildWorkerApi } from "@/workers/semantic-rebuild-worker";

type DisposableSemanticRebuilder = {
  rebuild(
    source: Uint8Array,
    scientificArtifactBundle: Uint8Array,
  ): Promise<Uint8Array>;
  terminate(): void;
};

type DisposableSemanticRebuilderFactory = () => DisposableSemanticRebuilder;

type SemanticRebuildWorker = {
  addEventListener(
    type: "error",
    listener: (event: { message?: string }) => void,
  ): void;
  addEventListener(type: "messageerror", listener: () => void): void;
  terminate(): void;
};

type SemanticRebuildRemote = {
  rebuild(
    source: Uint8Array,
    scientificArtifactBundle: Uint8Array,
  ): Promise<Uint8Array>;
  release(): void;
};

type SemanticRebuildTransport = {
  createWorker(): SemanticRebuildWorker;
  wrap(worker: SemanticRebuildWorker): SemanticRebuildRemote;
  transfer(bytes: Uint8Array): Uint8Array;
};

const productionTransport: SemanticRebuildTransport = {
  createWorker() {
    return new Worker(
      new URL("../workers/semantic-rebuild-worker.ts", import.meta.url),
      { type: "module" },
    );
  },
  wrap(worker) {
    const api = Comlink.wrap<SemanticRebuildWorkerApi>(worker as Worker);
    return {
      rebuild: (source, scientificArtifactBundle) =>
        api.rebuild(source, scientificArtifactBundle),
      release: () => api[Comlink.releaseProxy](),
    };
  },
  transfer(bytes) {
    return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
  },
};

let semanticRebuildTransport = productionTransport;

function bestEffortZero(bytes: Uint8Array): void {
  try {
    bytes.fill(0);
  } catch {
    // Transferring the backing buffer detaches it, which is stronger than a
    // local overwrite because this realm can no longer read the allocation.
  }
}

function spawnDisposableSemanticRebuilder(): DisposableSemanticRebuilder {
  const transport = semanticRebuildTransport;
  const worker = transport.createWorker();
  const fault = new Promise<never>((_, reject) => {
    worker.addEventListener("error", (event) => {
      reject(
        new Error(
          `Semantic rebuild worker failed: ${event.message || "could not load"}`,
        ),
      );
    });
    worker.addEventListener("messageerror", () => {
      reject(new Error("Semantic rebuild worker sent an unreadable message."));
    });
  });
  // Keep a handler attached so an un-raced fault never becomes an unhandled
  // rejection; every call races `fault` and still observes the rejection.
  fault.catch(() => {});
  const api = transport.wrap(worker);
  return {
    rebuild(source, scientificArtifactBundle) {
      return Promise.race([
        api.rebuild(
          transport.transfer(source),
          transport.transfer(scientificArtifactBundle),
        ),
        fault,
      ]);
    },
    terminate() {
      try {
        api.release();
      } finally {
        worker.terminate();
      }
    },
  };
}

let rebuilderFactory: DisposableSemanticRebuilderFactory =
  spawnDisposableSemanticRebuilder;

/** Test-only lifecycle seam; production always creates a new module worker. */
export function setDisposableSemanticRebuilderForTesting(
  factory: DisposableSemanticRebuilderFactory | null,
): void {
  rebuilderFactory = factory ?? spawnDisposableSemanticRebuilder;
}

/** Test-only low-level seam that still exercises the production factory. */
export function setSemanticRebuildTransportForTesting(
  transport: SemanticRebuildTransport | null,
): void {
  semanticRebuildTransport = transport ?? productionTransport;
}

/**
 * Validate raw-equivalent scientific substrates in a one-shot WASM realm.
 * Only the PHI-safe N-Quads index crosses back. The worker is destroyed on
 * success, typed refusal, initialization failure, or validation error.
 */
export async function rebuildSemanticIndexDisposable(
  source: Uint8Array,
  scientificArtifactBundle: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let rebuilder: DisposableSemanticRebuilder | undefined;
  let removeAbortListener: (() => void) | undefined;
  try {
    rebuilder = rebuilderFactory();
    const rebuild = rebuilder.rebuild(source, scientificArtifactBundle);
    if (!signal) return await rebuild;
    const aborted = new Promise<never>((_, reject) => {
      const rejectAborted = (): void => {
        reject(
          new DOMException("Semantic rebuild was cancelled.", "AbortError"),
        );
      };
      if (signal.aborted) {
        rejectAborted();
        return;
      }
      signal.addEventListener("abort", rejectAborted, { once: true });
      removeAbortListener = () =>
        signal.removeEventListener("abort", rejectAborted);
    });
    return await Promise.race([rebuild, aborted]);
  } finally {
    removeAbortListener?.();
    bestEffortZero(source);
    bestEffortZero(scientificArtifactBundle);
    rebuilder?.terminate();
  }
}
