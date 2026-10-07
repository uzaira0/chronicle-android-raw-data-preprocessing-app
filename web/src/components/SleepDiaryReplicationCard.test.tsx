import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { SleepDiaryReplicationCard } from "@/components/SleepDiaryReplicationCard";
import { createSleepDiaryMethodProfileReceipt } from "@/lib/sleepDiaryReplication";

describe("SleepDiaryReplicationCard", () => {
  it("renders all blocked variants and the default fixture-verifiable layout", () => {
    const html = renderToStaticMarkup(createElement(SleepDiaryReplicationCard, {
      methodProfileReceipt: null,
      onBound: vi.fn(),
      onStatus: vi.fn(),
    }));
    expect((html.match(/<option/g) ?? [])).toHaveLength(84);
    expect(html).toContain("Sleep diary replication");
    expect(html).toContain("Full profile: blocked.");
    expect(html).toContain("sleepdiaries-v1-csv · direct-tabular-csv-v1/1");
    expect(html).toContain("sleepdiaries-v1-json · keyed-object-json-v1/1");
    expect(html).toContain("41 diary items, 27 form elements, 8 schedule rules, 8 administration schedules, and 33 rules");
    expect(html).toContain("Composed form (27 elements)");
    expect(html).toContain("sleepdiaries:page:morning");
    expect(html).toContain("Composed schedule (8 rules)");
    expect(html).toContain("version-zenodo-sleepdiaries-v1.1.3:schedule:1");
    expect(html).toContain("Verify shared fixture and bind layout");
  });

  it("renders the selected MiNap layout with its exact blocked composition and remove control", async () => {
    const receipt = await createSleepDiaryMethodProfileReceipt(
      "version-zenodo-minap-v1.0",
      "minap-v1-event-sheet",
    );
    const html = renderToStaticMarkup(createElement(SleepDiaryReplicationCard, {
      methodProfileReceipt: receipt,
      onBound: vi.fn(),
      onStatus: vi.fn(),
    }));
    expect((html.match(/<option/g) ?? [])).toHaveLength(83);
    expect(html).toContain("minap-v1-event-sheet · chronological-event-pairing-v1/1");
    expect(html).toContain("16 diary items, 15 form elements, 3 schedule rules, 3 administration schedules, and 35 rules");
    expect(html).toContain("Composed form (15 elements)");
    expect(html).toContain("minap:section:login");
    expect(html).toContain("Composed schedule (3 rules)");
    expect(html).toContain("version-zenodo-minap-v1.0:schedule:1");
    expect(html).toContain("Re-verify shared fixture");
    expect(html).toContain("Remove diary binding");
    expect(html).toContain("minap-v1-event-pairing-basic");
  });
});
