import { describe, expect, it } from "vitest";

import { createDemoDisplayMasker } from "@/lib/demoDisplay";

describe("demoDisplay date masking", () => {
  it("masks ISO-8601 datetime strings with timezone suffixes", () => {
    const masker = createDemoDisplayMasker(true);
    expect(masker.text("Session at 2026-06-08T14:22:33.500Z is event")).toBe(
      "Session at Date 01 TS is event",
    );
  });

  it("masks locale weekday + month label dates shown in waterfall row labels", () => {
    const masker = createDemoDisplayMasker(true);
    expect(masker.text("Tue, Jun 08, 2026 · 00:00 → 01:00")).toBe("Date 01 · 00:00 → 01:00");
  });
});
