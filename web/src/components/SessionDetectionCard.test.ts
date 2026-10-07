import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EPISODE_RECONSTRUCTION_STRATEGIES,
  EVENT_RETENTION_SETS,
  INTERVAL_QUALITY_POLICIES,
  MAXIMUM_DURATION_DISPOSITIONS,
  MAXIMUM_DURATION_POLICIES,
  MAXIMUM_DURATION_THRESHOLD_SOURCES,
  MICRO_USE_CLASSIFICATION_POLICIES,
  MINIMUM_DURATION_COMPARATORS,
  MINIMUM_DURATION_DISPOSITIONS,
  OPENER_SETS,
  SESSION_GROUPING_POLICIES,
} from "@/components/SessionDetectionCard";

const ONTOLOGY_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../schema/chronicle-research-ontology.linkml.yaml",
);
const COMPONENT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "SessionDetectionCard.tsx",
);

/// Read one enum's permissible values out of the research ontology.
///
/// This deliberately mirrors the string-slicing parser the Rust side already
/// uses in `every_reconstruction_arm_is_declared_in_the_research_ontology`
/// (pipeline_v2.rs) rather than adding a YAML dependency to the web tests. Both
/// sides therefore read the same file the same way, and a disagreement between
/// them is a disagreement about the file, not about two parsers.
function permissibleValues(enumName: string): string[] {
  const lines = readFileSync(ONTOLOGY_FILE, "utf8").split("\n");
  const enumStart = lines.findIndex((line) => line.trim() === `${enumName}:`);
  if (enumStart === -1) {
    throw new Error(`the research ontology declares no enum named ${enumName}`);
  }
  const valuesStart = lines.findIndex(
    (line, index) => index > enumStart && line.trim() === "permissible_values:",
  );
  if (valuesStart === -1) {
    throw new Error(`${enumName} declares no permissible_values block`);
  }
  const indent = (line: string): number => line.length - line.trimStart().length;
  const valueIndent = indent(lines[valuesStart] ?? "") + 2;

  const values: string[] = [];
  for (let index = valuesStart + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    if (indent(line) < valueIndent) break;
    if (indent(line) > valueIndent) continue;
    // Values are written either as a bare `name:` or as `name: {description: …}`,
    // so take the key and drop anything the value carries on the same line.
    const name = (line.trim().split(":")[0] ?? "").trim();
    if (name === "" || name.startsWith("#")) continue;
    values.push(name);
  }
  return values;
}

/// Every axis whose selectable values are a published-method vocabulary.
///
/// Every axis is ontology-declared, so every axis is checkable. Before this,
/// only `episode_reconstruction_strategy` had an ontology enum, which is exactly
/// why its UI list was allowed to fall three arms behind the kernel unnoticed.
const AXES: readonly {
  optionKey: string;
  ontologyEnum: string;
  uiValues: readonly { value: string; label: string }[];
}[] = [
  {
    optionKey: "event_retention_set",
    ontologyEnum: "EventRetentionSetId",
    uiValues: EVENT_RETENTION_SETS,
  },
  {
    optionKey: "opener_set",
    ontologyEnum: "OpenerSetId",
    uiValues: OPENER_SETS,
  },
  {
    optionKey: "episode_reconstruction_strategy",
    ontologyEnum: "ReconstructionStrategyId",
    uiValues: EPISODE_RECONSTRUCTION_STRATEGIES,
  },
  {
    optionKey: "micro_use_classification_policy",
    ontologyEnum: "MicroUseClassificationPolicyId",
    uiValues: MICRO_USE_CLASSIFICATION_POLICIES,
  },
  {
    optionKey: "minimum_duration_comparator",
    ontologyEnum: "MinimumDurationComparatorId",
    uiValues: MINIMUM_DURATION_COMPARATORS,
  },
  {
    optionKey: "minimum_duration_disposition",
    ontologyEnum: "MinimumDurationDispositionId",
    uiValues: MINIMUM_DURATION_DISPOSITIONS,
  },
  {
    optionKey: "maximum_duration_policy",
    ontologyEnum: "MaximumDurationPolicyId",
    uiValues: MAXIMUM_DURATION_POLICIES,
  },
  {
    optionKey: "maximum_duration_disposition",
    ontologyEnum: "MaximumDurationConfiguredDispositionId",
    uiValues: MAXIMUM_DURATION_DISPOSITIONS,
  },
  {
    optionKey: "maximum_duration_threshold_source",
    ontologyEnum: "MaximumDurationThresholdSourceId",
    uiValues: MAXIMUM_DURATION_THRESHOLD_SOURCES,
  },
  {
    optionKey: "interval_quality_policy",
    ontologyEnum: "IntervalQualityPolicyId",
    uiValues: INTERVAL_QUALITY_POLICIES,
  },
  {
    optionKey: "session_grouping_policy",
    ontologyEnum: "SessionGroupingPolicyId",
    uiValues: SESSION_GROUPING_POLICIES,
  },
];

