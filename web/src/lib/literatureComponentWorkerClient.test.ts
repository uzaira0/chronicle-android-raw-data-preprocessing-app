import { afterEach, expect, it, vi } from "vitest";

import {
  LITERATURE_INPUT_ADAPTER_CONTRACTS,
  literatureComponentExecutionForSettings,
} from "@/lib/literatureInputAdapters";

afterEach(() => {
  vi.doUnmock("comlink");
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("routes the registered component and transfers only the raw buffer", async () => {
  const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(
    ({ semanticType }) => semanticType === "schoedel_screen_preprocessing",
  )!;
  const registration = literatureComponentExecutionForSettings(
    group.methodSettingIds,
  )!;
  const expected = {
    workspaceId: `sha256:${"1".repeat(64)}`,
    artifacts: [],
  };
  const api = {
    initializeRuntime: vi.fn(() => Promise.resolve()),
    executeLiteratureComponentBytes: vi.fn(() => Promise.resolve(expected)),
  };
  const transfer = vi.fn((value: unknown) => value);
  vi.doMock("comlink", () => ({
    wrap: vi.fn(() => api),
    transfer,
    proxy: vi.fn((value: unknown) => value),
  }));
  class WorkerStub {
    addEventListener(type: string, callback: (event: unknown) => void): void {
      if (type === "message") queueMicrotask(() => callback({ data: { type: "chronicle-worker-api-ready/v1" } }));
    }
    removeEventListener(): void {}
    terminate(): void {}
  }
  vi.stubGlobal("Worker", WorkerStub);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), {
          headers: { "content-type": "application/wasm" },
        }),
      ),
    ),
  );
  const client = await import("@/lib/rustWorkerClient");
  const raw = new Uint8Array([1, 2, 3]).buffer;
  const support = {
    phoneStudyPsCommunicationFile: {
      name: "ps_communication.csv",
      bytes: new Uint8Array([4, 5, 6]).buffer,
    },
  };

  await expect(
    client.executeLiteratureComponentBytes(
      registration,
      "ps_activity.csv",
      raw,
      support,
      true,
      "a".repeat(64),
    ),
  ).resolves.toBe(expected);
  expect(api.initializeRuntime).toHaveBeenCalledOnce();
  expect(api.executeLiteratureComponentBytes).toHaveBeenCalledWith(
    registration,
    "ps_activity.csv",
    raw,
    support,
    true,
    "a".repeat(64),
  );
  expect(transfer).toHaveBeenCalledWith(raw, [raw]);
  expect(transfer).toHaveBeenCalledTimes(1);
});
