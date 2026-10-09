import { createHash } from "node:crypto";

import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import codebookCsv from "@/testSupport/fixtures/synthetic-catalog-app-codebook.csv?raw";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  buildArtifactFixtureState,
  buildArtifactInterventions,
  buildInputCapabilityEvidenceCsv,
  INPUT_CAPABILITY_EVIDENCE_FIELDS,
  INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
  INPUT_CAPABILITY_IDS,
  prepareArtifactFixtureForScientificExecution,
  SUPPORT_ROLE_IDS,
} from "@/testSupport/artifactInterventions";
import {
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  SYNTHETIC_CORPUS_PROFILES,
} from "@/testSupport/syntheticChronicleCorpus";

const sourceSensitive = {
  ...DEFAULT_BROWSER_OPTIONS,
  processScreenUsage: true,
  screenSessionConstructionStrategy: "parry_toth_2025_session_glance_v1",
} as const;

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

describe("scientific campaign capability fixture", () => {
  const catalog = buildSyntheticCatalog({
    codebookCsv,
    filterCsv,
    backgroundCsv,
    forcingScreenOpenCsv: forcingCsv,
  });
  const corpus = generateSyntheticChronicleCorpus(
    SYNTHETIC_CORPUS_PROFILES[0]!,
    catalog,
  );
  const fixture = buildArtifactFixtureState({
    corpus,
    catalog,
    filterCsv,
    forcingCsv,
    backgroundCsv,
  });

  it("adds the exact raw-bound eight-column capability support role", () => {
    // Exact named set, not a count: a count absorbs an addition plus a
    // removal silently.
    expect([...SUPPORT_ROLE_IDS]).toEqual([
      "filter_file",
      "apps_forcing_screen_open_file",
      "background_apps_file",
      "app_codebook_file",
      "study_dates_file",
      "device_sharing_file",
      "survey_attribution_file",
      "enrolled_devices_file",
      "input_capability_evidence_file",
    ]);
    const csv = buildInputCapabilityEvidenceCsv(fixture.rawCsv);
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.meta.fields).toEqual(INPUT_CAPABILITY_EVIDENCE_FIELDS);
    expect(csv).toBe(
      `${INPUT_CAPABILITY_EVIDENCE_FIELDS.join(",")}\n${INPUT_CAPABILITY_IDS.map(
        (capabilityId) =>
          [
            INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
            digest(fixture.rawCsv),
            "*",
            capabilityId,
            "capable",
            "producer_manifest",
            "urn:chronicle:synthetic-campaign-manifest",
            "",
          ].join(","),
      ).join("\n")}\n`,
    );
    expect(parsed.data).toEqual(
      INPUT_CAPABILITY_IDS.map((capabilityId) => ({
        schema_version: INPUT_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
        raw_input_sha256: digest(fixture.rawCsv),
        participant_id: "*",
        capability_id: capabilityId,
        state: "capable",
        evidence_basis: "producer_manifest",
        evidence_reference: "urn:chronicle:synthetic-campaign-manifest",
        evidence_sha256: "",
      })),
    );
  });

  it("provides eight field shards and a required CRLF identity intervention", () => {
    const interventions = buildArtifactInterventions({
      corpus,
      catalog,
    }).filter(({ roleId }) => roleId === "input_capability_evidence_file");
    expect(
      [
        ...new Set(interventions.flatMap(({ sourceFields }) => sourceFields)),
      ].sort(),
    ).toEqual(
      INPUT_CAPABILITY_EVIDENCE_FIELDS.map(
        (field) => `input_capability_evidence_file.${field}`,
      ).sort(),
    );
    const crlf = interventions.find(
      ({ id }) =>
        id === "support-representation:input_capability_evidence_file:crlf",
    );
    expect(crlf).toMatchObject({
      expectedSemanticEffect: "required",
      sourceFields: [],
    });
    const changed = crlf!.apply(fixture);
    expect(changed.supports.input_capability_evidence_file.csv).toContain(
      "\r\n",
    );
    expect(
      digest(changed.supports.input_capability_evidence_file.csv),
    ).not.toBe(digest(fixture.supports.input_capability_evidence_file.csv));
  });

  it("rebinds raw mutations but preserves explicit mixed capability bindings", () => {
    const rawMutated = {
      ...fixture,
      rawCsv: `${fixture.rawCsv}\n`,
    };
    const rebound = prepareArtifactFixtureForScientificExecution(
      rawMutated,
      sourceSensitive,
    );
    expect(rebound.supports.input_capability_evidence_file.csv).toContain(
      digest(rawMutated.rawCsv),
    );

    const staleClaim = buildArtifactInterventions({ corpus, catalog })
      .find(({ id }) => id === "support:capability-stale-raw-binding")!
      .apply(fixture);
    expect(
      prepareArtifactFixtureForScientificExecution(staleClaim, sourceSensitive),
    ).toBe(staleClaim);
  });
});
