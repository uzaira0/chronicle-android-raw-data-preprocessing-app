import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { applyTheme, readTheme } from "@/lib/theme";
import { clearSwCaches } from "@/lib/swCache";
import { notifyUpdateReady } from "@/lib/swUpdate";
import "./index.css";

// Apply the saved theme before first paint so there is no light→dark flash.
applyTheme(readTheme());

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
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
        .catch(() => {
          // Registration failure shouldn't break the app; it just means no
          // offline cache / update prompt this session.
        });
    });
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

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
