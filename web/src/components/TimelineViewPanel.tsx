import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";

import type { Scene } from "@/lib/plotScene";
import type {
  ProcessedFileResult,
  TimelineParticipantView,
  TimelineViewData,
} from "@/lib/types";

type Props = { results: ProcessedFileResult[] };
type ViewType = "app" | "screen";

const VIEW_HEIGHT = 560;
const MIN_SCALE = 0.05;
const MAX_SCALE = 24;

/** Paint a {@link Scene}'s primitives onto a 2D context (already transformed by
 * the caller for zoom/pan). Mirrors the export renderers, reading the same flat
 * primitive list, so the interactive view matches the PNG/SVG plots. */
function renderScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  for (const p of scene.primitives) {
    if (p.type === "rect") {
      // Apply alpha around both fill and stroke (matches renderSceneToCanvas).
      ctx.globalAlpha = p.alpha ?? 1;
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fillRect(p.x, p.y, Math.max(p.w, 0), Math.max(p.h, 0));
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth ?? 1;
        ctx.strokeRect(p.x, p.y, Math.max(p.w, 0), Math.max(p.h, 0));
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
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.beginPath();
      p.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
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
}

type Transform = { scale: number; tx: number; ty: number };
type Hover = { left: number; top: number; title: string; lines: string[] };

/** One participant's day-grid timeline rendered to an interactive canvas:
 * wheel to zoom (about the cursor), drag to pan, hover a bar for details. */
function InteractiveScene({ view }: { view: TimelineParticipantView }): ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; id: number } | null>(null);
  const touchedRef = useRef(false);

  const [boxW, setBoxW] = useState(900);
  const [t, setT] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<Hover | null>(null);

  // Track the wrapper's width responsively.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (): void => setBoxW(Math.max(320, el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A new scene resets the "user has interacted" flag so it auto-fits again.
  useEffect(() => {
    touchedRef.current = false;
  }, [view]);

  // Fit the scene to the available width until the user zooms/pans.
  useEffect(() => {
    if (touchedRef.current) return;
    setT({ scale: boxW / Math.max(view.scene.width, 1), tx: 0, ty: 0 });
  }, [view, boxW]);

  // Redraw on transform / scene / size change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(boxW * dpr);
    canvas.height = Math.round(VIEW_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, boxW, VIEW_HEIGHT);
    ctx.setTransform(dpr * t.scale, 0, 0, dpr * t.scale, dpr * t.tx, dpr * t.ty);
    renderScene(ctx, view.scene);
  }, [t, view, boxW]);

  // Wheel-zoom via a native non-passive listener (React onWheel is passive, so
  // preventDefault there warns and the page scrolls through).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      touchedRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      setT((prev) => {
        const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
        const sx = (cx - prev.tx) / prev.scale;
        const sy = (cy - prev.ty) / prev.scale;
        return { scale, tx: cx - sx * scale, ty: cy - sy * scale };
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    dragRef.current = { x: event.clientX, y: event.clientY, tx: t.tx, ty: t.ty, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag) {
      touchedRef.current = true;
      setHover(null);
      setT((prev) => ({ ...prev, tx: drag.tx + (event.clientX - drag.x), ty: drag.ty + (event.clientY - drag.y) }));
      return;
    }
    const { x, y } = localPoint(event.clientX, event.clientY);
    const sx = (x - t.tx) / t.scale;
    const sy = (y - t.ty) / t.scale;
    const region = view.regions.find((r) => sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h);
    setHover(region ? { left: x + 14, top: y + 14, title: region.title, lines: region.lines } : null);
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const fit = (): void => {
    touchedRef.current = false;
    setT({ scale: boxW / Math.max(view.scene.width, 1), tx: 0, ty: 0 });
  };
  const zoomCenter = (factor: number): void => {
    touchedRef.current = true;
    setT((prev) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      const cx = boxW / 2;
      const cy = VIEW_HEIGHT / 2;
      const sx = (cx - prev.tx) / prev.scale;
      const sy = (cy - prev.ty) / prev.scale;
      return { scale, tx: cx - sx * scale, ty: cy - sy * scale };
    });
  };

  return (
    <figure className="timeline-view__scene">
      <figcaption className="timeline-view__scene-head">
        <span className="timeline-view__scene-title">{view.participantId}</span>
        <span className="timeline-view__scene-actions">
          <button type="button" className="btn btn--ghost" onClick={fit}>Fit</button>
          <button type="button" className="btn btn--ghost" onClick={() => zoomCenter(1.3)}>Zoom in</button>
          <button type="button" className="btn btn--ghost" onClick={() => zoomCenter(1 / 1.3)}>Zoom out</button>
        </span>
      </figcaption>
      <div ref={wrapRef} className="timeline-view__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="timeline-view__canvas"
          style={{ width: `${boxW}px`, height: `${VIEW_HEIGHT}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={(event) => {
            endDrag(event);
            setHover(null);
          }}
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

export function TimelineViewPanel({ results }: Props): ReactElement {
  const filesWithView = results.filter(
    (r): r is ProcessedFileResult & { timelineView: TimelineViewData } =>
      !!r.timelineView && (r.timelineView.app.length > 0 || r.timelineView.screen.length > 0),
  );

  const [selectedFile, setSelectedFile] = useState<string>("");
  const [selectedType, setSelectedType] = useState<ViewType>("app");

  if (filesWithView.length === 0) {
    return (
      <section className="timeline-view" aria-label="Timeline viewer" data-testid="timeline-view">
        <p className="timeline-view__empty" data-testid="timeline-view-empty">
          No timeline to view yet. Enable <strong>Timeline viewer</strong> in Settings and process a
          file — the interactive day-grid timelines appear here.
        </p>
      </section>
    );
  }

  // Resolve the effective file (fall back to the first available) so the panel
  // stays valid when results change or nothing has been picked yet.
  const activeFile =
    filesWithView.find((r) => r.inputFileName === selectedFile) ?? filesWithView[0]!;
  const availableTypes: ViewType[] = [
    ...(activeFile.timelineView.app.length > 0 ? (["app"] as const) : []),
    ...(activeFile.timelineView.screen.length > 0 ? (["screen"] as const) : []),
  ];
  const activeType: ViewType = availableTypes.includes(selectedType)
    ? selectedType
    : availableTypes[0]!;
  const views: TimelineParticipantView[] = activeFile.timelineView[activeType];

  const typeLabel: Record<ViewType, string> = { app: "App usage", screen: "Screen usage" };

  return (
    <section className="timeline-view" aria-label="Timeline viewer" data-testid="timeline-view">
      <div className="timeline-view__controls">
        <label className="timeline-view__field">
          <span>File</span>
          <select
            data-testid="timeline-view-file"
            value={activeFile.inputFileName}
            onChange={(event) => setSelectedFile(event.target.value)}
          >
            {filesWithView.map((r) => (
              <option key={r.inputFileName} value={r.inputFileName}>
                {r.inputFileName}
              </option>
            ))}
          </select>
        </label>
        <label className="timeline-view__field">
          <span>View</span>
          <select
            data-testid="timeline-view-type"
            value={activeType}
            onChange={(event) => setSelectedType(event.target.value as ViewType)}
          >
            {availableTypes.map((type) => (
              <option key={type} value={type}>
                {typeLabel[type]}
              </option>
            ))}
          </select>
        </label>
        <span className="timeline-view__hint">Scroll to zoom · drag to pan · hover a bar for details</span>
      </div>

      {views.map((view) => (
        <InteractiveScene key={`${activeFile.inputFileName}:${activeType}:${view.participantId}`} view={view} />
      ))}
    </section>
  );
}
