import productPlan from "../../../.semantic-federation/semantic/resources/chronicle.plan.json";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
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
