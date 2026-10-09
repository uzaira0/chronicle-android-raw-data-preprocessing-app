import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  mergeStoredSettingsChange,
  migrateSavedOptionSet,
  migrateStoredOptions,
  PRESETS_STORAGE_KEY,
  readConfigFile,
  readPersistedPresets,
  readStoredPresetLibrary,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEY,
  storedReceiptsChanged,
} from "@/lib/settingsPersistence";

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

/** Values that were the shipped defaults until 2026-07-15 (93cc84cc). */
const OLD_DEFAULTS = { useFilterFile: true, minimumUsageDuration: 0, proximityIntervalSeconds: 0 };
const MIGRATED = {
  useFilterFile: DEFAULT_BROWSER_OPTIONS.useFilterFile,
  minimumUsageDuration: DEFAULT_BROWSER_OPTIONS.minimumUsageDuration,
  proximityIntervalSeconds: DEFAULT_BROWSER_OPTIONS.proximityIntervalSeconds,
};
/** Also the default until 2026-08-28 (f7553c5c, settings v13). */
const OLD_TIMEZONE = { timezoneHandling: "selected-filter" } as const;

describe("active-settings envelope migration", () => {
  it("drops superseded defaults below v12 and keeps every value from v12 on", () => {
    expect(migrateStoredOptions(OLD_DEFAULTS, 11)).toMatchObject(MIGRATED);
    expect(migrateStoredOptions(OLD_DEFAULTS, 12)).toMatchObject(OLD_DEFAULTS);
    expect(migrateStoredOptions("not options", 0)).toEqual(DEFAULT_BROWSER_OPTIONS);
  });
});

