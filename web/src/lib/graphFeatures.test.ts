import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_OPTIONS,
  processRawCsvContent,
} from "@/lib/browserPipeline";
import type {
  BrowserProcessingOptions,
  BrowserSupportFile,
  MatcherInput,
  MatcherOutput,
} from "@/lib/types";

/**
 * Integration tests for the Clean/Analyze feature wiring: side-by-side
 * credited output, study window, attribution, compliance, day coverage.
 */

const HEADER =
  "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";

// One participant, one app session 10:00 -> 10:30 with screen witnesses,
// plus a screen-capability pair. Timezone America/Chicago (2026-03-07).
const CSV = [
  HEADER,
  "S,P100,,Game,Screen Non-Interactive,com.sys.screen,2026-03-07 09:00:00,America/Chicago",
  "S,P100,,Game,Screen Interactive,com.sys.screen,2026-03-07 09:59:00,America/Chicago",
  "S,P100,,Game,Activity Resumed,com.example.game,2026-03-07 10:00:00,America/Chicago",
  "S,P100,,Game,Activity Paused,com.example.game,2026-03-07 10:30:00,America/Chicago",
].join("\n");

const matcher = async (input: MatcherInput): Promise<MatcherOutput> => {
  // Pair each resume with the next same/other-stop event after it.
  const startIndices: number[] = [];
  const stopStartIndices: number[] = [];
  const stopEventIndices: number[] = [];
  for (let index = 0; index < input.resumed.length; index += 1) {
    if (input.resumed[index] !== 1) continue;
    for (let stop = index + 1; stop < input.resumed.length; stop += 1) {
      if (input.sameStop[stop] === 1 || input.otherStop[stop] === 1) {
        startIndices.push(index);
        stopStartIndices.push(index);
        stopEventIndices.push(stop);
        break;
      }
    }
  }
  return { startIndices, stopStartIndices, stopEventIndices, missingIndices: [] };
};

function supportFile(name: string, text: string): BrowserSupportFile {
  return { name, bytes: new TextEncoder().encode(text).buffer as ArrayBuffer };
}

const BASE_OPTIONS: Partial<BrowserProcessingOptions> = {
  ...DEFAULT_BROWSER_OPTIONS,
  processAppUsage: true,
  processScreenUsage: false,
  useFilterFile: false,
  useAppsForcingScreenOpenFile: false,
  useAppCodebook: false,
  enablePlotting: false,
};

async function run(
  options: Partial<BrowserProcessingOptions>,
  supportFiles: Record<string, BrowserSupportFile> = {},
  fileName = `Raw P100 ${Math.random().toString(36).slice(2)}.csv`,
) {
  return processRawCsvContent(fileName, CSV, options, supportFiles, matcher, undefined);
}

describe("clean/analyze feature wiring", () => {
  it("all features off: no credited/compliance/coverage outputs appear", async () => {
    const result = await run(BASE_OPTIONS);
    const names = result.outputs.map((output) => output.outputFileName).join("|");
    expect(names).not.toMatch(/Credited App Usage|Compliance Report|Day Coverage/);
  });

  it("screen-gated crediting emits a SIDE-BY-SIDE CSV and leaves the headline CSV untouched", async () => {
    const off = await run(BASE_OPTIONS, {}, "Raw P100 base.csv");
    const on = await run(
      { ...BASE_OPTIONS, enableScreenGatedCrediting: true },
      {},
      "Raw P100 credited.csv",
    );
    const headlineOff = off.outputs.find((output) => output.kind === "app")!;
    const headlineOn = on.outputs.find(
      (output) => output.kind === "app" && !/Credited/.test(output.outputFileName),
    )!;
    expect(await headlineOn.blob.text()).toBe(await headlineOff.blob.text());
    const credited = on.outputs.find((output) => /Credited App Usage\.csv$/.test(output.outputFileName));
    expect(credited).toBeDefined();
    expect(credited!.rowCount).toBeGreaterThan(0);
  });

  it("study-window filter enabled without a study-dates file fails LOUD with an actionable message", async () => {
    await expect(run({ ...BASE_OPTIONS, enableStudyWindowFilter: true })).rejects.toThrow(
      /study-dates file|Study Inputs/,
    );
  });

  it("study-window filter drops out-of-window sessions", async () => {
    const dates = supportFile(
      "study_dates.csv",
      "participant_id,start_date,end_date\nP100,2026-03-01,2026-03-06\n",
    );
    const result = await run(
      { ...BASE_OPTIONS, enableStudyWindowFilter: true },
      { studyDatesFile: dates },
    );
    // The session is on 2026-03-07 — outside the window — so no App Usage rows survive.
    const headline = result.outputs.find((output) => output.kind === "app")!;
    const text = await headline.blob.text();
    expect(text).not.toMatch(/com\.example\.game/);
  });

  it("attribution + compliance emit the compliance report with shared-device accounting", async () => {
    const sharing = supportFile(
      "sharing.csv",
      "participant_id,sharing_status\nP100,Shared\n",
    );
    const result = await run(
      {
        ...BASE_OPTIONS,
        enablePersonAttribution: true,
        enableComplianceScoring: true,
        complianceThresholdPercent: 70,
      },
      { deviceSharingFile: sharing },
    );
    const report = result.outputs.find((output) => /Compliance Report\.csv$/.test(output.outputFileName));
    expect(report).toBeDefined();
    const text = await report!.blob.text();
    // Unlabeled usage on a shared device -> None -> unknown -> 0% compliance.
    const line = text.split("\n").find((entry) => entry.startsWith("P100,2026-03-07"))!;
    expect(line).toContain("Shared");
    expect(line).toMatch(/,0,0(,|$)/); // compliance 0, invalid
  });

  it("day coverage emits the usage/no_activity/no_data spine over the study window", async () => {
    const dates = supportFile(
      "study_dates.csv",
      "participant_id,start_date,end_date\nP100,2026-03-06,2026-03-08\n",
    );
    const result = await run(
      { ...BASE_OPTIONS, enableDayCoverage: true },
      { studyDatesFile: dates },
    );
    const coverage = result.outputs.find((output) => /Day Coverage\.csv$/.test(output.outputFileName));
    expect(coverage).toBeDefined();
    const lines = (await coverage!.blob.text()).trim().split("\n");
    expect(lines).toEqual([
      "participant_id,date,status",
      "P100,2026-03-06,no_data",
      "P100,2026-03-07,usage",
      "P100,2026-03-08,no_data",
    ]);
  });
});
