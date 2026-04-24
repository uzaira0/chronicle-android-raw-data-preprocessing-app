import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const distDir = path.join(webDir, "dist");

const requiredFiles = [
  "_headers",
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  ".vite/manifest.json",
];

const requiredHeaderSnippets = [
  "Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; font-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy: same-origin",
  "Cross-Origin-Embedder-Policy: credentialless",
  "Cross-Origin-Resource-Policy: same-origin",
  "Origin-Agent-Cluster: ?1",
  "Referrer-Policy: no-referrer",
  "X-Content-Type-Options: nosniff",
  "X-Frame-Options: DENY",
  "Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), web-share=()",
  "Strict-Transport-Security: max-age=31536000; includeSubDomains",
  "/index.html",
  "Cache-Control: no-store",
  "/sw.js",
  "Cache-Control: no-cache, no-store, must-revalidate",
  "/manifest.webmanifest",
  "Cache-Control: no-cache",
  "/assets/*",
  "Cache-Control: public, max-age=31536000, immutable",
];

async function main(): Promise<void> {
  for (const relativePath of requiredFiles) {
    await access(path.join(distDir, relativePath));
  }

  const headersText = await readFile(path.join(distDir, "_headers"), "utf-8");
  for (const snippet of requiredHeaderSnippets) {
    if (!headersText.includes(snippet)) {
      throw new Error(`dist/_headers is missing required snippet: ${snippet}`);
    }
  }

  const cspMatch = headersText.match(/Content-Security-Policy: ([^\n]+)/);
  if (!cspMatch) {
    throw new Error("dist/_headers does not contain a Content-Security-Policy rule");
  }
  const headersCsp = cspMatch[1].trim();

  const indexHtml = await readFile(path.join(distDir, "index.html"), "utf-8");
  const metaCspMatch = indexHtml.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  );
  if (!metaCspMatch) {
    throw new Error("dist/index.html is missing the CSP meta tag fallback");
  }

  const metaCsp = metaCspMatch[1].trim();
  if (headersCsp !== metaCsp) {
    throw new Error(
      `CSP mismatch between dist/_headers and dist/index.html\nheaders: ${headersCsp}\nmeta: ${metaCsp}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        distDir,
        verifiedFiles: requiredFiles,
      },
      null,
      2,
    ),
  );
}

await main();
