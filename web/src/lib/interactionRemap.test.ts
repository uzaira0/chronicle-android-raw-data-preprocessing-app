import { describe, expect, it } from "vitest";

import { CANONICAL_INTERACTION_TYPES } from "@/lib/interactionTypes";

describe("CANONICAL_INTERACTION_TYPES", () => {
  it("is a sorted, duplicate-free Rust-generated UI vocabulary", () => {
    expect([...CANONICAL_INTERACTION_TYPES]).toEqual(
      [...CANONICAL_INTERACTION_TYPES].sort((a, b) => a.localeCompare(b)),
    );
    expect(new Set(CANONICAL_INTERACTION_TYPES).size).toBe(CANONICAL_INTERACTION_TYPES.length);
  });

  it("includes the key session-boundary targets", () => {
    for (const name of ["Activity Resumed", "Activity Paused", "Activity Stopped"]) {
      expect(CANONICAL_INTERACTION_TYPES).toContain(name);
    }
  });
});
