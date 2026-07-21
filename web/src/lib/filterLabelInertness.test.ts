import { describe, expect, it } from "vitest";

import { processRawCsvContent } from "@/lib/browserPipeline";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { matchAppUsageWithProximity } from "@/lib/proximityMatcher";
import type {
  MatcherInput,
  MatcherOutput,
  SplitterInput,
  SplitterOutput,
} from "@/lib/types";

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

// Edge: the junk app's foreground is UNMATCHED (it never closes). The filtered
// pass retypes it to "End of Usage Missing" — an unmatched RESUME, which is why
// End of Usage Missing sits in the default otherInteractionTypesToStopUsageAt:
// a resume displaces whatever was foreground, so it must interrupt other app
// usage. Before it was in the stop set, filtering silently dropped that
// interrupt only when the filter was on, changing valid apps' numbers (the
// two-pass interrupt leak; the real destructive case is pinned by the desktop
// pathological on/off test). It must interrupt identically either way.
const UNMATCHED_JUNK_ONLY_CLOSE = [
  HEADER,
  row("Chat", "Activity Resumed", "com.valid.chat", "2026-03-07 10:00:00"),
  row("Junk", "Activity Resumed", "com.junk.app", "2026-03-07 10:02:00"),
].join("\n");

const FILTER_CSV = [
  "app_package_name,known_application_labels",
  "com.junk.app,Junk",
].join("\n");

type OutputRow = { pkg: string; type: string; duration: string };

const referenceMatcher = (input: MatcherInput): Promise<MatcherOutput> =>
  Promise.resolve(matchAppUsageWithProximity(input));

async function appOutputRows(
  csv: string,
  useFilter: boolean,
): Promise<OutputRow[]> {
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
      ? {
          filterFile: {
            name: "filter.csv",
            bytes: new TextEncoder().encode(FILTER_CSV).buffer,
          },
        }
      : {},
    referenceMatcher,
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
  return rows.filter(
    (r) => r.pkg === "com.valid.chat" && r.type === "App Usage",
  );
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

  it("an UNMATCHED junk foreground still interrupts a valid session identically (interrupt-leak regression)", async () => {
    const on = await appOutputRows(UNMATCHED_JUNK_ONLY_CLOSE, true);
    const off = await appOutputRows(UNMATCHED_JUNK_ONLY_CLOSE, false);
    // Valid app closes at the junk foreground in BOTH worlds (not left open).
    expect(validEpisodes(on)).toEqual(validEpisodes(off));
    expect(validEpisodes(on).length).toBeGreaterThan(0);
    expect(validEpisodes(on)[0]?.duration).not.toBe("");
    // The unmatched junk foreground is the interrupt: End of Usage Missing (an
    // unmatched resume), blanked timing, never counted as App Usage.
    const junkOn = on.filter((r) => r.pkg === "com.junk.app");
    expect(junkOn.some((r) => r.type === "End of Usage Missing")).toBe(true);
    expect(junkOn.every((r) => r.type !== "App Usage")).toBe(true);
    expect(junkOn.every((r) => r.duration === "")).toBe(true);
  });

  it("the junk app itself IS marked: Filtered App Usage with blanked timing", async () => {
    const on = await appOutputRows(MAINLINE, true);
    const junk = on.filter((r) => r.pkg === "com.junk.app");
    expect(junk.some((r) => r.type === "Filtered App Usage")).toBe(true);
    expect(junk.every((r) => r.type !== "App Usage")).toBe(true);
    expect(junk.every((r) => r.duration === "")).toBe(true);
  });
});

/**
 * CONSTRUCT-AND-MARK (EYES precedent: background activity is its own category
 * whose treatment is an open analytic decision). A package on BOTH the filter
 * list and the background-apps list gets BOTH honored: the background session
 * is CONSTRUCTED — extended to the app's own stop, real timing — and MARKED
 * with the distinct type "Filtered App Background Usage". It is excluded from
 * App Usage totals/crediting; how to treat it analytically is deferred. The
 * valid app stays identical either way, which requires the new type to sit in
 * the default `otherInteractionTypesToStopUsageAt` (the constructed row must
 * interrupt valid sessions exactly where the raw Activity Resumed would have).
 */
