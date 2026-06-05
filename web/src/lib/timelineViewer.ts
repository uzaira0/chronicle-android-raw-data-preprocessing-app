// Self-contained, interactive HTML "timeline viewer" export (#18). Earlier this
// embedded static day-grid PNGs with App / Screen tabs — which is not a viewer,
// just images you could already get from the plot export. It now ships the SAME
// interactivity as the in-app View tab: the day-grid scenes and per-session
// hover regions are embedded as JSON and rendered live on a canvas with
// scroll-to-zoom, drag-to-pan, and hover tooltips. The interaction code is the
// vanilla-JS twin of TimelineViewPanel's InteractiveScene (see
// timelineViewerRuntime.js), inlined verbatim so the file opens in any browser
// fully offline — nothing is fetched from the network.

import runtimeJs from "@/lib/timelineViewerRuntime.js?raw";
import type { TimelineParticipantView } from "@/lib/types";

type ViewerInput = {
  fileName: string;
  timezone: string;
  /** Interactive app-usage views (scene + hover regions), one per participant. */
  app: TimelineParticipantView[];
  /** Interactive screen-usage views, one per participant. */
  screen: TimelineParticipantView[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serialize the embedded scene data. `<` is escaped to its JSON unicode escape
 * so the payload can never break out of the surrounding `<script>` (e.g. a
 * literal `</script>` inside a string) while staying valid JSON to parse.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Per-participant figure scaffolding; the runtime attaches the canvas behavior. */
function renderPanel(
  type: "app" | "screen",
  views: TimelineParticipantView[],
  emptyLabel: string,
): string {
  if (views.length === 0) {
    return `<p class="tv-empty">${escapeHtml(emptyLabel)}</p>`;
  }
  return views
    .map(
      (view, index) =>
        `<figure class="tv-scene" data-tv-type="${type}" data-tv-index="${index}">
  <figcaption class="tv-scene-head">
    <span class="tv-scene-title">${escapeHtml(view.participantId)}</span>
    <span class="tv-scene-actions">
      <button type="button" class="tv-btn" data-tv-act="fit">Fit</button>
      <button type="button" class="tv-btn" data-tv-act="in">Zoom in</button>
      <button type="button" class="tv-btn" data-tv-act="out">Zoom out</button>
    </span>
  </figcaption>
  <div class="tv-canvas-wrap">
    <canvas class="tv-canvas"></canvas>
    <div class="tv-tooltip" hidden></div>
  </div>
</figure>`,
    )
    .join("\n");
}

/**
 * Build a standalone, interactive HTML timeline viewer for one input file: App /
 * Screen tabs, each stacking the per-participant day-grid scenes on a live
 * canvas (zoom / pan / hover), in the same by-day vertical alignment as the
 * exported images. The scene + region data drives both this export and the
 * in-app View tab, so they cannot drift.
 */
export function buildTimelineViewerHtml(input: ViewerInput): string {
  const { fileName, timezone, app, screen } = input;
  const data = embedJson({ app, screen });
  const appPanel = renderPanel("app", app, "No app-usage data for this file.");
  const screenPanel = renderPanel("screen", screen, "No screen-usage data for this file.");
  // Mirror the runtime's initial-tab rule (timelineViewerRuntime.js) exactly so
  // the server-rendered active tab never disagrees with what the script selects.
  const initial = app.length > 0 ? "app" : screen.length > 0 ? "screen" : "app";
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
  .tv-tabs { display: flex; gap: 4px; padding: 12px 20px 0; background: #fff; border-bottom: 1px solid #e6e9ec; position: sticky; top: 0; z-index: 2; }
  .tv-tab { appearance: none; border: 1px solid #e6e9ec; border-bottom: none; background: #f0f2f5; color: #5b6671; padding: 8px 16px; font: inherit; font-weight: 600; border-radius: 8px 8px 0 0; cursor: pointer; }
  .tv-tab[aria-selected="true"] { background: #fff; color: #1f2933; }
  .tv-panel { display: none; padding: 20px; }
  .tv-panel.is-active { display: block; }
  .tv-hint { color: #5b6671; font-size: 13px; margin: 0 0 16px; }
  .tv-scene { margin: 0 0 28px; }
  .tv-scene-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
  .tv-scene-title { font-weight: 600; }
  .tv-scene-actions { display: flex; gap: 6px; }
  .tv-btn { appearance: none; border: 1px solid #cfd6dd; background: #fff; color: #1f2933; padding: 4px 10px; font: inherit; font-size: 13px; border-radius: 6px; cursor: pointer; }
  .tv-btn:hover { background: #f0f2f5; }
  .tv-canvas-wrap { position: relative; border: 1px solid #e6e9ec; border-radius: 6px; background: #fff; overflow: hidden; }
  .tv-canvas { display: block; touch-action: none; cursor: grab; }
  .tv-canvas:active { cursor: grabbing; }
  .tv-tooltip { position: absolute; z-index: 3; pointer-events: none; max-width: 280px; background: #1f2933; color: #fff; padding: 6px 8px; border-radius: 6px; font-size: 12px; line-height: 1.4; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); }
  .tv-tooltip[hidden] { display: none; }
  .tv-tooltip strong { display: block; margin-bottom: 2px; }
  .tv-empty { color: #5b6671; font-style: italic; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(fileName)}</h1>
  <div class="tv-meta">Timeline viewer · timezone ${escapeHtml(timezone || "—")}</div>
</header>
<div class="tv-tabs" role="tablist">
  <button class="tv-tab" id="tab-app" role="tab" data-tv-tab="app" aria-controls="panel-app" aria-selected="${initial === "app"}">App usage</button>
  <button class="tv-tab" id="tab-screen" role="tab" data-tv-tab="screen" aria-controls="panel-screen" aria-selected="${initial === "screen"}">Screen usage</button>
</div>
<section class="tv-panel${initial === "app" ? " is-active" : ""}" id="panel-app" data-tv-panel="app" role="tabpanel" aria-labelledby="tab-app">
  <p class="tv-hint">Scroll to zoom · drag to pan · hover a bar for details</p>
${appPanel}
</section>
<section class="tv-panel${initial === "screen" ? " is-active" : ""}" id="panel-screen" data-tv-panel="screen" role="tabpanel" aria-labelledby="tab-screen">
  <p class="tv-hint">Scroll to zoom · drag to pan · hover a bar for details</p>
${screenPanel}
</section>
<script type="application/json" id="tv-data">${data}</script>
<script>${runtimeJs}</script>
</body>
</html>`;
}
