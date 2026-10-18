import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProgressList } from "@/components/ProgressList";
import { runtimeScientificRefusalFixture } from "@/testSupport/runtimeScientificPreflightFixture";

describe("ProgressList scientific refusal", () => {
  it("shows the plain refusal and keeps its reason codes out of the summary line", () => {
    const receipt = runtimeScientificRefusalFixture();
    const html = renderToStaticMarkup(
      <ProgressList
        rows={[
          {
            fileName: "raw.csv",
            status: "error",
            error: "Scientific preflight refused",
            scientificPreflightRefusal: receipt,
          },
        ]}
        overallPercent={1}
      />,
    );
    expect(html).toContain("Scientific preflight refused");
    // The codes are in the receipt, shown under Technical details once expanded.
    expect(html).not.toContain("capability_evidence_not_bound_to_input");
    expect(html).not.toContain("Done");
  });
});
