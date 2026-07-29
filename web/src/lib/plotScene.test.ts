import { describe, expect, it } from "vitest";

import { parseFont, renderSceneToSvg, sceneToSvgBlob, type Scene } from "@/lib/plotScene";

describe("parseFont", () => {
  it("extracts size, weight and family from a Canvas font shorthand", () => {
    expect(parseFont("bold 16px system-ui, sans-serif")).toEqual({
      fontSize: "16px",
      fontWeight: "bold",
      fontFamily: "system-ui, sans-serif",
    });
    expect(parseFont("11px system-ui, sans-serif")).toEqual({
      fontSize: "11px",
      fontWeight: "normal",
      fontFamily: "system-ui, sans-serif",
    });
  });

  it("falls back to a default size/family for an unparseable font", () => {
    expect(parseFont("")).toEqual({ fontSize: "13px", fontWeight: "normal", fontFamily: "system-ui, sans-serif" });
  });

  it("keeps the default family when a size token has nothing after it", () => {
    // A bare size with no family stack: the slice after the size token is empty,
    // so the family must stay the default rather than becoming "".
    expect(parseFont("16px")).toEqual({
      fontSize: "16px",
      fontWeight: "normal",
      fontFamily: "system-ui, sans-serif",
    });
  });
});

describe("renderSceneToSvg", () => {
  const scene: Scene = {
    width: 200,
    height: 100,
    primitives: [
      { type: "rect", x: 0, y: 0, w: 200, h: 100, fill: "#ffffff" },
      { type: "rect", x: 10, y: 20, w: 30, h: 40, fill: "#e6194b", alpha: 0.35 },
      { type: "rect", x: 5, y: 5, w: 190, h: 90, stroke: "#ccc", strokeWidth: 1 }, // border, no fill
      { type: "line", x1: 0, y1: 50, x2: 200, y2: 50, stroke: "#cccccc", strokeWidth: 1, dash: [4, 4] },
      { type: "text", x: 100, y: 10, text: "A & B <chart>", fill: "#111", font: "bold 16px system-ui, sans-serif", anchor: "middle", baseline: "alphabetic" },
      { type: "poly", points: [[0, 0], [5, 10], [10, 0]], fill: "green", closed: true },
    ],
  };

  it("emits a well-formed SVG root with the scene's dimensions", () => {
    const svg = renderSceneToSvg(scene);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="100"');
    expect(svg).toContain('viewBox="0 0 200 100"');
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it("renders each primitive type with the expected attributes", () => {
    const svg = renderSceneToSvg(scene);
    expect(svg).toContain('<rect x="10" y="20" width="30" height="40" fill="#e6194b" fill-opacity="0.35"');
    expect(svg).toContain('fill="none" stroke="#ccc" stroke-width="1"'); // border rect
    expect(svg).toContain('stroke-dasharray="4,4"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('fill="green"');
  });

  it("escapes XML metacharacters in text content", () => {
    const svg = renderSceneToSvg(scene);
    expect(svg).toContain("A &amp; B &lt;chart&gt;");
    expect(svg).not.toContain("<chart>");
  });

  it("omits fill-opacity for fully opaque rects", () => {
    const svg = renderSceneToSvg({
      width: 1,
      height: 1,
      primitives: [{ type: "rect", x: 0, y: 0, w: 1, h: 1, fill: "#000" }],
    });
    expect(svg).not.toContain("fill-opacity");
  });

  it("produces an image/svg+xml blob", () => {
    const blob = sceneToSvgBlob(scene);
    expect(blob.type).toBe("image/svg+xml");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("defaults stroke-width to 1 for stroked rect/line/poly that omit it", () => {
    const svg = renderSceneToSvg({
      width: 20,
      height: 20,
      primitives: [
        // rect with a stroke but no strokeWidth → stroke-width defaults to 1.
        { type: "rect", x: 0, y: 0, w: 5, h: 5, stroke: "#abc" },
        // line with a stroke but no strokeWidth → stroke-width defaults to 1.
        { type: "line", x1: 0, y1: 0, x2: 10, y2: 10, stroke: "#def" },
        // stroked polygon carrying an explicit width (the ?? left operand).
        { type: "poly", points: [[0, 0], [5, 5], [5, 0]], stroke: "#111", strokeWidth: 3, closed: true },
        // stroked, fill-less, OPEN poly with no width → polyline + default width.
        { type: "poly", points: [[1, 1], [2, 2]], stroke: "#222" },
      ],
    });
    // rect: no fill → fill="none"; stroke present; default width 1.
    expect(svg).toContain('<rect x="0" y="0" width="5" height="5" fill="none" stroke="#abc" stroke-width="1"');
    // line without an explicit width still renders stroke-width="1".
    expect(svg).toContain('stroke="#def" stroke-width="1"');
    // fill-less polygon carries its explicit stroke-width and fill="none".
    expect(svg).toContain('<polygon points="0,0 5,5 5,0" fill="none" stroke="#111" stroke-width="3"');
    // open poly → <polyline>, default stroke-width 1.
    expect(svg).toContain('<polyline points="1,1 2,2" fill="none" stroke="#222" stroke-width="1"');
  });
});
