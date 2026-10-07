type ZipEntry = {
  fileName: string;
  blob: Blob;
};

type ZipOptions = {
  /** Last-modified stamp written to every entry. Defaults to the current time. */
  modifiedAt?: Date;
};

/**
 * MS-DOS timestamps count from 1980-01-01 and encode month/day as 1-based
 * fields, so a zeroed date field decodes to month 0 / day 0 — which extractors
 * normalize to 1979-11-30. Writing a real stamp is what keeps downloaded
 * batches from all claiming that date.
 */
const DOS_MIN_MS = new Date(1980, 0, 1, 0, 0, 0).getTime();
const DOS_MAX_MS = new Date(2107, 11, 31, 23, 59, 58).getTime();

function dosDateTime(modifiedAt: Date): { time: number; date: number } {
  const raw = modifiedAt.getTime();
  const clamped = Number.isFinite(raw)
    ? Math.min(Math.max(raw, DOS_MIN_MS), DOS_MAX_MS)
    : DOS_MIN_MS;
  const at = new Date(clamped);
  return {
    // DOS stores local time with 2-second granularity.
    time:
      (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date:
      ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

const textEncoder = new TextEncoder();

let crcTable: DataView | null = null;

function getCrcTable(): DataView {
  if (crcTable) return crcTable;
  const table = new DataView(new ArrayBuffer(256 * 4));
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table.setUint32(index << 2, crc >>> 0, true);
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) {
    // The table has 256 entries, so the & 0xff offset is always in range;
    // DataView reads return plain numbers (no index-may-be-undefined branch).
    crc = table.getUint32(((crc ^ byte) & 0xff) << 2, true) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * Every entry is a flat output file that extracts on Windows, macOS and Linux.
 * Path separators, drive and stream colons, the other characters Windows
 * forbids, and control characters become "_"; leading dots and spaces (hidden
 * or parent names) and trailing ones (dropped by Windows) go; a reserved
 * Windows device stem (CON, NUL, COM1, …) gets a "_" prefix.
 */
function safeZipName(fileName: string): string {
  const flat = fileName
    .replace(/^(?:\.{0,2}[\\/])+/, "")
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if (!flat) return "output";
  return /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i.test(flat) ? `_${flat}` : flat;
}

/**
 * Two outputs with one name would overwrite each other on extraction, and
 * Windows and macOS compare names case-insensitively (lower-upper-lower folds
 * final sigma and ß/ẞ too).
 * ponytail: no 255-byte cap; a ~225-character input name plus a suffix fails to
 * extract loudly on such filesystems. Truncate the stem if that ever happens.
 */
function uniqueZipName(name: string, used: Set<string>): string {
  const key = (value: string) => value.toLowerCase().toUpperCase().toLowerCase();
  let candidate = name;
  const dot = name.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let copy = 2; used.has(key(candidate)); copy += 1) {
    candidate = `${stem} (${copy})${extension}`;
  }
  used.add(key(candidate));
  return candidate;
}

/**
 * Build a no-compression ZIP. CSVs are already text and browser-side store
 * mode avoids adding a compression dependency to the offline app bundle.
 */
export async function createZipBlob(
  entries: ZipEntry[],
  options: ZipOptions = {},
): Promise<Blob> {
  const localParts: Uint8Array<ArrayBuffer>[] = [];
  const centralParts: Uint8Array<ArrayBuffer>[] = [];
  const modified = dosDateTime(options.modifiedAt ?? new Date());
  let offset = 0;
  const usedNames = new Set<string>();

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(uniqueZipName(safeZipName(entry.fileName), usedNames));
    const data = new Uint8Array((await entry.blob.arrayBuffer()));
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    // Bit 11: names are UTF-8. Without it, Windows Explorer and other readers
    // decode them as CP437 and mangle any non-ASCII output name.
    writeUint16(localHeader, 6, 0x0800);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, modified.time);
    writeUint16(localHeader, 12, modified.date);
    writeUint32(localHeader, 14, checksum);
    writeUint32(localHeader, 18, data.byteLength);
    writeUint32(localHeader, 22, data.byteLength);
    writeUint16(localHeader, 26, nameBytes.length);
    writeUint16(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, 0x0800);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, modified.time);
    writeUint16(centralHeader, 14, modified.date);
    writeUint32(centralHeader, 16, checksum);
    writeUint32(centralHeader, 20, data.byteLength);
    writeUint32(centralHeader, 24, data.byteLength);
    writeUint16(centralHeader, 28, nameBytes.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, offset);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.byteLength + data.byteLength;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50);
  writeUint16(end, 4, 0);
  writeUint16(end, 6, 0);
  writeUint16(end, 8, entries.length);
  writeUint16(end, 10, entries.length);
  writeUint32(end, 12, centralSize);
  writeUint32(end, 16, centralOffset);
  writeUint16(end, 20, 0);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}