describe("filtered background apps are constructed and marked, never blanked", () => {
  // Spotify is BOTH a background app and in the filter list; Chat runs in the
  // foreground inside what would be Spotify's extended session.
  const BACKGROUND_OVERLAP = [
    HEADER,
    row(
      "Audio",
      "Activity Resumed",
      "com.spotify.music",
      "2026-03-07 10:00:00",
    ),
    row("Audio", "Activity Paused", "com.spotify.music", "2026-03-07 10:01:00"),
    row("Chat", "Activity Resumed", "com.valid.chat", "2026-03-07 10:02:00"),
    row("Chat", "Activity Paused", "com.valid.chat", "2026-03-07 10:06:00"),
    row(
      "Audio",
      "Activity Stopped",
      "com.spotify.music",
      "2026-03-07 10:10:00",
    ),
  ].join("\n");

  const BACKGROUND_FILTER_CSV = [
    "app_package_name,known_application_labels",
    "com.spotify.music,Audio",
  ].join("\n");
  const BACKGROUND_CSV = [
    "package_name,label_or_note",
    "com.spotify.music,Audio",
  ].join("\n");

  async function backgroundRunResult(
    useFilter: boolean,
  ): Promise<Awaited<ReturnType<typeof processRawCsvContent>>> {
    // Pass-through splitter (one primary sub-interval per session). Identical
    // for both runs, so any on/off difference comes from the pipeline itself.
    const splitter = (input: SplitterInput): Promise<SplitterOutput> =>
      Promise.resolve(
        Array.from(input.starts).map((startNs, sessionIndex) => ({
          sessionIndex,
          startNs,
          stopNs: input.stops[sessionIndex],
          layer: "primary",
        })),
      );
    const result = await processRawCsvContent(
      "Raw P01.csv",
      BACKGROUND_OVERLAP,
      {
        ...DEFAULT_BROWSER_OPTIONS,
        useFilterFile: useFilter,
        useBackgroundAppsFile: true,
        useAppCodebook: false,
        processScreenUsage: false,
        enablePlotting: false,
        minimumUsageDuration: 0,
      },
      {
        backgroundAppsFile: {
          name: "bg.csv",
          bytes: new TextEncoder().encode(BACKGROUND_CSV).buffer,
        },
        ...(useFilter
          ? {
              filterFile: {
                name: "filter.csv",
                bytes: new TextEncoder().encode(BACKGROUND_FILTER_CSV).buffer,
              },
            }
          : {}),
      },
      referenceMatcher,
      undefined,
      undefined,
      splitter,
    );
    return result;
  }

  async function backgroundRun(useFilter: boolean): Promise<OutputRow[]> {
    const result = await backgroundRunResult(useFilter);
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

  it("a filtered background app gets its session constructed AND marked", async () => {
    const on = await backgroundRun(true);
    const off = await backgroundRun(false);

    // Unfiltered: background semantics extend the session to Activity Stopped.
    const offSpotify = off.filter(
      (r) => r.pkg === "com.spotify.music" && r.type === "App Usage",
    );
    expect(offSpotify).toHaveLength(1);
    expect(offSpotify[0].duration).toBe("600.0");

    // Filtered: the SAME session is constructed (same 600s extension to the
    // app's own stop) but marked as the deferred category — never counted as
    // App Usage, never blanked.
    const onSpotify = on.filter(
      (r) =>
        r.pkg === "com.spotify.music" &&
        r.type === "Filtered App Background Usage",
    );
    expect(onSpotify).toHaveLength(1);
    expect(onSpotify[0].duration).toBe("600.0");
    expect(
      on
        .filter((r) => r.pkg === "com.spotify.music")
        .every((r) => r.type !== "App Usage"),
    ).toBe(true);

    // The valid app is untouched by the choice, as the inertness suite pins.
    expect(validEpisodes(on)).toEqual(validEpisodes(off));
  });

  it("declares construct-and-mark as a config notice when both lists claim a package", async () => {
    const contradictory = await backgroundRunResult(true);
    expect(contradictory.configNotices ?? []).toHaveLength(1);
    expect(contradictory.configNotices![0]).toContain("com.spotify.music");
    expect(contradictory.configNotices![0]).toContain(
      "Filtered App Background Usage",
    );
    expect(contradictory.configNotices![0]).toContain("Both are honored");

    // No contradiction active (filter off) -> no notice.
    const clean = await backgroundRunResult(false);
    expect(clean.configNotices).toBeUndefined();
  });

  it("a constructed-and-marked row still interrupts valid sessions where the raw resume would", async () => {
    // The background junk app foregrounds DURING the valid app's session. With
    // the filter OFF its Activity Resumed is an other-stop for Chat; with the
    // filter ON that same event becomes the constructed Filtered App Background
    // Usage row, which sits in the default otherInteractionTypesToStopUsageAt
    // precisely so Chat is interrupted at the identical timestamp.
    const INTERRUPT = [
      HEADER,
      row("Chat", "Activity Resumed", "com.valid.chat", "2026-03-07 10:00:00"),
      row(
        "Audio",
        "Activity Resumed",
        "com.spotify.music",
        "2026-03-07 10:02:00",
      ),
      row(
        "Audio",
        "Activity Paused",
        "com.spotify.music",
        "2026-03-07 10:03:00",
      ),
      row("Chat", "Activity Paused", "com.valid.chat", "2026-03-07 10:06:00"),
      row(
        "Audio",
        "Activity Stopped",
        "com.spotify.music",
        "2026-03-07 10:10:00",
      ),
    ].join("\n");

    const run = async (useFilter: boolean): Promise<OutputRow[]> => {
      const result = await processRawCsvContent(
        "Raw P01.csv",
        INTERRUPT,
        {
          ...DEFAULT_BROWSER_OPTIONS,
          useFilterFile: useFilter,
          useBackgroundAppsFile: true,
          useAppCodebook: false,
          processScreenUsage: false,
          enablePlotting: false,
          minimumUsageDuration: 0,
        },
        {
          backgroundAppsFile: {
            name: "bg.csv",
            bytes: new TextEncoder().encode(BACKGROUND_CSV).buffer,
          },
          ...(useFilter
            ? {
                filterFile: {
                  name: "filter.csv",
                  bytes: new TextEncoder().encode(BACKGROUND_FILTER_CSV).buffer,
                },
              }
            : {}),
        },
        referenceMatcher,
        undefined,
        undefined,
        (input: SplitterInput): Promise<SplitterOutput> =>
          Promise.resolve(
            Array.from(input.starts).map((startNs, sessionIndex) => ({
              sessionIndex,
              startNs,
              stopNs: input.stops[sessionIndex],
              layer: "primary",
            })),
          ),
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
    };

    const on = await run(true);
    const off = await run(false);
    expect(validEpisodes(on)).toEqual(validEpisodes(off));
    expect(validEpisodes(on).length).toBeGreaterThan(0);
    // And the marked category carries the full constructed extension.
    const fabu = on.filter((r) => r.type === "Filtered App Background Usage");
    expect(fabu).toHaveLength(1);
    expect(fabu[0].pkg).toBe("com.spotify.music");
  });
});
