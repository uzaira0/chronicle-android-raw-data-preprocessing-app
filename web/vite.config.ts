import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { packedJsonAssetsPlugin } from "./scripts/packed_json_assets.mjs";
import { thirdPartyNoticesPlugins } from "./scripts/third_party_notices.mjs";

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
 * Test builds only (`npm run build:test`, used by the Playwright web server
 * and the browser benchmarks): honour `window.__CHRONICLE_TEST_RUNTIME__` and
 * `__CHRONICLE_BENCHMARK_PAYLOAD_BUDGET_BYTES__` (src/lib/testHooks.ts). Every
 * other build, including `npm run build:app` in the deploy workflow, compiles
 * both reads out of the bundle.
 */
const TEST_HOOKS = process.env.CHRONICLE_E2E_TEST_HOOKS === "1";
const thirdPartyNotices = thirdPartyNoticesPlugins(resolve(__dirname));
const dependencyCampaignPackage = process.env.CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR;
if (dependencyCampaignPackage && process.env.VITEST !== "true") {
  throw new Error(
    "CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR is allowed only in Vitest dependency campaigns",
  );
}

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
 * A test build says so in index.html, so the e2e helpers can tell a build
 * that honours the injected runtime from a deployed one (the canary runs the
 * smoke suite against the live site) without probing the bundle.
 */
function testHooksMarkerPlugin(): Plugin {
  return {
    name: "chronicle-test-hooks-marker",
    transformIndexHtml(html) {
      if (!TEST_HOOKS) return html;
      return html.replace(
        "</head>",
        '    <meta name="chronicle-test-hooks" content="on" />\n  </head>',
      );
    },
  };
}

/**
 * Vite emits module workers (the matcher's `chronicle-worker-*.js`) and their
 * WASM as a SEPARATE sub-build whose outputs never land in `manifest.json`. The
 * service worker precaches by walking that manifest, so those chunks were never
 * cached — a first processing run while offline could not load the worker and
 * hung silently. After the whole build is on disk, scan `dist` for every emitted
 * JS/CSS/WASM/packed-JSON file and write a supplementary precache list the SW
 * also loads, including lossless payloads used only by the worker sub-build.
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
          } else if (/\.(js|css|wasm|json\.pack)$/.test(entry.name) && rel !== "sw.js") {
            // Exclude sw.js — it's already in the SW's own SHELL_URLS; listing it
            // here too would double-cache the service worker on install.
            files.push(`./${rel}`);
          }
        }
      };
      walk(outDir, "");
      writeFileSync(resolve(outDir, "sw-precache-extra.json"), JSON.stringify(files.sort()));
      // `public/sw.js` is copied verbatim, so its bytes never changed between
      // deploys: the browser's byte-compare update check never fired, a
      // returning user never re-ran the precache, and old caches were never
      // dropped. Stamping the cache name with the build makes every deploy a
      // new service worker whose `activate` purges the previous cache.
      const swPath = resolve(outDir, "sw.js");
      const sw = readFileSync(swPath, "utf8");
      const stamped = sw.replace(
        /^const CACHE_NAME = "chronicle-local-shell-v3";/,
        `const CACHE_NAME = "chronicle-local-shell-v3-${BUILD.sha}";`,
      );
      if (stamped === sw && !sw.includes(`-${BUILD.sha}"`)) {
        throw new Error("sw.js: CACHE_NAME literal not found, the build stamp was not applied");
      }
      writeFileSync(swPath, stamped);
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD.sha),
    __BUILD_DATE__: JSON.stringify(BUILD.date),
    __CHRONICLE_TEST_HOOKS__: JSON.stringify(TEST_HOOKS),
  },
  plugins: [
    react(),
    devCspPlugin(),
    testHooksMarkerPlugin(),
    packedJsonAssetsPlugin(resolve(__dirname)),
    precacheExtraPlugin(),
    ...thirdPartyNotices.main,
  ],
  resolve: {
    alias: [
      ...(dependencyCampaignPackage
        ? [
            {
              find: "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js",
              replacement: resolve(
                dependencyCampaignPackage,
                "chronicle_preprocessing_runtime_wasm.js",
              ),
            },
          ]
        : []),
      { find: "@", replacement: resolve(__dirname, "./src") },
    ],
  },
  worker: {
    format: "es",
    plugins: () => [packedJsonAssetsPlugin(resolve(__dirname)), thirdPartyNotices.worker()],
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
