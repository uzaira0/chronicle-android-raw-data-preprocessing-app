import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProcessPanel } from "@/components/ProcessPanel";
import { RawFilesCard } from "@/components/RawFilesCard";
import { createDemoDisplayMasker } from "@/lib/demoDisplay";
import type { RawFileInspection } from "@/lib/fileInspection";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";

const OPTIONS = DEFAULT_BROWSER_OPTIONS;
const MASKER = createDemoDisplayMasker(false);

function inspection(
  fileName: string,
  overrides: Partial<RawFileInspection> = {},
): RawFileInspection {
  return {
    fileName,
    sizeBytes: 128,
    inputSha256: "a".repeat(64),
    rowCount: 4,
    participantCount: 1,
    participantPartitionBatchId: null,
    participantTokens: [],
    columns: ["participant_id", "event_timestamp"],
    timezones: ["UTC"],
    hasRequiredColumns: true,
    invalidTimestampCount: 0,
    missingTimestampCount: 0,
    missingTimezoneCount: 0,
    duplicateTimestampCount: 0,
    outOfOrderTimestampCount: 0,
    firstOutOfOrderRow: null,
    unrecognizedInteractionTypes: [],
    screenStartEventCount: 0,
    warnings: [],
    ...overrides,
  };
}

const MISSING_COLUMNS = inspection("Raw P01.csv", {
  hasRequiredColumns: false,
  warnings: ["Missing required columns: app_package_name, event_timestamp"],
});

function file(name: string): File {
  return new File(["x"], name, { type: "text/csv" });
}

function processPanel(
  props: Partial<Parameters<typeof ProcessPanel>[0]> = {},
): string {
  return renderToStaticMarkup(
    <ProcessPanel
      options={OPTIONS}
      setOptions={() => {}}
      uploadedFiles={[file("Raw P01.csv")]}
      inspections={[MISSING_COLUMNS]}
      displayMasker={MASKER}
      isInspecting={false}
      inspectionReady
      isRunning={false}
      onProcess={() => {}}
      onCancel={() => {}}
      progressRows={[]}
      overallPercent={0}
      expanded={false}
      onExpandedChange={() => {}}
      {...props}
    />,
  );
}

/**
 * The kernel's row reader resolves raw columns by name and substitutes an empty
 * string for one it cannot find, so a file missing `app_package_name` processes
 * to blank packages and still reports success. Before this gate existed the
 * inspection already knew (`hasRequiredColumns`) and nothing read it.
 */
