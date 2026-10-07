import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTheme, readTheme } from "@/lib/theme";

// public/theme-boot.js sets the theme before the app's JavaScript loads; the
// app then applies its own. Both must pick the same theme or the page flips.
const BOOT_SCRIPT = readFileSync(resolve(__dirname, "../../public/theme-boot.js"), "utf8");

/** A stored value, nothing stored, or a storage read that throws. */
type Saved = { value: string | null } | "throws";

function environment(saved: Saved, systemDark: boolean | "no-matchMedia") {
  const attributes = new Map<string, string>();
  const localStorage = {
    getItem: () => {
      if (saved === "throws") throw new DOMException("denied", "SecurityError");
      return saved.value;
    },
    setItem: () => undefined,
  };
  const window: Record<string, unknown> = {};
  if (systemDark !== "no-matchMedia") {
    window.matchMedia = (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && systemDark,
    });
  }
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
  };
  return { attributes, localStorage, window, document };
}

function bootTheme(saved: Saved, systemDark: boolean | "no-matchMedia"): string | undefined {
  const env = environment(saved, systemDark);
  runInNewContext(BOOT_SCRIPT, env);
  return env.attributes.get("data-theme");
}

function appTheme(saved: Saved, systemDark: boolean | "no-matchMedia"): string | undefined {
  const env = environment(saved, systemDark);
  vi.stubGlobal("localStorage", env.localStorage);
  vi.stubGlobal("window", env.window);
  vi.stubGlobal("document", env.document);
  applyTheme(readTheme());
  return env.attributes.get("data-theme");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme-boot.js", () => {
  const savedValues: Saved[] = [
    { value: null },
    { value: "light" },
    { value: "dark" },
    { value: "system" },
    { value: "bogus" },
    "throws",
  ];
  const systems = [true, false, "no-matchMedia"] as const;

  for (const saved of savedValues) {
    for (const systemDark of systems) {
      it(`matches applyTheme for saved=${saved === "throws" ? "throws" : String(saved.value)}, system dark=${String(systemDark)}`, () => {
        const boot = bootTheme(saved, systemDark);
        expect(boot === "light" || boot === "dark").toBe(true);
        expect(boot).toBe(appTheme(saved, systemDark));
      });
    }
  }

  it("follows a dark system when nothing is saved", () => {
    expect(bootTheme({ value: null }, true)).toBe("dark");
    expect(bootTheme({ value: null }, false)).toBe("light");
  });

  it("keeps a saved choice over the system theme", () => {
    expect(bootTheme({ value: "light" }, true)).toBe("light");
    expect(bootTheme({ value: "dark" }, false)).toBe("dark");
  });
});
