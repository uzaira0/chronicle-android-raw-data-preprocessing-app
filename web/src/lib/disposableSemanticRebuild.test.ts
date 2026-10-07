import { afterEach, describe, expect, it, vi } from "vitest";
import {
  rebuildSemanticIndexDisposable,
  setDisposableSemanticRebuilderForTesting,
  setSemanticRebuildTransportForTesting,
} from "@/lib/disposableSemanticRebuild";

afterEach(() => {
  setDisposableSemanticRebuilderForTesting(null);
  setSemanticRebuildTransportForTesting(null);
});

function productionFactoryHarness(
  rebuild: (source: Uint8Array, bundle: Uint8Array) => Promise<Uint8Array>,
) {
  const listeners = new Map<
    string,
    Array<(event: { message?: string }) => void>
  >();
  const terminate = vi.fn();
  const release = vi.fn();
  const transfer = vi.fn((bytes: Uint8Array): Uint8Array =>
    structuredClone(bytes, {
      transfer: [bytes.buffer as ArrayBuffer],
    }),
  );
  const worker = {
    addEventListener(
      type: "error" | "messageerror",
      listener: (event: { message?: string }) => void,
    ) {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
    terminate,
  };
  setSemanticRebuildTransportForTesting({
    createWorker: () => worker,
    wrap: () => ({ rebuild, release }),
    transfer,
  });
  const emit = (type: "error" | "messageerror", message?: string): void => {
    for (const listener of listeners.get(type) ?? []) listener({ message });
  };
  return { emit, release, terminate, transfer };
}

describe("disposable semantic rebuild", () => {
  it("returns only the PHI-safe index, wipes inputs, and terminates on success", async () => {
    const terminate = vi.fn();
    const index = new Uint8Array([7, 8, 9]);
    setDisposableSemanticRebuilderForTesting(() => ({
      rebuild: vi.fn(() => Promise.resolve(index)),
      terminate,
    }));
    const source = new Uint8Array([1, 2, 3]);
    const bundle = new TextEncoder().encode("P01,super.secret.package");

    await expect(rebuildSemanticIndexDisposable(source, bundle)).resolves.toBe(
      index,
    );
    expect(source.every((byte) => byte === 0)).toBe(true);
    expect(bundle.every((byte) => byte === 0)).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("wipes inputs and terminates after a typed validation rejection", async () => {
    const terminate = vi.fn();
    setDisposableSemanticRebuilderForTesting(() => ({
      rebuild: vi.fn(() =>
        Promise.reject(
          new Error("semantic scientific artifact payload invalid: eyes"),
        ),
      ),
      terminate,
    }));
    const source = new Uint8Array([1, 2, 3]);
    const bundle = new TextEncoder().encode("LOW_ENTROPY_PARTICIPANT");

    await expect(
      rebuildSemanticIndexDisposable(source, bundle),
    ).rejects.toThrow("semantic scientific artifact payload invalid");
    expect(source.every((byte) => byte === 0)).toBe(true);
    expect(bundle.every((byte) => byte === 0)).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("wipes inputs when the disposable worker cannot be created", async () => {
    setDisposableSemanticRebuilderForTesting(() => {
      throw new Error("worker construction refused");
    });
    const source = new TextEncoder().encode("source");
    const bundle = new TextEncoder().encode("P01,secret.package");

    await expect(
      rebuildSemanticIndexDisposable(source, bundle),
    ).rejects.toThrow("worker construction refused");
    expect(source.every((byte) => byte === 0)).toBe(true);
    expect(bundle.every((byte) => byte === 0)).toBe(true);
  });

  it("wipes inputs and terminates an in-flight worker on cancellation", async () => {
    const terminate = vi.fn();
    setDisposableSemanticRebuilderForTesting(() => ({
      rebuild: vi.fn(() => new Promise<Uint8Array>(() => {})),
      terminate,
    }));
    const controller = new AbortController();
    const source = new TextEncoder().encode("source");
    const bundle = new TextEncoder().encode("P01,secret.package");
    const rebuild = rebuildSemanticIndexDisposable(
      source,
      bundle,
      controller.signal,
    );

    controller.abort();

    await expect(rebuild).rejects.toMatchObject({ name: "AbortError" });
    expect(source.every((byte) => byte === 0)).toBe(true);
    expect(bundle.every((byte) => byte === 0)).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("rejects and wipes without waiting when the signal is already aborted", async () => {
    const terminate = vi.fn();
    setDisposableSemanticRebuilderForTesting(() => ({
      rebuild: vi.fn(() => new Promise<Uint8Array>(() => {})),
      terminate,
    }));
    const controller = new AbortController();
    controller.abort();
    const source = new TextEncoder().encode("source");
    const bundle = new TextEncoder().encode("P01,secret.package");

    await expect(
      rebuildSemanticIndexDisposable(source, bundle, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(source.every((byte) => byte === 0)).toBe(true);
    expect(bundle.every((byte) => byte === 0)).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it.each([
    ["error" as const, "module could not initialize"],
    ["messageerror" as const, undefined],
  ])(
    "production factory releases and terminates after worker %s",
    async (eventType, message) => {
      const harness = productionFactoryHarness(
        () => new Promise<Uint8Array>(() => {}),
      );
      const source = new TextEncoder().encode("source");
      const bundle = new TextEncoder().encode("P01,secret.package");
      const rebuild = rebuildSemanticIndexDisposable(source, bundle);

      harness.emit(eventType, message);

      await expect(rebuild).rejects.toThrow(
        eventType === "error" ? "module could not initialize" : "unreadable",
      );
      expect(harness.transfer).toHaveBeenCalledTimes(2);
      expect(source.byteLength).toBe(0);
      expect(bundle.byteLength).toBe(0);
      expect(harness.release).toHaveBeenCalledOnce();
      expect(harness.terminate).toHaveBeenCalledOnce();
    },
  );

  it("production factory transfers, releases, and terminates after RPC success", async () => {
    const index = new Uint8Array([4, 5, 6]);
    const harness = productionFactoryHarness(() => Promise.resolve(index));
    const source = new TextEncoder().encode("source");
    const bundle = new TextEncoder().encode("P01,secret.package");

    await expect(rebuildSemanticIndexDisposable(source, bundle)).resolves.toBe(
      index,
    );
    expect(harness.transfer).toHaveBeenCalledTimes(2);
    expect(source.byteLength).toBe(0);
    expect(bundle.byteLength).toBe(0);
    expect(harness.release).toHaveBeenCalledOnce();
    expect(harness.terminate).toHaveBeenCalledOnce();
  });

  it("production factory releases and terminates after RPC rejection", async () => {
    const harness = productionFactoryHarness(() =>
      Promise.reject(new Error("typed semantic rejection")),
    );
    const source = new TextEncoder().encode("source");
    const bundle = new TextEncoder().encode("P01,secret.package");

    await expect(
      rebuildSemanticIndexDisposable(source, bundle),
    ).rejects.toThrow("typed semantic rejection");
    expect(harness.release).toHaveBeenCalledOnce();
    expect(harness.terminate).toHaveBeenCalledOnce();
  });

  it("production factory releases and terminates on cancellation", async () => {
    const harness = productionFactoryHarness(
      () => new Promise<Uint8Array>(() => {}),
    );
    const controller = new AbortController();
    const source = new TextEncoder().encode("source");
    const bundle = new TextEncoder().encode("P01,secret.package");
    const rebuild = rebuildSemanticIndexDisposable(
      source,
      bundle,
      controller.signal,
    );

    controller.abort();

    await expect(rebuild).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.release).toHaveBeenCalledOnce();
    expect(harness.terminate).toHaveBeenCalledOnce();
  });
});

/**
 * The default transport itself: a module `Worker` for
 * `src/workers/semantic-rebuild-worker.ts`, Comlink's proxy around it, and
 * Comlink's transfer of each input buffer. Every other case above replaces the
 * transport, so these three are exercised here against a stubbed `Worker`
 * global and a substituted `comlink`.
 */
describe("production semantic rebuild transport", () => {
  afterEach(() => {
    vi.doUnmock("comlink");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("wraps a module worker, transfers both inputs, and releases the proxy", async () => {
    const releaseProxy = Symbol("releaseProxy");
    const index = new Uint8Array([4, 5, 6]);
    const rebuild = vi.fn(() => Promise.resolve(index));
    const release = vi.fn();
    const transfer = vi.fn((value: unknown) => value);
    vi.doMock("comlink", () => ({
      releaseProxy,
      wrap: vi.fn(() => ({ rebuild, [releaseProxy]: release })),
      transfer,
    }));
    const constructed: Array<{ url: URL; options: unknown }> = [];
    const terminate = vi.fn();
    class StubWorker {
      constructor(url: URL, options: unknown) {
        constructed.push({ url, options });
      }
      addEventListener() {}
      terminate = terminate;
    }
    vi.stubGlobal("Worker", StubWorker);
    vi.resetModules();
    const module = await import("@/lib/disposableSemanticRebuild");
    const source = new TextEncoder().encode("source");
    const bundle = new TextEncoder().encode("P01,secret.package");

    await expect(
      module.rebuildSemanticIndexDisposable(source, bundle),
    ).resolves.toBe(index);
    expect(constructed).toHaveLength(1);
    expect(constructed[0]?.url.pathname).toMatch(
      /workers\/semantic-rebuild-worker\.ts$/,
    );
    expect(constructed[0]?.options).toEqual({ type: "module" });
    expect(transfer).toHaveBeenCalledTimes(2);
    expect(rebuild).toHaveBeenCalledWith(source, bundle);
    expect(release).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });
});
