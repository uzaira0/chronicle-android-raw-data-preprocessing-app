// Ad-hoc visual harness: drives the running dev server with synthetic raw CSVs
// and captures the results table + generated plots so we can eyeball the UI.
// Usage: node scripts/screenshot_results.mjs [baseUrl] [outDir]
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://127.0.0.1:5181";
const OUT = process.argv[3] ?? "/tmp/chronicle-shots";

const HEADER =
  "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone";

const SCREEN_ON = "Unknown importance: 15"; // Screen Interactive
const SCREEN_OFF = "Unknown importance: 16"; // Screen Non-Interactive
const APP_FG = "Unknown importance: 1"; // Activity Resumed
const APP_BG = "Unknown importance: 2"; // Activity Paused

// A screen-on session bracketing one foreground app use.
function session(pid, label, pkg, date, onT, fgT, bgT, offT, tz) {
  const r = (t, type, lbl, p) =>
    `study,${pid},Android,Target Child,${lbl},${type},${p},${date} ${t},,,${tz}`;
  return [
    r(onT, SCREEN_ON, "System", "android"),
    r(fgT, APP_FG, label, pkg),
    r(bgT, APP_BG, label, pkg),
    r(offT, SCREEN_OFF, "System", "android"),
  ];
}

// P01: app + screen usage across two days with a long mid-day gap and an
// overnight gap (both > 1h → both plots should shade them).
const FILE_A = [
  HEADER,
  ...session("P01", "Chat", "com.example.chat", "2026-03-07", "08:00:00", "08:00:30", "08:14:00", "08:15:00", "America/Chicago"),
  ...session("P01", "YouTube", "com.example.video", "2026-03-07", "09:00:00", "09:00:30", "09:44:00", "09:46:00", "America/Chicago"),
  // ~8.5h mid-day gap here
  ...session("P01", "Maps", "com.example.maps", "2026-03-07", "18:30:00", "18:30:30", "18:54:00", "18:56:00", "America/Chicago"),
  // overnight gap here
  ...session("P01", "Chat", "com.example.chat", "2026-03-08", "07:30:00", "07:30:30", "07:49:00", "07:51:00", "America/Chicago"),
].join("\n");

// P02: data spanning two timezones (a participant who travelled) — must NOT be
// flagged as a warning. Includes screen usage so the only thing that could mark
// it "Review" is the (now removed) multi-timezone warning.
const FILE_B = [
  HEADER,
  ...session("P02", "Chat", "com.example.chat", "2026-03-07", "10:00:00", "10:00:30", "10:19:00", "10:20:00", "America/Chicago"),
  ...session("P02", "Maps", "com.example.maps", "2026-03-07", "14:00:00", "14:00:30", "14:29:00", "14:30:00", "America/New_York"),
].join("\n");

function bufFor(name, content) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(content, "utf-8") };
}

async function saveDownloadZip(page, testId, dest) {
  const dl = page.waitForEvent("download");
  await page.getByTestId(testId).first().click();
  const download = await dl;
  const path = await download.path();
  const bytes = await readFile(path);
  await writeFile(dest, bytes);
  return bytes;
}

// minimal STORED-zip reader (createZipBlob writes no compression)
function unzipStored(bytes) {
  const dec = new TextDecoder();
  const out = new Map();
  let o = 0;
  const u16 = (p) => bytes[p] | (bytes[p + 1] << 8);
  const u32 = (p) => (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
  while (o + 30 <= bytes.byteLength && u32(o) === 0x04034b50) {
    const comp = u16(o + 8);
    const size = u32(o + 18);
    const nlen = u16(o + 26);
    const elen = u16(o + 28);
    const nameStart = o + 30;
    const dataStart = nameStart + nlen + elen;
    const name = dec.decode(bytes.slice(nameStart, nameStart + nlen));
    if (comp !== 0) throw new Error(`unsupported compression ${comp}`);
    out.set(name, bytes.slice(dataStart, dataStart + size));
    o = dataStart + size;
  }
  return out;
}

const main = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    window.__CHRONICLE_TEST_RUNTIME__ = { datetimeOfPreprocessing: "2026-04-24 00:32:53" };
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[page error]", m.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle" });

  await page.getByTestId("raw-file-input").setInputFiles([
    bufFor("Raw P01.csv", FILE_A),
    bufFor("Raw P02 travel.csv", FILE_B),
  ]);

  // make sure app + screen + plots are all on
  for (const id of ["toggle-processAppUsage", "toggle-processScreenUsage", "toggle-enablePlotting"]) {
    const el = page.getByTestId(id);
    if (await el.count()) {
      try { await el.check(); } catch { /* already on / disabled */ }
    }
  }

  // Files tab: this is where the per-file inspection warnings + readiness count
  // surface. With the multi-timezone warning removed, P02 (two zones) must show
  // no warning here.
  try {
    await page.getByRole("tab", { name: /Files/i }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/files-tab.png`, fullPage: true });
  } catch (e) {
    console.log("files-tab capture skipped:", e.message);
  }

  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await page.getByTestId("result-file-table").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(500);

  await page.getByTestId("result-panel").first().screenshot({ path: `${OUT}/results-panel.png` });
  await page.screenshot({ path: `${OUT}/full-page.png`, fullPage: true });

  // pull the plot PNGs
  try {
    const zipBytes = await saveDownloadZip(page, "download-plots-zip", `${OUT}/plots.zip`);
    const entries = unzipStored(zipBytes);
    for (const [name, data] of entries) {
      if (name.toLowerCase().endsWith(".png")) {
        const safe = name.replace(/[^a-z0-9.\-]+/gi, "_");
        await writeFile(`${OUT}/${safe}`, data);
        console.log("plot:", name, `${data.byteLength}b`);
      }
    }
  } catch (e) {
    console.log("plot capture skipped:", e.message);
  }

  console.log("screenshots written to", OUT);
  await browser.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
