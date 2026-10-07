import { describe, expect, it, vi } from "vitest";

import {
  applyProjectAtomically,
  ProjectApplicationBusyError,
  type ProjectApplicationActivity,
} from "@/lib/projectApplication";

describe("atomic project application", () => {
  it.each([
    ["processing", { processing: true, retrying: false, comparing: false }],
    ["retry", { processing: false, retrying: true, comparing: false }],
    ["comparison", { processing: false, retrying: false, comparing: true }],
  ] satisfies Array<[string, ProjectApplicationActivity]>) (
    "refuses before any %s-time state mutation",
    (_label, activity) => {
      const setOptions = vi.fn();
      const setSupport = vi.fn();
      const replaceRawAndInspection = vi.fn();

      expect(() =>
        applyProjectAtomically(activity, () => {
          setOptions();
          setSupport();
          replaceRawAndInspection();
        }),
      ).toThrow(ProjectApplicationBusyError);
      expect(setOptions).not.toHaveBeenCalled();
      expect(setSupport).not.toHaveBeenCalled();
      expect(replaceRawAndInspection).not.toHaveBeenCalled();
    },
  );

  it("commits options, support, and exact raw reinspection together while idle", () => {
    const calls: string[] = [];
    applyProjectAtomically(
      { processing: false, retrying: false, comparing: false },
      () => {
        calls.push("options", "support", "raw-reinspection");
      },
    );
    expect(calls).toEqual(["options", "support", "raw-reinspection"]);
  });
});
