/**
 * Trigger a browser download of a Blob via a transient object URL + anchor click.
 * Single source of truth so a future cross-browser tweak (e.g. a forced MIME type
 * or appending the anchor to the DOM for Safari) only has to change in one place.
 */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
