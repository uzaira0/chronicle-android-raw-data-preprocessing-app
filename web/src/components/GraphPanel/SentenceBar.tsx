import type { ReactElement } from "react";

/**
 * Plain-English readout for the current graph selection. Always visible so
 * the interaction model teaches itself: the hint explains what clicking does
 * before anything is selected.
 */

type Props = {
  sentence: string | null;
};

export function SentenceBar({ sentence }: Props): ReactElement {
  return (
    <p className="graph-sentence" role="status" data-testid="graph-sentence">
      {sentence ??
        "Click a step to see everything it changes. Click a second step to see what the two have in common upstream. With a step selected, hover another to see the steps every effect passes through."}
    </p>
  );
}