describe("saved option sets (presets, projects, exported configs)", () => {
  const saved = { ...OLD_DEFAULTS, ...OLD_TIMEZONE };

  it("drops a value only when it was still the default on the day it was saved", () => {
    // Before 2026-07-15 all four were the defaults of the day.
    expect(migrateSavedOptionSet(saved, { savedAt: "2026-07-01T12:00:00.000Z" }))
      .toMatchObject({ ...MIGRATED, timezoneHandling: DEFAULT_BROWSER_OPTIONS.timezoneHandling });
    // Between the two changes the first three were deliberate choices.
    expect(migrateSavedOptionSet(saved, { savedAt: "2026-08-01T12:00:00.000Z" }))
      .toMatchObject({ ...OLD_DEFAULTS, timezoneHandling: DEFAULT_BROWSER_OPTIONS.timezoneHandling });
    // After both every value was chosen.
    expect(migrateSavedOptionSet(saved, { savedAt: "2026-09-02T12:00:00.000Z" })).toMatchObject(saved);
    // A save time in another offset is compared as an instant.
    expect(migrateSavedOptionSet(saved, { savedAt: "2026-07-15T00:30:00-05:00" }).useFilterFile)
      .toBe(DEFAULT_BROWSER_OPTIONS.useFilterFile);
    expect(migrateSavedOptionSet(saved, { savedAt: "2026-07-15T00:40:00-05:00" }).useFilterFile).toBe(true);
  });

  it("lets a version written after a change settle it, and the save time split v1", () => {
    // v11 was only ever written after 2026-07-15, whatever date it carries.
    expect(migrateSavedOptionSet(saved, { schemaVersion: 11, savedAt: "2026-07-01T00:00:00.000Z" }))
      .toMatchObject({ ...OLD_DEFAULTS, timezoneHandling: DEFAULT_BROWSER_OPTIONS.timezoneHandling });
    expect(migrateSavedOptionSet(saved, { schemaVersion: 13 })).toMatchObject(saved);
    expect(migrateSavedOptionSet(saved, { schemaVersion: 1, savedAt: "2026-07-01T00:00:00.000Z" })).toMatchObject(MIGRATED);
    expect(migrateSavedOptionSet(saved, { schemaVersion: 1, savedAt: "2026-07-20T00:00:00.000Z" })).toMatchObject(OLD_DEFAULTS);
    // A version below the change and no usable time: it was the default.
    expect(migrateSavedOptionSet(saved, { schemaVersion: 1, savedAt: "garbled" })).toMatchObject(MIGRATED);
    // Neither: kept as saved rather than guessed at.
    expect(migrateSavedOptionSet(saved, {})).toMatchObject(saved);
  });

  // User ruling 2026-10-09: when minimum usage became a cleaning step (default
  // 60 → 0), saved presets, projects and configs holding 60 move to 0 too;
  // anything saved by a v16+ build keeps the value it holds.
  it("moves a saved 60 s minimum usage to 0 unless a v16+ build saved it", () => {
    const sixty = { ...DEFAULT_BROWSER_OPTIONS, minimumUsageDuration: 60, proximityIntervalSeconds: 5 };
    expect(DEFAULT_BROWSER_OPTIONS.minimumUsageDuration).toBe(0);
    for (const saved of [
      { schemaVersion: 15, savedAt: "2026-10-01T00:00:00.000Z" },
      // An old build still open after the deploy saves v15 with a later time.
      { schemaVersion: 15, savedAt: "2027-01-01T00:00:00.000Z" },
      { schemaVersion: 15 },
      { savedAt: "2026-09-01T00:00:00.000Z" },
    ]) {
      const migrated = migrateSavedOptionSet(sixty, saved);
      expect(migrated.minimumUsageDuration, JSON.stringify(saved)).toBe(0);
      expect(migrated.proximityIntervalSeconds).toBe(5);
    }
    expect(migrateSavedOptionSet(sixty, { schemaVersion: 16, savedAt: "2026-10-01T00:00:00.000Z" })
      .minimumUsageDuration).toBe(60);
    expect(migrateSavedOptionSet({ ...sixty, minimumUsageDuration: 45 }, { schemaVersion: 15 })
      .minimumUsageDuration).toBe(45);
    expect(migrateStoredOptions({ ...sixty }, 11).minimumUsageDuration).toBe(0);
  });

  it("migrates each stored preset by its own version or save time and rewrites the library stamped", () => {
    const store = installStorage();
    store.set(PRESETS_STORAGE_KEY, JSON.stringify({
      // The library's version is re-stamped by every preset action, so it is
      // not when any one preset was written.
      schemaVersion: 14,
      presets: [
        { id: "a", name: "Saved in June", updatedAt: "2026-06-01T00:00:00.000Z", options: OLD_DEFAULTS },
        { id: "b", name: "Saved in August", updatedAt: "2026-08-01T00:00:00.000Z", options: OLD_DEFAULTS },
        { id: "c", name: "Versioned", schemaVersion: SETTINGS_SCHEMA_VERSION, updatedAt: "2026-06-01T00:00:00.000Z", options: OLD_DEFAULTS },
      ],
    }));

    const [june, august, versioned] = readPersistedPresets();

    expect(june?.options).toMatchObject(MIGRATED);
    expect(august?.options).toMatchObject(OLD_DEFAULTS);
    expect(versioned?.options).toMatchObject(OLD_DEFAULTS);
    const rewritten = JSON.parse(store.get(PRESETS_STORAGE_KEY) ?? "{}") as {
      presets: Array<{ schemaVersion: number; updatedAt: string }>;
    };
    expect(rewritten.presets.map((preset) => preset.schemaVersion)).toEqual([
      SETTINGS_SCHEMA_VERSION,
      SETTINGS_SCHEMA_VERSION,
      SETTINGS_SCHEMA_VERSION,
    ]);
    // The save time is the preset's, not the migration's.
    expect(rewritten.presets[0]?.updatedAt).toBe("2026-06-01T00:00:00.000Z");
    // Reading the rewritten library again changes nothing.
    const before = store.get(PRESETS_STORAGE_KEY);
    expect(readPersistedPresets()).toHaveLength(3);
    expect(store.get(PRESETS_STORAGE_KEY)).toBe(before);
  });

  it("reads the oldest bare-array preset library by each preset's save time", () => {
    const store = installStorage();
    store.set(PRESETS_STORAGE_KEY, JSON.stringify([
      { id: "a", name: "Bare", updatedAt: "2026-06-01T00:00:00.000Z", options: OLD_DEFAULTS },
      "junk",
    ]));
    expect(readPersistedPresets()[0]?.options.useFilterFile).toBe(DEFAULT_BROWSER_OPTIONS.useFilterFile);
  });

  it("migrates an imported config by the version and time it was exported", async () => {
    const file = (schemaVersion: number, exportedAt: string) => new File([JSON.stringify({
      schemaVersion,
      exportedAt,
      currentSettings: { ...OLD_DEFAULTS },
      presets: [{ id: "p", name: "P", updatedAt: exportedAt, options: OLD_DEFAULTS }],
    })], "config.json");
    const june = await readConfigFile(file(1, "2026-06-01T00:00:00.000Z"));
    expect(june.options).toMatchObject(MIGRATED);
    expect(june.presets[0]?.options).toMatchObject(MIGRATED);
    const august = await readConfigFile(file(11, "2026-08-20T00:00:00.000Z"));
    expect(august.options).toMatchObject(OLD_DEFAULTS);
    expect(august.presets[0]).toMatchObject({ schemaVersion: SETTINGS_SCHEMA_VERSION, options: OLD_DEFAULTS });
  });
});

