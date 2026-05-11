import { bench, describe } from "vitest";
import {
  DEFAULT_BROWSER_OPTIONS,
  discoverTimezonesFromRawCsv,
  processRawCsvContent,
} from "@/lib/browserPipeline";
import type { MatcherInput, MatcherOutput } from "@/lib/types";

const passthroughMatcher = async (_input: MatcherInput): Promise<MatcherOutput> => ({
  startIndices: [],
  stopStartIndices: [],
  stopEventIndices: [],
  missingIndices: [],
});

function makeRawCsv(rows: number): string {
  const header =
    "participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";
  const lines = [header];
  const baseMs = new Date("2024-01-01T08:00:00Z").getTime();
  for (let i = 0; i < rows; i++) {
    const ts = new Date(baseMs + i * 60_000)
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");
    lines.push(
      `P01,user1,Test App,MOVE_TO_FOREGROUND,com.test.app,${ts},America/Chicago`,
    );
  }
  return lines.join("\n");
}

const CSV_100 = makeRawCsv(100);
const CSV_1000 = makeRawCsv(1_000);

describe("browserPipeline throughput", () => {
  bench("discoverTimezones — 100 rows", async () => {
    await discoverTimezonesFromRawCsv(CSV_100);
  });

  bench("processRawCsvContent — 100 rows", async () => {
    await processRawCsvContent(
      "bench.csv",
      CSV_100,
      DEFAULT_BROWSER_OPTIONS,
      undefined,
      passthroughMatcher,
    );
  });

  bench("processRawCsvContent — 1 000 rows", async () => {
    await processRawCsvContent(
      "bench.csv",
      CSV_1000,
      DEFAULT_BROWSER_OPTIONS,
      undefined,
      passthroughMatcher,
    );
  });
});
