import { useEffect, useState, type ReactElement } from "react";

import { applyTheme, persistTheme, readTheme, type Theme } from "@/lib/theme";

const OPTIONS: Array<{ value: Theme; label: string; icon: string }> = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "system", label: "System", icon: "🖥" },
];

/** Light / dark / system theme switch. Persists the choice and re-applies it
 * when the OS theme changes while in "system" mode. */
export function ThemeToggle(): ReactElement {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => applyTheme("system");
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [theme]);

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme" data-testid="theme-toggle">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`theme-toggle__btn${theme === option.value ? " is-active" : ""}`}
          aria-pressed={theme === option.value}
          title={`${option.label} theme`}
          data-testid={`theme-${option.value}`}
          onClick={() => setTheme(option.value)}
        >
          <span aria-hidden="true">{option.icon}</span>
          <span className="theme-toggle__label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
