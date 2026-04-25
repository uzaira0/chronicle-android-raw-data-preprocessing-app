import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

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
