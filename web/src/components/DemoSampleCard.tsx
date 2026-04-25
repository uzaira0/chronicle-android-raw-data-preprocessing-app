import type { ReactElement } from "react";

type Props = {
  isRunning: boolean;
  onRun: () => void;
};

/**
 * Standalone "Demo a sample file" affordance pinned to the top-right of
 * the page. Runs a generated ~600-row sample raw CSV through the same
 * pipeline a real run uses, so the user can demo the actual pipeline
 * output without uploading their own data.
 */
export function DemoSampleCard({ isRunning, onRun }: Props): ReactElement {
  return (
    <aside className="demo-sample-card" aria-label="Demo a sample file">
      <h2 className="demo-sample-card__title">Demo a sample file</h2>
      <p className="demo-sample-card__body">
        Run the full preprocessing pipeline on a built-in fake-but-realistic
        Chronicle CSV (about 600 rows, one participant, one timezone) and
        download the same output you would get from your own data.
      </p>
      <button
        type="button"
        className="btn btn--secondary"
        data-testid="run-sample-button"
        onClick={onRun}
        disabled={isRunning}
      >
        {isRunning ? "Running…" : "Run demo"}
      </button>
    </aside>
  );
}
