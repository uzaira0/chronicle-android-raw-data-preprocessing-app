import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { clearSwCaches, clearSwCachesAndReload } from "./lib/swCache";
import "./index.css";

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .then((registration) => {
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener(
              "statechange",
              () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  window.dispatchEvent(new CustomEvent("sw-update-available"));
                }
              },
              { once: true },
            );
          });
        })
        .catch((err: unknown) => {
          console.warn("Chronicle: service worker registration failed — offline caching unavailable", err);
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
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