describe("cross-tab settings merge", () => {
  const envelope = (options: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, savedAt: "t", options, ...extra });

  it("takes exactly what the other tab changed and keeps this tab's other options", () => {
    // This tab has an unsaved-elsewhere edit (studyName) the other tab's
    // write does not touch; the other tab changed only minimumUsageDuration.
    const local = { ...DEFAULT_BROWSER_OPTIONS, studyName: "TAB-A-STUDY", proximityIntervalSeconds: 9 };
    const merged = mergeStoredSettingsChange(
      local,
      envelope({ studyName: "TAB-A-STUDY" }),
      envelope({ studyName: "TAB-A-STUDY", minimumUsageDuration: 15 }),
    );
    expect(merged).toMatchObject({ studyName: "TAB-A-STUDY", proximityIntervalSeconds: 9, minimumUsageDuration: 15 });
    expect(merged).not.toBe(local);

    // An option the other tab changed overrides this tab's value for it.
    expect(mergeStoredSettingsChange(local, envelope({ studyName: "TAB-A-STUDY" }), envelope({ studyName: "TAB-B" })))
      .toMatchObject({ studyName: "TAB-B", proximityIntervalSeconds: 9 });
  });

  it("returns this tab's own object when the write changes nothing for it", () => {
    const local = { ...DEFAULT_BROWSER_OPTIONS, minimumUsageDuration: 15 };
    const same = envelope({ minimumUsageDuration: 15 });
    expect(mergeStoredSettingsChange(local, envelope({}), same)).toBe(local);
    // A first write by another tab is read against the defaults.
    expect(mergeStoredSettingsChange(local, null, same)).toBe(local);
  });

  it("ignores a removal or an unreadable write", () => {
    expect(mergeStoredSettingsChange(DEFAULT_BROWSER_OPTIONS, envelope({}), null)).toBeNull();
    expect(mergeStoredSettingsChange(DEFAULT_BROWSER_OPTIONS, envelope({}), "{garbled")).toBeNull();
    // An unreadable previous value is read as the defaults.
    expect(mergeStoredSettingsChange(DEFAULT_BROWSER_OPTIONS, "{garbled", envelope({ minimumUsageDuration: 7 })))
      .toMatchObject({ minimumUsageDuration: 7 });
    // A bare (pre-envelope) options object is the oldest format, v0.
    expect(mergeStoredSettingsChange(DEFAULT_BROWSER_OPTIONS, null, JSON.stringify({ minimumUsageDuration: 7 })))
      .toMatchObject({ minimumUsageDuration: 7 });
  });

  it("merges the maximum-duration selection as one set", () => {
    const vector = {
      longDurationThresholdHoursExplicit: true,
      maximumDurationPolicy: "post_reconstruction_strict_max_v1",
      maximumDurationDisposition: "drop_row",
      maximumDurationThresholdSource: "fixed_parameter",
      maximumDurationThresholdNs: "9223372036854775807",
    };
    const local = { ...DEFAULT_BROWSER_OPTIONS };
    // The other tab chose the set: it arrives whole.
    expect(mergeStoredSettingsChange(local, envelope({}), envelope(vector))).toMatchObject(vector);
    // The other tab changed only the disposition: the whole set is its set,
    // never this tab's policy mixed with the other tab's disposition.
    const mine = { ...local, ...vector, maximumDurationThresholdNs: "3600000000000" } as typeof local;
    expect(mergeStoredSettingsChange(mine, envelope(vector), envelope({ ...vector, maximumDurationDisposition: "truncate_to_threshold" })))
      .toMatchObject({ ...vector, maximumDurationDisposition: "truncate_to_threshold" });
    // The other tab cleared the set: it leaves whole.
    const removed = mergeStoredSettingsChange({ ...local, ...vector } as typeof local, envelope(vector), envelope({}));
    for (const key of Object.keys(vector).filter((key) => key !== "longDurationThresholdHoursExplicit")) {
      expect(removed?.[key as keyof typeof local]).toBeUndefined();
    }
  });

  it("notices a change of the stored method receipts", () => {
    const receipt = { methodProfileReceipts: { android: { methodProfileId: "x" } } };
    expect(storedReceiptsChanged(envelope({}), envelope({}, receipt))).toBe(true);
    expect(storedReceiptsChanged(envelope({}, receipt), envelope({ studyName: "x" }, receipt))).toBe(false);
    expect(storedReceiptsChanged(null, envelope({}))).toBe(false);
    expect(storedReceiptsChanged("{garbled", envelope({}))).toBe(true);
    expect(storedReceiptsChanged(JSON.stringify([1]), envelope({}))).toBe(false);
  });
});

describe("readStoredPresetLibrary", () => {
  it("reads the library as stored, and null where a read-modify-write has no base", () => {
    expect(readStoredPresetLibrary()).toBeNull();
    const store = installStorage();
    expect(readStoredPresetLibrary()).toEqual([]);
    store.set(PRESETS_STORAGE_KEY, "{garbled");
    expect(readStoredPresetLibrary()).toBeNull();
    store.set(PRESETS_STORAGE_KEY, JSON.stringify({ something: "else" }));
    expect(readStoredPresetLibrary()).toBeNull();
    store.set(PRESETS_STORAGE_KEY, JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, presets: [{ id: "a", name: "A", schemaVersion: SETTINGS_SCHEMA_VERSION, options: {} }] }));
    expect(readStoredPresetLibrary()?.map((preset) => preset.name)).toEqual(["A"]);
    expect(SETTINGS_STORAGE_KEY).toBe("chronicle.processingOptions.v1");
  });
});
