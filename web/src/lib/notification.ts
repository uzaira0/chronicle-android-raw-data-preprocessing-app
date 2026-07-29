/**
 * Thin wrapper around the Notification API with permission prompts gated to
 * user-initiated actions. All calls are no-ops when the API is unavailable or
 * the user has not granted permission — they never throw.
 */

function notificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function ensureNotificationPermission(): Promise<
  "granted" | "denied" | "default" | "unsupported"
> {
  if (!notificationSupported()) return "unsupported";
  const status = Notification.permission;
  if (status === "granted" || status === "denied") return status;
  try {
    const next = await Notification.requestPermission();
    return next;
  } catch {
    return "default";
  }
}

export function sendNotification(title: string, body?: string): void {
  if (!notificationSupported()) return;
  if (Notification.permission !== "granted") return;
  try {

    new Notification(title, { body });
  } catch {
    // Some browsers restrict notifications outside secure contexts — swallow.
  }
}
