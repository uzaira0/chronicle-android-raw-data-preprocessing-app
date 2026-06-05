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

/** Paint a {@link Scene}'s primitives onto a 2D context (already scaled by the
 * caller). Mirrors the export renderers, reading the same flat
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

type Hover = { left: number; top: number; title: string; lines: string[] };

/** One participant's bare waterfall timeline rendered fit-to-width on a tall
 * canvas. The page scrolls vertically; hover stays in scene coordinates. */
function InteractiveScene({ view }: { view: TimelineParticipantView }): ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [boxW, setBoxW] = useState(900);
  const [hover, setHover] = useState<Hover | null>(null);
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
    renderScene(ctx, view.scene);
  }, [view, boxW, scale, canvasCssHeight]);

  const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const { x, y } = localPoint(event.clientX, event.clientY);
    const sx = x / scale;
    const sy = y / scale;
    const region = view.regions.find((r) => sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h);
    setHover(region ? { left: x + 14, top: y + 14, title: region.title, lines: region.lines } : null);
  };

  return (
    <figure className="timeline-view__scene">
      <figcaption className="timeline-view__scene-head">
        <span className="timeline-view__scene-title">{view.participantId}</span>
      </figcaption>
      <div ref={wrapRef} className="timeline-view__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="timeline-view__canvas"
          style={{ width: "100%", height: `${canvasCssHeight}px` }}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
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
          file — the interactive waterfall timelines appear here.
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
        <span className="timeline-view__hint">Hover a bar for details · scroll for more days</span>
      </div>

      {views.map((view) => (
        <InteractiveScene key={`${activeFile.inputFileName}:${activeType}:${view.participantId}`} view={view} />
      ))}
    </section>
  );
}
