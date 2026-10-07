import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { MethodProfileReceipt } from "@/lib/types";

/**
 * Receipt validation reads registries that are loaded on demand, after the
 * first paint. Each case starts from a fresh settingsPersistence module, as a
 * page load does, so nothing is loaded until the code under test loads it.
 */
const RECEIPT: MethodProfileReceipt = {
  methodProfileId: "profile:paper:primary",
  sourceWorkId: "doi:paper",
  sourceMethodVariantId: "primary",
  sourceMethodVariantIds: ["primary"],
  methodProfileVersion: "v1",
  settingIds: ["setting:duration"],
  bindings: [{
    settingId: "setting:duration",
    slot: "minimum_usage_duration",
    value: 15,
    conformanceFixtureId: "fixture:paper:duration",
    conformanceResultDigest: `sha256:${"a".repeat(64)}`,
  }],
};
const OPTIONS = { ...DEFAULT_BROWSER_OPTIONS, minimumUsageDuration: 15 };

function installStorage(entries: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

async function freshPersistence() {
  vi.resetModules();
  return import("@/lib/settingsPersistence");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/methodReceiptValidation");
  vi.resetModules();
});

describe("receipt validation before its registries load", () => {
  it("refuses to validate a receipt instead of reading it as absent", async () => {
    const persistence = await freshPersistence();
    const settings = JSON.stringify({
      schemaVersion: persistence.SETTINGS_SCHEMA_VERSION,
      savedAt: "2026-10-03T00:00:00.000Z",
      options: { minimumUsageDuration: 15 },
      methodProfileReceipts: { android: RECEIPT },
    });
    const presets = JSON.stringify({
      schemaVersion: persistence.SETTINGS_SCHEMA_VERSION,
      presets: [{ id: "p", name: "P", schemaVersion: persistence.SETTINGS_SCHEMA_VERSION, options: { minimumUsageDuration: 15 }, methodProfileReceipt: RECEIPT }],
    });
    const store = installStorage({
      [persistence.SETTINGS_STORAGE_KEY]: settings,
      [persistence.PRESETS_STORAGE_KEY]: presets,
    });

    // Something that is not a receipt record needs no registry.
    expect(persistence.sanitizeMethodProfileReceipt(null)).toBeUndefined();
    expect(() => persistence.sanitizeMethodProfileReceipt(RECEIPT))
      .toThrow(persistence.MethodReceiptValidationNotLoadedError);
    // The readers' "unreadable data reads as none" fallbacks do not swallow it:
    // a dropped receipt would be erased by the next write.
    expect(() => persistence.readPersistedMethodProfileReceipts())
      .toThrow(persistence.MethodReceiptValidationNotLoadedError);
    expect(() => persistence.readPersistedPresets())
      .toThrow(persistence.MethodReceiptValidationNotLoadedError);
    expect(() => persistence.readStoredPresetLibrary())
      .toThrow(persistence.MethodReceiptValidationNotLoadedError);
    expect(() => persistence.persistOptions(OPTIONS, RECEIPT))
      .toThrow(persistence.MethodReceiptValidationNotLoadedError);
    expect(store.get(persistence.SETTINGS_STORAGE_KEY)).toBe(settings);
    expect(store.get(persistence.PRESETS_STORAGE_KEY)).toBe(presets);

    await persistence.loadMethodReceiptValidation();
    expect(persistence.readPersistedMethodProfileReceipts()).toEqual({ android: RECEIPT });
    expect(persistence.readPersistedPresets()[0]?.methodProfileReceipt).toEqual(RECEIPT);
  });

  it("says whether stored settings or presets hold a receipt to validate", async () => {
    const persistence = await freshPersistence();
    expect(persistence.storedDataHoldsMethodReceipt()).toBe(false);
    const store = installStorage();
    expect(persistence.storedDataHoldsMethodReceipt()).toBe(false);
    store.set(persistence.SETTINGS_STORAGE_KEY, JSON.stringify({ options: { minimumUsageDuration: 15 } }));
    expect(persistence.storedDataHoldsMethodReceipt()).toBe(false);
    store.set(persistence.PRESETS_STORAGE_KEY, JSON.stringify({ presets: [{ methodProfileReceipt: RECEIPT }] }));
    expect(persistence.storedDataHoldsMethodReceipt()).toBe(true);
    store.delete(persistence.PRESETS_STORAGE_KEY);
    store.set(persistence.SETTINGS_STORAGE_KEY, JSON.stringify({ methodProfileReceipts: { android: RECEIPT } }));
    expect(persistence.storedDataHoldsMethodReceipt()).toBe(true);
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); } } });
    expect(persistence.storedDataHoldsMethodReceipt()).toBe(false);
  });

  it("makes the preset library readable, loading the registries only when it holds a receipt", async () => {
    const persistence = await freshPersistence();
    const store = installStorage();
    await persistence.presetLibraryReadable();
    expect(() => persistence.sanitizeMethodProfileReceipt(RECEIPT)).toThrow(persistence.MethodReceiptValidationNotLoadedError);
    store.set(persistence.PRESETS_STORAGE_KEY, JSON.stringify({ presets: [{ id: "p", name: "P", options: {}, methodProfileReceipt: RECEIPT }] }));
    await persistence.presetLibraryReadable();
    expect(persistence.sanitizeMethodProfileReceipt(RECEIPT)).toEqual(RECEIPT);
  });

  it("answers input uses without the registries while no receipt is active", async () => {
    const persistence = await freshPersistence();
    expect(Object.values(persistence.methodReceiptInputUses([]))).toEqual([false, false, false, false, false, false]);
    expect(() => persistence.methodReceiptInputUses(["setting:duration"]))
      .toThrow(persistence.MethodReceiptValidationNotLoadedError);
    await persistence.loadMethodReceiptValidation();
    expect(persistence.methodReceiptInputUses(["setting:duration"]).anchorEvents).toBe(false);
  });

  it("retries a registry load that failed", async () => {
    vi.doMock("@/lib/methodReceiptValidation", () => {
      throw new Error("offline before the service worker cached it");
    });
    const persistence = await freshPersistence();
    // Vitest wraps a throwing mock factory in its own message.
    await expect(persistence.loadMethodReceiptValidation()).rejects.toThrow(/error when mocking/);
    expect(() => persistence.sanitizeMethodProfileReceipt(RECEIPT)).toThrow(persistence.MethodReceiptValidationNotLoadedError);
    vi.doUnmock("@/lib/methodReceiptValidation");
    await expect(persistence.loadMethodReceiptValidation()).resolves.toHaveProperty("validateMethodProfileReceiptRecord");
    expect(persistence.sanitizeMethodProfileReceipt(RECEIPT)).toEqual(RECEIPT);
  });

  it("reads another tab's receipts from its write, checked against that write's options", async () => {
    const persistence = await freshPersistence();
    await persistence.loadMethodReceiptValidation();
    const write = (options: Record<string, unknown>) => JSON.stringify({
      schemaVersion: persistence.SETTINGS_SCHEMA_VERSION,
      savedAt: "2026-10-03T00:00:00.000Z",
      options,
      methodProfileReceipts: { android: RECEIPT },
    });
    // Storage holds something else entirely (this tab's own later save).
    installStorage({ [persistence.SETTINGS_STORAGE_KEY]: JSON.stringify({ options: {} }) });
    expect(persistence.storedSettingsReceipts(write({ minimumUsageDuration: 15 }))).toEqual({ android: RECEIPT });
    // A receipt whose bound value the write's own options do not hold is not active.
    expect(persistence.storedSettingsReceipts(write({ minimumUsageDuration: 30 }))).toEqual({});
    expect(persistence.storedSettingsReceipts("{garbled")).toEqual({});
    expect(persistence.storedSettingsReceipts(null)).toEqual({});
  });

  it("loads the registries itself for a config import that carries a receipt", async () => {
    const persistence = await freshPersistence();
    const file = new File([JSON.stringify({
      schemaVersion: persistence.SETTINGS_SCHEMA_VERSION,
      currentSettings: { minimumUsageDuration: 15 },
      currentMethodProfileReceipt: RECEIPT,
      presets: [],
    })], "config.json");
    expect((await persistence.readConfigFile(file)).methodProfileReceipt).toEqual(RECEIPT);
  });

  it("loads the registries itself to save and load a project that carries a receipt", async () => {
    vi.resetModules();
    const projects = await import("@/lib/projectsStore");
    const { SETTINGS_SCHEMA_VERSION } = await import("@/lib/settingsPersistence");
    await projects.saveProject({
      id: "with-receipt",
      name: "With receipt",
      createdAt: "2026-10-03T00:00:00.000Z",
      updatedAt: "2026-10-03T00:00:00.000Z",
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      options: OPTIONS,
      methodProfileReceipt: RECEIPT,
      includesFiles: false,
      rawFileNames: [],
      rawFiles: [],
      supportFiles: {},
    });
    vi.resetModules();
    const reloaded = await import("@/lib/projectsStore");
    expect((await reloaded.loadProject("with-receipt"))?.methodProfileReceipt).toEqual(RECEIPT);
  });
});
