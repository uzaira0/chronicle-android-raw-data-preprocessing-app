import productPlan from "../../../.semantic-federation/semantic/resources/chronicle.plan.json" with { type: "json" };

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  MAXIMUM_DURATION_VECTOR_KEYS,
  completeMaximumDurationVector,
  isValidMaximumDurationSelectionShape,
  withMaximumDurationVector,
  type MaximumDurationVectorKey,
} from "@/lib/maximumDurationVector";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
} from "@/lib/types";

/** Pinned run metadata for byte-stable Rust/WASM campaign output. */
export const GOLDEN_RUNTIME: BrowserProcessingRuntime = {
  datetimeOfPreprocessing: "2026-07-18 00:00:00 UTC",
};

/** A configuration that activates every computational branch. */
export const ALL_ON: BrowserProcessingOptions = {
  ...DEFAULT_BROWSER_OPTIONS,
  processAppUsage: true,
  processScreenUsage: true,
  useFilterFile: true,
  useAppsForcingScreenOpenFile: true,
  useBackgroundAppsFile: true,
  useAppCodebook: true,
  includeCategoryColumn: true,
  modelConcurrentUsage: true,
  applyMinimumUsageDurationToConcurrentSubintervals: true,
  filterZeroDurationSessions: true,
  interactionTypesToRemove: ["Usage Stat"],
  interactionTypeRemap: [],
  timezoneHandling: "selected-convert",
  selectedTimezone: "America/Chicago",
  enableScreenGatedCrediting: true,
  enableStudyWindowFilter: true,
  enablePersonAttribution: true,
  enableComplianceScoring: true,
  addNoActivityPlaceholderDays: true,
  enableDayCoverage: true,
};

type PlanQueryGroup = {
  query_group_id: string;
  input_query_groups: string[];
};

const queryGroups = productPlan.query_groups as PlanQueryGroup[];

/** Product-group order from the generated Rust-owned plan. */
export const order = queryGroups.map((group) => group.query_group_id);

/** Exact group-level downstream cone from the generated Rust-owned plan. */
export function descendantsOf(seed: ReadonlySet<string>): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const group of queryGroups) {
    for (const input of group.input_query_groups) {
      const targets = dependents.get(input) ?? [];
      targets.push(group.query_group_id);
      dependents.set(input, targets);
    }
  }
  const cone = new Set(seed);
  const queue = [...seed];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependents.get(current) ?? []) {
      if (cone.has(dependent)) continue;
      cone.add(dependent);
      queue.push(dependent);
    }
  }
  return cone;
}

const MAXIMUM_DURATION_VECTOR_KEY_SET = new Set<string>(MAXIMUM_DURATION_VECTOR_KEYS);
const SCREEN_MAXIMUM_DURATION_KEYS = [
  "screenSessionMaximumDurationMinutes",
  "screenSessionMaximumDurationDisposition",
] as const;
const SCREEN_MAXIMUM_DURATION_KEY_SET = new Set<string>(SCREEN_MAXIMUM_DURATION_KEYS);

/** The option keys an intervention on `key` may move. Every key moves only
 * itself, except the maximum-duration keys, which travel as their legal
 * selection vector: setting one of them completes the others to the one legal
 * pairing (`completeMaximumDurationVector`), exactly as the settings card
 * does, because a partial vector is not a configuration the runtime accepts
 * (`pipeline_options_invalid:b06=request_shape_invalid`). */
export function interventionFields(key: string): readonly string[] {
  if (MAXIMUM_DURATION_VECTOR_KEY_SET.has(key)) return MAXIMUM_DURATION_VECTOR_KEYS;
  if (SCREEN_MAXIMUM_DURATION_KEY_SET.has(key)) return SCREEN_MAXIMUM_DURATION_KEYS;
  return [key];
}

/** A configuration with exactly one option key replaced (or removed when the
 * value is `undefined`). The axis campaigns perturb one key at a time; the
 * B06 vector keys complete their siblings, see `interventionFields`. */
export function withValue(
  source: BrowserProcessingOptions,
  key: string,
  value: unknown,
): BrowserProcessingOptions {
  if (MAXIMUM_DURATION_VECTOR_KEY_SET.has(key)) {
    return withMaximumDurationVector(
      source,
      completeMaximumDurationVector(source, key as MaximumDurationVectorKey, value),
    );
  }
  if (SCREEN_MAXIMUM_DURATION_KEY_SET.has(key)) {
    const target = { ...source };
    if (key === "screenSessionMaximumDurationMinutes") {
      const minutes = value as number;
      target.screenSessionMaximumDurationMinutes = minutes;
      if (minutes <= 0) target.screenSessionMaximumDurationDisposition = "none";
      else if (target.screenSessionMaximumDurationDisposition === "none") {
        target.screenSessionMaximumDurationDisposition = "truncate";
      }
    } else {
      const disposition =
        value as BrowserProcessingOptions["screenSessionMaximumDurationDisposition"];
      target.screenSessionMaximumDurationDisposition = disposition;
      if (disposition === "none") target.screenSessionMaximumDurationMinutes = 0;
      else if (target.screenSessionMaximumDurationMinutes <= 0) {
        target.screenSessionMaximumDurationMinutes = 60;
      }
    }
    return target;
  }
  const target = { ...source } as unknown as Record<string, unknown>;
  if (value === undefined) delete target[key];
  else target[key] = value;
  return target as unknown as BrowserProcessingOptions;
}

/** Whether a perturbed configuration is one the runtime will accept at all. A
 * `selected-` timezone strategy without a selected timezone is refused before
 * any query runs, and a maximum-duration vector outside its legal shapes is
 * refused before reconstruction, so such variants are not axis
 * observations. */
export function validConfiguration(options: BrowserProcessingOptions): boolean {
  const screenMaximumDurationIsValid =
    (options.screenSessionMaximumDurationDisposition === "none" &&
      options.screenSessionMaximumDurationMinutes === 0) ||
    (options.screenSessionMaximumDurationDisposition !== "none" &&
      Number.isFinite(options.screenSessionMaximumDurationMinutes) &&
      options.screenSessionMaximumDurationMinutes > 0);
  return (
    !(
      options.timezoneHandling.startsWith("selected-") &&
      !options.selectedTimezone?.trim()
    ) &&
    isValidMaximumDurationSelectionShape(options) &&
    screenMaximumDurationIsValid
  );
}
