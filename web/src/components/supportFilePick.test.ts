import { describe, expect, it, vi } from "vitest";

import {
  createSupportFilePickHandler,
  restoreStoredSupportFile,
} from "@/components/supportFilePick";
import type { SupportFilePickEvent } from "@/components/supportFilePick";
import { createDemoDisplayMasker } from "@/lib/demoDisplay";
import { SUPPORT_FILE_ACCEPT } from "@/lib/validation";

const PLAIN = createDemoDisplayMasker(false);

function pickEvent(file: File | null): SupportFilePickEvent {
  return {
    target: { files: file ? [file] : [] },
    currentTarget: { value: file ? `C:\\fakepath\\${file.name}` : "" },
  };
}

function harness(accept = SUPPORT_FILE_ACCEPT, masker = PLAIN) {
  const onFileChange = vi.fn<(next: File | null) => void>();
  const onFormatError = vi.fn<(message: string | null) => void>();
  const handle = createSupportFilePickHandler({
    accept,
    displayMasker: masker,
    onFileChange,
    onFormatError,
  });
  return { handle, onFileChange, onFormatError };
}

/**
 * These used to be source-text greps over both card files ("the source contains
 * `if (!error)`"), which passed just as happily with the guard deleted. They
 * now exercise the handler both cards actually install.
 */
describe("support-file pick handler", () => {
  it("keeps a refused file out of the slot", () => {
    const { handle, onFileChange, onFormatError } = harness();
    handle(pickEvent(new File(["x"], "filter.xls")));
    expect(onFileChange).not.toHaveBeenCalled();
    expect(onFormatError).toHaveBeenCalledTimes(1);
    expect(onFormatError.mock.calls[0]?.[0]).toContain("legacy .xls");
  });

  it("commits a format the runtime resolves", () => {
    const { handle, onFileChange, onFormatError } = harness();
    const file = new File(["app_package_name\n"], "filter.csv");
    handle(pickEvent(file));
    expect(onFileChange).toHaveBeenCalledWith(file);
    expect(onFormatError).toHaveBeenCalledWith(null);
  });

  it("clears a standing refusal when the next pick is valid", () => {
    const { handle, onFileChange, onFormatError } = harness();
    handle(pickEvent(new File(["x"], "filter.xls")));
    const good = new File(["app_package_name\n"], "filter.xlsx");
    handle(pickEvent(good));
    expect(onFormatError.mock.calls.map((call) => call[0] === null)).toEqual([
      false,
      true,
    ]);
    expect(onFileChange.mock.calls).toEqual([[good]]);
  });

  it("masks the filename in the refusal when demo mode is on", () => {
    const { handle, onFormatError } = harness(
      SUPPORT_FILE_ACCEPT,
      createDemoDisplayMasker(true),
    );
    handle(pickEvent(new File(["x"], "P01-secret-cohort.sav")));
    const message = onFormatError.mock.calls[0]?.[0] ?? "";
    expect(message).not.toContain("secret-cohort");
    expect(message).toContain(".sav");
    expect(message).toContain("Upload .csv or .xlsx.");
  });

  it("resets the input so the same filename can be picked again", () => {
    const { handle } = harness();
    const event = pickEvent(new File(["x"], "filter.csv"));
    handle(event);
    expect(event.currentTarget.value).toBe("");
  });

  it("treats an empty pick as clearing the slot, not as a refusal", () => {
    const { handle, onFileChange, onFormatError } = harness();
    handle(pickEvent(null));
    expect(onFileChange).toHaveBeenCalledWith(null);
    expect(onFormatError).toHaveBeenCalledWith(null);
  });

  it("follows the picker's own accept string, not a global one", () => {
    // The input-capability-evidence slot is CSV-only.
    const { handle, onFileChange, onFormatError } = harness(".csv");
    handle(pickEvent(new File(["x"], "evidence.xlsx")));
    expect(onFileChange).not.toHaveBeenCalled();
    expect(onFormatError.mock.calls[0]?.[0]).toContain("Upload .csv.");
  });
});

/**
 * Project restore used to bypass the picker entirely: `storedFileToFile` on a
 * bundled `.xls` put a File the runtime cannot read straight into the slot,
 * which then rendered the green "Enabled with uploaded file" line and killed
 * the batch at run time.
 */
describe("restored project support files", () => {
  type Stored = { name: string };
  const toFile = (stored: Stored): File => new File(["x"], stored.name);

  it("drops a stored file the runtime cannot read, and says which", () => {
    const rejected: string[] = [];
    const restored = restoreStoredSupportFile(
      { name: "filter.xls" },
      SUPPORT_FILE_ACCEPT,
      toFile,
      (message) => rejected.push(message),
    );
    expect(restored).toBeNull();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain("filter.xls");
    expect(rejected[0]).toContain("legacy .xls");
  });

  it("restores a readable stored file untouched", () => {
    const rejected: string[] = [];
    const restored = restoreStoredSupportFile(
      { name: "filter.csv" },
      SUPPORT_FILE_ACCEPT,
      toFile,
      (message) => rejected.push(message),
    );
    expect(restored?.name).toBe("filter.csv");
    expect(rejected).toEqual([]);
  });

  it("treats an absent slot as empty rather than as a rejection", () => {
    const rejected: string[] = [];
    const materialize = vi.fn(toFile);
    expect(
      restoreStoredSupportFile(
        undefined,
        SUPPORT_FILE_ACCEPT,
        materialize,
        (message) => rejected.push(message),
      ),
    ).toBeNull();
    expect(materialize).not.toHaveBeenCalled();
    expect(rejected).toEqual([]);
  });

  it("applies the per-slot accept set, not one global set", () => {
    const rejected: string[] = [];
    // The input-capability-evidence slot is CSV-only, so a restored .xlsx is
    // wrong there even though it is fine for the filter slot.
    expect(
      restoreStoredSupportFile(
        { name: "evidence.xlsx" },
        ".csv",
        toFile,
        (message) => rejected.push(message),
      ),
    ).toBeNull();
    expect(rejected[0]).toContain("Upload .csv.");
    expect(
      restoreStoredSupportFile(
        { name: "evidence.xlsx" },
        SUPPORT_FILE_ACCEPT,
        toFile,
        (message) => rejected.push(message),
      )?.name,
    ).toBe("evidence.xlsx");
  });
});
