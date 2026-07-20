import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";

import type { Primitive, Scene, SceneRegion, WaterfallSceneMeta } from "@/lib/plotScene";
import { sceneToSvgBlob } from "@/lib/plotScene";
import { downloadBlob } from "@/lib/download";
import type { TimelineParticipantView } from "@/lib/types";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";

type RowTransform = { zoom: number; offset: number };
type RowTransforms = Record<number, RowTransform>;

const MAX_ROW_ZOOM = 24;
const HIGHLIGHT_STROKE = "#f5a623";

function rowAtY(meta: WaterfallSceneMeta | undefined, y: number): number | null {
  if (!meta) return null;
  const index = meta.rows.findIndex((row) => y >= row.y && y < row.y + row.h);
  return index >= 0 ? index : null;
}

function clampRowTransform(meta: WaterfallSceneMeta, transform: RowTransform): RowTransform {
  const zoom = Math.max(1, Math.min(MAX_ROW_ZOOM, transform.zoom));
  if (zoom <= 1.001) return { zoom: 1, offset: 0 };
  const minOffset = meta.plotWidth - meta.plotWidth * zoom;
  return { zoom, offset: Math.min(0, Math.max(minOffset, transform.offset)) };
}

function transformX(x: number, meta: WaterfallSceneMeta, transform: RowTransform): number {
  return meta.gutter + (x - meta.gutter) * transform.zoom + transform.offset;
}

function inverseTransformX(x: number, meta: WaterfallSceneMeta, transform: RowTransform): number {
  return meta.gutter + (x - meta.gutter - transform.offset) / transform.zoom;
}

function dataRowForPrimitive(meta: WaterfallSceneMeta | undefined, p: Primitive): number | null {
  if (!meta) return null;
  if (p.type === "rect") {
    if (p.x + p.w < meta.gutter) return null;
    const row = rowAtY(meta, p.y + p.h / 2);
    if (row === null) return null;
    const rowMeta = meta.rows[row];
    if (p.y < rowMeta.y - 0.01 || p.y + p.h > rowMeta.y + rowMeta.h + 0.01) return null;
    return row;
  }
  if (p.type === "line") {
    if (Math.abs(p.x1 - p.x2) > 0.01) return null;
    if (p.x1 < meta.gutter - 16) return null;
    return rowAtY(meta, (p.y1 + p.y2) / 2);
  }
  if (p.type === "poly") {
    const avgY = p.points.reduce((sum, [, y]) => sum + y, 0) / Math.max(1, p.points.length);
    const maxX = Math.max(...p.points.map(([x]) => x));
    if (maxX < meta.gutter - 16) return null;
    return rowAtY(meta, avgY);
  }
  return null;
}

function paintPrimitive(
  ctx: CanvasRenderingContext2D,
  p: Primitive,
  meta?: WaterfallSceneMeta,
  rowTransform?: RowTransform,
): void {
  const tx = (x: number): number =>
    meta && rowTransform ? transformX(x, meta, rowTransform) : x;
  const scaledWidth = (x: number, w: number): number =>
    meta && rowTransform ? tx(x + w) - tx(x) : Math.max(w, 0);
  const preserveGlyphX = (points: Array<[number, number]>, x: number): number => {
    if (!meta || !rowTransform) return x;
    const xs = points.map(([px]) => px);
    const center = (Math.min(...xs) + Math.max(...xs)) / 2;
    return tx(center) + (x - center);
  };

  if (p.type === "rect") {
    ctx.globalAlpha = p.alpha ?? 1;
    const x = tx(p.x);
    const w = Math.max(scaledWidth(p.x, p.w), 0);
    if (p.fill) {
      ctx.fillStyle = p.fill;
      ctx.fillRect(x, p.y, w, Math.max(p.h, 0));
    }
    if (p.stroke) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth ?? 1;
      ctx.strokeRect(x, p.y, w, Math.max(p.h, 0));
    }
    ctx.globalAlpha = 1;
  } else if (p.type === "text") {
    ctx.fillStyle = p.fill;
    ctx.font = p.font;
    ctx.textAlign = p.anchor === "start" ? "left" : p.anchor === "middle" ? "center" : "right";
    ctx.textBaseline = p.baseline === "top" ? "top" : p.baseline === "middle" ? "middle" : "alphabetic";
    ctx.fillText(p.text, p.x, p.y);
  } else if (p.type === "line") {
    ctx.strokeStyle = p.stroke;
    ctx.lineWidth = p.strokeWidth ?? 1;
    ctx.setLineDash(p.dash ?? []);
    ctx.beginPath();
    ctx.moveTo(tx(p.x1), p.y1);
    ctx.lineTo(tx(p.x2), p.y2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.beginPath();
    p.points.forEach(([x, y], i) => {
      const px = preserveGlyphX(p.points, x);
      return i === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    });
    if (p.closed) ctx.closePath();
    if (p.fill) {
      ctx.fillStyle = p.fill;
      ctx.fill();
    }
    if (p.stroke) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth ?? 1;
      ctx.stroke();
    }
  }
}

