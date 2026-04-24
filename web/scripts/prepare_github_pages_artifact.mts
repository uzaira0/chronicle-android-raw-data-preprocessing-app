import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const distDir = path.join(webDir, "dist");
const githubPagesDistDir = path.join(webDir, ".github-pages-dist");

async function main(): Promise<void> {
  await rm(githubPagesDistDir, { recursive: true, force: true });
  await mkdir(githubPagesDistDir, { recursive: true });
  await cp(distDir, githubPagesDistDir, { recursive: true });

  await rm(path.join(githubPagesDistDir, "_headers"), { force: true });
  await writeFile(path.join(githubPagesDistDir, ".nojekyll"), "", "utf-8");

  const indexHtml = await readFile(path.join(githubPagesDistDir, "index.html"), "utf-8");
  if (!indexHtml.includes('http-equiv="Content-Security-Policy"')) {
    throw new Error("GitHub Pages artifact is missing the CSP meta tag fallback in index.html");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        source: distDir,
        output: githubPagesDistDir,
      },
      null,
      2,
    ),
  );
}

await main();
