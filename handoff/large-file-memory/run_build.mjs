// Upload one raw CSV to a built app in a real browser, press Process, and
// report what happened plus the browser's peak resident memory.
// usage: node run_build.mjs <url> <chromium|firefox> <csv> <label> <timeoutMin>
const W = process.env.W ?? process.exit(console.error("set W to the work directory"), 2);
const { chromium, firefox } = await import(`${process.env.REPO ?? process.cwd()}/web/node_modules/playwright/index.mjs`);
import { readFileSync, readdirSync, appendFileSync } from "node:fs";

const [url, browserName, csv, label, timeoutMin = "40"] = process.argv.slice(2);
const out = `${W}/results/${label}-${browserName}`;
const engine = browserName === "firefox" ? firefox : chromium;
import { rmSync } from "node:fs";
const profileDir = `${W}/profile-${label}`;
rmSync(profileDir, { recursive: true, force: true });
// On-disk profile: an ephemeral context keeps OPFS in memory under a small quota.
const browser = await engine.launchPersistentContext(profileDir, { headless: true });
const rootPid = process.pid; // the browser is our child; tree RSS includes this node driver (~100 MiB)

function treeRssMiB(root) {
  const children = new Map();
  for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    try {
      const ppid = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[1];
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(pid);
    } catch {}
  }
  let total = 0, maxProc = 0;
  const stack = [String(root)];
  while (stack.length) {
    const pid = stack.pop();
    try {
      const kb = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);
      total += kb;
      if (kb > maxProc) {
        maxProc = kb;
        const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
        globalThis.__maxProcType = cmd.find((a) => a.startsWith("--type=") || a.startsWith("--utility-sub-type=")) ?? cmd[0];
      }
    } catch {}
    stack.push(...(children.get(pid) ?? []));
  }
  return { total: total / 1024, maxProc: maxProc / 1024 };
}

let peak = { total: 0, maxProc: 0 };
const sampler = setInterval(() => {
  const now = treeRssMiB(rootPid);
  appendFileSync(`${out}.rss`, `${Math.round(process.uptime())}s total=${Math.round(now.total)} max=${Math.round(now.maxProc)} ${globalThis.__maxProcType}\n`);
  peak = { total: Math.max(peak.total, now.total), maxProc: Math.max(peak.maxProc, now.maxProc) };
}, 1000);

const page = browser.pages()[0] ?? (await browser.newPage());
const consoleLines = [];
page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 400)));
page.on("pageerror", (e) => consoleLines.push(`pageerror: ${e.message}`.slice(0, 400)));
let crashed = false;
page.on("crash", () => { crashed = true; });

const started = Date.now();
let outcome = "timeout";
let detail = "";
try {
  await page.goto(url);
  await page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }).waitFor({ timeout: 60_000 });
  await page.getByTestId("raw-file-input").setInputFiles(csv);
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click({ timeout: 120_000 });
  const deadline = Date.now() + Number(timeoutMin) * 60_000;
  let lastText = "", lastChange = Date.now();
  while (Date.now() < deadline && !crashed) {
    if (await page.getByTestId("result-file-table").first().isVisible().catch(() => false)) {
      outcome = "result-table";
      if (process.env.AFTER_RESULT_VIEW) {
        // What a researcher does next: open the View tab.
        await page.waitForTimeout(30_000);
        await page.getByRole("tab", { name: /View/i }).click();
      }
      await page.waitForTimeout(Number(process.env.AFTER_RESULT_SECONDS ?? 0) * 1000);
      break;
    }
    const text = (await page.locator("main").innerText({ timeout: 10_000 }).catch(() => "")).replace(/\s+/g, " ");
    if (text !== lastText) { lastText = text; lastChange = Date.now(); }
    appendFileSync(`${out}.trace`, `${Math.round((Date.now() - started) / 1000)}s rss=${Math.round(treeRssMiB(rootPid).total)}MiB ${text.slice(-400)}\n`);
    const alerts = (await page.getByRole("alert").allInnerTexts().catch(() => [])).join(" | ");
    if (/invalid string length|out of memory|failed|error|could not|cannot|unable|unreachable/i.test(alerts)) { outcome = "error-shown"; detail = alerts.slice(-1500); break; }
    if (Date.now() - lastChange > 25 * 60_000) { outcome = "stalled-5min"; detail = text.slice(-1500); break; }
    await page.waitForTimeout(20_000);
  }
  if (crashed) outcome = "page-crashed";
} catch (e) {
  outcome = crashed ? "page-crashed" : "script-error";
  detail = String(e).slice(0, 1500);
}
const seconds = Math.round((Date.now() - started) / 1000);
let pageText = "";
try {
  await page.screenshot({ path: `${out}.png`, fullPage: true, timeout: 30_000 });
  pageText = (await page.locator("main").innerText({ timeout: 10_000 })).slice(0, 3000);
} catch {}
clearInterval(sampler);
console.log(JSON.stringify({ label, browser: browserName, outcome, seconds, peakTreeRssMiB: Math.round(peak.total), peakSingleProcessMiB: Math.round(peak.maxProc), detail, console: consoleLines.slice(-15), pageText }, null, 1));
await browser.close();
