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

  // Paint a Scene's primitives onto an already-scaled 2D context. Mirrors
  // renderScene in TimelineViewPanel.tsx and renderSceneToCanvas in
  // plotGenerator.ts, reading the identical primitive list.
  function renderScene(ctx, scene) {
    var prims = scene.primitives || [];
    for (var i = 0; i < prims.length; i++) {
      var p = prims[i];
      if (p.type === "rect") {
        ctx.globalAlpha = p.alpha == null ? 1 : p.alpha;
        if (p.fill) {
          ctx.fillStyle = p.fill;
          ctx.fillRect(p.x, p.y, Math.max(p.w, 0), Math.max(p.h, 0));
        }
        if (p.stroke) {
          ctx.strokeStyle = p.stroke;
          ctx.lineWidth = p.strokeWidth == null ? 1 : p.strokeWidth;
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
        ctx.lineWidth = p.strokeWidth == null ? 1 : p.strokeWidth;
        ctx.setLineDash(p.dash || []);
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y1);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (p.type === "poly") {
        ctx.beginPath();
        for (var j = 0; j < p.points.length; j++) {
          var pt = p.points[j];
          if (j === 0) ctx.moveTo(pt[0], pt[1]);
          else ctx.lineTo(pt[0], pt[1]);
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
    var state = { scale: 1, boxW: 0, sized: false };

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
      canvas.style.width = boxW + "px";
      canvas.style.height = cssH + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, boxW, cssH);
      ctx.setTransform(dpr * state.scale, 0, 0, dpr * state.scale, 0, 0);
      renderScene(ctx, scene);
    }

    // Size to the wrapper's width and (re)draw. Lazy: a canvas in a hidden tab
    // panel reports clientWidth 0, so it is sized only once its panel is shown.
    function activate() {
      var w = Math.max(320, Math.round(wrap.clientWidth));
      if (state.sized && w === state.boxW) return;
      state.boxW = w;
      state.scale = state.boxW / Math.max(scene.width, 1);
      state.sized = true;
      hideTip();
      draw();
    }

    canvas.addEventListener("pointermove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var sx = x / state.scale;
      var sy = y / state.scale;
      var hit = null;
      for (var i = 0; i < regions.length; i++) {
        var r = regions[i];
        if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) {
          hit = r;
          break;
        }
      }
      if (hit) showTip(x + 14, y + 14, hit);
      else hideTip();
    });

    canvas.addEventListener("pointerleave", hideTip);

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
