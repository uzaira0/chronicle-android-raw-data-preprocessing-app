import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { FOCUSABLE_SELECTOR, trappedFocusIndex } from "@/lib/focusTrap";

// Safari does not focus a button when it is clicked, so when a click opens
// this dialog `document.activeElement` is <body> or whatever was focused
// earlier, and focus went back to the wrong place on close. Remember the
// control the latest click landed on (capture phase, so it is recorded before
// React's handler opens the dialog); a key press clears it, because then the
// focused element is the one the user acted on.
let lastClickedControl: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (event) => {
      lastClickedControl =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(FOCUSABLE_SELECTOR)
          : null;
    },
    true,
  );
  document.addEventListener(
    "keydown",
    () => {
      lastClickedControl = null;
    },
    true,
  );
}

function focusOwnerBeforeOpen(): HTMLElement | null {
  if (lastClickedControl?.isConnected) return lastClickedControl;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

type Props = {
  title: string;
  /** What exactly the action does; read out as the dialog's description. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for deletions, `primary` for reversible changes. */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
};

/**
 * Modal confirmation for destructive actions. It takes focus on open (on the
 * Cancel button, so Enter never deletes by accident), keeps Tab inside the
 * dialog, closes on Escape or a backdrop click, and returns focus to whatever
 * had it before it opened.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onCancel,
  testId = "confirm-dialog",
}: Props): ReactElement {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    const previouslyFocused = focusOwnerBeforeOpen();
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      // Rendered controls only: the trap now makes every move itself, so a
      // hidden match would otherwise swallow a Tab press.
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getClientRects().length > 0);
      const active = document.activeElement;
      const next = trappedFocusIndex(
        focusable.length,
        active instanceof HTMLElement ? focusable.indexOf(active) : -1,
        event.shiftKey,
      );
      if (next === null) return;
      event.preventDefault();
      focusable[next]?.focus();
    };
    // Capture phase: the dialog owns the keyboard while it is open, so an
    // Escape handler elsewhere on the page (a popover, the timeline) does not
    // also act on the same key press.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid={testId}
      >
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        <div id={bodyId} className="modal__body">
          {children}
        </div>
        <div className="modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn--ghost"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "btn btn--danger" : "btn btn--primary"}
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
