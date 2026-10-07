/**
 * Local error log and the "Copy diagnostic report" text.
 *
 * Nothing here sends anything anywhere: the CSP allows no other origin, and
 * the report reaches a developer only when the user copies it and chooses to
 * share it. Errors are kept in this tab and, best effort, in localStorage (so a
 * failure that ends in a reload or the crash screen is still there to copy).
 * `resetLocalData` removes the stored copy with every other `chronicle*` key.
 *
 * Participant data must never enter the report. A run's data lives in files,
 * worker memory and OPFS; the only way any of it could reach this log is an
 * error message that quotes it. Every message and stack is therefore redacted
 * when it is recorded (`redactDiagnosticText`): data-file names, quoted
 * values, timestamps and long numbers are replaced before anything is kept.
 */

export const DIAGNOSTICS_STORAGE_KEY = "chronicle-web.diagnostics.v1";
export const MAX_RECORDED_ERRORS = 25;
const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 4000;

/** `shown`: an error the app reported to the user (error banner or toast). */
export type ErrorSource = "error" | "unhandledrejection" | "render" | "background" | "shown";

export type RecordedError = {
  at: string;
  source: ErrorSource;
  name: string;
  message: string;
  stack?: string;
  /** What the app was doing (redacted like the message). */
  context?: string;
};

// A data file name, including the " (1)" a browser adds to a repeated
// download. Names with spaces are covered by setSensitiveNames, which the app
// feeds every file name it sees.
const DATA_FILE_NAME =
  /[^\s"'`“”‘’()<>[\]{},;:/\\|]+(?: \(\d+\))?\.(?:csv|tsv|txt|xlsx|xls|json|parquet|sav|zip|gz|arrow|jsonld)\b/gi;
// A single quote opens a quoted value only where it is not an apostrophe
// inside a word ("doesn't").
const QUOTED = /"[^"\n]*"|(?<!\w)'[^'\n]*'|`[^`\n]*`|“[^”\n]*”|‘[^’\n]*’/g;
// The runtime names participants unquoted ("participant_id=P07",
// "participant={…}", "for participant P1"): the value after an = or : goes,
// and so does a word after "participant" that holds a digit ("participant
// has" stays readable).
const PARTICIPANT_ASSIGNED = /\b(participant(?:[ _]?id)?\s*[=:]\s*)(?!<)[^\s,;)\]}]+/gi;
const PARTICIPANT_NAMED = /\b(participant(?:[ _]?id)?\s+)(?!<)(?=[^\s,;)\]}]*\d)[^\s,;)\]}]+/gi;
// Any other word mixing letters and digits (TECH0042, P07a) is treated as an
// identifier; plain words and plain numbers stay readable.
const MIXED_IDENTIFIER = /\b(?=[A-Za-z_-]*\d)(?=[\d_-]*[A-Za-z])[A-Za-z0-9_-]{4,}\b/g;
const DATETIME = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;
const LONG_NUMBER = /\d{5,}/g;
// Dotted identifiers such as Android package names (com.example.app).
const DOTTED_NAME = /\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}\b/gi;
// A stack frame names the app's own code and script position, never data:
// V8 writes "    at fn (url:line:col)", Firefox and Safari "fn@url:line:col".
// Every other stack line (V8 opens with "Name: message") is redacted.
const STACK_FRAME = /^\s+at\s|^(?:[^\s@]*|(?:global|module|eval) code)@\S*:\d+:\d+$/;

let sensitiveNames: RegExp | null = null;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The names of the files currently open (raw and support files). Raw export
 * names usually carry a participant ID and can contain spaces, which the
 * file-name pattern alone would split, so each name and its stem (the name
 * without its extension, when at least three characters) is redacted whole.
 */
export function setSensitiveNames(names: readonly string[]): void {
  const terms = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    terms.add(trimmed);
    const stem = trimmed.replace(/\.[^.]+$/, "");
    if (stem.length >= 3) terms.add(stem);
  }
  sensitiveNames = terms.size
    ? new RegExp([...terms].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"), "gi")
    : null;
}

/** Replace anything in free text that could be participant data. */
export function redactDiagnosticText(text: string): string {
  return (sensitiveNames ? text.replace(sensitiveNames, "<file>") : text)
    .replace(DATA_FILE_NAME, "<file>")
    .replace(QUOTED, "<value>")
    .replace(DATETIME, "<datetime>")
    .replace(LONG_NUMBER, "<number>")
    .replace(DOTTED_NAME, "<name>")
    .replace(PARTICIPANT_ASSIGNED, "$1<id>")
    .replace(PARTICIPANT_NAMED, "$1<id>")
    .replace(MIXED_IDENTIFIER, "<id>");
}