describe("published-method axis controls", () => {
  it("does not present the legacy 45-second app grouping as van Berkel's classifier", () => {
    expect(SESSION_GROUPING_POLICIES.find((entry) => entry.value === "van_berkel_45s")?.label)
      .toBe("App-episode gap ≤ 45 s (legacy ID)");
    const ontology = readFileSync(ONTOLOGY_FILE, "utf8");
    const description = ontology.split("      van_berkel_45s:")[1]?.split("\n")[0];
    expect(description).toContain("not an exact implementation of van Berkel");
    expect(description).toContain("Gap < T");
    expect(description).toContain("device-session");
  });

  it("offers every implemented arm of every ontology-declared axis", () => {
    // A rule that ships in the kernel but is missing from this list cannot be
    // selected, so it is not a shipped feature at all — it is dead code that
    // every other test still exercises directly and therefore still passes.
    // That is what happened to foreground_background_pairing,
    // draxler_interruption_aware and morrison_lock_tolerant.
    for (const axis of AXES) {
      const declared = permissibleValues(axis.ontologyEnum);
      const offered = axis.uiValues.map((entry) => entry.value);
      expect(
        [...offered].sort(),
        `${axis.optionKey} must offer exactly the arms ${axis.ontologyEnum} declares`,
      ).toEqual([...declared].sort());
    }
  });

  it("gives every offered value a distinct non-empty label", () => {
    // A duplicated or blank label makes two published rules indistinguishable
    // in the one place a researcher chooses between them.
    for (const axis of AXES) {
      const labels = axis.uiValues.map((entry) => entry.label);
      expect(labels.filter((label) => label.trim() === "")).toEqual([]);
      expect(new Set(labels).size, `${axis.optionKey} labels must be distinct`).toBe(labels.length);
    }
  });

  it("offers each value exactly once", () => {
    for (const axis of AXES) {
      const values = axis.uiValues.map((entry) => entry.value);
      expect(new Set(values).size, `${axis.optionKey} values must be distinct`).toBe(values.length);
    }
  });

  it("places opener eligibility between event retention and reconstruction", () => {
    const source = readFileSync(COMPONENT_FILE, "utf8");
    const retention = source.indexOf('data-testid="event-retention-set-select"');
    const opener = source.indexOf('data-testid="opener-set-select"');
    const reconstruction = source.indexOf(
      'data-testid="episode-reconstruction-strategy-select"',
    );

    expect(retention).toBeGreaterThanOrEqual(0);
    expect(opener).toBeGreaterThan(retention);
    expect(reconstruction).toBeGreaterThan(opener);
    expect(source).toContain('modified={isMod("openerSet")}');
    expect(source).toContain('onReset={() => reset("openerSet")}');
  });

  it("keeps B03 classification and every B04 decision independently reachable", () => {
    const source = readFileSync(COMPONENT_FILE, "utf8");
    for (const testId of [
      "micro-use-classification-policy-select",
      "minimum-usage-duration-input",
      "minimum-duration-comparator-select",
      "minimum-duration-disposition-select",
    ]) {
      expect(source).toContain(`data-testid="${testId}"`);
    }
    for (const key of [
      "microUseClassificationPolicy",
      "minimumDurationComparator",
      "minimumDurationDisposition",
    ]) {
      expect(source).toContain(`modified={isMod("${key}")}`);
      expect(source).toContain(`onReset={() => reset("${key}")}`);
    }
  });

  it("keeps every B06 maximum-duration control reachable and resets the vector as one unit", () => {
    const source = readFileSync(COMPONENT_FILE, "utf8");
    for (const testId of [
      "long-duration-threshold-input",
      "maximum-duration-policy-select",
      "maximum-duration-disposition-select",
      "maximum-duration-threshold-source-select",
      "maximum-duration-threshold-ns-input",
    ]) {
      expect(source).toContain(`data-testid="${testId}"`);
    }
    // The four selection keys are one vector: every B06 field resets through
    // the same handler, and every edit goes through the completion table so
    // the browser never holds a partial (kernel-refused) shape.
    expect(source.match(/onReset=\{resetMaximumDuration\}/g)?.length).toBe(4);
    expect(source).toContain('updateMaximumDuration("maximumDurationPolicy", undefined)');
    expect(source).toContain("completeMaximumDurationVector(current, key, value)");
    // The nanosecond threshold is text on the wire — never a JS number input.
    const nsInput = source.slice(source.indexOf('id="maximum-duration-threshold-ns-input"'));
    expect(nsInput.slice(0, 400)).toContain('type="text"');
    expect(nsInput.slice(0, 400)).toContain('inputMode="numeric"');
    expect(nsInput.slice(0, 400)).toContain("maxLength={19}");
    // Typing legacy hours marks the choice explicit; resetting clears the marker.
    expect(source).toContain("longDurationThresholdHoursExplicit: true,");
    expect(source).toContain("longDurationThresholdHoursExplicit: undefined,");
  });
});
