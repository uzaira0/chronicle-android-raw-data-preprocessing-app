import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LiteratureComponentResultPanel } from "@/components/LiteratureComponentResultPanel";
import type { LiteratureComponentRuntimeExecution } from "@/lib/rustPipelineRuntime";

describe("LiteratureComponentResultPanel", () => {
  it("renders every receipt-visible execution limitation", () => {
    const result = {
      manifest: {
        componentId: "chronicle.fixed-minute-packet-aggregation/v1",
        sourceRowCount: 4,
        derivedResultRowCount: 3,
      },
      componentExecutionReceipt: {
        limitations: [
          "The source omits the grid anchor.",
          "The bounded fixture uses half-open bins.",
        ],
      },
      artifacts: [],
    } as unknown as LiteratureComponentRuntimeExecution;

    const html = renderToStaticMarkup(
      createElement(LiteratureComponentResultPanel, {
        result,
        error: null,
        onDelete: vi.fn(),
        onError: vi.fn(),
      }),
    );

    expect(html).toContain("Execution limitations");
    expect(html).toContain("The source omits the grid anchor.");
    expect(html).toContain("The bounded fixture uses half-open bins.");
  });

  it("shows the keyguard source-schema boundary beside its executed component", () => {
    const limitation =
      "The component starts from Chronicle-normalized keyguard events because the paper does not publish the raw PhoneLab schema or raw-to-normalized mapping.";
    const result = {
      manifest: {
        componentId: "chronicle.keyguard-transition-fsm/v1",
        sourceRowCount: 18,
        derivedResultRowCount: 5,
      },
      componentExecutionReceipt: { limitations: [limitation] },
      artifacts: [],
    } as unknown as LiteratureComponentRuntimeExecution;

    const html = renderToStaticMarkup(
      createElement(LiteratureComponentResultPanel, {
        result,
        error: null,
        onDelete: vi.fn(),
        onError: vi.fn(),
      }),
    );

    expect(html).toContain("chronicle.keyguard-transition-fsm/v1");
    expect(html).toContain("18 source rows");
    expect(html).toContain("5 derived rows");
    expect(html).toContain(limitation);
  });

  it("renders the notification source discrepancy and its dual-variant artifact", () => {
    const discrepancy =
      "Released-code count 1 and stated zero-fill intent are distinct variants.";
    const result = {
      manifest: {
        componentId: "chronicle.notification-study-daily/v1",
        sourceRowCount: 8,
        derivedResultRowCount: 8,
      },
      componentExecutionReceipt: { limitations: [discrepancy] },
      artifacts: [
        {
          metadata: {
            kind: "literature-notification-daily-count-source-variants-csv",
            mediaType: "text/csv",
            size: 512,
            rowCount: 8,
          },
          bytes: new Uint8Array(),
        },
      ],
    } as unknown as LiteratureComponentRuntimeExecution;

    const html = renderToStaticMarkup(
      createElement(LiteratureComponentResultPanel, {
        result,
        error: null,
        onDelete: vi.fn(),
        onError: vi.fn(),
      }),
    );

    expect(html).toContain("chronicle.notification-study-daily/v1");
    expect(html).toContain(discrepancy);
    expect(html).toContain(
      "literature-notification-daily-count-source-variants-csv",
    );
    expect(html).toContain("8 derived rows");
  });
});