function redactStack(stack: string): string {
  return stack
    .split("\n")
    .map((line) => (STACK_FRAME.test(line) ? line : redactDiagnosticText(line)))
    .join("\n");
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}… [${text.length - limit} more characters]` : text;
}

function describe(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  }
  if (typeof error === "string") return { name: "Error", message: error };
  if (error === undefined || error === null) return { name: "Error", message: String(error) };
  // A rejected non-Error (a plain object) is described by its type only:
  // serializing it could copy whatever data it carried.
  return { name: "NonError", message: `a ${typeof error} was thrown (${Object.prototype.toString.call(error)})` };
}

let recorded: RecordedError[] | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    // Reading `localStorage` itself throws where storage is blocked; the log
    // then lives in this tab only.
    return undefined;
  }
}

function isRecordedError(value: unknown): value is RecordedError {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.at === "string" && typeof entry.source === "string"
    && typeof entry.name === "string" && typeof entry.message === "string";
}

function loaded(): RecordedError[] {
  if (recorded) return recorded;
  recorded = [];
  const raw = (() => {
    try {
      return storage()?.getItem(DIAGNOSTICS_STORAGE_KEY) ?? null;
    } catch {
      // Blocked storage: start an in-tab log.
      return null;
    }
  })();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) recorded = parsed.filter(isRecordedError).slice(-MAX_RECORDED_ERRORS);
    } catch {
      // A garbled stored log is replaced by the next recorded error; it holds
      // diagnostics only, never user work.
    }
  }
  return recorded;
}

/** Record one error. Never throws: a broken logger must not add a failure. */
export function recordError(source: ErrorSource, error: unknown, context?: string): RecordedError {
  const { name, message, stack } = describe(error);
  const entry: RecordedError = {
    at: new Date().toISOString(),
    source,
    // Redaction runs on text already cut to a bound (a few times what is
    // kept, so a placeholder's shortening cannot leave the kept part short).
    name: clip(redactDiagnosticText(name.slice(0, 400)), 100),
    message: clip(redactDiagnosticText(message.slice(0, MAX_MESSAGE_CHARS * 4)), MAX_MESSAGE_CHARS),
    ...(stack ? { stack: clip(redactStack(stack.slice(0, MAX_STACK_CHARS * 4)), MAX_STACK_CHARS) } : {}),
    ...(context ? { context: clip(redactDiagnosticText(context.slice(0, MAX_MESSAGE_CHARS * 4)), MAX_MESSAGE_CHARS) } : {}),
  };
  const log = loaded();
  log.push(entry);
  if (log.length > MAX_RECORDED_ERRORS) log.splice(0, log.length - MAX_RECORDED_ERRORS);
  try {
    storage()?.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Full or blocked storage: the entry stays in this tab's log.
  }
  for (const listener of listeners) listener();
  return entry;
}

export function recentErrors(): readonly RecordedError[] {
  return [...loaded()];
}

/** Call `listener` after every recorded error; returns the unsubscribe. */
export function onErrorRecorded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget the in-memory log (tests, and after the stored copy is deleted). */
export function resetRecordedErrors(): void {
  recorded = null;
}

type ErrorTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * Record every uncaught error and unhandled rejection of the page. The
 * listeners only record: the browser's own console reporting is unchanged.
 */
export function installGlobalErrorRecorder(target: ErrorTarget): () => void {
  const onError = (event: ErrorEvent): void => {
    const where = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined;
    recordError("error", event.error ?? event.message, where);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    recordError("unhandledrejection", event.reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

export type DiagnosticEnvironment = {
  appVersion: string;
  buildSha: string;
  buildDate: string;
  userAgent: string;
  language: string;
  hardwareConcurrency: number | null;
  deviceMemoryGiB: number | null;
  online: boolean | null;
  secureContext: boolean | null;
  crossOriginIsolated: boolean | null;
  serviceWorkerControlled: boolean | null;
  storage: {
    usageBytes: number | null;
    quotaBytes: number | null;
    persisted: boolean | null;
    originPrivateFileSystem: boolean;
    syncAccessHandles: boolean;
    indexedDb: boolean;
    localStorage: boolean;
  };
};

type NavigatorLike = Partial<{
  userAgent: string;
  language: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  onLine: boolean;
  serviceWorker: { controller: unknown };
  storage: Partial<{
    estimate: () => Promise<{ usage?: number; quota?: number }>;
    persisted: () => Promise<boolean>;
    getDirectory: unknown;
  }>;
}>;

export type DiagnosticGlobals = {
  navigator?: NavigatorLike;
  isSecureContext?: boolean;
  crossOriginIsolated?: boolean;
  indexedDB?: unknown;
  FileSystemFileHandle?: { prototype: object };
  localStorageAvailable: boolean;
};

function localStorageWorks(): boolean {
  try {
    const store = storage();
    if (!store) return false;
    const probe = `${DIAGNOSTICS_STORAGE_KEY}.probe`;
    store.setItem(probe, "1");
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** The page's own globals, read defensively (any of them can be missing). */
export function browserDiagnosticGlobals(): DiagnosticGlobals {
  const scope = globalThis as unknown as Record<string, unknown>;
  return {
    navigator: scope.navigator as NavigatorLike | undefined,
    isSecureContext: scope.isSecureContext as boolean | undefined,
    crossOriginIsolated: scope.crossOriginIsolated as boolean | undefined,
    indexedDB: scope.indexedDB,
    FileSystemFileHandle: scope.FileSystemFileHandle as { prototype: object } | undefined,
    localStorageAvailable: localStorageWorks(),
  };
}

async function settle<T>(read: (() => Promise<T>) | undefined): Promise<T | null> {
  if (!read) return null;
  try {
    return await read();
  } catch {
    // An unreadable capability is reported as unknown, not as a failure.
    return null;
  }
}

export async function collectDiagnosticEnvironment(
  build: { appVersion: string; buildSha: string; buildDate: string },
  globals: DiagnosticGlobals = browserDiagnosticGlobals(),
): Promise<DiagnosticEnvironment> {
  const nav = globals.navigator ?? {};
  const store = nav.storage;
  // Calls stay inside settle(), so a capability that throws reads as unknown.
  const readEstimate = store?.estimate;
  const readPersisted = store?.persisted;
  const estimate = await settle(readEstimate ? () => readEstimate.call(store) : undefined);
  const persisted = await settle(readPersisted ? () => readPersisted.call(store) : undefined);
  return {
    ...build,
    userAgent: nav.userAgent ?? "unknown",
    language: nav.language ?? "unknown",
    hardwareConcurrency: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    deviceMemoryGiB: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    online: typeof nav.onLine === "boolean" ? nav.onLine : null,
    secureContext: typeof globals.isSecureContext === "boolean" ? globals.isSecureContext : null,
    crossOriginIsolated: typeof globals.crossOriginIsolated === "boolean" ? globals.crossOriginIsolated : null,
    serviceWorkerControlled: nav.serviceWorker ? Boolean(nav.serviceWorker.controller) : null,
    storage: {
      usageBytes: typeof estimate?.usage === "number" ? estimate.usage : null,
      quotaBytes: typeof estimate?.quota === "number" ? estimate.quota : null,
      persisted,
      originPrivateFileSystem: typeof store?.getDirectory === "function",
      syncAccessHandles: Boolean(
        globals.FileSystemFileHandle && "createSyncAccessHandle" in globals.FileSystemFileHandle.prototype,
      ),
      indexedDb: globals.indexedDB !== undefined && globals.indexedDB !== null,
      localStorage: globals.localStorageAvailable,
    },
  };
}

const yesNo = (value: boolean | null): string => (value === null ? "unknown" : value ? "yes" : "no");
const bytes = (value: number | null): string =>
  value === null ? "unknown" : `${(value / (1024 * 1024)).toFixed(1)} MiB`;

/**
 * The plain-text report the user copies. It holds the build, the browser, the
 * storage this app depends on, and the recorded errors — never settings,
 * file names, file contents or results.
 */
export function formatDiagnosticReport(
  environment: DiagnosticEnvironment,
  errors: readonly RecordedError[],
  generatedAt: string,
): string {
  const { storage: store } = environment;
  const lines = [
    "Chronicle Android Raw Data Preprocessor — diagnostic report",
    `Generated: ${generatedAt}`,
    "Contains no file names, file contents, settings or results.",
    "",
    "App",
    `  Version: ${environment.appVersion}+${environment.buildSha}`,
    `  Build date: ${environment.buildDate || "unknown"}`,
    "",
    "Browser",
    `  User agent: ${environment.userAgent}`,
    `  Language: ${environment.language}`,
    `  Logical cores: ${environment.hardwareConcurrency ?? "unknown"}`,
    `  Device memory: ${environment.deviceMemoryGiB === null ? "unknown" : `${environment.deviceMemoryGiB} GiB`}`,
    `  Online: ${yesNo(environment.online)}`,
    `  Secure context: ${yesNo(environment.secureContext)}`,
    `  Cross-origin isolated: ${yesNo(environment.crossOriginIsolated)}`,
    `  Offline copy (service worker) in control: ${yesNo(environment.serviceWorkerControlled)}`,
    "",
    "Storage",
    `  Used: ${bytes(store.usageBytes)} of ${bytes(store.quotaBytes)}`,
    `  Protected from eviction: ${yesNo(store.persisted)}`,
    `  Origin-private file system: ${yesNo(store.originPrivateFileSystem)}`,
    `  Sync access handles: ${yesNo(store.syncAccessHandles)}`,
    `  IndexedDB: ${yesNo(store.indexedDb)}`,
    `  localStorage: ${yesNo(store.localStorage)}`,
    "",
    `Recent errors (${errors.length})`,
  ];
  if (!errors.length) lines.push("  none recorded");
  for (const [index, entry] of errors.entries()) {
    lines.push(`  ${index + 1}. ${entry.at} [${entry.source}] ${entry.name}: ${entry.message}`);
    if (entry.context) lines.push(`     while: ${entry.context}`);
    if (entry.stack) {
      for (const frame of entry.stack.split("\n")) lines.push(`     ${frame}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
