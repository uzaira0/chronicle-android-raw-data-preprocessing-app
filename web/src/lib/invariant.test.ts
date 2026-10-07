import { describe, expect, it } from "vitest";
import { requireDefined } from "./invariant";

describe("requireDefined", () => {
  it("returns a present value unchanged, including falsy ones", () => {
    const record = { a: 1 };
    expect(requireDefined(record, "record exists")).toBe(record);
    expect(requireDefined(0, "zero is present")).toBe(0);
    expect(requireDefined("", "empty string is present")).toBe("");
    expect(requireDefined(false, "false is present")).toBe(false);
  });

  it("throws an Error naming the invariant when the value is absent", () => {
    expect(() => requireDefined(undefined, "the table has key x")).toThrow(new Error("Invariant violated: the table has key x"));
    expect(() => requireDefined(null, "the row has an owner")).toThrow(new Error("Invariant violated: the row has an owner"));
  });
});
