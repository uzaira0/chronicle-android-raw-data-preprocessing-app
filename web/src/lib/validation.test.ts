import { describe, expect, it } from "vitest";

import { rangeError } from "@/lib/validation";

describe("rangeError", () => {
  it("rejects NaN with the enter-a-number message", () => {
    expect(rangeError(Number.NaN)).toBe("Enter a number");
    expect(rangeError(Number.NaN, 0, 10)).toBe("Enter a number");
  });

  it("names the full range when both bounds exist", () => {
    expect(rangeError(-1, 0, 10)).toBe("Enter a value between 0 and 10");
    expect(rangeError(11, 0, 10)).toBe("Enter a value between 0 and 10");
  });

  it("names the single violated bound when only one exists", () => {
    expect(rangeError(-1, 0)).toBe("Must be at least 0");
    expect(rangeError(11, undefined, 10)).toBe("Must be at most 10");
  });

  it("returns null inside the range, inclusive of the bounds", () => {
    expect(rangeError(0, 0, 10)).toBeNull();
    expect(rangeError(10, 0, 10)).toBeNull();
    expect(rangeError(5)).toBeNull();
  });
});
