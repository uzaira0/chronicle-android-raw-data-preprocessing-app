import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDemoDisplayMasker,
  persistDemoDisplayEnabled,
  readDemoDisplayEnabled,
} from "@/lib/demoDisplay";

describe("demoDisplay date masking", () => {
  it("masks ISO-8601 datetime strings with timezone suffixes", () => {
    const masker = createDemoDisplayMasker(true);
    expect(masker.text("Session at 2026-06-08T14:22:33.500Z is event")).toBe(
      "Session at Date 01 TS is event",
    );
  });

  it("masks locale weekday + month label dates shown in waterfall row labels", () => {
    const masker = createDemoDisplayMasker(true);
    expect(masker.text("Tue, Jun 08, 2026 · 00:00 → 01:00")).toBe(
      "Date 01 · 00:00 → 01:00",
    );
  });

  it("masks space-separated datetimes (no TS suffix), bare dates, and repeats stably", () => {
    const masker = createDemoDisplayMasker(true);
    expect(
      masker.text("seen 2026-03-02T10:00:00Z then 2026-03-02T10:00:00Z"),
    ).toBe("seen Date 01 TS then Date 01 TS");
    expect(masker.text("at 2026-03-02 10:00:00-06:00")).toBe("at Date 02");
    expect(masker.text("on 2026-04-01")).toBe("on Date 03");
    expect(masker.text("Monday, March 2, 2026 visit")).toBe("Date 04 visit");
  });
});

describe("demo display persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeLocalStorage(overrides: Partial<Storage> = {}) {
    const store = new Map<string, string>();
    return {
      store,
      storage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        ...overrides,
      } as unknown as Storage,
    };
  }

  it("round-trips the enabled flag through localStorage", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    expect(readDemoDisplayEnabled()).toBe(false);
    persistDemoDisplayEnabled(true);
    expect(readDemoDisplayEnabled()).toBe(true);
    persistDemoDisplayEnabled(false);
    expect(readDemoDisplayEnabled()).toBe(false);
  });

  it("treats corrupt JSON and throwing storage as disabled, and persist never throws", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    store.set("chronicle.demoDisplay.v1", "{not json");
    expect(readDemoDisplayEnabled()).toBe(false);

    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: throwing });
    expect(readDemoDisplayEnabled()).toBe(false);
    expect(() => persistDemoDisplayEnabled(true)).not.toThrow();
  });

  it("is inert without a window (node env default)", () => {
    expect(readDemoDisplayEnabled()).toBe(false);
    expect(() => persistDemoDisplayEnabled(true)).not.toThrow();
  });
});

describe("createDemoDisplayMasker", () => {
  it("is the identity when masking is off", () => {
    const masker = createDemoDisplayMasker(false);
    expect(masker.hideDemoMetadata).toBe(false);
    expect(masker.fileName("P01_raw.csv")).toBe("P01_raw.csv");
    expect(masker.participantId("P01")).toBe("P01");
    expect(masker.timezone("America/Chicago")).toBe("America/Chicago");
    expect(masker.text("2026-03-02 seen for P01")).toBe(
      "2026-03-02 seen for P01",
    );
  });

  it("assigns stable per-value labels and preserves file extensions", () => {
    const masker = createDemoDisplayMasker(true);
    expect(masker.fileName("P01_raw.csv")).toBe("File 01.csv");
    expect(masker.fileName("P01_raw.csv")).toBe("File 01.csv");
    expect(masker.fileName("P02_raw.xlsx")).toBe("File 02.xlsx");
    expect(masker.fileName("no_extension")).toBe("File 03");
    // A leading dot is not an extension separator.
    expect(masker.fileName(".env")).toBe("File 04");
    expect(masker.fileName("   ")).toBe("   ");
    expect(masker.participantId("P01")).toBe("Participant 01");
    expect(masker.participantId("P01")).toBe("Participant 01");
    expect(masker.participantId("P02")).toBe("Participant 02");
    expect(masker.timezone("America/Chicago")).toBe("Timezone 01");
    expect(masker.timezone("")).toBe("");
  });

  it("replaces exact values longest-first so substrings never clobber full names", () => {
    const masker = createDemoDisplayMasker(true);
    const out = masker.text("P01_raw.csv and P01_raw both seen", [
      "P01_raw",
      "P01_raw.csv",
      " ",
      "",
    ]);
    const fileFull = masker.fileName("P01_raw.csv");
    const fileBase = masker.fileName("P01_raw");
    expect(out).toBe(`${fileFull} and ${fileBase} both seen`);
    // No exact values → text passes straight to date masking only.
    expect(masker.text("plain text")).toBe("plain text");
    // An absent exact value is a no-op. A generated label that contains the
    // original word must terminate after one replacement, not loop forever.
    const edgeMasker = createDemoDisplayMasker(true);
    expect(edgeMasker.text("plain text", ["absent"])).toBe("plain text");
    expect(edgeMasker.text("File", ["File"])).toBe("File 02");
  });
});
