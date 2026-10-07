import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAYLOAD_BUDGET_BYTES } from "./payloadSpill";
import type { ChronicleWorkerApi } from "./chronicle-worker";

const comlink = vi.hoisted((): { exposed: unknown } => ({ exposed: null }));
const spill = vi.hoisted(() => ({ openPayloadSpill: vi.fn() }));
const readyMessage = vi.hoisted(() => vi.fn());
const runtime = vi.hoisted(() => ({
  initializeRustRuntime: vi.fn(),
  installRustPayloadSpill: vi.fn(),
}));

vi.mock("comlink", () => ({
  expose: (value: unknown) => {
    comlink.exposed = value;
  },
  transfer: (value: unknown) => value,
}));

vi.mock("./payloadSpill", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./payloadSpill")>()),
  openPayloadSpill: spill.openPayloadSpill,
}));

vi.mock("@/lib/rustPipelineRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rustPipelineRuntime")>()),
  initializeRustRuntime: runtime.initializeRustRuntime,
  installRustPayloadSpill: runtime.installRustPayloadSpill,
}));

/** Re-evaluates the worker module so each test gets a fresh spill handle. */
async function exposedWorkerApi(): Promise<ChronicleWorkerApi> {
  vi.resetModules();
  await import("./chronicle-worker");
  expect(readyMessage).toHaveBeenCalledExactlyOnceWith({
    type: "chronicle-worker-api-ready/v1",
  });
  expect(comlink.exposed).not.toBeNull();
  return comlink.exposed as ChronicleWorkerApi;
}

describe("chronicle worker runtime initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comlink.exposed = null;
    vi.stubGlobal("postMessage", readyMessage);
    runtime.initializeRustRuntime.mockResolvedValue(undefined);
    runtime.installRustPayloadSpill.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("installs the opened spill bridge with the worker payload budget", async () => {
    const bridge = {
      put: () => {},
      get: () => new Uint8Array(),
      remove: () => {},
    };
    spill.openPayloadSpill.mockResolvedValue({
      bridge,
      stats: () => ({
        puts: 0,
        gets: 0,
        putBytes: 0,
        getBytes: 0,
        putMs: 0,
        getMs: 0,
      }),
      close: () => Promise.resolve(),
    });

    const api = await exposedWorkerApi();
    await api.initializeRuntime({});

    expect(runtime.installRustPayloadSpill).toHaveBeenCalledWith(
      bridge,
      PAYLOAD_BUDGET_BYTES,
    );
  });

  it("posts a failed spill sweep to the page beside the Comlink channel", async () => {
    spill.openPayloadSpill.mockResolvedValue(null);
    const api = await exposedWorkerApi();
    await api.initializeRuntime({});
    const [onSweepFailure] = spill.openPayloadSpill.mock.calls[0] as [(message: string) => void];
    onSweepFailure("2 leftover spill files could not be removed (disk)");
    expect(readyMessage).toHaveBeenLastCalledWith({
      type: "chronicle-worker-background-failure/v1",
      operation: "spill-sweep",
      message: "2 leftover spill files could not be removed (disk)",
    });
  });

  it("installs nothing when sync access handles are unavailable", async () => {
    spill.openPayloadSpill.mockResolvedValue(null);

    const api = await exposedWorkerApi();
    await api.initializeRuntime({});

    expect(runtime.initializeRustRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.installRustPayloadSpill).not.toHaveBeenCalled();
  });
});
