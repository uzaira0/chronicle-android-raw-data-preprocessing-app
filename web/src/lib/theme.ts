/**
 * Light / dark / system theme handling. The resolved theme is applied as
 * `data-theme` on <html>; index.css defines the dark token overrides under
 * `:root[data-theme="dark"]`. Persisted to localStorage so it survives reloads,
 * and applied at boot (in main.tsx) before first paint to avoid a flash.
 */
export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "chronicle.theme.v1";

export function readTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // localStorage may be unavailable (private mode); fall through to default.
  }
  return "system";
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures — theme still applies for this session.
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveTheme(theme));
}
