import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import { createPortal } from "react-dom";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  onReset: (next: BrowserProcessingOptions) => void;
};

function isAnyModified(options: BrowserProcessingOptions): boolean {
  const keys = Object.keys(DEFAULT_BROWSER_OPTIONS) as Array<keyof BrowserProcessingOptions>;
  return keys.some((key) => {
    const fallback = DEFAULT_BROWSER_OPTIONS[key];
    const value = options[key];
    if (Array.isArray(fallback) || Array.isArray(value)) {
      const left = (fallback ?? []) as unknown[];
      const right = (value ?? []) as unknown[];
      if (left.length !== right.length) return true;
      return left.some((entry, index) => entry !== right[index]);
    }
    return fallback !== value;
  });
}

export function ResetDefaultsButton({ options, onReset }: Props): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const dirty = isAnyModified(options);

  useEffect(() => {
    if (!confirming) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => setConfirming(true)}
        disabled={!dirty}
      >
        Reset all to defaults
      </button>
      {confirming
        ? createPortal(
            <div
              className="modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="reset-modal-title"
              onClick={(event) => {
                if (event.target === event.currentTarget) setConfirming(false);
              }}
            >
              <div className="modal">
                <h2 id="reset-modal-title" className="modal__title">
                  Reset all settings to defaults?
                </h2>
                <p className="modal__body">
                  Every setting in every section will be returned to the canonical default.
                  Your selected files (raw, filter, apps forcing screen open, codebook) are kept.
                </p>
                <div className="modal__actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      onReset({ ...DEFAULT_BROWSER_OPTIONS });
                      setConfirming(false);
                    }}
                  >
                    Reset all
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
