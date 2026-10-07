import { createHash } from "node:crypto";

import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingScreenOpenCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import codebookCsv from "@/assets/defaults/unified_app_codebook.csv?raw";
import {
  buildInputCapabilityEvidenceCsv,
  INPUT_CAPABILITY_EVIDENCE_FIELDS,
  INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
  INPUT_CAPABILITY_IDS,
} from "@/testSupport/artifactInterventions";
import {
  B06_ALL_OUTPUTS_INTERSECTION_FILES,
  buildB06AllOutputsIntersectionFixtures,
} from "@/testSupport/b06OmissionFixtureMaterializer";
import allOutputsCodebookCsv from "@/testSupport/fixtures/b06-all-outputs-intersection-app-codebook.csv?raw";
import allOutputsForcingCsv from "@/testSupport/fixtures/b06-all-outputs-intersection-apps-forcing-screen-open.csv?raw";
import allOutputsFilterCsv from "@/testSupport/fixtures/b06-all-outputs-intersection-apps-to-filter.csv?raw";
import allOutputsBackgroundCsv from "@/testSupport/fixtures/b06-all-outputs-intersection-background-apps.csv?raw";
import allOutputsDeviceSharingCsv from "@/testSupport/fixtures/b06-all-outputs-intersection-device-sharing.csv?raw";
import allOutputsEnrolledDevicesCsv from "@/testSupport/fixtures/b06-all-outputs-intersection-enrolled-devices.csv?raw";
import allOutputsStudyDatesCsv from "@/testSupport/fixtures/b06-all-outputs-intersection-study-dates.csv?raw";
import allOutputsSurveyAttributionCsv from "@/testSupport/fixtures/b06-all-outputs-intersection-survey-attribution.csv?raw";
import allOutputsRawCsv from "@/testSupport/fixtures/b06-all-outputs-intersection.csv?raw";
import appCapabilityCsv from "@/testSupport/fixtures/b06-app-strategy-separating-input-capability-evidence.csv?raw";
import appStrategyCsv from "@/testSupport/fixtures/b06-app-strategy-separating-rows.csv?raw";
import schoedelCapabilityCsv from "@/testSupport/fixtures/b06-schoedel-b05-input-capability-evidence.csv?raw";
import schoedelRawCsv from "@/testSupport/fixtures/schoedel-prose-reconstruction.csv?raw";

const RAW_FIELDS = [
  "study_id",
  "participant_id",
  "username",
  "application_label",
  "interaction_type",
  "app_package_name",
  "event_timestamp",
  "timezone",
] as const;

type RawRow = Record<(typeof RAW_FIELDS)[number], string>;
type CapabilityRow = Record<
  (typeof INPUT_CAPABILITY_EVIDENCE_FIELDS)[number],
  string
>;

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseCsv<Row extends Record<string, string>>(
  csv: string,
): Papa.ParseResult<Row> {
  const parsed = Papa.parse<Row>(csv, { header: true, skipEmptyLines: true });
  expect(parsed.errors).toEqual([]);
  return parsed;
}

