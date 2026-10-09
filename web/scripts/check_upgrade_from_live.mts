/**
 * Upgrade check: what users do, not what a clean test browser does.
 *
 * Every processing option case (e2e/optionMatrix.ts) is processed first by the
 * build that is LIVE in production (proxied from the real site, so it is exactly
 * what users have) and then by this checkout's build (web/dist), in the same
 * browser profile at the same origin, so the second run finds the saved runs the
 * first one left in OPFS. Every case of the new build must process: a saved run
 * the new build cannot use may never stop a file (the 2026-10-09 outage, and the
 * same failure the Blue Light build would have shipped).
 *
 * Usage: vite-node scripts/check_upgrade_from_live.mts [--shards 4] [--live URL] [--new DIST]
 * Needs `npm run build:vite` first. Fails (exit 1) on any new-build failure.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "@playwright/test";

import { CASES, EXPECTED_REFUSALS, type Case } from "../e2e/optionMatrix";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_DIR = path.join(WEB_ROOT, ".tmp", "upgrade-check");
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1]! : fallback;
};
const NEW_BUILD = path.resolve(flag("--new", path.join(WEB_ROOT, "dist")));
const LIVE = flag("--live", "https://uzaira0.github.io/chronicle-android-raw-data-preprocessing-app/");
const SHARDS = Number(flag("--shards", "4"));
const LIVE_CACHE = path.join(WORK_DIR, "live");

const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".csv": "text/csv", ".txt": "text/plain",
};

/** One port per shard; `root` switches from the live proxy to the new build. */
function serve(port: number, state: { root: "live" | "new" }): Promise<Server> {
  const server = createServer(async (req, res) => {
    let rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    if (rel.split("/").includes("..")) return void res.writeHead(400).end();
    const dir = state.root === "new" ? NEW_BUILD : LIVE_CACHE;
    const file = path.join(dir, rel);
    try {
      if (state.root === "live" && !existsSync(file)) {
        const upstream = await fetch(new URL(rel, LIVE));
        if (!upstream.ok) return void res.writeHead(upstream.status).end();
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, Buffer.from(await upstream.arrayBuffer()));
      }
      const body = readFileSync(file);
      res.writeHead(200, {
        "content-type": TYPES[path.extname(rel)] ?? "application/octet-stream",
        "cache-control": "no-store",
      }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

/** Base fixture; case i drops data row i so every case has its own saved run. */
function fixtures(count: number): Buffer[] {
  mkdirSync(WORK_DIR, { recursive: true });
  const base = path.join(WORK_DIR, "base.csv");
  if (!existsSync(base)) {
    execFileSync(
      path.join(WEB_ROOT, "node_modules", ".bin", "vite-node"),
      ["scripts/generate_benchmark_fixture.mts", "--realistic", "--days", "2",
        "--rows-per-day", "300", "--seed", "4242", "--output", base],
      { cwd: WEB_ROOT, stdio: "ignore" },
    );
  }
  const lines = readFileSync(base, "utf-8").split("\n");
  return Array.from({ length: count }, (_, i) =>
    Buffer.from(lines.filter((_, at) => at !== 1 + (i % (lines.length - 2))).join("\n")),
  );
}

type Outcome = { ok: boolean; detail: string };

async function processCase(page: Page, origin: string, matrixCase: Case, file: Buffer, index: number): Promise<Outcome> {
  await page.goto(`${origin}/?config=${encodeURIComponent(JSON.stringify(matrixCase.diff))}`);
  await page.getByRole("heading", { name: /Chronicle Android Raw Data Preprocessor/ }).waitFor({ timeout: 60_000 });
  await page.getByTestId("raw-file-input").setInputFiles({ name: `case-${index}.csv`, mimeType: "text/csv", buffer: file });
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  const refusal = EXPECTED_REFUSALS[matrixCase.name];
  // The app keeps earlier results across reloads: match this case's own row.
  const row = page.getByTestId("result-row").filter({ hasText: `case-${index}.csv` });
  // The run summary ends "(N failed)" when a file is refused (App.tsx).
  const failedSummary = page.getByText(/\(\d+ failed\)/);
  const done = row.or(page.getByTestId("error-detail"))
    .or(page.getByTestId("raw-file-row-error")).or(failedSummary);
  await (refusal ? page.getByText(refusal).or(done) : done).first().waitFor({ timeout: 180_000 });
  await page.getByTestId("cancel-process-button").waitFor({ state: "detached", timeout: 180_000 });
  if (refusal && (await page.getByText(refusal).count()) > 0) return { ok: true, detail: "expected refusal" };
  const errors = await page.getByTestId("error-detail").or(page.getByTestId("raw-file-row-error"))
    .or(failedSummary).allInnerTexts();
  if (errors.length > 0) return { ok: false, detail: errors.join(" | ").slice(0, 400) };
  return { ok: (await row.count()) > 0, detail: "processed" };
}

async function shard(index: number, cases: { matrixCase: Case; at: number }[], files: Buffer[]) {
  const port = 4300 + index;
  const origin = `http://127.0.0.1:${port}`;
  const state: { root: "live" | "new" } = { root: "live" };
  const server = await serve(port, state);
  const profile = mkdtempSync(path.join(WORK_DIR, `profile-${index}-`));
  const failures: string[] = [];
  const liveFailures: string[] = [];
  try {
    for (const root of ["live", "new"] as const) {
      state.root = root;
      const context = await chromium.launchPersistentContext(profile, { headless: true });
      const page = context.pages()[0] ?? (await context.newPage());
      page.setDefaultTimeout(120_000);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      try {
        for (const { matrixCase, at } of cases) {
          let outcome: Outcome;
          try {
            outcome = await processCase(page, origin, matrixCase, files[at]!, at);
          } catch (error) {
            outcome = { ok: false, detail: (error as Error).message.split("\n")[0]! };
          }
          if (!outcome.ok) (root === "new" ? failures : liveFailures).push(`${matrixCase.name}: ${outcome.detail}`);
        }
        if (root === "new" && pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);
        // A deploy swaps the service worker; the saved runs (OPFS) stay.
        await page.evaluate(async () => {
          for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
          for (const k of await caches.keys()) await caches.delete(k);
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
  return { failures, liveFailures };
}

if (!existsSync(path.join(NEW_BUILD, "index.html"))) {
  throw new Error(`${NEW_BUILD} has no build: run \`npm run build:vite\` first`);
}
rmSync(LIVE_CACHE, { recursive: true, force: true });
const files = fixtures(CASES.length);
const indexed = CASES.map((matrixCase, at) => ({ matrixCase, at }));
const results = await Promise.all(
  Array.from({ length: SHARDS }, (_, s) => shard(s, indexed.filter(({ at }) => at % SHARDS === s), files)),
);
const failures = results.flatMap((r) => r.failures);
const liveFailures = results.flatMap((r) => r.liveFailures);
console.log(`upgrade check: ${CASES.length} option cases, live ${LIVE} -> this build`);
if (liveFailures.length > 0) {
  console.log(`live build could not process ${liveFailures.length} case(s) (already live, not caused by this change):\n  ${liveFailures.join("\n  ")}`);
}
if (failures.length > 0) {
  console.error(`NEW BUILD FAILED ${failures.length} case(s) after the live build saved runs:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("upgrade check: every case processed by the new build over the live build's saved runs");
