import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  buildConfigExportBlob,
  hasPersistedOptions,
  persistOptions,
  persistPresets,
  readConfigFile,
  readPersistedOptions,
  readPersistedPresets,
  readSharedConfig,
  sanitizeOptions,
} from "@/lib/settingsPersistence";

/** Minimal in-memory localStorage — same surface the module touches. */
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

describe("sanitizeOptions", () => {
  it("keeps typed values and drops mistyped ones per key family", () => {
    const next = sanitizeOptions({
      processAppUsage: false, // boolean kept
      processScreenUsage: "yes", // mistyped → default
      minimumUsageDuration: 45, // number kept
      proximityIntervalSeconds: Number.NaN, // non-finite → default
      selectedTimezone: "America/Chicago", // string kept
      studyName: 7, // mistyped → default
      parallelMaxWorkers: "6", // optionalPositiveInteger coerces
    });
    expect(next.processAppUsage).toBe(false);
    expect(next.processScreenUsage).toBe(DEFAULT_BROWSER_OPTIONS.processScreenUsage);
    expect(next.minimumUsageDuration).toBe(45);
    expect(next.proximityIntervalSeconds).toBe(DEFAULT_BROWSER_OPTIONS.proximityIntervalSeconds);
    expect(next.selectedTimezone).toBe("America/Chicago");
    expect(next.studyName).toBe(DEFAULT_BROWSER_OPTIONS.studyName);
    expect(next.parallelMaxWorkers).toBe(6);
  });

  it("floors positive parallelMaxWorkers, rejects zero/negative/empty", () => {
    expect(sanitizeOptions({ parallelMaxWorkers: 2.9 }).parallelMaxWorkers).toBe(2);
    expect(sanitizeOptions({ parallelMaxWorkers: 0 }).parallelMaxWorkers).toBeUndefined();
    expect(sanitizeOptions({ parallelMaxWorkers: -3 }).parallelMaxWorkers).toBeUndefined();
    expect(sanitizeOptions({ parallelMaxWorkers: "" }).parallelMaxWorkers).toBeUndefined();
  });

  it("converts the legacy usageSessionMode enum when the booleans are absent", () => {
    expect(sanitizeOptions({ usageSessionMode: "screen_usage" })).toMatchObject({
      processAppUsage: false,
      processScreenUsage: true,
    });
    expect(sanitizeOptions({ usageSessionMode: "app_usage" })).toMatchObject({
      processAppUsage: true,
      processScreenUsage: false,
    });
    // Explicit booleans win over the legacy enum.
    expect(
      sanitizeOptions({ usageSessionMode: "screen_usage", processAppUsage: true }),
    ).toMatchObject({ processAppUsage: true });
  });

  it("filters remap entries whose target is not a canonical interaction type", () => {
    const next = sanitizeOptions({
      interactionTypeRemap: [
        "Notification Interruption=>Activity Paused",
        "Whatever=>Not A Real Type",
      ],
    });
    expect(next.interactionTypeRemap).toEqual(["Notification Interruption=>Activity Paused"]);
  });

  it("returns pure defaults for a non-record input", () => {
    expect(sanitizeOptions(null)).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
    expect(sanitizeOptions("junk")).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
  });

  it("falls back to the default number-array when every entry is non-finite", () => {
    // A number-array key whose supplied entries all coerce to NaN yields an empty
    // filtered array, so sanitizeOptions restores the default rather than [].
    const next = sanitizeOptions({ longUsageDurationThresholds: ["x", "y", "z"] });
    expect(next.longUsageDurationThresholds).toEqual(
      DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds,
    );
    expect(next.longUsageDurationThresholds.length).toBeGreaterThan(0);
  });
});