/** Faint "no usage" bands behind rows that a participant had raw data but no
 * sessions on (the no_usage_day flag) — surfaces gap days on the timeline, not
 * just in the day table. Drawn before the scene so real bars sit on top. */
function paintGapBands(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  meta: WaterfallSceneMeta,
  gapDates: Set<string>,
): void {
  if (gapDates.size === 0) return;
  ctx.save();
  for (const row of meta.rows) {
    if (!gapDates.has(row.date)) continue;
    ctx.fillStyle = "rgba(140, 140, 150, 0.14)";
    ctx.fillRect(meta.gutter, row.y, scene.width - meta.gutter, row.h);
    ctx.fillStyle = "rgba(90, 90, 110, 0.55)";
    ctx.font = "italic 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("no usage", meta.gutter + 6, row.y + row.h / 2);
  }
  ctx.restore();
}

/** Spotlight matching app sessions across the whole timeline: dim the plot, then
 * re-draw matching session regions bright with an outline. Uses the region model
 * (each region carries its app title + fill) so it can't drift from the bars. */
function paintHighlights(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  matches: SceneRegion[],
  meta: WaterfallSceneMeta | undefined,
  transforms: RowTransforms,
  active: boolean,
): void {
  if (!active || !meta) return;

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
  ctx.fillRect(meta.gutter, 0, scene.width - meta.gutter, scene.height);
  ctx.restore();

  for (const region of matches) {
    const row = rowAtY(meta, region.y + region.h / 2);
    const transform = row !== null ? transforms[row] : undefined;
    const draw = (): void => {
      const x = transform ? transformX(region.x, meta, transform) : region.x;
      const right = transform ? transformX(region.x + region.w, meta, transform) : region.x + region.w;
      const w = Math.max(right - x, 1);
      if (region.fill) {
        ctx.fillStyle = region.fill;
        ctx.fillRect(x, region.y, w, region.h);
      }
      ctx.strokeStyle = HIGHLIGHT_STROKE;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, region.y, w, region.h);
    };
    if (row !== null && transform && transform.zoom > 1) {
      const rowMeta = meta.rows[row];
      ctx.save();
      ctx.beginPath();
      ctx.rect(meta.gutter, rowMeta.y, meta.plotWidth, rowMeta.h);
      ctx.clip();
      draw();
      ctx.restore();
    } else {
      draw();
    }
  }
}

function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  transforms: RowTransforms,
): void {
  const meta = scene.meta?.kind === "waterfall" ? scene.meta : undefined;
  for (const p of scene.primitives) {
    const row = dataRowForPrimitive(meta, p);
    const rowTransform = row !== null ? transforms[row] : undefined;
    if (meta && row !== null && rowTransform && rowTransform.zoom > 1) {
      const rowMeta = meta.rows[row];
      ctx.save();
      ctx.beginPath();
      ctx.rect(meta.gutter, rowMeta.y, meta.plotWidth, rowMeta.h);
      ctx.clip();
      paintPrimitive(ctx, p, meta, rowTransform);
      ctx.restore();
    } else {
      paintPrimitive(ctx, p, meta, rowTransform);
    }
  }
}

type Hover = { left: number; top: number; title: string; lines: string[] };

