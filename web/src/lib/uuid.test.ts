import { afterEach, describe, expect, it, vi } from "vitest";

import { safeUuid } from "@/lib/uuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safeUuid", () => {
  it("uses crypto.randomUUID when available", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
      getRandomValues: real.getRandomValues.bind(real),
    });
    expect(safeUuid()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("falls back to getRandomValues when randomUUID is undefined (non-secure context)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      randomUUID: undefined,
      getRandomValues: real.getRandomValues.bind(real),
    });
    expect(safeUuid()).toMatch(UUID_V4);
  });

  it("produces distinct ids on repeated fallback calls", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      randomUUID: undefined,
      getRandomValues: real.getRandomValues.bind(real),
    });
    expect(safeUuid()).not.toBe(safeUuid());
  });
});
