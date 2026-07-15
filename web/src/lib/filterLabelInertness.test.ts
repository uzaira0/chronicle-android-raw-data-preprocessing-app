import { describe, expect, it } from "vitest";

import { processRawCsvContent } from "@/lib/browserPipeline";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import type { MatcherInput, MatcherOutput } from "@/lib/types";

/**
 * App filtering must MARK, not alter: labeling an app as filtered blanks that
 * app's own timing, but a VALID app's episode boundaries must be identical
 * with the filter on or off. This holds by configuration, not by construction:
 * the default `otherInteractionTypesToStopUsageAt` includes "Filtered App
 * Resumed" and "Filtered App Usage" precisely so a filtered app's
 * foregrounding still interrupts a valid session at the same timestamp an
 * unfiltered resume would. These tests pin that contract.
 */

const HEADER =
  "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone";

function row(label: string, type: string, pkg: string, ts: string): string {
  return `study,P01,Android,Target Child,${label},${type},${pkg},${ts},,,America/Chicago`;
}

// Mainline: the junk app interrupts the valid app and closes cleanly.
const MAINLINE = [
  HEADER,
  row("Chat", "Activity Resumed", "com.valid.chat", "2026-03-07 10:00:00"),
  row("Junk", "Activity Resumed", "com.junk.app", "2026-03-07 10:02:00"),
  row("Junk", "Activity Paused", "com.junk.app", "2026-03-07 10:03:00"),
  row("Chat", "Activity Paused", "com.valid.chat", "2026-03-07 10:05:00"),
].join("\n");

// Edge: the junk app's resume never finds a stop (missing end of usage).
const MISSING_END = [
  HEADER,
  row("Chat", "Activity Resumed", "com.valid.chat", "2026-03-07 10:00:00"),
  row("Junk", "Activity Resumed", "com.junk.app", "2026-03-07 10:02:00"),
  row("Chat", "Activity Paused", "com.valid.chat", "2026-03-07 10:05:00"),
].join("\n");

const FILTER_CSV = ["app_package_name,known_application_labels", "com.junk.app,Junk"].join("\n");

type OutputRow = { pkg: string; type: string; duration: string };

async function appOutputRows(csv: string, useFilter: boolean): Promise<OutputRow[]> {
  const matcher = async (_input: MatcherInput): Promise<MatcherOutput> => {
    throw new Error("mock matcher should be bypassed (proximity default > 0)");
  };
  const result = await processRawCsvContent(
    "Raw P01.csv",
    csv,
    {
      ...DEFAULT_BROWSER_OPTIONS,
      useFilterFile: useFilter,
      useAppCodebook: false,
      processScreenUsage: false,
      enablePlotting: false,
      minimumUsageDuration: 0,
    },
    useFilter
      ? { filterFile: { name: "filter.csv", bytes: new TextEncoder().encode(FILTER_CSV) } }
      : {},
    matcher,
  );
  const blob = result.outputs.find((output) => output.kind === "app")?.blob;
  const text = blob ? await blob.text() : "";
  const lines = text.trim().split("\n");
  const headers = (lines[0] ?? "").split(",");
  const pkgIdx = headers.indexOf("app_package_name");
  const typeIdx = headers.indexOf("interaction_type");
  const durIdx = headers.indexOf("duration_seconds");
  return lines
    .slice(1)
    .map((line) => line.split(","))
    .map((cols) => ({
      pkg: cols[pkgIdx] ?? "",
      type: cols[typeIdx] ?? "",
      duration: cols[durIdx] ?? "",
    }));
}

function validEpisodes(rows: OutputRow[]): OutputRow[] {
  return rows.filter((r) => r.pkg === "com.valid.chat" && r.type === "App Usage");
}

describe("filter labels mark filtered apps without altering valid apps' episodes", () => {
  it("mainline: valid-app episodes are identical with the filter on and off", async () => {
    const on = await appOutputRows(MAINLINE, true);
    const off = await appOutputRows(MAINLINE, false);
    expect(validEpisodes(on)).toEqual(validEpisodes(off));
    expect(validEpisodes(on).length).toBeGreaterThan(0);
  });

  it("missing-end edge: an unclosed filtered resume still interrupts identically", async () => {
    const on = await appOutputRows(MISSING_END, true);
    const off = await appOutputRows(MISSING_END, false);
    expect(validEpisodes(on)).toEqual(validEpisodes(off));
    expect(validEpisodes(on).length).toBeGreaterThan(0);
  });

  it("the junk app itself IS marked: Filtered App Usage with blanked timing", async () => {
    const on = await appOutputRows(MAINLINE, true);
    const junk = on.filter((r) => r.pkg === "com.junk.app");
    expect(junk.some((r) => r.type === "Filtered App Usage")).toBe(true);
    expect(junk.every((r) => r.type !== "App Usage")).toBe(true);
    expect(junk.every((r) => r.duration === "")).toBe(true);
  });
});
