import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  applyScreenMaximumDurationChange,
  SCREEN_SESSION_CONSTRUCTION_STRATEGIES,
} from "@/components/ScreenDetectionCard";
import {
  DEFAULT_BROWSER_OPTIONS,
  SCREEN_SESSION_CONSTRUCTION_STRATEGY_VALUES,
} from "@/lib/generatedContract";

const COMPONENT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "ScreenDetectionCard.tsx",
);

describe("screen-session construction control", () => {
  it("offers every generated B05 strategy once and names each distinctly", () => {
    expect(SCREEN_SESSION_CONSTRUCTION_STRATEGIES.map(({ value }) => value)).toEqual(
      SCREEN_SESSION_CONSTRUCTION_STRATEGY_VALUES,
    );
    const labels = SCREEN_SESSION_CONSTRUCTION_STRATEGIES.map(({ label }) => label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("participates in modified/reset state and explains the Schoedel dependency", () => {
    const source = readFileSync(COMPONENT_FILE, "utf8");
    expect(source).toContain(
      'data-testid="screen-session-construction-strategy-select"',
    );
    expect(source).toContain(
      'modified={isMod("screenSessionConstructionStrategy")}',
    );
    expect(source).toContain(
      'onReset={() => reset("screenSessionConstructionStrategy")}',
    );
    expect(source).toContain('data-testid="screen-internal-dependency-note"');
    expect(source).toContain('data-testid="screen-capability-evidence-note"');
  });

  it("keeps screen-session maximum-duration changes in a legal pair", () => {
    const active = applyScreenMaximumDurationChange(DEFAULT_BROWSER_OPTIONS, {
      disposition: "exclude_participant",
    });
    expect(active).toMatchObject({
      screenSessionMaximumDurationDisposition: "exclude_participant",
      screenSessionMaximumDurationMinutes: 60,
    });
    expect(
      applyScreenMaximumDurationChange(active, { disposition: "none" }),
    ).toMatchObject({
      screenSessionMaximumDurationDisposition: "none",
      screenSessionMaximumDurationMinutes: 0,
    });
    expect(applyScreenMaximumDurationChange(active, { minutes: 0 })).toMatchObject({
      screenSessionMaximumDurationDisposition: "none",
      screenSessionMaximumDurationMinutes: 0,
    });
  });
});
