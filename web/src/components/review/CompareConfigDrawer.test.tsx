import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CompareConfigDrawer } from "@/components/review/CompareConfigDrawer";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { createDemoDisplayMasker } from "@/lib/demoDisplay";
import { runtimeScientificRefusalFixture } from "@/testSupport/runtimeScientificPreflightFixture";

describe("comparison scientific refusal", () => {
  it("keeps the exact typed no-execute decision inspectable in Arm B", () => {
    const receipt = runtimeScientificRefusalFixture();
    const html = renderToStaticMarkup(
      createElement(CompareConfigDrawer, {
        options: DEFAULT_BROWSER_OPTIONS,
        setOptions: vi.fn(),
        onRun: vi.fn(),
        onResetToA: vi.fn(),
        onClose: vi.fn(),
        running: false,
        error: "Scientific preflight refused",
        scientificRefusal: receipt,
        comparisonFailures: [],
        displayMasker: createDemoDisplayMasker(false),
        completedCount: 0,
        fileCount: 1,
      }),
    );
    expect(html).toContain("Scientific preflight decision");
    expect(html).toContain("capability_evidence_not_bound_to_input");
    expect(html).toContain(receipt.commitDigest);
  });

  it("renders the exact receipt for every partially failed file group", () => {
    const first = runtimeScientificRefusalFixture();
    const second = {
      ...runtimeScientificRefusalFixture(),
      commitDigest: `sha256:${"9".repeat(64)}`,
    };
    const html = renderToStaticMarkup(
      createElement(CompareConfigDrawer, {
        options: DEFAULT_BROWSER_OPTIONS,
        setOptions: vi.fn(),
        onRun: vi.fn(),
        onResetToA: vi.fn(),
        onClose: vi.fn(),
        running: false,
        error: "Compared 1 file; 2 failed.",
        scientificRefusal: first,
        comparisonFailures: [
          {
            fileNames: ["a.csv"],
            message: "refused A",
            cause: new Error("refused A"),
            scientificPreflightRefusal: first,
          },
          {
            fileNames: ["b.csv", "copy.csv"],
            message: "refused B",
            cause: new Error("refused B"),
            scientificPreflightRefusal: second,
          },
        ],
        displayMasker: createDemoDisplayMasker(false),
        completedCount: 1,
        fileCount: 3,
      }),
    );
    expect(html).toContain("a.csv");
    expect(html).toContain("b.csv, copy.csv");
    expect(html).toContain(first.commitDigest);
    expect(html).toContain(second.commitDigest);
  });

  it("disables every binding control and Close while a comparison is running", () => {
    const html = renderToStaticMarkup(
      createElement(CompareConfigDrawer, {
        options: DEFAULT_BROWSER_OPTIONS,
        setOptions: vi.fn(),
        onRun: vi.fn(),
        onResetToA: vi.fn(),
        onClose: vi.fn(),
        running: true,
        error: null,
        scientificRefusal: null,
        comparisonFailures: [],
        displayMasker: createDemoDisplayMasker(false),
        completedCount: 0,
        fileCount: 2,
      }),
    );
    expect(html).toContain('<fieldset class="review-drawer__body" disabled=""');
    expect(html).toContain('aria-label="Close" disabled=""');
  });

  it("masks every refused filename in demo mode", () => {
    const first = runtimeScientificRefusalFixture();
    const second = {
      ...runtimeScientificRefusalFixture(),
      commitDigest: `sha256:${"9".repeat(64)}`,
    };
    const html = renderToStaticMarkup(
      createElement(CompareConfigDrawer, {
        options: DEFAULT_BROWSER_OPTIONS,
        setOptions: vi.fn(),
        onRun: vi.fn(),
        onResetToA: vi.fn(),
        onClose: vi.fn(),
        running: false,
        error: "participant-alice.csv and participant-bob.csv were refused.",
        scientificRefusal: first,
        comparisonFailures: [
          {
            fileNames: ["participant-alice.csv"],
            message: "refused A",
            cause: new Error("refused A"),
            scientificPreflightRefusal: first,
          },
          {
            fileNames: ["participant-bob.csv"],
            message: "refused B",
            cause: new Error("refused B"),
            scientificPreflightRefusal: second,
          },
        ],
        displayMasker: createDemoDisplayMasker(true),
        completedCount: 0,
        fileCount: 2,
      }),
    );
    expect(html).toContain("File 01.csv");
    expect(html).toContain("File 02.csv");
    expect(html).not.toContain("participant-alice.csv");
    expect(html).not.toContain("participant-bob.csv");
    expect(html).toContain(first.commitDigest);
    expect(html).toContain(second.commitDigest);
  });
});

/**
 * Arm B dispatches its own kernel run from this drawer, so it needs the same
 * bounds gate the Process button has. Without it an emptied numeric field sent
 * `Number("") === 0` straight to the kernel: a 0-hour maximum-session
 * threshold makes every session End-of-Usage-Missing while the comparison
 * reports success and renders a diff.
 */
describe("Arm B settings bounds", () => {
  const renderDrawer = (
    overrides: Partial<typeof DEFAULT_BROWSER_OPTIONS>,
  ): string =>
    renderToStaticMarkup(
      createElement(CompareConfigDrawer, {
        options: { ...DEFAULT_BROWSER_OPTIONS, ...overrides },
        setOptions: vi.fn(),
        onRun: vi.fn(),
        onResetToA: vi.fn(),
        onClose: vi.fn(),
        running: false,
        error: null,
        scientificRefusal: null,
        comparisonFailures: [],
        displayMasker: createDemoDisplayMasker(false),
        completedCount: 0,
        fileCount: 1,
      }),
    );

  const runButton = (html: string): string =>
    html.match(/<button[^>]*data-testid="review-run-comparison"[^>]*>/)?.[0] ??
    "";

  it("runs with the shipped defaults", () => {
    const html = renderDrawer({});
    expect(html).not.toContain('data-testid="review-range-block"');
    expect(runButton(html)).not.toContain("disabled");
    expect(html).toContain("Run comparison");
  });

  it("blocks the run and names the offending settings", () => {
    const html = renderDrawer({
      longDurationThresholdHours: 0,
      complianceThresholdPercent: 140,
    });
    expect(html).toContain('data-testid="review-range-block"');
    expect(html).toContain("Cannot run the comparison:");
    expect(html).toContain("enter a value between 1 and 48");
    expect(html).toContain("enter a value between 0 and 100");
    // Not merely styled: the dispatch itself is unreachable.
    expect(runButton(html)).toContain("disabled");
    expect(html).toContain("Fix out-of-range settings");
    expect(html).not.toContain("Run comparison");
  });

  it("blocks an out-of-range worker count too", () => {
    // `parallelMaxWorkers` was bounded only by literal rangeError calls in two
    // settings cards, so it reached this drawer unchecked.
    const html = renderDrawer({ parallelMaxWorkers: 500 });
    expect(html).toContain('data-testid="review-range-block"');
    expect(runButton(html)).toContain("disabled");
  });
});
