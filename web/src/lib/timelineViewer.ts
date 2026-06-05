// Self-contained HTML "timeline viewer" export (#18). Instead of a live canvas
// explorer that re-rendered every session on the main thread (which froze on
// large files), the timeline is exported as a standalone .html file: the same
// day-grid usage plots as the image export, embedded as data URIs, with App /
// Screen tabs. It opens in any browser, fully offline — nothing is fetched from
// the network.

type ViewerInput = {
  fileName: string;
  timezone: string;
  /** Day-grid app-usage plots, one per participant (the same images as the PNG export). */
  appPlots: Map<string, Blob>;
  /** Day-grid screen-usage plots, one per participant. */
  screenPlots: Map<string, Blob>;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function blobToDataUri(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Chunk the byte→char conversion so a large image can't blow the argument
  // limit of String.fromCharCode when spread.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const type = blob.type || "image/png";
  return `data:${type};base64,${btoa(binary)}`;
}

async function renderPanel(plots: Map<string, Blob>, emptyLabel: string): Promise<string> {
  const participantIds = [...plots.keys()].sort((a, b) => a.localeCompare(b));
  if (participantIds.length === 0) {
    return `<p class="tv-empty">${escapeHtml(emptyLabel)}</p>`;
  }
  const figures: string[] = [];
  for (const pid of participantIds) {
    const uri = await blobToDataUri(plots.get(pid)!);
    figures.push(
      `<figure class="tv-fig"><figcaption>${escapeHtml(pid)}</figcaption>` +
        `<img alt="Usage timeline for ${escapeHtml(pid)}" src="${uri}" /></figure>`,
    );
  }
  return figures.join("\n");
}

/**
 * Build a standalone HTML timeline viewer for one input file: App / Screen tabs,
 * each stacking the per-participant day-grid usage plots (same vertical, by-day
 * alignment as the exported images, not one long horizontal strip).
 */
export async function buildTimelineViewerHtml(input: ViewerInput): Promise<string> {
  const { fileName, timezone, appPlots, screenPlots } = input;
  const appPanel = await renderPanel(appPlots, "No app-usage data for this file.");
  const screenPanel = await renderPanel(screenPlots, "No screen-usage data for this file.");
  const title = `${fileName} — Timeline viewer`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2933; background: #f5f7fa; }
  header { padding: 16px 20px; border-bottom: 1px solid #e6e9ec; background: #fff; }
  h1 { margin: 0 0 4px; font-size: 18px; word-break: break-word; }
  .tv-meta { color: #5b6671; font-size: 13px; }
  .tv-tabs { display: flex; gap: 4px; padding: 12px 20px 0; background: #fff; border-bottom: 1px solid #e6e9ec; position: sticky; top: 0; z-index: 1; }
  .tv-tab { appearance: none; border: 1px solid #e6e9ec; border-bottom: none; background: #f0f2f5; color: #5b6671; padding: 8px 16px; font: inherit; font-weight: 600; border-radius: 8px 8px 0 0; cursor: pointer; }
  .tv-tab[aria-selected="true"] { background: #fff; color: #1f2933; }
  .tv-panel { display: none; padding: 20px; }
  .tv-panel.is-active { display: block; }
  .tv-fig { margin: 0 0 24px; }
  .tv-fig figcaption { font-weight: 600; margin-bottom: 6px; }
  .tv-fig img { display: block; max-width: 100%; height: auto; border: 1px solid #e6e9ec; border-radius: 6px; background: #fff; }
  .tv-empty { color: #5b6671; font-style: italic; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(fileName)}</h1>
  <div class="tv-meta">Timeline viewer · timezone ${escapeHtml(timezone || "—")}</div>
</header>
<div class="tv-tabs" role="tablist">
  <button class="tv-tab" id="tab-app" role="tab" aria-controls="panel-app" aria-selected="true" onclick="tvShow('app')">App usage</button>
  <button class="tv-tab" id="tab-screen" role="tab" aria-controls="panel-screen" aria-selected="false" onclick="tvShow('screen')">Screen usage</button>
</div>
<section class="tv-panel is-active" id="panel-app" role="tabpanel" aria-labelledby="tab-app">
${appPanel}
</section>
<section class="tv-panel" id="panel-screen" role="tabpanel" aria-labelledby="tab-screen">
${screenPanel}
</section>
<script>
  function tvShow(which) {
    for (const key of ["app", "screen"]) {
      document.getElementById("panel-" + key).classList.toggle("is-active", key === which);
      document.getElementById("tab-" + key).setAttribute("aria-selected", String(key === which));
    }
  }
</script>
</body>
</html>`;
}
