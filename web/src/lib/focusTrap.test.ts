import { describe, expect, it } from "vitest";

import { trappedFocusIndex } from "@/lib/focusTrap";

describe("trappedFocusIndex", () => {
  it("wraps Tab from the last control to the first", () => {
    expect(trappedFocusIndex(2, 1, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    expect(trappedFocusIndex(2, 0, true)).toBe(1);
  });

  // Safari's default keyboard setting skips buttons on Tab, so a move the
  // browser made itself left a buttons-only dialog. The trap moves every time.
  it("moves between inner controls itself instead of leaving it to the browser", () => {
    expect(trappedFocusIndex(3, 0, false)).toBe(1);
    expect(trappedFocusIndex(3, 1, false)).toBe(2);
    expect(trappedFocusIndex(3, 2, true)).toBe(1);
    expect(trappedFocusIndex(3, 1, true)).toBe(0);
  });

  it("pulls focus that escaped the dialog back in", () => {
    expect(trappedFocusIndex(2, -1, false)).toBe(0);
    expect(trappedFocusIndex(2, -1, true)).toBe(1);
  });

  it("keeps a single control focused", () => {
    expect(trappedFocusIndex(1, 0, false)).toBe(0);
    expect(trappedFocusIndex(1, 0, true)).toBe(0);
  });

  it("does nothing for a dialog without focusable controls", () => {
    expect(trappedFocusIndex(0, -1, false)).toBeNull();
  });
});
