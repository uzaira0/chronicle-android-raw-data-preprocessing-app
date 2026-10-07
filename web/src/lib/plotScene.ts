/**
 * Resolution-independent scene model for the app-usage / screen-usage plots and
 * the activity heatmap.
 *
 * A plot's geometry is computed once into a flat, ordered list of drawing
 * primitives (a {@link Scene}). Two renderers consume the same scene:
 *   - `renderSceneToCanvas` (in plotGenerator.ts) → the raster PNG path.
 *   - `renderSceneToSvg` (here)                  → the vector SVG path (#21).
 *
 * Because both renderers read the identical primitives, the PNG and SVG outputs
 * cannot drift: a geometry change in the scene builder updates both at once.
 *
 * Primitives are painted in array order (later entries draw on top), matching
 * Canvas semantics and SVG document order.
 */

/** Horizontal text alignment (Canvas textAlign left/center/right). */
type Anchor = "start" | "middle" | "end";
/** Vertical text alignment (Canvas textBaseline). */
type Baseline = "top" | "middle" | "alphabetic";

export type RectPrim = {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fill colour; omit for a stroke-only rectangle (e.g. the plot border). */
  fill?: string;
  /** Fill/stroke opacity in [0,1]; defaults to 1. */
  alpha?: number;
  stroke?: string;
  /** Stroke width; defaults to 1 when `stroke` is set. */
  strokeWidth?: number;
};

export type TextPrim = {
  type: "text";
  x: number;
  y: number;
  text: string;
  fill: string;
  /** Canvas/CSS font shorthand, e.g. "bold 16px system-ui, sans-serif". */
  font: string;
  anchor: Anchor;
  baseline: Baseline;
  /** Row-anchored text: `x` is a data position inside a waterfall row and the
   * glyph sits `dx` px to its right. Interactive viewers move `x` with the
   * row's zoom and keep `dx` fixed; static renderers draw at x + dx. Text
   * without it never moves with row zoom. */
  dx?: number;
};

/** Scene x at which a text primitive is painted, given its row's zoom `tx`
 * (omitted when the row is not zoomed). Only row-anchored text moves. */
export function textPaintX(p: TextPrim, tx?: (x: number) => number): number {
  if (p.dx === undefined) return p.x;
  return (tx ? tx(p.x) : p.x) + p.dx;
}

type LinePrim = {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth?: number;
  /** Dash pattern, e.g. [4, 4]; omit/empty for a solid line. */
  dash?: number[];
};

type PolyPrim = {
  type: "poly";
  points: Array<[number, number]>;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** When true the path is closed (a polygon); otherwise an open polyline. */
  closed?: boolean;
};

export type Primitive = RectPrim | TextPrim | LinePrim | PolyPrim;

/** What a DST (non-24 h) day row needs drawn beyond its bars: its real length
 * and the wall-clock label at each elapsed hour. */
export type DstRowMarks = { dayHours: number; labels: string[] };

export type WaterfallSceneMeta = {
  kind: "waterfall";
  gutter: number;
  plotWidth: number;
  /** `dst` is set only on DST rows, so a derived scene (the A/B comparison)
   * can redraw their marks without the timezone. */
  rows: Array<{ date: string; y: number; h: number; dst?: DstRowMarks }>;
};

export type Scene = {
  width: number;
  height: number;
  primitives: Primitive[];
  meta?: WaterfallSceneMeta;
};

/**
 * A hover hit-region over a session bar, in scene coordinates, carrying the
 * pre-formatted tooltip text. Emitted optionally by the scene builders so the
 * interactive viewer (#18 View tab) can show per-session details on hover
 * without re-deriving anything. Pure data → safe to clone across the worker.
 */
export type SceneRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bold tooltip heading (app label / "Screen"). */
  title: string;
  /** Tooltip detail lines. */
  lines: string[];
  /** Bar fill colour, so a region is self-describing — lets the A/B comparison
   * view reconstruct each arm's bars (colour included) from the built scenes
   * without re-deriving anything. Omitted for gaps. */
  fill?: string;
  /** What this region covers, so the comparison builder can pick out session
   * bars (vs gaps / device-event markers). Defaults to "session" when unset. */
  kind?: "session" | "gap" | "marker";
};

/**
 * Return the nearest vertically matching region within a horizontal tolerance.
 * Exact hits retain the scene's existing first-region ordering; expanded hits
 * choose the closest real edge so adjacent sub-pixel bars stay deterministic.
 */
export function findNearestSceneRegion(
  regions: SceneRegion[],
  x: number,
  y: number,
  maxHorizontalDistance: number,
): SceneRegion | undefined {
  const tolerance = Math.max(0, maxHorizontalDistance);
  let nearest: SceneRegion | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const region of regions) {
    if (y < region.y || y > region.y + region.h) continue;
    const left = Math.min(region.x, region.x + region.w);
    const right = Math.max(region.x, region.x + region.w);
    const distance = x < left ? left - x : x > right ? x - right : 0;
    if (distance === 0) return region;
    if (distance <= tolerance && distance < nearestDistance) {
      nearest = region;
      nearestDistance = distance;
    }
  }

  return nearest;
}

