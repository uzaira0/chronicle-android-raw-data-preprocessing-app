import { describe, expect, it } from "vitest";
import { UserFacingError } from "@/lib/diagnostics";

import {
  startExclusiveDownload,
  type ExclusiveDownloadHooks,
} from "@/lib/exclusiveDownload";

type Recorded = {
  busy: string | null;
  error: string | null;
  transitions: string[];
};

function recorder(): { state: Recorded; hooks: ExclusiveDownloadHooks } {
  const state: Recorded = { busy: null, error: null, transitions: [] };
  return {
    state,
    hooks: {
      isBusy: () => state.busy !== null,
      markBusy: (id) => {
        state.busy = id;
        state.transitions.push(`busy:${id}`);
      },
      markIdle: () => {
        state.busy = null;
        state.transitions.push("idle");
      },
      reportError: (message) => {
        state.error = message;
        state.transitions.push(`error:${message}`);
      },
    },
  };
}

describe("startExclusiveDownload", () => {
  it("runs the work, clears any prior error, and releases the busy marker", async () => {
    const { state, hooks } = recorder();
    state.error = "stale failure from an earlier download";
    let ran = false;
    // eslint-disable-next-line @typescript-eslint/require-await -- models async work with no awaits
    await startExclusiveDownload(hooks, "all", async () => {
      ran = true;
      expect(state.busy).toBe("all");
      expect(state.error).toBeNull();
    });
    expect(ran).toBe(true);
    expect(state.busy).toBeNull();
    expect(state.error).toBeNull();
  });

  it("ignores a second request while one is active", async () => {
    const { state, hooks } = recorder();
    let release!: () => void;
    const first = startExclusiveDownload(
      hooks,
      "all",
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    // eslint-disable-next-line @typescript-eslint/require-await -- must not run at all
    const second = startExclusiveDownload(hooks, "plot", async () => {
      throw new Error("must not run");
    });
    expect(second).toBeUndefined();
    expect(state.busy).toBe("all");
    release();
    await first;
    expect(state.busy).toBeNull();
  });

  it("reports a researcher-facing message verbatim and still releases the busy marker", async () => {
    const { state, hooks } = recorder();
    // eslint-disable-next-line @typescript-eslint/require-await -- immediate failure path
    await startExclusiveDownload(hooks, "timeline", async () => {
      throw new UserFacingError("Plots could not be generated for Raw P02.csv");
    });
    expect(state.error).toBe("Plots could not be generated for Raw P02.csv");
    expect(state.busy).toBeNull();
    // busy must be released AFTER the failure is recorded, so the button
    // re-enables only once the error text is already on screen.
    expect(state.transitions.slice(-2)).toEqual([
      "error:Plots could not be generated for Raw P02.csv",
      "idle",
    ]);
  });

  it("shows a plain sentence, not the raw text, for any other failure", async () => {
    const { state, hooks } = recorder();
    // eslint-disable-next-line @typescript-eslint/require-await -- immediate failure path
    await startExclusiveDownload(hooks, "aggregate", async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- pins String(failure) handling for non-Error throws
      throw "quota exceeded";
    });
    expect(state.error).toMatch(/^The download could not be prepared\./);
    expect(state.error).not.toContain("quota exceeded");
    expect(state.busy).toBeNull();
  });
});
