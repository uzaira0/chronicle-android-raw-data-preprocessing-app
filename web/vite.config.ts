import { execSync } from "node:child_process";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Build identity stamped into the bundle at build time (footer + plot subtitles),
 * so the deployed app shows the actual commit + date and updates every deploy.
 * Evaluated when Vite loads this config (build, dev, test). Falls back to "dev"
 * when git is unavailable so non-repo builds still work.
 */
function buildIdentity(): { sha: string; date: string } {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { sha: sha || "dev", date };
  } catch {
    return { sha: "dev", date };
  }
}
const BUILD = buildIdentity();

/**
 * In dev mode Vite injects CSS via HMR-managed <style> blocks and inline
 * style mutations, which the production CSP ('style-src self') rejects.
 * This plugin relaxes the CSP <meta> tag *only* when Vite is running in
 * `serve` mode so local development works without touching the production
 * asset headers. Production builds keep the strict CSP as authored.
 */
function devCspPlugin(): Plugin {
  return {
    name: "chronicle-dev-csp",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace(
          /style-src 'self'/g,
          "style-src 'self' 'unsafe-inline'",
        );
      },
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD.sha),
    __BUILD_DATE__: JSON.stringify(BUILD.date),
  },
  plugins: [react(), devCspPlugin()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: "dist",
    target: "esnext",
    manifest: true,
    // The default 4 KB inline limit turns the small filter and keep-awake
    // default CSVs into data: URIs. Production CSP forbids `connect-src
    // data:`, so a `fetch()` against the inlined URI fails. Emit every
    // asset as a separate file instead.
    assetsInlineLimit: 0,
  },
});
