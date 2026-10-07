import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DIAGNOSTICS_STORAGE_KEY,
  MAX_RECORDED_ERRORS,
  browserDiagnosticGlobals,
  collectDiagnosticEnvironment,
  formatDiagnosticReport,
  installGlobalErrorRecorder,
  onErrorRecorded,
  recentErrors,
  recordError,
  redactDiagnosticText,
  resetRecordedErrors,
  setSensitiveNames,
  type DiagnosticGlobals,
} from "@/lib/diagnostics";

class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.values.size;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const BUILD = { appVersion: "1.2.3", buildSha: "abc1234", buildDate: "2026-10-03" };

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal("localStorage", store);
  resetRecordedErrors();
  setSensitiveNames([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRecordedErrors();
  setSensitiveNames([]);
});

describe("redactDiagnosticText", () => {
  it("removes data-file names, quoted values, timestamps and long numbers", () => {
    expect(
      redactDiagnosticText(
        'row 4 of P07_raw.csv: "com.example.private" at 2024-05-01 10:00:00 for id 12345678',
      ),
    ).toBe("row 4 of <file>: <value> at <datetime> for id <number>");
    expect(redactDiagnosticText("no data here (404)")).toBe("no data here (404)");
    expect(redactDiagnosticText("lost reading com.example.chat for v1.0.0")).toBe("lost reading <name> for v1.0.0");
  });

  it("removes the open files' names whole, spaces included, and their stems", () => {
    setSensitiveNames(["Participant 07 export.csv", "  ", "ab.csv"]);
    expect(redactDiagnosticText("Participant 07 export failed; see Participant 07 export.csv"))
      .toBe("<file> failed; see <file>");
    // A stem shorter than three characters is too common a word to remove.
    expect(redactDiagnosticText("ab failed")).toBe("ab failed");
  });

  it("removes participant ids the runtime writes unquoted", () => {
    expect(redactDiagnosticText("duplicate notification ID 12 for participant TECH0042"))
      .toBe("duplicate notification ID 12 for participant <id>");
    expect(redactDiagnosticText("for participant P1, and participant_id=alice;"))
      .toBe("for participant <id>, and participant_id=<id>;");
    expect(redactDiagnosticText("participant={P07};day=3")).toBe("participant=<id>};day=3");
    // Any other word mixing letters and digits is taken as an identifier.
    expect(redactDiagnosticText("row for TECH0042 and P07a")).toBe("row for <id> and <id>");
    // Ordinary words around the label stay readable.
    expect(redactDiagnosticText("participant has no rows")).toBe("participant has no rows");
  });

  it("removes a repeated-download file name and a value after an apostrophe", () => {
    expect(redactDiagnosticText("could not read P0042_raw (1).csv")).toBe("could not read <file>");
    expect(redactDiagnosticText("column doesn't match 'TECH0042'")).toBe("column doesn't match <value>");
  });
});

