import { supportFileFormatError } from "@/lib/validation";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";

/**
 * The one place a picked support file is accepted or refused.
 *
 * Both support-file pickers (`FilesAndInputsCard`'s `SupportFileRow` and
 * `StudyInputsCard`'s `StudyInputRow`) used to inline this logic, so the guard
 * that keeps a refused file out of the slot existed twice and was covered only
 * by a source-text grep — a test that survived deleting either copy. Sharing
 * the handler makes the guard a single behaviour with a single test.
 */

/** The subset of a file-input change event the handler reads. */
export type SupportFilePickEvent = {
  target: { files: ArrayLike<File> | null };
  currentTarget: { value: string };
};

export type SupportFilePickHandlerConfig = {
  /** The picker's own accept string; the allowed set is read out of it. */
  accept: string;
  /** Applied to the filename before it appears in the refusal message. */
  displayMasker: DemoDisplayMasker;
  onFileChange: (next: File | null) => void;
  onFormatError: (message: string | null) => void;
};

export function createSupportFilePickHandler(
  config: SupportFilePickHandlerConfig,
): (event: SupportFilePickEvent) => void {
  const { accept, displayMasker, onFileChange, onFormatError } = config;
  return (event) => {
    const picked = event.target.files?.[0] ?? null;
    // Clear the input so re-picking the same filename fires `change` again.
    event.currentTarget.value = "";
    const error = picked
      ? supportFileFormatError(displayMasker.fileName(picked.name), accept)
      : null;
    onFormatError(error);
    // A refused file must not reach the slot. Two things depend on it: a bad
    // pick cannot silently discard a good file that is already loaded, and the
    // red refusal is never rendered beside a green "Enabled with <that file>"
    // line, which is the contradiction this check exists to prevent.
    if (error) return;
    onFileChange(picked);
  };
}

/**
 * One stored support file restored from a project record, or null when the
 * runtime cannot read its format.
 *
 * A project saved before the picker refused `.xls` still carries one in its
 * bundle. Dropping it straight into state bypasses pick-time validation
 * entirely: the slot restores with a green "Enabled with uploaded file" line
 * and the batch dies at run time in `RuntimeSupportFiles::resolve`. The
 * restore path therefore applies the same rule the picker applies, and reports
 * each rejection rather than dropping it silently.
 */
export function restoreStoredSupportFile<TStored>(
  stored: TStored | undefined,
  accept: string,
  toFile: (stored: TStored) => File,
  onRejected: (message: string) => void,
): File | null {
  if (!stored) return null;
  const file = toFile(stored);
  const formatError = supportFileFormatError(file.name, accept);
  if (!formatError) return file;
  onRejected(formatError);
  return null;
}
