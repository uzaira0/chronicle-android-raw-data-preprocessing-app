import { describe, expect, it, vi } from "vitest";

import {
  MemoryDirectoryHandle,
  memoryDirectoryHandle,
} from "@/testSupport/memoryFileSystem";
import {
  ephemeralWorkspaceNotice,
  probeOpfsCapability,
  resultsLackPersistedOutputs,
  transientWorkspaceRefusalNotice,
  workspaceDegradesToEphemeral,
  workspaceRefusesRun,
  type OpfsCapability,
} from "@/lib/opfsArtifactStore";

/**
 * F2. Before this classification every probe failure returned the same
 * `{status:"unavailable"}`, and the ephemeral fallback treated all of them as
 * "this browser cannot persist". A momentary `QuotaExceededError` or a worker
 * that restarted mid-probe therefore downgraded the whole batch to a run that
 * is lost on reload, where the old behaviour refused and the user retried into
 * a durable run.
 */
describe("durable-workspace probe classification", () => {
  const unavailable = (kind?: "unsupported" | "indeterminate"): OpfsCapability =>
    kind === undefined
      ? { status: "unavailable", reason: "r" }
      : { status: "unavailable", reason: "r", kind };

  it("degrades only when the context structurally cannot persist", () => {
    expect(workspaceDegradesToEphemeral(unavailable("unsupported"))).toBe(true);
    expect(workspaceRefusesRun(unavailable("unsupported"))).toBe(false);
  });

  it("refuses an indeterminate failure instead of downgrading it", () => {
    expect(workspaceDegradesToEphemeral(unavailable("indeterminate"))).toBe(
      false,
    );
    expect(workspaceRefusesRun(unavailable("indeterminate"))).toBe(true);
  });

  it("refuses an UNCLASSIFIED failure — the worker-unreachable arm cannot set a kind", () => {
    // rustWorkerClient's catch builds {status,reason} with no kind. Omission
    // must land on the conservative side by construction, not by remembering.
    expect(workspaceDegradesToEphemeral(unavailable())).toBe(false);
    expect(workspaceRefusesRun(unavailable())).toBe(true);
  });

  it("treats a ready or not-yet-probed capability as neither", () => {
    const ready: OpfsCapability = { status: "ready", evictionProtected: null };
    for (const capability of [ready, null]) {
      expect(workspaceDegradesToEphemeral(capability)).toBe(false);
      expect(workspaceRefusesRun(capability)).toBe(false);
    }
  });

  it("tells the user a refusal may be temporary and how to retry", () => {
    const text = transientWorkspaceRefusalNotice("Quota exceeded.");
    expect(text).toContain("Quota exceeded.");
    expect(text).toMatch(/temporary/i);
    expect(text).toMatch(/reload and try again/i);
    // And says why it is not silently downgraded.
    expect(text).toMatch(/lost on reload/i);
  });

  it("keeps the ephemeral notice distinct from the refusal", () => {
    const notice = ephemeralWorkspaceNotice("No OPFS here.");
    expect(notice).toContain("No OPFS here.");
    expect(notice).toMatch(/Download the outputs/i);
    expect(notice).not.toMatch(/try again/i);
  });
});

/**
 * F1. An ephemeral run's outputs are in-tab blobs with no `persistedArtifact`
 * locator; IndexedDB stores the record's metadata regardless, so it restored as
 * a complete-looking run whose every download was dead.
 */
describe("resultsLackPersistedOutputs", () => {
  const persisted = { persistedArtifact: { kind: "app-usage-csv" } };
  const ephemeral = {};

  it("is true when no result carries a persisted locator", () => {
    expect(
      resultsLackPersistedOutputs([
        { outputs: [ephemeral, ephemeral] },
        { outputs: [ephemeral] },
      ]),
    ).toBe(true);
  });

  it("is false when any result carries one", () => {
    expect(
      resultsLackPersistedOutputs([
        { outputs: [ephemeral] },
        { outputs: [persisted] },
      ]),
    ).toBe(false);
  });

  it("is false for an empty record — there is nothing to mislead about", () => {
    expect(resultsLackPersistedOutputs([])).toBe(false);
  });

  it("treats a result with no outputs array as unpersisted", () => {
    expect(resultsLackPersistedOutputs([{}])).toBe(true);
  });
});

/**
 * The classification the predicates above consume, measured through the real
 * probe rather than asserted on hand-built capability objects.
 */