describe("B06 omission-oracle synthetic fixtures", () => {
  it("freezes the exact 33-row, four-participant app-strategy stream", () => {
    expect({
      byteLength: Buffer.byteLength(appStrategyCsv),
      sha256: digest(appStrategyCsv),
    }).toEqual({
        byteLength: 3_708,
        sha256: "sha256:8510d2e2f747f59c6bc31dfc8b0c00683263692f21da229748e66292f85b54a3",
      });
    expect(appStrategyCsv.endsWith("\n")).toBe(true);
    expect(appStrategyCsv).not.toContain("\r");
    const parsed = parseCsv<RawRow>(appStrategyCsv);
    expect(parsed.meta.fields).toEqual(RAW_FIELDS);
    expect(parsed.data).toHaveLength(33);
    expect(parsed.data.map(({ study_id }) => study_id)).toEqual(
      Array.from({ length: 33 }, () => "B06-SYNTHETIC"),
    );
    expect(parsed.data.map(({ username }) => username)).toEqual(
      Array.from({ length: 33 }, () => "Synthetic Participant"),
    );
    expect(parsed.data.map(({ timezone }) => timezone)).toEqual(
      Array.from({ length: 33 }, () => "UTC"),
    );
    expect([...new Set(parsed.data.map(({ participant_id }) => participant_id))]).toEqual([
      "fixture-a",
      "fixture-b",
      "fixture-c",
      "fixture-d",
    ]);
    expect(
      ["fixture-a", "fixture-b", "fixture-c", "fixture-d"].map(
        (participantId) =>
          parsed.data.filter(({ participant_id }) => participant_id === participantId)
            .length,
      ),
    ).toEqual([8, 8, 11, 6]);
    expect(parsed.data.every(({ event_timestamp }) => event_timestamp.startsWith("2026-03-12 ")))
      .toBe(true);
    expect(new Set(parsed.data.map(({ event_timestamp }) => event_timestamp))).toHaveLength(33);
    const packageByLabel = {
      System: "android",
      Alpha: "com.synthetic.alpha",
      Beta: "com.synthetic.beta",
      Gamma: "com.synthetic.gamma",
    } as const;
    expect(
      parsed.data.every(
        ({ application_label, app_package_name }) =>
          packageByLabel[application_label as keyof typeof packageByLabel] ===
          app_package_name,
      ),
    ).toBe(true);
    expect(
      parsed.data.map(
        ({ participant_id, application_label, interaction_type, event_timestamp }, index) =>
          `${index + 1}:${participant_id}:${event_timestamp.slice(11)}:${application_label}:${interaction_type}`,
      ),
    ).toEqual([
      "1:fixture-a:09:00:00:System:Screen Interactive",
      "2:fixture-a:09:00:01:System:Keyguard Hidden",
      "3:fixture-a:09:00:02:Alpha:Activity Resumed",
      "4:fixture-a:09:00:40:System:Screen Non-Interactive",
      "5:fixture-a:09:01:00:System:Screen Interactive",
      "6:fixture-a:09:01:01:System:Keyguard Hidden",
      "7:fixture-a:09:01:39:Alpha:Activity Paused",
      "8:fixture-a:09:01:40:Alpha:Activity Stopped",
      "9:fixture-b:10:00:00:System:Screen Interactive",
      "10:fixture-b:10:00:01:System:Keyguard Hidden",
      "11:fixture-b:10:00:02:Alpha:Activity Resumed",
      "12:fixture-b:10:00:07:Alpha:User Interaction",
      "13:fixture-b:10:00:12:Beta:Activity Resumed",
      "14:fixture-b:10:00:22:Alpha:Activity Resumed",
      "15:fixture-b:10:01:42:Alpha:Activity Stopped",
      "16:fixture-b:10:02:00:System:Screen Non-Interactive",
      "17:fixture-c:11:00:00:System:Screen Interactive",
      "18:fixture-c:11:00:01:System:Keyguard Hidden",
      "19:fixture-c:11:00:02:Alpha:Activity Resumed",
      "20:fixture-c:11:00:12:Alpha:Activity Resumed",
      "21:fixture-c:11:00:22:Alpha:Activity Paused",
      "22:fixture-c:11:00:32:Alpha:Activity Resumed",
      "23:fixture-c:11:00:42:Alpha:Activity Paused",
      "24:fixture-c:11:00:43:Alpha:Activity Stopped",
      "25:fixture-c:11:00:50:Beta:Activity Resumed",
      "26:fixture-c:11:01:00:Gamma:Activity Resumed",
      "27:fixture-c:11:01:20:System:Screen Non-Interactive",
      "28:fixture-d:12:00:00:System:Screen Interactive",
      "29:fixture-d:12:00:01:Alpha:Activity Resumed",
      "30:fixture-d:12:10:02:Alpha:User Interaction",
      "31:fixture-d:12:10:03:System:Screen Non-Interactive",
      "32:fixture-d:12:10:33:System:Screen Interactive",
      "33:fixture-d:12:10:34:Beta:Activity Resumed",
    ]);
  });

  it.each([
    [
      "app-strategy",
      appStrategyCsv,
      appCapabilityCsv,
      "sha256:8510d2e2f747f59c6bc31dfc8b0c00683263692f21da229748e66292f85b54a3",
      3_708,
      "sha256:e3b54f7882d0e19602793022d0fca59c4a93fbf3193116cb24244ad14b6b5496",
    ],
    [
      "Schoedel/B05",
      schoedelRawCsv,
      schoedelCapabilityCsv,
      "sha256:9c5cbeee126952eb88d75deb2651c53dee597663278555015b702cf13b963c02",
      3_099,
      "sha256:52cf8fc2eb8fdaefa51d19d3a738429c172cb4bdd7d1347b8f779ff3f9b2b848",
    ],
  ])(
    "binds the %s sidecar byte-exactly to its synthetic raw fixture",
    (_label, raw, sidecar, rawSha256, rawByteLength, sidecarSha256) => {
      expect({ byteLength: Buffer.byteLength(raw), sha256: digest(raw) }).toEqual({
        byteLength: rawByteLength,
        sha256: rawSha256,
      });
      expect({
        byteLength: Buffer.byteLength(sidecar),
        sha256: digest(sidecar),
      }).toEqual({
        byteLength: 2_755,
        sha256: sidecarSha256,
      });
      expect(sidecar).toBe(buildInputCapabilityEvidenceCsv(raw));
      expect(sidecar.endsWith("\n")).toBe(true);
      expect(sidecar).not.toContain("\r");
      const parsed = parseCsv<CapabilityRow>(sidecar);
      expect(parsed.meta.fields).toEqual(INPUT_CAPABILITY_EVIDENCE_FIELDS);
      expect(parsed.data).toHaveLength(12);
      expect(parsed.data.map(({ capability_id }) => capability_id)).toEqual(
        INPUT_CAPABILITY_IDS,
      );
      expect(parsed.data).toEqual(
        INPUT_CAPABILITY_IDS.map((capabilityId) => ({
          schema_version: INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
          raw_input_sha256: digest(raw),
          participant_id: "*",
          capability_id: capabilityId,
          state: "capable",
          evidence_basis: "producer_manifest",
          evidence_reference: "urn:chronicle:synthetic-campaign-manifest",
          evidence_sha256: "",
        })),
      );
      expect(sidecar).not.toMatch(/(?:@|participant(?:-|_)\d|study(?:-|_)\d)/i);
    },
  );

  it("freezes the deterministic 193-row C20 corpus and only its eight active supports", () => {
    const observedByRole = {
      raw_chronicle_csv: allOutputsRawCsv,
      app_codebook_file: allOutputsCodebookCsv,
      apps_forcing_screen_open_file: allOutputsForcingCsv,
      background_apps_file: allOutputsBackgroundCsv,
      device_sharing_file: allOutputsDeviceSharingCsv,
      enrolled_devices_file: allOutputsEnrolledDevicesCsv,
      filter_file: allOutputsFilterCsv,
      study_dates_file: allOutputsStudyDatesCsv,
      survey_attribution_file: allOutputsSurveyAttributionCsv,
    } as const;
    const expected = {
      raw_chronicle_csv: [
        36_080,
        "sha256:7b8c41e89c5286a8ba9e75e18ab0392347451204ab4c2f93cb2d97ad297a643c",
      ],
      app_codebook_file: [
        10_527,
        "sha256:2679ef4b1699084f48beab50a25af062df84e0b49fe03d5fccff5c41677a757f",
      ],
      apps_forcing_screen_open_file: [
        166,
        "sha256:a9a7df7c765ce08495bc1c3f330ec13fe8601bb7c008de3d5fc8c673779243c3",
      ],
      background_apps_file: [
        298,
        "sha256:8acc3cdf8523624d4aa142b5498f0f4936ef08f757538d4787d384ab0c2d7720",
      ],
      device_sharing_file: [
        81,
        "sha256:2d3a521e0e704598058b24c62969429d08c9872236b8a15eb84b6c99b6d491cc",
      ],
      enrolled_devices_file: [
        65,
        "sha256:a3089fc1223fc5c5cff35ffd81e6cd84cac70b16767554affc0d8c7f45abe9cb",
      ],
      filter_file: [
        4_825,
        "sha256:48beb8d2f47cfe226bd415bdbb3fcd9341a5a8705e75e61897606e30dd8d2264",
      ],
      study_dates_file: [
        112,
        "sha256:97cfc5642ec9d660141e21d3dbb40f22ac7d2c4cc80a4fd4be708c61c4630bc3",
      ],
      survey_attribution_file: [
        4_165,
        "sha256:62dcdf1ca6271448b8c512110fbeb994ffd9229f7cdcd6a4593b5cf3649884f3",
      ],
    } as const;
    const materialized = buildB06AllOutputsIntersectionFixtures({
      codebookCsv,
      filterCsv,
      backgroundCsv,
      forcingScreenOpenCsv,
    });
    expect(materialized.map(({ role }) => role)).toEqual(
      Object.keys(B06_ALL_OUTPUTS_INTERSECTION_FILES),
    );
    expect(materialized.map(({ role }) => role)).not.toContain(
      "input_capability_evidence_file",
    );
    for (const { role, fileName, csv } of materialized) {
      expect(fileName).toBe(B06_ALL_OUTPUTS_INTERSECTION_FILES[role]);
      expect(csv).toBe(observedByRole[role]);
      expect(csv.endsWith("\n")).toBe(true);
      expect(csv).not.toContain("\r");
      expect([Buffer.byteLength(csv), digest(csv)]).toEqual(expected[role]);
    }

    const raw = parseCsv<Record<string, string>>(allOutputsRawCsv);
    expect(raw.data).toHaveLength(193);
    expect([...new Set(raw.data.map(({ study_id }) => study_id))]).toEqual([
      "synthetic-configuration-campaign",
    ]);
    expect([...new Set(raw.data.map(({ participant_id }) => participant_id))]).toEqual([
      "P-SYN-51a7e5aa",
    ]);
    const codebook = parseCsv<Record<string, string>>(allOutputsCodebookCsv);
    const packages = codebook.data.map(({ app_package_name }) => app_package_name!);
    expect(packages).toEqual(
      [...packages].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
    expect(allOutputsRawCsv).not.toMatch(/(?:@|real participant|real study)/i);
  });
});
