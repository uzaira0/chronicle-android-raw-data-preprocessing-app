import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/canonicalJson";

describe("canonicalJson", () => {
  it("uses JSON null semantics for values JSON.stringify cannot represent", () => {
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("matches native serde_jcs raw UTF-16 ordering recursively without locale collation", () => {
    // These bytes were emitted by the runtime's locked serde_jcs 0.2.0.
    // U+10000 and U+1F600 sort by their surrogate code units before U+E000.
    const input = Object.fromEntries(
      ["formula", "V", "a", "A", "é", "ö", "\uE000", "\u{10000}", "😀", "2", "10"]
        .map((key) => [key, 1]),
    );
    const native = '{"10":1,"2":1,"A":1,"V":1,"a":1,"formula":1,"é":1,"ö":1,"𐀀":1,"😀":1,"\uE000":1}';
    expect(canonicalJson(input)).toBe(native);
    expect(canonicalJson({ nested: [input, { formula: "T", V: "capacity" }] }))
      .toBe(`{"nested":[${native},{"V":"capacity","formula":"T"}]}`);
  });

  it("retains native JCS number formatting and array order", () => {
    expect(canonicalJson([1.0, -0.0, 1e-7, 1e21]))
      .toBe("[1,0,1e-7,1e+21]");
  });
});
