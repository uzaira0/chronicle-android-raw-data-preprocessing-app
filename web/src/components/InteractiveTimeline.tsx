import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { CATEGORY_COLORS } from "@/lib/plotGenerator";
import {
  fitViewport,
  hitTest,
  layoutTimeline,
  nsToX,
  panViewport,
  TIMELINE_MARGIN,
  timelineHeight,
  xToNs,
  zoomViewport,
  type TimelineViewport,
} from "@/lib/timelineGeometry";
import type { TimelineData, TimelineSession } from "@/lib/types";

const SCREEN_COLOR = "#9aa3ad";
const DEFAULT_WIDTH = 900;

function formatInstant(ns: bigint, timezone: string): string {
  const ms = Number(ns / 1_000_000n);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function colorFor(session: TimelineSession): string {
  if (session.kind === "screen") return SCREEN_COLOR;
  return CATEGORY_COLORS[session.category] ?? CATEGORY_COLORS.Unknown ?? "#888888";
}

type HoverState = { session: TimelineSession; left: number; top: number };

export function InteractiveTimeline({ data }: { data: TimelineData }): ReactElement {
  const { sessions, participants, timezone } = data;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number } | null>(null);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [viewport, setViewport] = useState<TimelineViewport>(() => fitViewport(sessions));
  const [showApp, setShowApp] = useState(true);
  const [showScreen, setShowScreen] = useState(true);
  const [hover, setHover] = useState<HoverState | null>(null);

  const visibleKinds = useMemo(() => {
    const set = new Set<TimelineSession["kind"]>();
    if (showApp) set.add("app");
    if (showScreen) set.add("screen");
    return set;
  }, [showApp, showScreen]);

  // Keep the latest viewport/width for the native (non-passive) wheel listener.
  const viewRef = useRef({ viewport, width });
  viewRef.current = { viewport, width };

  const height = timelineHeight(participants.length);
  const layout = useMemo(
    () => layoutTimeline(sessions, viewport, width, visibleKinds),
    [sessions, viewport, width, visibleKinds],
  );

  // Wheel-zoom via a native non-passive listener (React's onWheel is passive,
  // so preventDefault there warns and the page scrolls through).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const { viewport: vp, width: w } = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const focusNs = xToNs(event.clientX - rect.left, vp, w);
      setViewport((current) => zoomViewport(current, focusNs, event.deltaY < 0 ? 1.2 : 1 / 1.2));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Track container width responsively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => setWidth(Math.max(320, el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Draw the scene whenever the layout changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Time-axis ticks.
    ctx.fillStyle = "#5b6671";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const ns = viewport.startNs + ((viewport.endNs - viewport.startNs) * BigInt(i)) / BigInt(tickCount);
      const x = nsToX(ns, viewport, width);
      ctx.strokeStyle = "#e6e9ec";
      ctx.beginPath();
      ctx.moveTo(x, TIMELINE_MARGIN.top);
      ctx.lineTo(x, height - TIMELINE_MARGIN.bottom);
      ctx.stroke();
      ctx.textAlign = i === tickCount ? "end" : "start";
      ctx.fillStyle = "#5b6671";
      ctx.fillText(formatInstant(ns, timezone).replace(", ", " "), x + (i === tickCount ? -2 : 2), 16);
    }

    // Participant row labels.
    ctx.textAlign = "end";
    ctx.fillStyle = "#1f2933";
    ctx.textBaseline = "middle";
    for (const row of layout.rows) {
      ctx.fillText(row.participantId, TIMELINE_MARGIN.left - 8, row.y + row.height / 2, TIMELINE_MARGIN.left - 12);
    }

    // Session bands.
    for (const rect of layout.rects) {
      const session = sessions[rect.sessionIndex]!;
      ctx.fillStyle = colorFor(session);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }, [layout, sessions, viewport, width, height, timezone, participants.length]);

  const localX = (clientX: number): number => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return clientX - (rect?.left ?? 0);
  };
  const localY = (clientY: number): number => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return clientY - (rect?.top ?? 0);
  };

  return (
    <section className="timeline" aria-label="Interactive timeline" data-testid="interactive-timeline">
      <div className="timeline__controls">
        <span className="timeline__title">Timeline explorer</span>
        <button type="button" className="btn btn--ghost" data-testid="timeline-fit" onClick={() => setViewport(fitViewport(sessions))}>
          Fit all
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setViewport((v) => zoomViewport(v, (v.startNs + v.endNs) / 2n, 1.5))}>
          Zoom in
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setViewport((v) => zoomViewport(v, (v.startNs + v.endNs) / 2n, 1 / 1.5))}>
          Zoom out
        </button>
        <label className="timeline__layer">
          <input type="checkbox" checked={showApp} onChange={(e) => setShowApp(e.target.checked)} data-testid="timeline-layer-app" /> App
        </label>
        <label className="timeline__layer">
          <input type="checkbox" checked={showScreen} onChange={(e) => setShowScreen(e.target.checked)} data-testid="timeline-layer-screen" /> Screen
        </label>
      </div>
      <div ref={containerRef} className="timeline__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="timeline__canvas"
          style={{ width: `${width}px`, height: `${height}px` }}
          onPointerDown={(e) => {
            dragRef.current = { x: e.clientX };
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (drag) {
              const dx = e.clientX - drag.x;
              if (Math.abs(dx) > 0) {
                drag.x = e.clientX;
                const plotWidth = width - TIMELINE_MARGIN.left - TIMELINE_MARGIN.right;
                setViewport((v) => panViewport(v, plotWidth > 0 ? -dx / plotWidth : 0));
              }
              return;
            }
            const idx = hitTest(layout, localX(e.clientX), localY(e.clientY));
            if (idx === null) {
              setHover(null);
            } else {
              setHover({ session: sessions[idx]!, left: localX(e.clientX) + 12, top: localY(e.clientY) + 12 });
            }
          }}
          onPointerUp={(e) => {
            dragRef.current = null;
            (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
          }}
          onPointerLeave={() => {
            dragRef.current = null;
            setHover(null);
          }}
        />
        {hover && (
          <div className="timeline__tooltip" style={{ left: hover.left, top: hover.top }} data-testid="timeline-tooltip">
            <strong>{hover.session.appLabel || hover.session.appPackage || "(unknown)"}</strong>
            <div>{hover.session.appPackage}</div>
            <div>{hover.session.kind === "app" ? hover.session.category : "Screen"}</div>
            <div>{formatInstant(hover.session.startNs, timezone)} → {formatInstant(hover.session.stopNs, timezone)}</div>
            <div>
              {(Number(hover.session.stopNs - hover.session.startNs) / 60_000_000_000).toFixed(2)} min ·{" "}
              {hover.session.interactionType}
              {hover.session.usageLayer ? ` · ${hover.session.usageLayer}` : ""}
            </div>
          </div>
        )}
      </div>
      <p className="timeline__hint">Scroll to zoom · drag to pan · hover a band for details</p>
    </section>
  );
}