describe("persisted options round-trip (window stubbed)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips options through localStorage and unwraps the envelope", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    expect(hasPersistedOptions()).toBe(false);
    persistOptions({ ...DEFAULT_BROWSER_OPTIONS, minimumUsageDuration: 77 });
    expect(hasPersistedOptions()).toBe(true);
    expect(readPersistedOptions().minimumUsageDuration).toBe(77);
  });

  it("falls back to defaults on corrupt JSON and on storage throws", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    store.set("chronicle.processingOptions.v1", "{not json");
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });

    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: throwing });
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
    expect(hasPersistedOptions()).toBe(false);
    expect(() => persistOptions(DEFAULT_BROWSER_OPTIONS)).not.toThrow();
    expect(readPersistedPresets()).toEqual([]);
    expect(() => persistPresets([])).not.toThrow();
  });

  it("reads a legacy un-enveloped options object stored without the {options} wrapper", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    // A plain options object (no "options" key) is returned as-is by unwrapOptions.
    store.set("chronicle.processingOptions.v1", JSON.stringify({ minimumUsageDuration: 88 }));
    expect(readPersistedOptions().minimumUsageDuration).toBe(88);
  });

  it("returns defaults for a stored non-record payload (array/primitive)", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    // A stored JSON array is not a record → unwrapOptions returns it verbatim →
    // sanitizeOptions treats a non-record as {} → pure defaults.
    store.set("chronicle.processingOptions.v1", JSON.stringify([1, 2, 3]));
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
  });

  it("returns defaults when nothing is persisted yet (present window, empty store)", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    // getItem returns null → the !raw guard short-circuits to defaults.
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
    expect(readPersistedPresets()).toEqual([]);
  });

  it("mints ids/names/timestamps for persisted presets missing those fields", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    // A bare preset object (no id/name/createdAt/updatedAt) exercises every
    // fallback arm in readPersistedPresets' mapping.
    store.set(
      "chronicle.processingPresets.v1",
      JSON.stringify({ presets: [{ options: { minimumUsageDuration: 5 } }] }),
    );
    const read = readPersistedPresets();
    expect(read).toHaveLength(1);
    expect(read[0].id).toBeTruthy();
    expect(read[0].name).toBe("Imported preset");
    expect(read[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(read[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("round-trips presets and sanitizes malformed entries", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    persistPresets([
      {
        id: "p1",
        name: "My preset",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        options: { ...DEFAULT_BROWSER_OPTIONS, minimumUsageDuration: 12 },
      },
    ]);
    const read = readPersistedPresets();
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ id: "p1", name: "My preset" });

    const { storage: storage2, store: store2 } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage2 });
    store2.set("chronicle.processingPresets.v1", JSON.stringify({ presets: "nope" }));
    expect(readPersistedPresets()).toEqual([]);
  });

  it("without a window, reads return defaults and writes are no-ops", () => {
    // vitest node env has no window global by default.
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
    expect(hasPersistedOptions()).toBe(false);
    expect(() => persistOptions(DEFAULT_BROWSER_OPTIONS)).not.toThrow();
    expect(readPersistedPresets()).toEqual([]);
    expect(() => persistPresets([])).not.toThrow();
  });
});

describe("config export / import / shared URL", () => {
  it("exports an envelope readConfigFile can round-trip, sanitizing on the way in", async () => {
    const blob = buildConfigExportBlob(
      { ...DEFAULT_BROWSER_OPTIONS, minimumUsageDuration: 33 },
      [
        {
          id: "p1",
          name: "P",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          options: { ...DEFAULT_BROWSER_OPTIONS, proximityIntervalSeconds: 9 },
        },
      ],
    );
    const file = new File([await blob.text()], "config.json", { type: "application/json" });
    const imported = await readConfigFile(file);
    expect(imported.options.minimumUsageDuration).toBe(33);
    expect(imported.presets).toHaveLength(1);
    expect(imported.presets[0].options.proximityIntervalSeconds).toBe(9);
  });

  it("imports malformed preset entries with generated ids and default names", async () => {
    const file = new File(
      [JSON.stringify({ currentSettings: {}, presets: [{ options: {} }, "junk"] })],
      "config.json",
    );
    const imported = await readConfigFile(file);
    expect(imported.presets).toHaveLength(1);
    expect(imported.presets[0].name).toBe("Imported preset");
    expect(imported.presets[0].id).toBeTruthy();
  });

  it("returns empty presets when the imported config's presets field is not an array", async () => {
    // source.presets present but not an array → sanitizePresets returns [].
    const file = new File(
      [JSON.stringify({ currentSettings: { minimumUsageDuration: 21 }, presets: "nope" })],
      "config.json",
    );
    const imported = await readConfigFile(file);
    expect(imported.options.minimumUsageDuration).toBe(21);
    expect(imported.presets).toEqual([]);
  });

  it("treats a non-record top-level config document as empty", async () => {
    // A JSON array (or any non-object) at the top level → source falls back to {}
    // → default options and no presets, rather than throwing.
    const file = new File([JSON.stringify([1, 2, 3])], "config.json");
    const imported = await readConfigFile(file);
    expect(imported.options).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
    expect(imported.presets).toEqual([]);
  });

  it("readSharedConfig returns null for absent or invalid search params", () => {
    expect(readSharedConfig("")).toBeNull();
    expect(readSharedConfig("?cfg=%%%broken")).toBeNull();
  });

  it("readSharedConfig returns null when URL parsing throws", () => {
    // Force the parse step to throw so the defensive catch (return null) runs.
    vi.stubGlobal(
      "URLSearchParams",
      class {
        constructor() {
          throw new Error("boom");
        }
      },
    );
    expect(readSharedConfig("?config=anything")).toBeNull();
    vi.unstubAllGlobals();
  });
});
