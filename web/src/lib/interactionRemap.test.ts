import { describe, expect, it } from "vitest";

import {
  ALL_INTERACTION_TYPES_MAP,
  CANONICAL_INTERACTION_TYPES,
  parseInteractionRemap,
} from "@/lib/interactionTypes";

describe("parseInteractionRemap (#4 custom interaction-type mappings)", () => {
  it("parses well-formed entries into a from→to lookup", () => {
    const map = parseInteractionRemap(["RESUME_X => Activity Resumed", "STOP_Y => Activity Stopped"]);
    expect(map.get("RESUME_X")).toBe("Activity Resumed");
    expect(map.get("STOP_Y")).toBe("Activity Stopped");
    expect(map.size).toBe(2);
  });

  it("trims whitespace around both sides", () => {
    const map = parseInteractionRemap(["   foo   =>   Activity Paused   "]);
    expect(map.get("foo")).toBe("Activity Paused");
  });

  it("works with the compact (no-space) delimiter form", () => {
    const map = parseInteractionRemap(["foo=>Activity Resumed"]);
    expect(map.get("foo")).toBe("Activity Resumed");
  });

  it("skips entries with no delimiter or an empty side", () => {
    const map = parseInteractionRemap([
      "noDelimiter",
      "=> Activity Resumed", // empty from
      "foo =>", // empty to
      "",
    ]);
    expect(map.size).toBe(0);
  });

  it("lets a later entry win on a duplicate key", () => {
    const map = parseInteractionRemap(["foo => Activity Resumed", "foo => Activity Paused"]);
    expect(map.get("foo")).toBe("Activity Paused");
    expect(map.size).toBe(1);
  });

  it("splits on the first delimiter only", () => {
    // Defensive: a raw value is unlikely to contain '=>', but if a target did,
    // only the first delimiter splits the entry.
    const map = parseInteractionRemap(["foo => Activity Resumed => extra"]);
    expect(map.get("foo")).toBe("Activity Resumed => extra");
  });
});

describe("CANONICAL_INTERACTION_TYPES", () => {
  it("exposes the distinct canonical names, sorted, no duplicates", () => {
    const expected = Array.from(new Set(Object.values(ALL_INTERACTION_TYPES_MAP))).sort((a, b) =>
      a.localeCompare(b),
    );
    expect([...CANONICAL_INTERACTION_TYPES]).toEqual(expected);
    expect(new Set(CANONICAL_INTERACTION_TYPES).size).toBe(CANONICAL_INTERACTION_TYPES.length);
  });

  it("includes the key session-boundary targets", () => {
    for (const name of ["Activity Resumed", "Activity Paused", "Activity Stopped"]) {
      expect(CANONICAL_INTERACTION_TYPES).toContain(name);
    }
  });
});
