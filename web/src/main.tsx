import * as Sentry from "@sentry/browser";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Drop all breadcrumbs — raw CSV data must never leave the device.
      return { ...event, breadcrumbs: undefined };
    },
  });
}

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .then((registration) => {
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                window.dispatchEvent(new CustomEvent("sw-update-available"));
              }
            });
          });
        });
    });
  } else {
    // In dev, evict any service worker registered by an earlier production
    // build that might be cached by the browser. The SW aggressively caches
    // index.html and the bundled JS/CSS, which silently masks dev edits.
    window.addEventListener("load", () => {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      });
      void caches?.keys().then((keys) => {
        keys.forEach((key) => {
          void caches.delete(key);
        });
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
