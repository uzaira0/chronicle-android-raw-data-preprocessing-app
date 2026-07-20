import { describe, expect, it } from "vitest";

import { createZipBlob } from "@/lib/zip";

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

async function unzipStoredEntries(blob: Blob): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;

  while (offset + 30 <= bytes.byteLength && readUint32(bytes, offset) === 0x04034b50) {
    const compressionMethod = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const fileName = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    expect(compressionMethod).toBe(0);
    entries.set(fileName, decoder.decode(bytes.slice(dataStart, dataEnd)));
    offset = dataEnd;
  }

  return entries;
}

describe("createZipBlob", () => {
  it("creates a readable stored ZIP and normalizes unsafe paths", async () => {
    const zip = await createZipBlob([
      { fileName: "../Raw P01.csv", blob: new Blob(["a,b\n1,2\n"], { type: "text/csv" }) },
      { fileName: "nested\\report.json", blob: new Blob(['{"ok":true}']) },
    ]);

    expect(zip.type).toBe("application/zip");
    const entries = await unzipStoredEntries(zip);
    expect(entries.get("Raw P01.csv")).toBe("a,b\n1,2\n");
    expect(entries.get("nested/report.json")).toBe('{"ok":true}');
    expect(Array.from(entries.keys()).some((name) => name.includes(".."))).toBe(false);
  });
});
