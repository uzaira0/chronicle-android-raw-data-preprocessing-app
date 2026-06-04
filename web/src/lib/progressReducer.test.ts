import { describe, expect, it } from "vitest";

import { applyProgressEvent } from "@/lib/progressReducer";
import type { FileProgress } from "@/components/ProgressList";
import type { ProgressEvent } from "@/lib/types";

const run = (events: ProgressEvent[]): Record<string, FileProgress> =>
  events.reduce<Record<string, FileProgress>>(
    (state, event) => applyProgressEvent(state, event),
    {},
  );

describe("applyProgressEvent", () => {
  it("keeps a finished file complete when a late step arrives after file-complete", () => {
    // Reproduces the worker-path ordering: the Comlink callback port can deliver
    // a trailing "output" step *after* the RPC's file-complete.
    const fileName = "Raw P01.csv";
    const state = run([
      { type: "file-start", fileName },
      { type: "step", fileName, stepKind: "output", percent: 1 },
      { type: "file-complete", fileName },
      { type: "step", fileName, stepKind: "output", percent: 1 },
    ]);
    expect(state[fileName]?.status).toBe("complete");
  });

  it("does not revert an errored file to running", () => {
    const fileName = "Bad.csv";
    const state = run([
      { type: "file-start", fileName },
      { type: "file-complete", fileName, error: "boom" },
      { type: "step", fileName, stepKind: "matcher", percent: 0.5 },
    ]);
    expect(state[fileName]?.status).toBe("error");
    expect(state[fileName]?.error).toBe("boom");
  });

  it("advances running steps normally before completion", () => {
    const fileName = "Raw.csv";
    const state = run([
      { type: "file-start", fileName },
      { type: "step", fileName, stepKind: "matcher", percent: 0.5 },
    ]);
    expect(state[fileName]).toMatchObject({
      status: "running",
      stepKind: "matcher",
      percent: 0.5,
    });
  });

  it("tracks files independently", () => {
    const state = run([
      { type: "file-start", fileName: "a" },
      { type: "file-start", fileName: "b" },
      { type: "file-complete", fileName: "a" },
      { type: "step", fileName: "b", stepKind: "output", percent: 1 },
    ]);
    expect(state["a"]?.status).toBe("complete");
    expect(state["b"]?.status).toBe("running");
  });
});
