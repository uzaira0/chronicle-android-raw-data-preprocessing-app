import { readFile, writeFile } from "node:fs/promises";
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

/**
 * Generates dist/favicon.ico (ICO containing the PNG image) at build time so
 * browsers' automatic GET /favicon.ico requests resolve instead of 404-ing.
 * The format is a single-image Vista-style ICO that embeds a PNG payload.
 */
function faviconIcoPlugin(): Plugin {
  return {
    name: "chronicle-favicon-ico",
    apply: "build",
    async closeBundle() {
      const png = await readFile(new URL("./public/icon-192.png", import.meta.url));
      const header = Buffer.from([0, 0, 1, 0, 1, 0]);
      // ICONDIRENTRY: bytes 0-3 (width=0→256, height=0→256, colorCount=0, reserved=0)
      // are already zero from Buffer.alloc; only the numeric fields need explicit writes.
      const entry = Buffer.alloc(16);
      entry.writeUInt16LE(1, 4); // planes
      entry.writeUInt16LE(32, 6); // bit depth
      entry.writeUInt32LE(png.length, 8); // PNG size
      entry.writeUInt32LE(6 + 16, 12); // PNG offset in file
      await writeFile(new URL("./dist/favicon.ico", import.meta.url), Buffer.concat([header, entry, png]));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), devCspPlugin(), faviconIcoPlugin()],
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
