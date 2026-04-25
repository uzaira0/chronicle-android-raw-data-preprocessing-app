import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? "http://127.0.0.1:5174/";
const outPath = process.argv[3] ?? path.resolve(__dirname, "../.tmp/dev-screenshot.png");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1800 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (err) => errors.push(`PAGE ERROR: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    errors.push(`CONSOLE ${msg.type().toUpperCase()}: ${msg.text()}`);
  }
});

await page.goto(target, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

const fs = await import("node:fs/promises");
await fs.mkdir(path.dirname(outPath), { recursive: true });
await page.screenshot({ path: outPath, fullPage: true });

const probe = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const sheets = Array.from(document.styleSheets).map((s) => s.href ?? "<inline>");
  const swCount = (navigator.serviceWorker?.controller ? 1 : 0);
  const card = document.querySelector(".section-card");
  const cardStyle = card ? getComputedStyle(card) : null;
  return {
    rootColorBg: root.getPropertyValue("--color-bg").trim(),
    rootSpace4: root.getPropertyValue("--space-4").trim(),
    bodyBg: body.background,
    bodyFont: body.fontFamily,
    bodyColor: body.color,
    sheets,
    serviceWorkerControlling: swCount,
    sectionCardBackground: cardStyle?.backgroundColor ?? null,
    sectionCardBorderRadius: cardStyle?.borderRadius ?? null,
  };
});

console.log("PROBE:", JSON.stringify(probe, null, 2));
console.log("ERRORS:", JSON.stringify(errors, null, 2));
console.log("Wrote", outPath);
await browser.close();
