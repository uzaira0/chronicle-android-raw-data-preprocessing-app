/**
 * Tiny pub/sub bridging the service-worker update lifecycle (wired in main.tsx)
 * to the React shell, so the app can show a "new version available — reload"
 * banner instead of silently swapping assets under the user.
 *
 * The service worker calls skipWaiting() on install, so an update simply needs a
 * page reload to pick up the new assets; applyUpdate() reloads.
 */
type Listener = () => void;

let updateReady = false;
let listeners: Listener[] = [];

export function notifyUpdateReady(): void {
  if (updateReady) return;
  updateReady = true;
  for (const listener of listeners) listener();
}

export function isUpdateReady(): boolean {
  return updateReady;
}

export function onUpdateReady(listener: Listener): () => void {
  listeners.push(listener);
  if (updateReady) listener();
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

export function applyUpdate(): void {
  if (typeof window !== "undefined") window.location.reload();
}
