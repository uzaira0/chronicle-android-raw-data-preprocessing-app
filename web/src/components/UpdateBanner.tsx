import type { ReactElement } from "react";

type Props = {
  onDismiss: () => void;
};

export function UpdateBanner({ onDismiss }: Props): ReactElement {
  return (
    <div className="update-banner" role="alert" aria-live="assertive">
      <span>A new version is available.</span>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onDismiss}
        aria-label="Dismiss update notification"
      >
        ×
      </button>
    </div>
  );
}
