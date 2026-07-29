import { describe, expect, it } from "vitest";

import { buildTimelineViewerHtml } from "@/lib/timelineViewer";
import type { TimelineParticipantView } from "@/lib/types";

const view = (participantId: string) =>
  ({
    participantId,
    scene: { width: 1, height: 1, primitives: [] },
    regions: [],
  }) satisfies TimelineParticipantView;

describe("timeline viewer export", () => {
  it("selects a screen-only initial tab and escapes display metadata", () => {
    const html = buildTimelineViewerHtml({
      fileName: "Raw <P01>.csv",
      timezone: "",
      app: [],
      screen: [view("P&01")],
    });

    expect(html).toContain('id="tab-screen"');
    expect(html).toContain('id="panel-screen"');
    expect(html).toContain('aria-selected="true">Screen usage');
    expect(html).toContain("Raw &lt;P01&gt;.csv");
    expect(html).toContain("timezone —");
    expect(html).toContain("P&amp;01");
    expect(html).toContain("No app usage data for this file.");
  });

  it("falls back to the app tab when both panels are empty", () => {
    const html = buildTimelineViewerHtml({
      fileName: "Raw.csv",
      timezone: "UTC",
      app: [],
      screen: [],
    });

    expect(html).toContain('aria-selected="true">App usage');
    expect(html).toContain("No screen usage data for this file.");
  });
});