describe("probeOpfsCapability classifies each failure path", () => {
  const withNavigator = async (
    value: unknown,
  ): Promise<OpfsCapability> => {
    const prior = globalThis.navigator;
    vi.stubGlobal("navigator", value);
    try {
      return await probeOpfsCapability();
    } finally {
      vi.stubGlobal("navigator", prior);
    }
  };

  const locks = {
    request: (_n: string, _o: unknown, op: () => unknown) => op(),
  };

  const rootThatFails = (error: unknown, at: "directory" | "write") => {
    const root = new MemoryDirectoryHandle();
    const real = root.getDirectoryHandle.bind(root);
    return {
      locks,
      storage: {
        getDirectory: (): Promise<FileSystemDirectoryHandle> =>
          Promise.resolve(({
            getDirectoryHandle: async (
              name: string,
              options?: FileSystemGetDirectoryOptions,
            ) => {
              if (at === "directory") throw error;
              const directory = await real(name, options);
              return {
                ...directory,
                getFileHandle: () => {
                  // Rejecting with the caller's value verbatim is the point:
                  // these fixtures inject DOMExceptions AND non-Error values
                  // to prove the classifier never assumes an Error shape.
                  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                  return Promise.reject(error);
                },
                getDirectoryHandle: directory.getDirectoryHandle.bind(directory),
                removeEntry: directory.removeEntry.bind(directory),
              };
            },
          }) as unknown as FileSystemDirectoryHandle),
      },
    };
  };

  it("calls a missing Web Locks API structurally unsupported", async () => {
    const capability = await withNavigator({ storage: {}, locks: undefined });
    expect(capability).toMatchObject({
      status: "unavailable",
      kind: "unsupported",
    });
  });

  it("calls a missing OPFS API structurally unsupported", async () => {
    const capability = await withNavigator({ locks, storage: {} });
    expect(capability).toMatchObject({
      status: "unavailable",
      kind: "unsupported",
    });
  });

  it("calls a SecurityError at open structurally unsupported (private browsing)", async () => {
    const capability = await withNavigator({
      locks,
      storage: {
        getDirectory: () =>
          Promise.reject(new DOMException("denied", "SecurityError")),
      },
    });
    expect(capability).toMatchObject({
      status: "unavailable",
      kind: "unsupported",
    });
  });

  it("calls an unexplained failure at open INDETERMINATE, so the run is refused", async () => {
    // One UnknownError is retried (it may be transient); a different failure
    // on the retry is still unexplained.
    let calls = 0;
    const capability = await withNavigator({
      locks,
      storage: {
        getDirectory: () =>
          Promise.reject(
            calls++ === 0
              ? new DOMException("hiccup", "UnknownError")
              : new DOMException("still failing", "InvalidStateError"),
          ),
      },
    });
    expect(capability).toMatchObject({
      status: "unavailable",
      kind: "indeterminate",
    });
  });

  it("calls a repeated UnknownError at open UNSUPPORTED — Safari private browsing", async () => {
    const capability = await withNavigator({
      locks,
      storage: {
        getDirectory: () =>
          Promise.reject(new DOMException("hiccup", "UnknownError")),
      },
    });
    expect(capability).toMatchObject({
      status: "unavailable",
      kind: "unsupported",
    });
  });

  it("calls an exhausted quota INDETERMINATE — this is the F2 regression", async () => {
    // Storage opened fine and then a write failed. Retrying may well succeed,
    // so downgrading the batch to a run that dies on reload is wrong.
    const capability = await withNavigator(
      rootThatFails(new DOMException("full", "QuotaExceededError"), "write"),
    );
    expect(capability).toMatchObject({
      status: "unavailable",
      kind: "indeterminate",
    });
    expect(
      capability.status === "unavailable" ? capability.reason : "",
    ).toMatch(/not writable/);
  });

  it("calls a TypeError inside the round trip INDETERMINATE, not structural", async () => {
    // Before a handle exists, a TypeError means the API is not there at all
    // (`getDirectory` is not a function) and the context genuinely cannot
    // persist. AFTER a handle exists it is at least as likely to be a defect
    // inside writeFile/readFile as a missing `createWritable`, and degrading
    // there would silently drop persistence on our own bug. Post-open
    // TypeError is therefore refused, not downgraded.
    const capability = await withNavigator(
      rootThatFails(new TypeError("handle.createWritable is not a function"), "write"),
    );
    expect(capability).toMatchObject({
      status: "unavailable",
      kind: "indeterminate",
    });
    expect(
      capability.status === "unavailable" ? capability.reason : "",
    ).toMatch(/not writable/);
    // And the pre-open verdict for the same error name is unchanged.
    const missingApi = await withNavigator({ locks, storage: {} });
    expect(missingApi).toMatchObject({
      status: "unavailable",
      kind: "unsupported",
    });
  });

  it("still calls a SecurityError inside the round trip structurally unsupported", async () => {
    const capability = await withNavigator(
      rootThatFails(new DOMException("denied", "SecurityError"), "directory"),
    );
    expect(capability).toMatchObject({
      status: "unavailable",
      kind: "unsupported",
    });
  });

  it("reports a healthy context as ready", async () => {
    const root = new MemoryDirectoryHandle();
    const capability = await withNavigator({
      locks,
      storage: {
        getDirectory: () => Promise.resolve(memoryDirectoryHandle(root)),
        persisted: () => Promise.resolve(true),
      },
    });
    expect(capability).toEqual({ status: "ready", evictionProtected: true });
  });
});
