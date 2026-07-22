import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { TIMEZONE_HANDLING_VALUES } from "@/lib/generatedContract";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import {
  GOLDEN_RUNTIME,
  GOLDEN_SCENARIOS,
  type GoldenScenario,
} from "@/lib/pipelineGraph/golden/goldenScenario";
import type { BrowserSupportFile } from "@/lib/types";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

const EXPECTED_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "family-expected",
  "timezone-configuration-family.json",
);
const UPDATE = process.env.UPDATE_CONFIGURATION_FAMILY === "1";
const EXPECTED_MODES = [...TIMEZONE_HANDLING_VALUES];

type Partition = {
  perspectiveId: string;
  width: number;
  classes: Array<{ variants: string[] }>;
};

type FamilyReport = {
  protocolVersion: string;
  fixtureId: string;
  axis: { variants: string[]; cardinality: number };
  variants: Array<{
    variantId: string;
    rowsBefore: number;
    rowsAfter: number;
    rowsRemoved: number;
  }>;
  partitions: Partition[];
  influence: { seedNodes: string[]; conservativeCone: string[] };
  nodeWidthEnvelopes: Array<{
    nodeId: string;
    minimumWidth: number;
    maximumWidth: number;
    status: string;
  }>;
  completeness: {
    exhaustive: boolean;
    fullRustExecutionCount: number;
    missingVariants: string[];
    unexpectedVariants: string[];
    duplicateVariants: string[];
  };
};

beforeAll(() => {
  const wasmBytes = readFileSync(
    new URL(
      "../../../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
      import.meta.url,
    ),
  );
  runtime.initSync({ module: wasmBytes });
});

function bytes(file: BrowserSupportFile): Uint8Array {
  return new Uint8Array(file.bytes);
}

async function sha256Uri(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(value).buffer,
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function putSupport(
  supports: runtime.RuntimeSupportFiles,
  role: string,
  file: BrowserSupportFile | undefined,
): void {
  if (file) supports.put_with_name(role, file.name, bytes(file));
}

async function analyze(scenario: GoldenScenario): Promise<FamilyReport> {
  const input = new TextEncoder().encode(scenario.inputCsv);
  const inputDigest = await sha256Uri(input);
  const supports = new runtime.RuntimeSupportFiles();
  try {
    putSupport(supports, "filter_file", scenario.supportFiles.filterFile);
    putSupport(
      supports,
      "apps_forcing_screen_open_file",
      scenario.supportFiles.appsForcingScreenOpenFile,
    );
    putSupport(
      supports,
      "background_apps_file",
      scenario.supportFiles.backgroundAppsFile,
    );
    putSupport(
      supports,
      "app_codebook_file",
      scenario.supportFiles.appCodebookFile,
    );
    putSupport(
      supports,
      "study_dates_file",
      scenario.supportFiles.studyDatesFile,
    );
    putSupport(
      supports,
      "device_sharing_file",
      scenario.supportFiles.deviceSharingFile,
    );
    putSupport(
      supports,
      "survey_attribution_file",
      scenario.supportFiles.surveyAttributionFile,
    );
    putSupport(
      supports,
      "enrolled_devices_file",
      scenario.supportFiles.enrolledDevicesFile,
    );
    const request = JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v1",
      requestId: `timezone-family-${scenario.inputFileName}`,
      command: "ExecuteWorkspace",
      workspaceRootDigest: null,
      workspaceId: inputDigest,
      inputFileName: scenario.inputFileName,
      inputSha256: inputDigest,
      options: buildRustV2Options(scenario.options, GOLDEN_RUNTIME),
    });
    return JSON.parse(
      runtime.analyze_timezone_configuration_family(request, input, supports),
    ) as FamilyReport;
  } finally {
    supports.free();
  }
}

function width(report: FamilyReport, perspective: string): number {
  const partition = report.partitions.find(
    (candidate) => candidate.perspectiveId === perspective,
  );
  if (!partition) throw new Error(`missing partition: ${perspective}`);
  return partition.width;
}

describe("timezone configuration family over the existing golden corpus", () => {
  it("proves all four methods computationally collapse on every single-zone fixture", async () => {
    const reports: FamilyReport[] = [];
    for (const scenario of GOLDEN_SCENARIOS) {
      const report = await analyze(scenario);
      reports.push(report);
      expect(report.protocolVersion).toBe("chronicle-configuration-family/v1");
      expect(report.axis.variants).toEqual(EXPECTED_MODES);
      expect(report.axis.cardinality).toBe(4);
      expect(report.completeness).toMatchObject({
        exhaustive: true,
        fullRustExecutionCount: 4,
        missingVariants: [],
        unexpectedVariants: [],
        duplicateVariants: [],
      });

      // The method choice is retained for reproduction even though this
      // corpus is single-zone and therefore has one effective computation.
      expect(width(report, "declared-method"), scenario.name).toBe(4);
      expect(width(report, "effective-target"), scenario.name).toBe(1);
      expect(width(report, "retained-source-rows"), scenario.name).toBe(1);
      expect(width(report, "normalized-events"), scenario.name).toBe(1);
      expect(width(report, "published-outputs"), scenario.name).toBe(1);
      expect(width(report, "provenance-identity"), scenario.name).toBe(4);
      expect(report.variants.every((variant) => variant.rowsRemoved === 0)).toBe(
        true,
      );
      expect(
        report.variants.every(
          (variant) => variant.rowsBefore === variant.rowsAfter,
        ),
      ).toBe(true);
      expect(report.influence.seedNodes).toEqual(["normalize_timezones"]);
      expect(report.influence.conservativeCone).not.toContain("parse_events");
      expect(report.influence.conservativeCone).toContain("outputs");
      expect(
        report.nodeWidthEnvelopes.every(
          (envelope) =>
            envelope.minimumWidth === 1 && envelope.maximumWidth === 1,
        ),
      ).toBe(true);
    }

    const corpusEvidence = `${JSON.stringify(
      {
        protocolVersion: "chronicle-configuration-family-corpus/v1",
        fixtureAuthority: {
          source:
            "web/src/lib/pipelineGraph/golden/goldenScenario.ts#GOLDEN_SCENARIOS",
          implementationDigest: runtime.implementation_build_digest(),
        },
        reports,
      },
      null,
      2,
    )}\n`;
    if (UPDATE) {
      mkdirSync(dirname(EXPECTED_FILE), { recursive: true });
      writeFileSync(EXPECTED_FILE, corpusEvidence, "utf8");
      return;
    }
    expect(existsSync(EXPECTED_FILE), "missing family evidence snapshot").toBe(
      true,
    );
    expect(corpusEvidence).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  }, 120_000);
});
