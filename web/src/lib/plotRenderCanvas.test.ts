import { describe, expect, it } from "vitest";

import { renderSceneToCanvas } from "@/lib/plotGenerator";
import type { Scene } from "@/lib/plotScene";

/**
 * renderSceneToCanvas takes an abstract 2D-context interface, so the raster
 * paint path is unit-testable with a recording stub — no real canvas. The
 * assertions pin the call sequence per primitive type, which is exactly what
 * keeps the PNG twin in lockstep with the SVG renderer.
 */

type Call = [string, ...unknown[]];

function recordingCtx() {
  const calls: Call[] = [];
  const sets: Record<string, unknown[]> = {};
  const target = {
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  } as Record<string, unknown>;
  const ctx = new Proxy(target, {
    get(obj, prop: string) {
      if (prop in obj) return obj[prop];
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
      };
    },
    set(obj, prop: string, value) {
      (sets[prop] ??= []).push(value);
      obj[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as never, calls, sets };
}

describe("renderSceneToCanvas", () => {
  it("paints rect (fill+stroke+alpha), text (anchors), line (dash) and poly primitives in order", () => {
    const scene: Scene = {
      width: 100,
      height: 50,
      primitives: [
        { type: "rect", x: 1, y: 2, w: 3, h: 4, fill: "#111", stroke: "#222", strokeWidth: 2, alpha: 0.5 },
        { type: "rect", x: 5, y: 6, w: 7, h: 8 },
        { type: "text", x: 10, y: 11, text: "start", font: "10px sans", fill: "#333", anchor: "start", baseline: "top" },
        { type: "text", x: 12, y: 13, text: "mid", font: "10px sans", fill: "#333", anchor: "middle", baseline: "middle" },
        { type: "text", x: 14, y: 15, text: "end", font: "10px sans", fill: "#333", anchor: "end", baseline: "alphabetic" },
        { type: "line", x1: 0, y1: 0, x2: 9, y2: 9, stroke: "#444", strokeWidth: 3, dash: [4, 2] },
        { type: "line", x1: 1, y1: 1, x2: 2, y2: 2, stroke: "#555" },
        { type: "poly", points: [[0, 0], [4, 0], [4, 4]], closed: true, fill: "#666", stroke: "#777", strokeWidth: 2 },
        { type: "poly", points: [[9, 9], [10, 10]], closed: false },
      ],
    };

    const { ctx, calls, sets } = recordingCtx();
    renderSceneToCanvas(ctx, scene);

    const names = calls.map(([name]) => name);
    // rect #1: fill then stroke under alpha 0.5
    expect(names.slice(0, 2)).toEqual(["fillRect", "setLineDash"]);
    expect(calls.filter(([name]) => name === "strokeRect")).toHaveLength(1);
    expect(sets.globalAlpha).toContain(0.5);
    // texts: all three anchors set
    expect(sets.textAlign).toEqual(expect.arrayContaining(["left", "center", "right"]));
    expect(calls.filter(([name]) => name === "fillText")).toHaveLength(3);
    // lines: dash applied then cleared
    const dashCalls = calls.filter(([name]) => name === "setLineDash").map(([, dash]) => dash);
    expect(dashCalls).toEqual(expect.arrayContaining([[4, 2], []]));
    expect(calls.filter(([name]) => name === "stroke").length).toBeGreaterThanOrEqual(3);
    // polys: closed one closes the path and fills; open one neither
    expect(calls.filter(([name]) => name === "closePath")).toHaveLength(1);
    expect(calls.filter(([name]) => name === "fill")).toHaveLength(1);
    expect(calls.filter(([name]) => name === "moveTo").length).toBeGreaterThanOrEqual(3);
    // trailing reset
    expect(sets.textBaseline?.at(-1)).toBe("alphabetic");
    expect(sets.textAlign?.at(-1)).toBe("left");
  });

  it("defaults lineWidth to 1 for a stroked rect and stroked poly that omit strokeWidth", () => {
    const scene: Scene = {
      width: 10,
      height: 10,
      primitives: [
        // rect: stroke set, strokeWidth omitted → lineWidth defaults to 1.
        { type: "rect", x: 0, y: 0, w: 2, h: 2, stroke: "#abc" },
        // poly: stroke set, no fill, strokeWidth omitted → lineWidth defaults to 1.
        { type: "poly", points: [[0, 0], [1, 1], [1, 0]], stroke: "#def", closed: true },
      ],
    };

    const { ctx, calls, sets } = recordingCtx();
    renderSceneToCanvas(ctx, scene);

    // Both stroked primitives ran their stroke path with the default width.
    expect(sets.lineWidth).toContain(1);
    expect(calls.filter(([name]) => name === "strokeRect")).toHaveLength(1);
    expect(calls.filter(([name]) => name === "closePath")).toHaveLength(1);
    // A fill-less poly never fills.
    expect(calls.filter(([name]) => name === "fill")).toHaveLength(0);
  });
});