function safeFileBase(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "timeline";
}

/** Apply demo masking to a participant view's scene text, row dates, and hover
 * regions when demo mode hides metadata. A no-op otherwise. */
export function sanitizeDemoView(
  view: TimelineParticipantView,
  masker: DemoDisplayMasker,
): TimelineParticipantView {
  if (!masker.hideDemoMetadata) return view;
  const meta = view.scene.meta?.kind === "waterfall" ? view.scene.meta : undefined;
  const sanitizedScene: Scene = {
    ...view.scene,
    primitives: view.scene.primitives.map((primitive) =>
      primitive.type === "text"
        ? { ...primitive, text: masker.text(primitive.text) }
        : primitive,
    ),
    meta: meta
      ? {
          ...meta,
          rows: meta.rows.map((row) => ({
            ...row,
            date: masker.text(row.date),
          })),
        }
      : meta,
  };
  return {
    participantId: masker.participantId(view.participantId),
    scene: sanitizedScene,
    regions: view.regions.map((region) => ({
      ...region,
      title: masker.text(region.title),
      lines: region.lines.map((line) => masker.text(line)),
    })),
  };
}

/** One participant's bare waterfall timeline rendered fit-to-width on a tall
 * canvas. The page scrolls vertically; row-level zoom affects x only. */