describe("raw files missing a required column", () => {
  it("accepts typed component tables without pretending to inspect CSV columns", () => {
    const html = renderToStaticMarkup(
      <RawFilesCard
        uploadedFiles={[new File(["synthetic"], "analysis.arrow")]}
        inspections={[]}
        isInspecting={false}
        options={OPTIONS}
        displayMasker={MASKER}
        onFilesChange={() => {}}
        onFilesReorder={() => {}}
        onClear={() => {}}
        isRunning={false}
        literatureComponentActive
        componentTableFormat="arrow-ipc-file"
      />,
    );
    expect(html).toContain('accept=".arrow,application/vnd.apache.arrow.file"');
    expect(html).toContain("Component validates at run");
    expect(html).not.toContain("Status: Inspecting");
    expect(html).not.toContain("Success: Ready");
    expect(html).not.toContain("Error: Missing columns");
  });

  it("names the typed source CSV contract without demanding ordinary event columns", () => {
    const html = renderToStaticMarkup(
      <RawFilesCard
        uploadedFiles={[]} inspections={[]} isInspecting={false}
        options={OPTIONS} displayMasker={MASKER}
        onFilesChange={() => {}} onFilesReorder={() => {}} onClear={() => {}}
        isRunning={false} literatureComponentActive
      />,
    );
    expect(html).toContain("source-specific CSV matching the selected component");
    expect(html).toContain("ordinary Chronicle event columns are not required");
    expect(html).toContain("Drop the component source CSV here");
  });

  it("blocks Process and names the file and the columns", () => {
    const html = processPanel();
    expect(html).toContain('data-testid="raw-columns-block"');
    expect(html).toContain("Raw P01.csv");
    expect(html).toContain("app_package_name, event_timestamp");
    expect(html).toContain("Fix raw files missing required columns");
    // The button carries the disabled attribute, not merely the label.
    expect(
      /<button[^>]*data-testid="process-files-button"[^>]*disabled/.test(html),
    ).toBe(true);
  });

  it("does not block a file Rust accepted, warnings and all", () => {
    const html = processPanel({
      inspections: [
        inspection("Raw P01.csv", {
          warnings: ["3 rows have invalid event_timestamp values."],
        }),
      ],
    });
    expect(html).not.toContain('data-testid="raw-columns-block"');
    expect(html).toContain("Process files");
    expect(
      /<button[^>]*data-testid="process-files-button"[^>]*disabled/.test(html),
    ).toBe(false);
  });

  it("masks the filename in the refusal when demo display is on", () => {
    const html = processPanel({ displayMasker: createDemoDisplayMasker(true) });
    expect(html).toContain('data-testid="raw-columns-block"');
    expect(html).not.toContain("Raw P01.csv");
  });

  it("shows an error state on the file row, distinct from a warning", () => {
    const html = renderToStaticMarkup(
      <RawFilesCard
        uploadedFiles={[file("Raw P01.csv")]}
        inspections={[MISSING_COLUMNS]}
        isInspecting={false}
        options={OPTIONS}
        displayMasker={MASKER}
        onFilesChange={() => {}}
        onFilesReorder={() => {}}
        onClear={() => {}}
        isRunning={false}
      />,
    );
    expect(html).toContain("Error: Missing columns");
    expect(html).toContain('data-testid="raw-file-row-error"');
    expect(html).toContain("Cannot process this file.");
    expect(html).toContain("app_package_name, event_timestamp");
    expect(html).not.toContain("Warning: Review");
    expect(html).not.toContain("Success: Ready");
  });

  it("keeps the warning state for a file that only has warnings", () => {
    const html = renderToStaticMarkup(
      <RawFilesCard
        uploadedFiles={[file("Raw P01.csv")]}
        inspections={[
          inspection("Raw P01.csv", {
            warnings: ["3 rows have invalid event_timestamp values."],
          }),
        ]}
        isInspecting={false}
        options={OPTIONS}
        displayMasker={MASKER}
        onFilesChange={() => {}}
        onFilesReorder={() => {}}
        onClear={() => {}}
        isRunning={false}
      />,
    );
    expect(html).toContain("Warning: Review");
    expect(html).not.toContain("Error: Missing columns");
    expect(html).not.toContain('data-testid="raw-file-row-error"');
  });

  it("defers a source-shaped file to the selected literature component validator", () => {
    const html = renderToStaticMarkup(
      <RawFilesCard
        uploadedFiles={[file("ps_activity.csv")]}
        inspections={[{ ...MISSING_COLUMNS, fileName: "ps_activity.csv" }]}
        isInspecting={false}
        options={OPTIONS}
        displayMasker={MASKER}
        onFilesChange={() => {}}
        onFilesReorder={() => {}}
        onClear={() => {}}
        isRunning={false}
        literatureComponentActive
      />,
    );
    expect(html).toContain("Component validates at run");
    expect(html).toContain("validated by the selected literature component");
    expect(html).not.toContain("Error: Missing columns");
    expect(html).not.toContain('data-testid="raw-file-row-error"');
  });
});

/**
 * A failed durable-workspace probe used to disable Process outright, even
 * though the Rust runtime has a complete non-persisted branch. It now labels
 * the run instead of refusing it.
 */
describe("ephemeral workspace", () => {
  it("keeps Process available and says the run is tab-only", () => {
    const html = processPanel({
      inspections: [inspection("Raw P01.csv")],
      ephemeralWorkspace: true,
    });
    expect(
      /<button[^>]*data-testid="process-files-button"[^>]*disabled/.test(html),
    ).toBe(false);
    expect(html).toContain("Process files (ephemeral)");
    expect(html).toContain('data-testid="ephemeral-workspace-note"');
    expect(html).toContain("held in this tab only");
  });

  it("still refuses a raw file missing a required column", () => {
    const html = processPanel({ ephemeralWorkspace: true });
    expect(
      /<button[^>]*data-testid="process-files-button"[^>]*disabled/.test(html),
    ).toBe(true);
  });
});
