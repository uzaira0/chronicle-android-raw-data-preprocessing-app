// Runtime for the exported standalone timeline viewer (#18).
//
// This file is inlined verbatim into the exported .html (via `?raw`) as a
// classic <script>, so it must run in any browser straight from `file://`
// with no modules, no imports, and no network. It is a faithful vanilla-JS
// port of the in-app `InteractiveScene` (TimelineViewPanel.tsx): each
// participant canvas renders fit-to-width, the page scrolls vertically, and
// hover hit-testing reads the same `SceneRegion` boxes embedded as JSON.
//
// Kept as a real .js file (not a template literal) so `node --check` and the
// e2e "open the export and exercise it" test can catch errors in it.
(function () {
  "use strict";

  var dataEl = document.getElementById("tv-data");
  if (!dataEl) return;
  var DATA = JSON.parse(dataEl.textContent || "{}");
  DATA.app = DATA.app || [];
  DATA.screen = DATA.screen || [];

  var MAX_ROW_ZOOM = 24;

  function rowAtY(meta, y) {
    if (!meta) return null;
    for (var i = 0; i < meta.rows.length; i++) {
      var row = meta.rows[i];
      if (y >= row.y && y < row.y + row.h) return i;
    }
    return null;
  }

  function clampRowTransform(meta, transform) {
    var zoom = Math.max(1, Math.min(MAX_ROW_ZOOM, transform.zoom));
    if (zoom <= 1.001) return { zoom: 1, offset: 0 };
    var minOffset = meta.plotWidth - meta.plotWidth * zoom;
    return { zoom: zoom, offset: Math.min(0, Math.max(minOffset, transform.offset)) };
  }

  function transformX(x, meta, transform) {
    return meta.gutter + (x - meta.gutter) * transform.zoom + transform.offset;
  }

  function inverseTransformX(x, meta, transform) {
    return meta.gutter + (x - meta.gutter - transform.offset) / transform.zoom;
  }

  function dataRowForPrimitive(meta, p) {
    if (!meta) return null;
    if (p.type === "rect") {
      if (p.x + p.w < meta.gutter) return null;
      var row = rowAtY(meta, p.y + p.h / 2);
      if (row === null) return null;
      var rowMeta = meta.rows[row];
      if (p.y < rowMeta.y - 0.01 || p.y + p.h > rowMeta.y + rowMeta.h + 0.01) return null;
      return row;
    }
    if (p.type === "line") {
      if (Math.abs(p.x1 - p.x2) > 0.01) return null;
      if (p.x1 < meta.gutter - 16) return null;
      return rowAtY(meta, (p.y1 + p.y2) / 2);
    }
    if (p.type === "poly") {
      var sumY = 0;
      var maxX = -Infinity;
      for (var i = 0; i < p.points.length; i++) {
        sumY += p.points[i][1];
        maxX = Math.max(maxX, p.points[i][0]);
      }
      if (maxX < meta.gutter - 16) return null;
      return rowAtY(meta, sumY / Math.max(1, p.points.length));
    }
    return null;
  }

  function paintPrimitive(ctx, p, meta, rowTransform) {
    function tx(x) {
      return meta && rowTransform ? transformX(x, meta, rowTransform) : x;
    }
    function scaledWidth(x, w) {
      return meta && rowTransform ? tx(x + w) - tx(x) : Math.max(w, 0);
    }
    function preserveGlyphX(points, x) {
      if (!meta || !rowTransform) return x;
      var minX = Infinity;
      var maxX = -Infinity;
      for (var i = 0; i < points.length; i++) {
        minX = Math.min(minX, points[i][0]);
        maxX = Math.max(maxX, points[i][0]);
      }
      var center = (minX + maxX) / 2;
      return tx(center) + (x - center);
    }
    if (p.type === "rect") {
      ctx.globalAlpha = p.alpha == null ? 1 : p.alpha;
      var x = tx(p.x);
      var w = Math.max(scaledWidth(p.x, p.w), 0);
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fillRect(x, p.y, w, Math.max(p.h, 0));
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth == null ? 1 : p.strokeWidth;
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
      ctx.lineWidth = p.strokeWidth == null ? 1 : p.strokeWidth;
      ctx.setLineDash(p.dash || []);
      ctx.beginPath();
      ctx.moveTo(tx(p.x1), p.y1);
      ctx.lineTo(tx(p.x2), p.y2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (p.type === "poly") {
      ctx.beginPath();
      for (var j = 0; j < p.points.length; j++) {
        var pt = p.points[j];
        var px = preserveGlyphX(p.points, pt[0]);
        if (j === 0) ctx.moveTo(px, pt[1]);
        else ctx.lineTo(px, pt[1]);
      }
      if (p.closed) ctx.closePath();
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill();
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth == null ? 1 : p.strokeWidth;
        ctx.stroke();
      }
    }
  }

  // Paint a Scene's primitives onto an already-scaled 2D context. Mirrors
  // renderScene in TimelineViewPanel.tsx and renderSceneToCanvas in
  // plotGenerator.ts, reading the identical primitive list.
  function renderScene(ctx, scene, transforms) {
    var prims = scene.primitives || [];
    var meta = scene.meta && scene.meta.kind === "waterfall" ? scene.meta : null;
    for (var i = 0; i < prims.length; i++) {
      var p = prims[i];
      var rowIndex = dataRowForPrimitive(meta, p);
      var rowTransform = rowIndex !== null ? transforms[rowIndex] : null;
      if (meta && rowIndex !== null && rowTransform && rowTransform.zoom > 1) {
        var row = meta.rows[rowIndex];
        ctx.save();
        ctx.beginPath();
        ctx.rect(meta.gutter, row.y, meta.plotWidth, row.h);
        ctx.clip();
        paintPrimitive(ctx, p, meta, rowTransform);
        ctx.restore();
      } else {
        paintPrimitive(ctx, p, meta, rowTransform);
      }
    }
  }

  function makeController(fig) {
    var type = fig.getAttribute("data-tv-type");
    var index = parseInt(fig.getAttribute("data-tv-index"), 10);
    var view = (DATA[type] || [])[index];
    var canvas = fig.querySelector(".tv-canvas");
    var wrap = fig.querySelector(".tv-canvas-wrap");
    var tooltip = fig.querySelector(".tv-tooltip");
    if (!view || !canvas || !wrap) return null;

    var scene = view.scene || { width: 1, height: 1, primitives: [] };
    var regions = view.regions || [];
    var meta = scene.meta && scene.meta.kind === "waterfall" ? scene.meta : null;
    var state = { scale: 1, boxW: 0, sized: false, transforms: {}, drag: null };

    function hideTip() {
      if (tooltip) tooltip.hidden = true;
    }

    function showTip(left, top, region) {
      if (!tooltip) return;
      tooltip.textContent = "";
      var strong = document.createElement("strong");
      strong.textContent = region.title;
      tooltip.appendChild(strong);
      for (var i = 0; i < region.lines.length; i++) {
        var div = document.createElement("div");
        div.textContent = region.lines[i];
        tooltip.appendChild(div);
      }
      tooltip.style.left = left + "px";
      tooltip.style.top = top + "px";
      tooltip.hidden = false;
    }

    function draw() {
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      var dpr = window.devicePixelRatio || 1;
      var boxW = state.boxW;
      var cssH = Math.max(1, scene.height * state.scale);
      canvas.width = Math.round(boxW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = "100%";
      canvas.style.height = cssH + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, boxW, cssH);
      ctx.setTransform(dpr * state.scale, 0, 0, dpr * state.scale, 0, 0);
      renderScene(ctx, scene, state.transforms);
    }

    // Size to the wrapper's width and (re)draw. Lazy: a canvas in a hidden tab
    // panel reports clientWidth 0, so it is sized only once its panel is shown.
    function activate() {
      var w = Math.max(320, wrap.getBoundingClientRect().width);
      if (state.sized && w === state.boxW) return;
      state.boxW = w;
      state.scale = state.boxW / Math.max(scene.width, 1);
      state.sized = true;
      hideTip();
      draw();
    }

    canvas.addEventListener(
      "wheel",
      function (e) {
        if (!meta || !e.shiftKey) return;
        var delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        if (delta === 0) return;
        e.preventDefault();
        var rect = canvas.getBoundingClientRect();
        var sx = (e.clientX - rect.left) / state.scale;
        var sy = (e.clientY - rect.top) / state.scale;
        var row = rowAtY(meta, sy);
        if (row === null || sx < meta.gutter) return;
        var factor = delta < 0 ? 1.2 : 1 / 1.2;
        var old = state.transforms[row] || { zoom: 1, offset: 0 };
        var contentX = inverseTransformX(sx, meta, old);
        var next = clampRowTransform(meta, {
          zoom: old.zoom * factor,
          offset: sx - meta.gutter - (contentX - meta.gutter) * old.zoom * factor,
        });
        if (next.zoom <= 1.001) delete state.transforms[row];
        else state.transforms[row] = next;
        state.drag = null;
        hideTip();
        draw();
      },
      { passive: false },
    );

    canvas.addEventListener("pointerdown", function (e) {
      if (!meta) return;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var row = rowAtY(meta, y / state.scale);
      if (row === null) return;
      var transform = state.transforms[row];
      if (!transform || transform.zoom <= 1) return;
      state.drag = { row: row, x: x, offset: transform.offset, pointerId: e.pointerId };
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      hideTip();
    });

    canvas.addEventListener("pointermove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      if (state.drag && meta) {
        var deltaSceneX = (x - state.drag.x) / state.scale;
        var current = state.transforms[state.drag.row] || { zoom: 1, offset: 0 };
        state.transforms[state.drag.row] = clampRowTransform(meta, {
          zoom: current.zoom,
          offset: state.drag.offset + deltaSceneX,
        });
        hideTip();
        draw();
        return;
      }
      var sx = x / state.scale;
      var sy = y / state.scale;
      var row = rowAtY(meta, sy);
      var rowTransform = row !== null ? state.transforms[row] : null;
      var hitX = meta && rowTransform ? inverseTransformX(sx, meta, rowTransform) : sx;
      var hit = null;
      for (var i = 0; i < regions.length; i++) {
        var r = regions[i];
        if (hitX >= r.x && hitX <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) {
          hit = r;
          break;
        }
      }
      if (hit) showTip(x + 14, y + 14, hit);
      else hideTip();
    });

    function endDrag(e) {
      state.drag = null;
      if (e && canvas.releasePointerCapture) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (_) {
          // Some browsers throw if capture was already released.
        }
      }
    }

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointerleave", function (e) {
      endDrag(e);
      hideTip();
    });

    canvas.addEventListener("dblclick", function (e) {
      if (!meta) return;
      var rect = canvas.getBoundingClientRect();
      var y = e.clientY - rect.top;
      var row = rowAtY(meta, y / state.scale);
      if (row === null || !state.transforms[row]) return;
      delete state.transforms[row];
      hideTip();
      draw();
    });

    return { activate: activate };
  }

  var controllers = { app: [], screen: [] };
  var figs = document.querySelectorAll(".tv-scene");
  for (var f = 0; f < figs.length; f++) {
    var fig = figs[f];
    var type = fig.getAttribute("data-tv-type");
    var controller = makeController(fig);
    if (controller && controllers[type]) controllers[type].push(controller);
  }

  var current = null;

  function show(which) {
    var keys = ["app", "screen"];
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var panel = document.querySelector('[data-tv-panel="' + key + '"]');
      var tab = document.querySelector('[data-tv-tab="' + key + '"]');
      if (panel) panel.classList.toggle("is-active", key === which);
      if (tab) tab.setAttribute("aria-selected", String(key === which));
    }
    current = which;
    var list = controllers[which] || [];
    for (var j = 0; j < list.length; j++) list[j].activate();
  }

  var tabs = document.querySelectorAll("[data-tv-tab]");
  for (var t = 0; t < tabs.length; t++) {
    (function (tab) {
      tab.addEventListener("click", function () {
        show(tab.getAttribute("data-tv-tab"));
      });
    })(tabs[t]);
  }

  window.addEventListener("resize", function () {
    if (!current) return;
    var list = controllers[current] || [];
    for (var j = 0; j < list.length; j++) {
      list[j].activate();
    }
  });

  // Open on the first tab that actually has data.
  show(DATA.app.length > 0 ? "app" : DATA.screen.length > 0 ? "screen" : "app");
})();
