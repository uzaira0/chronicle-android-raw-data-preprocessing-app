import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "@/App";
import { resolveDefaultSupportFiles } from "@/lib/processingUiContract";
import { readPersistedOptions } from "@/lib/settingsPersistence";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { createProcessingRunLifecycle } from "@/lib/processingRunLifecycle";

const appHarness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  stateCalls: 0,
  onProcess: undefined as undefined | (() => void),
  onFinished: undefined as undefined | (() => void),
  files: [] as Array<{ name: string }>,
  pools: [] as Array<{ terminate: ReturnType<typeof vi.fn> }>,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: <S,>(initial: S | (() => S)) => {
      const index = ++appHarness.stateCalls;
      const [value, setValue] = react.useState(
        index === 8 ? [{ name: "raw.csv", size: 1 }] : initial,
      );
      return [value, (next: S) => {
        if (index === 2 && next === false) appHarness.onFinished?.();
        setValue(next);
      }];
    },
    useEffect: (effect: () => void | (() => void)) => {
      appHarness.effects.push(effect);
    },
  };
});

vi.mock("@/components/ProcessPanel", () => ({
  ProcessPanel: ({ onProcess, uploadedFiles }: { onProcess: () => void; uploadedFiles: Array<{ name: string }> }) => {
    appHarness.onProcess = onProcess;
    appHarness.files = uploadedFiles;
    return null;
  },
}));

vi.mock("@/lib/rustWorkerClient", async (importOriginal) => {
  const client = await importOriginal<typeof import("@/lib/rustWorkerClient")>();
  return {
    ...client,
    probeWorkerWorkspaceCapability: vi.fn(() => Promise.resolve({
      status: "ready", evictionProtected: true,
    })),
    WorkerPool: class {
      usable = true;
      size = 1;
      terminate = vi.fn();
      setRetainedMemoryBudget = vi.fn();
      constructor() { appHarness.pools.push(this); }
    },
  };
});

vi.mock("@/lib/opfsArtifactStore", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/lib/opfsArtifactStore")>();
  return {
    ...store,
    probeOpfsCapability: vi.fn(() => Promise.resolve({
      status: "ready", evictionProtected: true,
    })),
  };
});

vi.mock("@/lib/processingUiContract", async (importOriginal) => {
  const contract = await importOriginal<typeof import("@/lib/processingUiContract")>();
  return { ...contract, resolveDefaultSupportFiles: vi.fn() };
});

vi.mock("@/lib/settingsPersistence", async (importOriginal) => {
  const settings = await importOriginal<typeof import("@/lib/settingsPersistence")>();
  return { ...settings, readPersistedOptions: vi.fn() };
});

vi.mock("@/lib/notification", async (importOriginal) => {
  const notification = await importOriginal<typeof import("@/lib/notification")>();
  return { ...notification, ensureNotificationPermission: vi.fn() };
});

describe("processing run lifecycle", () => {
  it("does not create or retain an App worker after unmount during support loading", async () => {
    appHarness.effects.length = 0;
    appHarness.pools.length = 0;
    appHarness.stateCalls = 0;
    appHarness.onProcess = undefined;
    let finishSupportLoad!: () => void;
    const supportLoad = new Promise<Record<string, never>>((resolve) => {
      finishSupportLoad = () => resolve({});
    });
    vi.mocked(resolveDefaultSupportFiles).mockReturnValue(supportLoad);
    vi.mocked(readPersistedOptions).mockReturnValue({
      ...DEFAULT_BROWSER_OPTIONS,
      timezoneHandling: "primary-filter",
      useAppCodebook: false,
      processScreenUsage: false,
    });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });
    let finished!: () => void;
    const runFinished = new Promise<void>((resolve) => { finished = resolve; });
    appHarness.onFinished = finished;

    renderToStaticMarkup(createElement(App));
    // The App effect that mounts the processing-run lifecycle and tears it
    // down on unmount. Found by what it does rather than by position, so an
    // unrelated effect added earlier in App does not make this test run the
    // wrong effect.
    const lifecycleEffect = appHarness.effects.filter((effect) =>
      effect.toString().includes("processingRunLifecycleRef.current.mount()"));
    expect(lifecycleEffect).toHaveLength(1);
    const unmount = lifecycleEffect[0]!();
    expect(appHarness.onProcess).toBeTypeOf("function");
    expect(appHarness.files).toHaveLength(1);
    appHarness.onProcess!();
    await vi.waitFor(() => expect(resolveDefaultSupportFiles).toHaveBeenCalledOnce());

    expect(unmount).toBeTypeOf("function");
    unmount!();
    vi.stubGlobal("window", {});
    finishSupportLoad();
    await runFinished;

    expect(appHarness.pools).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("terminates a pool created after unmount instead of retaining it", async () => {
    const lifecycle = createProcessingRunLifecycle();
    const token = lifecycle.token();
    let finishSupportLoad!: () => void;
    const supportLoad = new Promise<void>((resolve) => { finishSupportLoad = resolve; });
    const pool = { terminate: vi.fn() };
    const keep = vi.fn();
    const pending = supportLoad.then(() =>
      lifecycle.retain(token, pool, keep),
    );

    lifecycle.unmount();
    lifecycle.mount(); // A remount cannot revive the pending run's token.
    finishSupportLoad();

    await expect(pending).resolves.toBe(false);
    expect(pool.terminate).toHaveBeenCalledOnce();
    expect(keep).not.toHaveBeenCalled();
  });

  it("retains the pool of the current run and keeps it alive", () => {
    const lifecycle = createProcessingRunLifecycle();
    const token = lifecycle.token();
    const pool = { terminate: vi.fn() };
    const keep = vi.fn();

    expect(lifecycle.isCurrent(token)).toBe(true);
    expect(lifecycle.retain(token, pool, keep)).toBe(true);
    expect(keep).toHaveBeenCalledOnce();
    expect(pool.terminate).not.toHaveBeenCalled();

    // The token of a run started after a remount is current again.
    lifecycle.unmount();
    lifecycle.mount();
    const next = lifecycle.token();
    expect(next).not.toBe(token);
    expect(lifecycle.retain(next, pool, keep)).toBe(true);
    expect(keep).toHaveBeenCalledTimes(2);
    expect(pool.terminate).not.toHaveBeenCalled();
  });
});
