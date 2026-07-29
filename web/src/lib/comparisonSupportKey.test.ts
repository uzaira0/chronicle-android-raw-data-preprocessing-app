import { describe, expect, it } from "vitest";

import { supportFileInputList } from "./comparisonSupportKey";
import type { BrowserSupportFiles } from "@/lib/types";

describe("supportFileInputList", () => {
  it("returns inputs in the one canonical role order", () => {
    const byRole: Record<keyof BrowserSupportFiles, string> = {
      filterFile: "filter",
      appsForcingScreenOpenFile: "forcing",
      backgroundAppsFile: "background",
      appCodebookFile: "codebook",
      studyDatesFile: "dates",
      deviceSharingFile: "sharing",
      surveyAttributionFile: "survey",
      enrolledDevicesFile: "enrolled",
    };
    expect(supportFileInputList(byRole)).toEqual([
      "filter",
      "forcing",
      "background",
      "codebook",
      "dates",
      "sharing",
      "survey",
      "enrolled",
    ]);
  });
});
