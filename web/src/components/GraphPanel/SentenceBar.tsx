import type { ReactElement } from "react";

/**
 * Plain-English readout for the current graph selection. Always visible so
 * the interaction model teaches itself: the hint explains what clicking does
 * before anything is selected.
 */

type Props = {
  sentence: string | null;
  /** What the selected step DOES — shown under the path sentence. */
  detail?: string | null;
};

export function SentenceBar({ sentence, detail }: Props): ReactElement {
  return (
    <div className="graph-sentence-bar">
      <p className="graph-sentence" role="status" data-testid="graph-sentence">
        {sentence ??
          "Click a step to see everything it changes. Click a second step to see what the two have in common upstream. With a step selected, hover another to see the steps every effect passes through."}
      </p>
      {detail ? (
        <p className="graph-sentence-detail" data-testid="graph-sentence-detail">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
