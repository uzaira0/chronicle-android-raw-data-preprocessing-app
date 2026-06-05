/**
 * App build identity, injected by Vite `define` (vite.config.ts) at build time
 * from the git commit + build date. Shown in the footer and plot subtitles so a
 * deployed build is identifiable and the stamp updates on every deploy. The
 * `typeof` guards keep this safe if a tool ever loads the module without the
 * defines applied (falls back to a "dev" identity instead of throwing).
 */
export const BUILD_SHA: string =
  typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev";

export const BUILD_DATE: string =
  typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "";

/** "sha (YYYY-MM-DD)", or just the sha when no date is available (dev). */
export const BUILD_LABEL: string = BUILD_DATE ? `${BUILD_SHA} (${BUILD_DATE})` : BUILD_SHA;
