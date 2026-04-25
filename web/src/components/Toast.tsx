import { useEffect, type ReactElement } from "react";

type Props = {
  message: string;
  isError?: boolean;
  onDismiss: () => void;
  timeoutMs?: number;
};

export function Toast({ message, isError = false, onDismiss, timeoutMs = 5000 }: Props): ReactElement {
  useEffect(() => {
    const handle = window.setTimeout(onDismiss, timeoutMs);
    return () => window.clearTimeout(handle);
  }, [onDismiss, timeoutMs]);

  return (
    <div className={`toast${isError ? " is-error" : ""}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="btn btn--ghost" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
