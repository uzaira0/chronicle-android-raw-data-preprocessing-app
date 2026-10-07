/**
 * Keyboard focus containment for modal dialogs (WAI-ARIA dialog pattern):
 * Tab moves to the next control and wraps from the last to the first,
 * Shift+Tab moves back and wraps from the first to the last, and focus that
 * has escaped the dialog is pulled back in.
 */

/** Elements that can take keyboard focus by Tab inside a dialog. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "details > summary:first-of-type",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * The index Tab should move focus to, or `null` when the dialog has nothing
 * focusable. `currentIndex` is -1 when focus is outside the dialog.
 *
 * The trap makes every move itself rather than letting the browser make the
 * inner ones: Safari's default keyboard setting skips buttons on Tab, so the
 * browser's own move from a dialog's Cancel button left the dialog entirely.
 */
export function trappedFocusIndex(
  count: number,
  currentIndex: number,
  backwards: boolean,
): number | null {
  if (count <= 0) return null;
  if (currentIndex < 0) return backwards ? count - 1 : 0;
  return (currentIndex + (backwards ? count - 1 : 1)) % count;
}
