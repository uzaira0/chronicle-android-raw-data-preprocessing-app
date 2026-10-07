import { useEffect, type ReactElement } from "react";

type Props = {
  message: string;
  isError?: boolean;
  onDismiss: () => void;
  /** Auto-dismiss delay for a success toast. Error toasts never auto-dismiss. */
  timeoutMs?: number;
};

/**
 * One transient message. A success toast is a polite status that clears
 * itself after `timeoutMs`; an error toast is an assertive alert that stays
 * until dismissed, so a failure cannot vanish before it is read (WCAG 2.2.1).
 * The timer restarts only when the message itself changes, never on an
 * unrelated parent render (callers pass a stable `onDismiss`).
 */
export function Toast({ message, isError = false, onDismiss, timeoutMs = 5000 }: Props): ReactElement {
  useEffect(() => {
    if (isError) return undefined;
    const handle = window.setTimeout(onDismiss, timeoutMs);
    return () => window.clearTimeout(handle);
  }, [isError, message, onDismiss, timeoutMs]);

  const content = (
    <>
      <span>{message}</span>
      <button type="button" className="btn btn--ghost" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </>
  );
  if (!isError) {
    return (
      <div className="toast" role="status" aria-live="polite">
        {content}
      </div>
    );
  }
  // The alert announces the error assertively. The inner role="status" with
  // aria-live="off" adds no second announcement; it keeps the existing
  // getByRole("status") locators in e2e/*.spec.ts (rosenthal, s-adl,
  // temporal-observations) matching error toasts until those specs move to
  // getByRole("alert").
  return (
    <div className="toast is-error" role="alert" data-testid="error-toast">
      <div role="status" aria-live="off" style={{ display: "contents" }}>
        {content}
      </div>
    </div>
  );
}
