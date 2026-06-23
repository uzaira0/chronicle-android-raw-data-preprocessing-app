/**
 * Read the origin's storage usage so the UI can warn before a write fails. The
 * in-browser pipeline persists results, projects, and a cached last run to
 * IndexedDB; on a full disk those writes throw `QuotaExceededError` and, left
 * unchecked, can wedge the next boot. A heads-up at high usage lets a researcher
 * export a backup and free space first.
 */

export type StoragePressure = {
  /** Bytes used by this origin (0 when unknown). */
  usage: number;
  /** Bytes the browser will grant this origin (0 when unknown). */
  quota: number;
  /** usage / quota in [0,1] (0 when unknown). */
  ratio: number;
  /** Whether the browser reported a usable estimate. */
  supported: boolean;
};

/** Warn at/above this fraction of quota. */
export const STORAGE_PRESSURE_THRESHOLD = 0.8;

type StorageManagerLike = { estimate?: () => Promise<{ usage?: number; quota?: number }> };

export async function estimateStoragePressure(): Promise<StoragePressure> {
  const empty: StoragePressure = { usage: 0, quota: 0, ratio: 0, supported: false };
  if (typeof navigator === "undefined") return empty;
  const storage = (navigator as Navigator & { storage?: StorageManagerLike }).storage;
  if (!storage?.estimate) return empty;
  try {
    const { usage = 0, quota = 0 } = await storage.estimate();
    const ratio = quota > 0 ? usage / quota : 0;
    return { usage, quota, ratio, supported: true };
  } catch {
    return empty;
  }
}

/** True when usage is at/above the warning threshold (and the estimate is real). */
export function isStoragePressureHigh(pressure: StoragePressure): boolean {
  return pressure.supported && pressure.quota > 0 && pressure.ratio >= STORAGE_PRESSURE_THRESHOLD;
}

type PersistManagerLike = {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
};

/**
 * Ask the browser to make this origin's storage persistent so the browser won't
 * silently evict saved projects + the cached run under disk pressure. Without
 * this, IndexedDB here is eviction-eligible best-effort storage. Idempotent and
 * best-effort: unsupported or denied just resolves `false`. Resolves to whether
 * storage is persistent afterwards.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  const storage = (navigator as Navigator & { storage?: PersistManagerLike }).storage;
  if (!storage?.persist) return false;
  try {
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Compact human size, e.g. 1.4 GB / 820 MB / 12 KB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}
