import { describe, expect, it } from "vitest";

import { createZipBlob } from "@/lib/zip";

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
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

type DosStamp = {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function decodeDosStamp(time: number, date: number): DosStamp {
  return {
    year: ((date >> 9) & 0x7f) + 1980,
    month: (date >> 5) & 0x0f,
    day: date & 0x1f,
    hours: (time >> 11) & 0x1f,
    minutes: (time >> 5) & 0x3f,
    seconds: (time & 0x1f) * 2,
  };
}

/**
 * Every last-modified field the archive carries: offsets 10/12 in each local
 * file header and 12/14 in each central directory header.
 */
function readModificationStamps(bytes: Uint8Array): DosStamp[] {
  const stamps: DosStamp[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && readUint32(bytes, offset) === 0x04034b50) {
    stamps.push(decodeDosStamp(readUint16(bytes, offset + 10), readUint16(bytes, offset + 12)));
    const compressedSize = readUint32(bytes, offset + 18);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  while (offset + 46 <= bytes.byteLength && readUint32(bytes, offset) === 0x02014b50) {
    stamps.push(decodeDosStamp(readUint16(bytes, offset + 12), readUint16(bytes, offset + 14)));
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return stamps;
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
    expect(entries.get("nested_report.json")).toBe('{"ok":true}');
    expect(Array.from(entries.keys()).some((name) => name.includes(".."))).toBe(false);
  });

  it("declares UTF-8 names in both headers so non-ASCII names extract intact", async () => {
    const bytes = new Uint8Array(
      await (await createZipBlob([{ fileName: "résumé.csv", blob: new Blob(["x"]) }])).arrayBuffer(),
    );
    const centralOffset = readUint32(bytes, bytes.byteLength - 22 + 16);
    expect(readUint16(bytes, 6) & 0x0800).toBe(0x0800);
    expect(readUint16(bytes, centralOffset + 8) & 0x0800).toBe(0x0800);
  });

  it("keeps every entry a flat, portable name inside the extraction folder", async () => {
    const zip = await createZipBlob(
      ["C:\\escape.csv", "report:stream.csv", "/abs/x.csv", "..\\..\\up.csv", "..."].map(
        (fileName) => ({ fileName, blob: new Blob([fileName]) }),
      ),
    );
    expect(Array.from((await unzipStoredEntries(zip)).keys())).toEqual([
      "C__escape.csv",
      "report_stream.csv",
      "abs_x.csv",
      "up.csv",
      "output",
    ]);
    const windows = await createZipBlob(
      ["study?.csv", "CON.backup.csv", "a\u007fb\u0085c.csv", "trailing. ", "Σ.csv", "ς.csv", "COM¹.x.csv", "maß.csv", "MAẞ.csv"].map(
        (fileName) => ({ fileName, blob: new Blob([fileName]) }),
      ),
    );
    expect(Array.from((await unzipStoredEntries(windows)).keys())).toEqual([
      "study_.csv",
      "_CON.backup.csv",
      "a_b_c.csv",
      "trailing",
      "Σ.csv",
      "ς (2).csv",
      "_COM¹.x.csv",
      "maß.csv",
      "MAẞ (2).csv",
    ]);
  });

  it("numbers outputs that would otherwise overwrite each other", async () => {
    const zip = await createZipBlob(
      ["P01 App.csv", "P01 App.csv", "p01 app.csv", "folder/item.csv", "folder\\item.csv"].map(
        (fileName, index) => ({ fileName, blob: new Blob([String(index)]) }),
      ),
    );
    expect(Array.from((await unzipStoredEntries(zip)).entries())).toEqual([
      ["P01 App.csv", "0"],
      ["P01 App (2).csv", "1"],
      ["p01 app (3).csv", "2"],
      ["folder_item.csv", "3"],
      ["folder_item (2).csv", "4"],
    ]);
  });

  it("stamps every entry with a real DOS modification timestamp", async () => {
    // DOS date/time fields left at zero decode to 1979-11-30, which is what
    // extractors showed for every file in a downloaded batch.
    const modifiedAt = new Date(2026, 7, 7, 14, 35, 22);
    const zip = await createZipBlob(
      [
        { fileName: "one.csv", blob: new Blob(["a\n"]) },
        { fileName: "two.csv", blob: new Blob(["b\n"]) },
      ],
      { modifiedAt },
    );
    const bytes = new Uint8Array(await zip.arrayBuffer());

    const stamps = readModificationStamps(bytes);
    expect(stamps).toHaveLength(4); // 2 local headers + 2 central headers
    for (const stamp of stamps) {
      expect(stamp).toEqual({
        year: 2026,
        month: 8,
        day: 7,
        hours: 14,
        minutes: 35,
        seconds: 22,
      });
    }
  });

  it("clamps timestamps below the 1980 DOS epoch instead of writing zero", async () => {
    const zip = await createZipBlob([{ fileName: "one.csv", blob: new Blob(["a\n"]) }], {
      modifiedAt: new Date(1970, 0, 1),
    });
    const stamps = readModificationStamps(new Uint8Array(await zip.arrayBuffer()));

    expect(stamps).toHaveLength(2);
    for (const stamp of stamps) {
      expect(stamp).toMatchObject({ year: 1980, month: 1, day: 1 });
    }
  });

  it("defaults to the current time when no timestamp is supplied", async () => {
    const before = new Date();
    const zip = await createZipBlob([{ fileName: "one.csv", blob: new Blob(["a\n"]) }]);
    const after = new Date();
    const [stamp] = readModificationStamps(new Uint8Array(await zip.arrayBuffer()));

    expect(stamp).toBeDefined();
    // DOS seconds have 2-second granularity, so compare against a padded window.
    const stamped = new Date(
      stamp!.year,
      stamp!.month - 1,
      stamp!.day,
      stamp!.hours,
      stamp!.minutes,
      stamp!.seconds,
    ).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before.getTime() - 2000);
    expect(stamped).toBeLessThanOrEqual(after.getTime() + 2000);
  });
});
