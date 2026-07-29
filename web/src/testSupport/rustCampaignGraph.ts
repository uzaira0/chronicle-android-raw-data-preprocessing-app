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

type PlanNode = {
  node_id: string;
  input_nodes: string[];
};

const nodes = productPlan.nodes as PlanNode[];

/** Product-group order from the generated Rust-owned plan. */
export const order = nodes.map((node) => node.node_id);

/** Exact group-level downstream cone from the generated Rust-owned plan. */
export function descendantsOf(seed: ReadonlySet<string>): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    for (const input of node.input_nodes) {
      const targets = dependents.get(input) ?? [];
      targets.push(node.node_id);
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
