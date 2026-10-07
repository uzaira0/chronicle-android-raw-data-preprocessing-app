import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProgressList } from "@/components/ProgressList";
import { runtimeScientificRefusalFixture } from "@/testSupport/runtimeScientificPreflightFixture";

describe("ProgressList scientific refusal", () => {
  it("renders the exact typed refusal decision without a successful result", () => {
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
    expect(html).toContain("capability_evidence_not_bound_to_input");
    expect(html).toContain("capability_evidence_not_bound_to_input");
    expect(html).not.toContain("Done");
  });
});
