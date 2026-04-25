import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import type { BrowserProcessingOptions } from "@/lib/types";

export type OptionKey = keyof BrowserProcessingOptions;

function arrayEquals(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function isOptionDefault<K extends OptionKey>(
  key: K,
  value: BrowserProcessingOptions[K],
): boolean {
  const fallback = DEFAULT_BROWSER_OPTIONS[key];
  if (Array.isArray(fallback) || Array.isArray(value)) {
    return arrayEquals(fallback ?? [], value ?? []);
  }
  // Treat undefined and the documented default as equivalent for optional fields.
  if (fallback === undefined && (value === undefined || value === "" || value === 0)) {
    return value === undefined || value === fallback || value === "" || value === 0;
  }
  return fallback === value;
}

export function anyOptionModified(
  options: BrowserProcessingOptions,
  keys: readonly OptionKey[],
): boolean {
  return keys.some((key) => !isOptionDefault(key, options[key]));
}

export function resetOption<K extends OptionKey>(
  options: BrowserProcessingOptions,
  key: K,
): BrowserProcessingOptions {
  return { ...options, [key]: DEFAULT_BROWSER_OPTIONS[key] } as BrowserProcessingOptions;
}
