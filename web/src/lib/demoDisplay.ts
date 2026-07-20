export type DemoDisplayMasker = {
  hideDemoMetadata: boolean;
  fileName: (value: string) => string;
  participantId: (value: string) => string;
  timezone: (value: string) => string;
  text: (value: string, exactValues?: readonly string[]) => string;
};

const DEMO_DISPLAY_STORAGE_KEY = "chronicle.demoDisplay.v1";

const DATETIME_RE = /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const LOCALE_DATE_RE =
  /\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*,?\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/g;

function createLabeler(prefix: string) {
  let nextId = 1;
  const map = new Map<string, string>();
  return (value: string) => {
    const key = value.trim();
    if (!key) return value;
    let label = map.get(key);
    if (!label) {
      label = `${prefix} ${String(nextId).padStart(2, "0")}`;
      map.set(key, label);
      nextId += 1;
    }
    return label;
  };
}

function replaceExactAll(source: string, value: string, replacement: string): string {
  if (!value) return source;
  if (!source.includes(value)) return source;
  let cursor = 0;
  let next = source;
  while (next.includes(value)) {
    const at = next.indexOf(value, cursor);
    if (at < 0) break;
    next = `${next.slice(0, at)}${replacement}${next.slice(at + value.length)}`;
    cursor = at + replacement.length;
  }
  return next;
}

function createDateTimeMasker() {
  const dateLabel = createLabeler("Date");
  return (value: string) => value
    .replace(DATETIME_RE, (match) => `${dateLabel(match)} ${match.includes("T") ? "TS" : ""}`.trimEnd())
    .replace(LOCALE_DATE_RE, (match) => dateLabel(match))
    .replace(DATE_RE, (match) => dateLabel(match));
}

export function readDemoDisplayEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DEMO_DISPLAY_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as unknown;
    return Boolean((parsed as Record<string, unknown>)?.hideDemoMetadata);
  } catch {
    return false;
  }
}

export function persistDemoDisplayEnabled(hideDemoMetadata: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_DISPLAY_STORAGE_KEY, JSON.stringify({ hideDemoMetadata }));
  } catch {
    // Private mode/locked storage: keep feature non-persistent, but functional.
  }
}

export function createDemoDisplayMasker(hideDemoMetadata: boolean): DemoDisplayMasker {
  if (!hideDemoMetadata) {
    return {
      hideDemoMetadata: false,
      fileName: (value) => value,
      participantId: (value) => value,
      timezone: (value) => value,
      text: (value) => value,
    };
  }

  const fileLabel = createLabeler("File");
  const participantLabel = createLabeler("Participant");
  const timezoneLabel = createLabeler("Timezone");
  const dateLabeler = createDateTimeMasker();

  return {
    hideDemoMetadata: true,
    fileName(value) {
      const key = value.trim();
      if (!key) return value;
      const dot = key.lastIndexOf(".");
      const ext = dot > 0 ? key.slice(dot) : "";
      const base = dot > 0 ? key.slice(0, dot) : key;
      return `${fileLabel(base)}${ext}`;
    },
    participantId: participantLabel,
    timezone: timezoneLabel,
    text(value, exactValues = []) {
      let next = value;
      const uniqueValues = Array.from(new Set(exactValues)).filter((entry) => entry.trim().length > 0);
      uniqueValues.sort((left, right) => right.length - left.length);
      for (const exact of uniqueValues) {
        next = replaceExactAll(next, exact, this.fileName(exact));
      }
      return dateLabeler(next);
    },
  };
}
