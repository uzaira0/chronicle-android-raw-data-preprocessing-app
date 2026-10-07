import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { installGlobalErrorRecorder, recordError } from "@/lib/diagnostics";
import { loadMethodReceiptValidation, storedDataHoldsMethodReceipt } from "@/lib/settingsPersistence";
import { applyTheme, readTheme } from "@/lib/theme";
import { clearSwCaches } from "@/lib/swCache";
import { notifyUpdateReady } from "@/lib/swUpdate";
import "./index.css";

// Keep a local record of every uncaught error and unhandled rejection for the
// "Copy diagnostic report" control (footer and crash screen). Nothing is sent.
installGlobalErrorRecorder(window);

// Apply the saved theme before first paint so there is no light→dark flash.
applyTheme(readTheme());

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    const registerServiceWorker = () => {
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .then((registration) => {
          // A controller already present at load means any later controllerchange
          // is an UPDATE (not the first install), so prompt the user to reload.
          const hadController = !!navigator.serviceWorker.controller;
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (hadController) notifyUpdateReady();
          });
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              // Require a controller that existed BEFORE this registration — on a
              // first install clients.claim() can set the controller before this
              // fires, which would otherwise pop the update banner on first visit.
              if (installing.state === "installed" && hadController && navigator.serviceWorker.controller) {
                notifyUpdateReady();
              }
            });
          });
        })
        .catch((error: unknown) => {
          // Registration failure shouldn't break the app; it just means no
          // offline cache / update prompt this session. Keep it for the
          // diagnostic report, which is where "offline does not work" starts.
          recordError("background", error, "service worker registration");
        });
    };
    // Packed import dependencies use top-level await. The load event may have
    // already fired before this module finishes evaluating; preserve offline
    // registration in that supported asynchronous initialization path.
    if (document.readyState === "complete") registerServiceWorker();
    else window.addEventListener("load", registerServiceWorker, { once: true });
  } else {
    // In dev, evict any service worker registered by an earlier production
    // build that might be cached by the browser. The SW aggressively caches
    // index.html and the bundled JS/CSS, which silently masks dev edits.
    window.addEventListener("load", () => {
      void clearSwCaches().catch(() => {
        // Dev-mode SW eviction failure is non-fatal.
      });
    });
  }
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

const render = () =>
  createRoot(root).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>,
  );

// App reads stored settings, presets and method receipts synchronously while
// it renders. Receipt validation needs the method-profile registries, which
// stay off the first-paint path, so they are awaited first only when stored
// data holds a receipt. If they cannot load, App still renders and its error
// boundary shows the failure instead of silently dropping the receipt.
if (storedDataHoldsMethodReceipt()) {
  void loadMethodReceiptValidation().then(render, (error: unknown) => {
    recordError("background", error, "method receipt validation load");
    render();
  });
} else {
  render();
}
