import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const artifactMode = process.argv[2] ?? "cloudflare";

const sharedRequiredFiles = ["index.html", "manifest.webmanifest", "sw.js", ".vite/manifest.json"];

const cloudflareRequiredFiles = ["_headers", ...sharedRequiredFiles];
const cloudflareRequiredHeaderSnippets = [
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

function getArtifactDir(mode: string): string {
  if (mode === "github-pages") {
    return path.join(webDir, ".github-pages-dist");
  }
  return path.join(webDir, "dist");
}

async function main(): Promise<void> {
  const artifactDir = getArtifactDir(artifactMode);
  const requiredFiles = artifactMode === "github-pages" ? [".nojekyll", ...sharedRequiredFiles] : cloudflareRequiredFiles;

  for (const relativePath of requiredFiles) {
    await access(path.join(artifactDir, relativePath));
  }

  const indexHtml = await readFile(path.join(artifactDir, "index.html"), "utf-8");
  const metaCspMatch = indexHtml.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  );
  if (!metaCspMatch) {
    throw new Error(`${path.basename(artifactDir)}/index.html is missing the CSP meta tag fallback`);
  }

  if (artifactMode === "github-pages") {
    try {
      await access(path.join(artifactDir, "_headers"));
      throw new Error("GitHub Pages artifact should not contain Cloudflare-only _headers");
    } catch (error) {
      if (!(error instanceof Error) || !/should not contain/.test(error.message)) {
        // File correctly absent.
      } else {
        throw error;
      }
    }
  } else {
    const headersText = await readFile(path.join(artifactDir, "_headers"), "utf-8");
    for (const snippet of cloudflareRequiredHeaderSnippets) {
      if (!headersText.includes(snippet)) {
        throw new Error(`${path.basename(artifactDir)}/_headers is missing required snippet: ${snippet}`);
      }
    }

    const cspMatch = headersText.match(/Content-Security-Policy: ([^\n]+)/);
    if (!cspMatch) {
      throw new Error(`${path.basename(artifactDir)}/_headers does not contain a Content-Security-Policy rule`);
    }
    const headersCsp = cspMatch[1].trim();
    const metaCsp = metaCspMatch[1].trim();
    if (headersCsp !== metaCsp) {
      throw new Error(
        `CSP mismatch between ${path.basename(artifactDir)}/_headers and ${path.basename(artifactDir)}/index.html\nheaders: ${headersCsp}\nmeta: ${metaCsp}`,
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: artifactMode,
        artifactDir,
        verifiedFiles: requiredFiles,
      },
      null,
      2,
    ),
  );
}

await main();
