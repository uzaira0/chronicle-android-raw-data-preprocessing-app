import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/canonicalJson";

describe("canonicalJson", () => {
  it("uses JSON null semantics for values JSON.stringify cannot represent", () => {
    expect(canonicalJson(undefined)).toBe("null");
  });
});
