import type { ProgressEvent } from "@/lib/types";
import type { FileProgress } from "@/components/ProgressList";

/**
 * Fold a {@link ProgressEvent} into the per-file progress map. Pure, so the
 * ordering invariant below can be unit tested without React.
 *
 * Invariant: a file that already finished (status `"complete"`, `"error"`, or
 * `"cancelled"`) is never reverted to a non-terminal status by a later event. In
 * the worker path the Comlink-proxied `onProgress` callback travels a *separate*
 * MessagePort from the RPC return value, so a trailing `step` event (e.g.
 * "output" 100%) can be delivered *after* `file-complete` — or after a cancel
 * marked the row `"cancelled"`. Without this guard that late event would leave
 * the row stuck at "Building output 100%" (or un-cancel a cancelled file).
 */
export function applyProgressEvent(
  current: Record<string, FileProgress>,
  event: ProgressEvent,
): Record<string, FileProgress> {
  const patch: Partial<FileProgress> =
    event.type === "file-start"
      ? { status: "running", stepKind: "parse", percent: 0 }
      : event.type === "step"
        ? { status: "running", stepKind: event.stepKind, percent: event.percent }
        : { status: event.error ? "error" : "complete", percent: 1, error: event.error };

  const existing =
    current[event.fileName] ?? { fileName: event.fileName, status: "pending" as const };
  const existingTerminal =
    existing.status === "complete" || existing.status === "error" || existing.status === "cancelled";
  const patchTerminal = patch.status === "complete" || patch.status === "error";
  if (existingTerminal && !patchTerminal) {
    return current;
  }

  return {
    ...current,
    [event.fileName]: { ...existing, ...patch },
  };
}
