import { execSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
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

/**
 * Vite emits module workers (the matcher's `chronicle-worker-*.js`) and their
 * WASM as a SEPARATE sub-build whose outputs never land in `manifest.json`. The
 * service worker precaches by walking that manifest, so those chunks were never
 * cached — a first processing run while offline could not load the worker and
 * hung silently. After the whole build is on disk, scan `dist` for every emitted
 * JS/CSS/WASM file and write a supplementary precache list the SW also loads.
 */
function precacheExtraPlugin(): Plugin {
  return {
    name: "chronicle-precache-extra",
    apply: "build",
    closeBundle() {
      const outDir = resolve(__dirname, "dist");
      // Vite builds module workers as a SEPARATE Rollup sub-build, so closeBundle
      // can fire once on the worker bundle (before the main app chunks + index.html
      // exist) and again on the main bundle. Only write once the build is COMPLETE
      // — gated on index.html being present — so a partial, worker-only scan can
      // never become the final artifact regardless of sub-build ordering.
      if (!existsSync(resolve(outDir, "index.html"))) {
        return;
      }
      const files: string[] = [];
      const walk = (dir: string, base: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const rel = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(resolve(dir, entry.name), rel);
          } else if (/\.(js|css|wasm)$/.test(entry.name) && rel !== "sw.js") {
            // Exclude sw.js — it's already in the SW's own SHELL_URLS; listing it
            // here too would double-cache the service worker on install.
            files.push(`./${rel}`);
          }
        }
      };
      walk(outDir, "");
      writeFileSync(resolve(outDir, "sw-precache-extra.json"), JSON.stringify(files.sort()));
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD.sha),
    __BUILD_DATE__: JSON.stringify(BUILD.date),
  },
  plugins: [react(), devCspPlugin(), precacheExtraPlugin()],
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