export function InteractiveScene({
  view,
  context,
  highlightQuery = "",
  gapDates,
  allowExport = false,
}: {
  view: TimelineParticipantView;
  context: string;
  /** App-name query; matching sessions are spotlighted across every row (#20). */
  highlightQuery?: string;
  /** Masked dates flagged no_usage_day, drawn as faint bands (#18). */
  gapDates?: Set<string>;
  /** Show the PNG/SVG export-this-view controls (#21). */
  allowExport?: boolean;
}): ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ row: number; x: number; offset: number; pointerId: number } | null>(null);

  const [boxW, setBoxW] = useState(900);
  const [hover, setHover] = useState<Hover | null>(null);
  const [rowTransforms, setRowTransforms] = useState<RowTransforms>({});
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  // Focus-visible semantics: a pointer click sets the keyboard *target* row (so a
  // subsequent arrow-key zoom acts on it) but must NOT paint a focus ring — that
  // would be visual noise on every click and drag. The ring + SR announcement
  // only appear once the user actually navigates by keyboard.
  const [focusVisible, setFocusVisible] = useState(false);
  const meta = view.scene.meta?.kind === "waterfall" ? view.scene.meta : undefined;
  const scale = boxW / Math.max(view.scene.width, 1);
  const canvasCssHeight = Math.max(1, view.scene.height * scale);
  const emptyGaps = useMemo(() => new Set<string>(), []);
  const gapKey = gapDates ? [...gapDates].sort().join("|") : "";
  // Stabilize by CONTENT: ViewPanel rebuilds the gapDates Set every render (it
  // can't useMemo it — it sits after an early return), so without this the redraw
  // effect (which lists `gaps` as a dep) would re-run on every parent render.
  const gaps = useMemo(
    () => gapDates ?? emptyGaps,
    [gapKey, emptyGaps],
  );

  // Filter matches once; both the badge count and paintHighlights consume this, so
  // they can't diverge and we don't filter twice per render.
  const matchedRegions = useMemo(() => {
    const q = highlightQuery.trim().toLowerCase();
    if (!q) return [] as SceneRegion[];
    return view.regions.filter(
      (region) => (!region.kind || region.kind === "session") && region.title.toLowerCase().includes(q),
    );
  }, [highlightQuery, view.regions]);
  const matchCount = matchedRegions.length;

  // Track the wrapper's width responsively.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (): void => setBoxW(Math.max(320, el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    setHover(null);
    setRowTransforms({});
    setFocusedRow(null);
    setFocusVisible(false);
    dragRef.current = null;
  }, [view]);

  // Redraw on scene / size / zoom / highlight / focus change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(boxW * dpr);
    canvas.height = Math.round(canvasCssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, boxW, canvasCssHeight);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    if (meta) paintGapBands(ctx, view.scene, meta, gaps);
    renderScene(ctx, view.scene, rowTransforms);
    paintHighlights(ctx, view.scene, matchedRegions, meta, rowTransforms, highlightQuery.trim() !== "");
    if (meta && focusVisible && focusedRow !== null && meta.rows[focusedRow]) {
      const rowMeta = meta.rows[focusedRow];
      ctx.save();
      ctx.strokeStyle = "#5b6cf3";
      ctx.lineWidth = 2;
      ctx.strokeRect(meta.gutter, rowMeta.y, meta.plotWidth, rowMeta.h);
      ctx.restore();
    }
  }, [view, boxW, scale, canvasCssHeight, rowTransforms, highlightQuery, matchedRegions, gaps, focusedRow, focusVisible, meta]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !meta) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.shiftKey) return;
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = (event.clientX - rect.left) / scale;
      const sy = (event.clientY - rect.top) / scale;
      const row = rowAtY(meta, sy);
      if (row === null || sx < meta.gutter) return;
      const factor = delta < 0 ? 1.2 : 1 / 1.2;
      setRowTransforms((current) => {
        const old = current[row] ?? { zoom: 1, offset: 0 };
        const contentX = inverseTransformX(sx, meta, old);
        const next = clampRowTransform(meta, {
          zoom: old.zoom * factor,
          offset: sx - meta.gutter - (contentX - meta.gutter) * old.zoom * factor,
        });
        const updated = { ...current };
        if (next.zoom <= 1.001) delete updated[row];
        else updated[row] = next;
        return updated;
      });
      setHover(null);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [meta, scale]);

  const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const { x, y } = localPoint(event.clientX, event.clientY);
    const drag = dragRef.current;
    if (drag && meta) {
      const deltaSceneX = (x - drag.x) / scale;
      setRowTransforms((current) => ({
        ...current,
        [drag.row]: clampRowTransform(meta, {
          ...(current[drag.row] ?? { zoom: 1, offset: 0 }),
          offset: drag.offset + deltaSceneX,
        }),
      }));
      setHover(null);
      return;
    }

    const sx = x / scale;
    const sy = y / scale;
    const row = rowAtY(meta, sy);
    const rowTransform = row !== null ? rowTransforms[row] : undefined;
    const hitX = meta && rowTransform ? inverseTransformX(sx, meta, rowTransform) : sx;
    const region = view.regions.find((r) => hitX >= r.x && hitX <= r.x + r.w && sy >= r.y && sy <= r.y + r.h);
    setHover(region ? { left: x + 14, top: y + 14, title: region.title, lines: region.lines } : null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!meta) return;
    const { x, y } = localPoint(event.clientX, event.clientY);
    const row = rowAtY(meta, y / scale);
    if (row === null) return;
    setFocusedRow(row);
    setFocusVisible(false);
    const transform = rowTransforms[row];
    if (!transform || transform.zoom <= 1) return;
    dragRef.current = { row, x, offset: transform.offset, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setHover(null);
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>): void => {
    if (!meta) return;
    const { y } = localPoint(event.clientX, event.clientY);
    const row = rowAtY(meta, y / scale);
    if (row === null) return;
    setRowTransforms((current) => {
      if (!current[row]) return current;
      const updated = { ...current };
      delete updated[row];
      return updated;
    });
  };

  // Zoom a row centered on the plot middle — the keyboard equivalent of
  // shift-scroll, so the timeline is usable without a mouse (#22).
  const zoomRow = (row: number, factor: number): void => {
    if (!meta) return;
    setRowTransforms((current) => {
      const old = current[row] ?? { zoom: 1, offset: 0 };
      const centerX = meta.gutter + meta.plotWidth / 2;
      const contentX = inverseTransformX(centerX, meta, old);
      const next = clampRowTransform(meta, {
        zoom: old.zoom * factor,
        offset: centerX - meta.gutter - (contentX - meta.gutter) * old.zoom * factor,
      });
      const updated = { ...current };
      if (next.zoom <= 1.001) delete updated[row];
      else updated[row] = next;
      return updated;
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    if (!meta) return;
    const rowCount = meta.rows.length;
    if (rowCount === 0) return;
    const current = focusedRow ?? -1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setFocusVisible(true);
        setFocusedRow(Math.min(rowCount - 1, current + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setFocusVisible(true);
        setFocusedRow(Math.max(0, current < 0 ? rowCount - 1 : current - 1));
        break;
      case "Home":
        event.preventDefault();
        setFocusVisible(true);
        setFocusedRow(0);
        break;
      case "End":
        event.preventDefault();
        setFocusVisible(true);
        setFocusedRow(rowCount - 1);
        break;
      case "+":
      case "=":
      case "ArrowRight":
        if (focusedRow !== null) {
          event.preventDefault();
          setFocusVisible(true);
          zoomRow(focusedRow, 1.3);
        }
        break;
      case "-":
      case "_":
      case "ArrowLeft":
        if (focusedRow !== null) {
          event.preventDefault();
          setFocusVisible(true);
          zoomRow(focusedRow, 1 / 1.3);
        }
        break;
      case "Escape":
        if (focusedRow !== null) {
          event.preventDefault();
          setFocusVisible(true);
          setRowTransforms((cur) => {
            if (!cur[focusedRow]) return cur;
            const updated = { ...cur };
            delete updated[focusedRow];
            return updated;
          });
        }
        break;
      default:
        break;
    }
  };

  const focusAnnouncement =
    focusVisible && focusedRow !== null && meta?.rows[focusedRow]
      ? `Row ${focusedRow + 1} of ${meta.rows.length}: ${meta.rows[focusedRow].date}${
          rowTransforms[focusedRow] ? `, zoomed ${rowTransforms[focusedRow].zoom.toFixed(1)}×` : ""
        }`
      : "";

  const exportPng = (): void => {
    const scene = view.scene;
    const c = document.createElement("canvas");
    const dpr = 2;
    c.width = Math.round(scene.width * dpr);
    c.height = Math.round(scene.height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, scene.width, scene.height);
    // Export the pure Scene only, so PNG and SVG are byte-faithful to the same
    // model. Gap bands and the highlight spotlight are interactive-only overlays
    // (gap bands aren't scene primitives and so can't appear in the SVG either).
    renderScene(ctx, scene, {});
    c.toBlob((blob) => {
      if (blob) downloadBlob(`${safeFileBase(view.participantId)}-timeline.png`, blob);
    }, "image/png");
  };

  const exportSvg = (): void => {
    downloadBlob(`${safeFileBase(view.participantId)}-timeline.svg`, sceneToSvgBlob(view.scene));
  };

  return (
    <figure className="timeline-view__scene">
      <figcaption className="timeline-view__scene-head">
        <span className="timeline-view__scene-title" data-testid="timeline-view-participant-title">
          {view.participantId}
          <span className="timeline-view__scene-meta"> · {context}</span>
          {highlightQuery.trim() ? (
            <span className="timeline-view__match-count" data-testid="timeline-match-count">
              {" · "}
              {matchCount} match{matchCount === 1 ? "" : "es"}
            </span>
          ) : null}
        </span>
        {allowExport ? (
          <span className="timeline-view__export">
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              data-testid="export-view-png"
              onClick={exportPng}
            >
              Export PNG
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              data-testid="export-view-svg"
              onClick={exportSvg}
            >
              Export SVG
            </button>
          </span>
        ) : null}
      </figcaption>
      <div ref={wrapRef} className="timeline-view__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="timeline-view__canvas"
          style={{ width: "100%", height: `${canvasCssHeight}px` }}
          tabIndex={0}
          role="group"
          aria-label={`Interactive usage timeline for ${view.participantId}. Use arrow keys to move between days; left and right arrows zoom the focused day.`}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={(event) => {
            endDrag(event);
            setHover(null);
          }}
          onDoubleClick={onDoubleClick}
        />
        {hover ? (
          <div className="timeline-view__tooltip" style={{ left: hover.left, top: hover.top }}>
            <strong>{hover.title}</strong>
            {hover.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="visually-hidden" aria-live="polite" data-testid="timeline-focus-announce">
        {focusAnnouncement}
      </div>
    </figure>
  );
}