const DEFAULT_FONT_FAMILY = "system-ui, sans-serif";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeXml(value: string): string {
  return value
    // XML 1.0 cannot carry these even escaped (a NUL in a label made the whole
    // SVG unparseable), and lone surrogates are not characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Parse a Canvas font shorthand into the SVG text attributes we need. */
export function parseFont(font: string): {
  fontSize: string;
  fontWeight: string;
  fontFamily: string;
} {
  const weight = /\bbold\b/i.test(font) ? "bold" : "normal";
  const sizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
  const fontSize = sizeMatch ? `${sizeMatch[1]}px` : "13px";
  // Family is whatever follows the size token; fall back to the default stack.
  let fontFamily = DEFAULT_FONT_FAMILY;
  if (sizeMatch) {
    const after = font.slice(font.indexOf(sizeMatch[0]) + sizeMatch[0].length).trim();
    if (after) fontFamily = after;
  }
  return { fontSize, fontWeight: weight, fontFamily };
}

function anchorToSvg(anchor: Anchor): string {
  return anchor === "start" ? "start" : anchor === "middle" ? "middle" : "end";
}

function baselineToSvg(baseline: Baseline): string {
  // Approximate Canvas baselines with the closest broadly-supported SVG values.
  return baseline === "top" ? "hanging" : baseline === "middle" ? "central" : "alphabetic";
}

function rectToSvg(p: RectPrim): string {
  const attrs = [
    `x="${round(p.x)}"`,
    `y="${round(p.y)}"`,
    `width="${round(Math.max(p.w, 0))}"`,
    `height="${round(Math.max(p.h, 0))}"`,
    `fill="${p.fill ?? "none"}"`,
  ];
  if (p.alpha !== undefined && p.alpha < 1) attrs.push(`fill-opacity="${round(p.alpha)}"`);
  if (p.stroke) {
    attrs.push(`stroke="${p.stroke}"`, `stroke-width="${p.strokeWidth ?? 1}"`);
  }
  return `<rect ${attrs.join(" ")} />`;
}

function textToSvg(p: TextPrim): string {
  const { fontSize, fontWeight, fontFamily } = parseFont(p.font);
  const attrs = [
    `x="${round(textPaintX(p))}"`,
    `y="${round(p.y)}"`,
    `fill="${p.fill}"`,
    `font-size="${fontSize}"`,
    `font-weight="${fontWeight}"`,
    `font-family="${escapeXml(fontFamily)}"`,
    `text-anchor="${anchorToSvg(p.anchor)}"`,
    `dominant-baseline="${baselineToSvg(p.baseline)}"`,
  ];
  return `<text ${attrs.join(" ")}>${escapeXml(p.text)}</text>`;
}

function lineToSvg(p: LinePrim): string {
  const attrs = [
    `x1="${round(p.x1)}"`,
    `y1="${round(p.y1)}"`,
    `x2="${round(p.x2)}"`,
    `y2="${round(p.y2)}"`,
    `stroke="${p.stroke}"`,
    `stroke-width="${p.strokeWidth ?? 1}"`,
  ];
  if (p.dash && p.dash.length) attrs.push(`stroke-dasharray="${p.dash.join(",")}"`);
  return `<line ${attrs.join(" ")} />`;
}

function polyToSvg(p: PolyPrim): string {
  const points = p.points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
  const attrs = [
    `points="${points}"`,
    `fill="${p.fill ?? "none"}"`,
  ];
  if (p.stroke) attrs.push(`stroke="${p.stroke}"`, `stroke-width="${p.strokeWidth ?? 1}"`);
  return p.closed ? `<polygon ${attrs.join(" ")} />` : `<polyline ${attrs.join(" ")} />`;
}

function primitiveToSvg(p: Primitive): string {
  switch (p.type) {
    case "rect":
      return rectToSvg(p);
    case "text":
      return textToSvg(p);
    case "line":
      return lineToSvg(p);
    case "poly":
      return polyToSvg(p);
  }
}

/** Serialize a {@link Scene} into a standalone SVG document string. */
export function renderSceneToSvg(scene: Scene): string {
  const body = scene.primitives.map(primitiveToSvg).join("\n  ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" ` +
    `viewBox="0 0 ${scene.width} ${scene.height}" font-family="${DEFAULT_FONT_FAMILY}">\n  ` +
    `${body}\n</svg>\n`
  );
}

/** Serialize a {@link Scene} to an `image/svg+xml` Blob (worker- and DOM-safe). */
export function sceneToSvgBlob(scene: Scene): Blob {
  return new Blob([renderSceneToSvg(scene)], { type: "image/svg+xml" });
}