describe("recordError", () => {
  it("keeps the newest entries, redacted, in this tab and in localStorage", () => {
    const listener = vi.fn();
    const stop = onErrorRecorded(listener);
    const error = new TypeError('cannot read "P01" of Raw P01.csv');
    error.stack = 'TypeError: cannot read "P01" of Raw P01.csv\n    at parse (https://host/assets/index-abc.js:1:234567)';
    const entry = recordError("error", error, "processing Raw P01.csv");
    stop();
    recordError("background", "second");

    expect(entry).toMatchObject({
      source: "error",
      name: "TypeError",
      message: "cannot read <value> of Raw <file>",
      context: "processing Raw <file>",
    });
    // A frame keeps its script position; only the text before it is redacted.
    expect(entry.stack).toBe(
      "TypeError: cannot read <value> of Raw <file>\n    at parse (https://host/assets/index-abc.js:1:234567)",
    );
    expect(listener).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(store.getItem(DIAGNOSTICS_STORAGE_KEY) ?? "[]") as unknown[];
    expect(stored).toHaveLength(2);
    resetRecordedErrors();
    expect(recentErrors().map((recorded) => recorded.message)).toEqual([
      "cannot read <value> of Raw <file>",
      "second",
    ]);
  });

  it("keeps stack frames verbatim and redacts every other stack line", () => {
    const error = new Error("read at 2026-03-07 10:00:00");
    error.stack = [
      "Error: read at 2026-03-07 10:00:00",
      "parse@https://host/assets/index-abc.js:1:234567",
      "    at Object.read (https://host/assets/index-abc.js:2:3)",
      // Safari names top-level module and script code with a space.
      "module code@https://host/assets/App-B4x9Qz1.js:2:123",
      "global code@https://host/assets/index-abc.js:1:5",
      "@debugger eval code:1:1 with com.example.chat",
    ].join("\n");
    expect(recordError("error", error).stack).toBe([
      "Error: read at <datetime>",
      "parse@https://host/assets/index-abc.js:1:234567",
      "    at Object.read (https://host/assets/index-abc.js:2:3)",
      "module code@https://host/assets/App-B4x9Qz1.js:2:123",
      "global code@https://host/assets/index-abc.js:1:5",
      "@debugger eval code:1:1 with <name>",
    ].join("\n"));
  });

  it("is bounded and clips long text", () => {
    for (let index = 0; index < MAX_RECORDED_ERRORS + 5; index += 1) recordError("error", `e${index}`);
    const log = recentErrors();
    expect(log).toHaveLength(MAX_RECORDED_ERRORS);
    expect(log[0]?.message).toBe("e5");
    expect(recordError("error", "x".repeat(600)).message).toMatch(/^x{500}… \[100 more characters\]$/);
  });

  it("describes non-Error values by type, never by content", () => {
    expect(recordError("unhandledrejection", { participant: "P01", row: [1, 2] }).message)
      .toBe("a object was thrown ([object Object])");
    expect(recordError("unhandledrejection", undefined).message).toBe("undefined");
    expect(recordError("error", null).name).toBe("Error");
    const nameless = new Error("plain");
    nameless.name = "";
    nameless.stack = "";
    const recorded = recordError("error", nameless);
    expect(recorded.name).toBe("Error");
    expect("stack" in recorded).toBe(false);
  });

  it("keeps working in this tab when storage is full, blocked or garbled", () => {
    store.failWrites = true;
    expect(() => recordError("error", "full")).not.toThrow();
    expect(recentErrors()).toHaveLength(1);

    resetRecordedErrors();
    store.failWrites = false;
    store.setItem(DIAGNOSTICS_STORAGE_KEY, "{not json");
    expect(recentErrors()).toEqual([]);
    store.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify([{ at: 1 }, { at: "t", source: "error", name: "E", message: "kept" }, null]));
    resetRecordedErrors();
    expect(recentErrors().map((entry) => entry.message)).toEqual(["kept"]);

    resetRecordedErrors();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(recentErrors()).toEqual([]);
    resetRecordedErrors();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });
    expect(() => recordError("error", "blocked")).not.toThrow();
    expect(recentErrors()).toHaveLength(1);
    expect(browserDiagnosticGlobals().localStorageAvailable).toBe(false);
  });
});

describe("installGlobalErrorRecorder", () => {
  it("records uncaught errors and unhandled rejections until removed", () => {
    const target = new EventTarget();
    const remove = installGlobalErrorRecorder(target);
    const errorEvent = Object.assign(new Event("error"), {
      error: new RangeError("bad range"),
      message: "bad range",
      filename: "https://host/assets/index.js",
      lineno: 1,
      colno: 2,
    });
    target.dispatchEvent(errorEvent);
    target.dispatchEvent(Object.assign(new Event("error"), { error: undefined, message: "Script error.", filename: "" }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("lost promise") }));
    remove();
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "after removal" }));

    expect(recentErrors().map(({ source, message, context }) => ({ source, message, context }))).toEqual([
      { source: "error", message: "bad range", context: "https://host/assets/index.js:1:2" },
      { source: "error", message: "Script error.", context: undefined },
      { source: "unhandledrejection", message: "lost promise", context: undefined },
    ]);
  });
});

