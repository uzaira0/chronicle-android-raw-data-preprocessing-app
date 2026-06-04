import { describe, expect, it } from "vitest";

import { dedupeExactRows } from "@/lib/browserPipeline";

// dedupeExactRows reads only the four identifying fields that define an
// "exact-duplicate raw row" (#2): participant, timestamp, interaction, app.
// Build minimal rows and cast to the internal CanonicalRow without widening
// the module's public surface.
type RowKey = {
  participant_id: string;
  event_timestamp_ns: bigint;
  interaction_type: string;
  app_package_name: string;
};
type CanonicalRow = Parameters<typeof dedupeExactRows>[0][number];

function row(key: RowKey, extra: Record<string, unknown> = {}): CanonicalRow {
  return { ...key, ...extra } as unknown as CanonicalRow;
}

const base: RowKey = {
  participant_id: "P01",
  event_timestamp_ns: 1_000n,
  interaction_type: "Activity Resumed",
  app_package_name: "com.example.app",
};

describe("dedupeExactRows (#2 whole-row dedup)", () => {
  it("collapses fully-identical rows, keeping the first occurrence", () => {
    const result = dedupeExactRows([row(base), row(base), row(base)]);
    expect(result.rows).toHaveLength(1);
    expect(result.removed).toBe(2);
  });

  it("keeps the first occurrence's field values (not a later copy)", () => {
    // Rows share the dedup key but differ in a non-key field; first wins.
    const result = dedupeExactRows([
      row(base, { application_label: "First" }),
      row(base, { application_label: "Second" }),
    ]);
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as unknown as { application_label: string }).application_label).toBe(
      "First",
    );
    expect(result.removed).toBe(1);
  });

  it("is participant-aware: same timestamp/app/interaction across participants is kept", () => {
    const result = dedupeExactRows([
      row({ ...base, participant_id: "P01" }),
      row({ ...base, participant_id: "P02" }),
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.removed).toBe(0);
  });

  it("distinguishes timestamp, interaction type, and app package", () => {
    const result = dedupeExactRows([
      row(base),
      row({ ...base, event_timestamp_ns: 2_000n }),
      row({ ...base, interaction_type: "Activity Paused" }),
      row({ ...base, app_package_name: "com.other.app" }),
    ]);
    expect(result.rows).toHaveLength(4);
    expect(result.removed).toBe(0);
  });

  it("returns removed=0 for empty and single-row inputs", () => {
    expect(dedupeExactRows([])).toEqual({ rows: [], removed: 0 });
    const single = dedupeExactRows([row(base)]);
    expect(single.rows).toHaveLength(1);
    expect(single.removed).toBe(0);
  });
});
