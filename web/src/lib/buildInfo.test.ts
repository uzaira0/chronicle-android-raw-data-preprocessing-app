import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("build identity", () => {
  it("uses the build-time commit and date when Vite provides them", async () => {
    vi.stubGlobal("__BUILD_SHA__", "abc1234");
    vi.stubGlobal("__BUILD_DATE__", "2026-07-21");
    vi.resetModules();

    const build = await import("@/lib/buildInfo");
    expect(build.BUILD_SHA).toBe("abc1234");
    expect(build.BUILD_DATE).toBe("2026-07-21");
    expect(build.BUILD_LABEL).toBe("abc1234 (2026-07-21)");
  });

  it("falls back to a development identity when build defines are absent", async () => {
    vi.resetModules();
    const build = await import("@/lib/buildInfo");
    expect(build.BUILD_SHA).toBe("dev");
    expect(build.BUILD_DATE).toBe("");
    expect(build.BUILD_LABEL).toBe("dev");
  });
});