describe("diagnostic report", () => {
  const globals = (overrides: Partial<DiagnosticGlobals> = {}): DiagnosticGlobals => ({
    navigator: {
      userAgent: "TestBrowser/1",
      language: "en-GB",
      hardwareConcurrency: 8,
      deviceMemory: 4,
      onLine: true,
      serviceWorker: { controller: {} },
      storage: {
        estimate: () => Promise.resolve({ usage: 10 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
        persisted: () => Promise.resolve(true),
        getDirectory: () => undefined,
      },
    },
    isSecureContext: true,
    crossOriginIsolated: false,
    indexedDB: {},
    FileSystemFileHandle: { prototype: { createSyncAccessHandle: () => undefined } },
    localStorageAvailable: true,
    ...overrides,
  });

  it("reports the build, browser, storage and recorded errors", async () => {
    const environment = await collectDiagnosticEnvironment(BUILD, globals());
    recordError("render", new Error("render failed"), "App");
    const report = formatDiagnosticReport(environment, recentErrors(), "2026-10-03T00:00:00.000Z");
    expect(report).toContain("Version: 1.2.3+abc1234");
    expect(report).toContain("User agent: TestBrowser/1");
    expect(report).toContain("Used: 10.0 MiB of 100.0 MiB");
    expect(report).toContain("Protected from eviction: yes");
    expect(report).toContain("Origin-private file system: yes");
    expect(report).toContain("Sync access handles: yes");
    expect(report).toContain("Cross-origin isolated: no");
    expect(report).toContain("Recent errors (1)");
    expect(report).toMatch(/1\. \S+ \[render\] Error: render failed\n {5}while: App\n {5}Error: render failed/);
  });

  it("says unknown for every capability a browser does not expose", async () => {
    const failing = globals({
      navigator: {
        storage: {
          estimate: () => Promise.reject(new Error("denied")),
        },
      },
      isSecureContext: undefined,
      crossOriginIsolated: undefined,
      indexedDB: undefined,
      FileSystemFileHandle: undefined,
      localStorageAvailable: false,
    });
    const environment = await collectDiagnosticEnvironment(BUILD, failing);
    const report = formatDiagnosticReport({ ...environment, buildDate: "" }, [], "now");
    expect(report).toContain("Build date: unknown");
    expect(report).toContain("User agent: unknown");
    expect(report).toContain("Logical cores: unknown");
    expect(report).toContain("Device memory: unknown");
    expect(report).toContain("Online: unknown");
    expect(report).toContain("Used: unknown of unknown");
    expect(report).toContain("Protected from eviction: unknown");
    expect(report).toContain("Offline copy (service worker) in control: unknown");
    expect(report).toContain("IndexedDB: no");
    expect(report).toContain("none recorded");
    const bare = await collectDiagnosticEnvironment(BUILD, { localStorageAvailable: true });
    expect(bare.storage.originPrivateFileSystem).toBe(false);
  });

  it("reads the real page globals", () => {
    vi.stubGlobal("navigator", { userAgent: "Real/1" });
    const read = browserDiagnosticGlobals();
    expect(read.navigator?.userAgent).toBe("Real/1");
    expect(read.localStorageAvailable).toBe(true);
    expect(store.getItem(`${DIAGNOSTICS_STORAGE_KEY}.probe`)).toBeNull();
    store.failWrites = true;
    expect(browserDiagnosticGlobals().localStorageAvailable).toBe(false);
    vi.stubGlobal("localStorage", undefined);
    expect(browserDiagnosticGlobals().localStorageAvailable).toBe(false);
  });
});
