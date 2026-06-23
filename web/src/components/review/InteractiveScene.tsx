import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement } from "react";

import type { Primitive, Scene, WaterfallSceneMeta } from "@/lib/plotScene";
import type { TimelineParticipantView } from "@/lib/types";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";

type RowTransform = { zoom: number; offset: number };
type RowTransforms = Record<number, RowTransform>;

const MAX_ROW_ZOOM = 24;

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
    const rowMeta = meta.rows[row]!;
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

function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, transforms: RowTransforms): void {
  const meta = scene.meta?.kind === "waterfall" ? scene.meta : undefined;
  for (const p of scene.primitives) {
    const row = dataRowForPrimitive(meta, p);
    const rowTransform = row !== null ? transforms[row] : undefined;
    if (meta && row !== null && rowTransform && rowTransform.zoom > 1) {
      const rowMeta = meta.rows[row]!;
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
}: {
  view: TimelineParticipantView;
  context: string;
}): ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ row: number; x: number; offset: number; pointerId: number } | null>(null);

  const [boxW, setBoxW] = useState(900);
  const [hover, setHover] = useState<Hover | null>(null);
  const [rowTransforms, setRowTransforms] = useState<RowTransforms>({});
  const meta = view.scene.meta?.kind === "waterfall" ? view.scene.meta : undefined;
  const scale = boxW / Math.max(view.scene.width, 1);
  const canvasCssHeight = Math.max(1, view.scene.height * scale);

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
    dragRef.current = null;
  }, [view]);

  // Redraw on scene / size change.
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
    renderScene(ctx, view.scene, rowTransforms);
  }, [view, boxW, scale, canvasCssHeight, rowTransforms]);

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

  return (
    <figure className="timeline-view__scene">
      <figcaption className="timeline-view__scene-head">
        <span className="timeline-view__scene-title" data-testid="timeline-view-participant-title">
          {view.participantId}
          <span className="timeline-view__scene-meta"> · {context}</span>
        </span>
      </figcaption>
      <div ref={wrapRef} className="timeline-view__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="timeline-view__canvas"
          style={{ width: "100%", height: `${canvasCssHeight}px` }}
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
    </figure>
  );
}
