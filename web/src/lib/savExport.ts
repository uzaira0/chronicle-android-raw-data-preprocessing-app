/**
 * SPSS `.sav` (System File) writer (#9) — a deterministic, dependency-free
 * serializer for the cleaned output tables, so behavioural-science users can load
 * Chronicle output straight into SPSS/PSPP with variable labels intact.
 *
 * Scope & format choices (kept simple to stay verifiable):
 * - **SAV bias-100 compression** (compression flag 1) — the common real-SPSS
 *   layout: small integers and all-spaces string segments collapse to a single
 *   command byte, and system-missing numerics use command code 255 (so they read
 *   back as null, not a sentinel double).
 * - **Little-endian** throughout (layout_code 2).
 * - **UTF-8** strings, declared via the type-7/subtype-20 encoding record.
 * - Short 8-char variable names (`V1`, `V2`, …) in the dictionary, with the real
 *   column names carried in the type-7/subtype-13 long-variable-names record —
 *   exactly how modern SPSS files exceed the 8-byte legacy name limit.
 * - String variables capped at 255 bytes (the single-variable A-format max);
 *   longer values are truncated (the app's string columns are package names and
 *   labels, well under this).
 * - A FIXED creation date/time so identical input yields byte-identical output
 *   (reproducibility); no wall-clock read.
 *
 * Verified by round-tripping through the `sav-reader` package in tests.
 */

export type SavVariableType = "numeric" | "string";

export type SavVariable = {
  /** The real (long) column name, surfaced to SPSS via the subtype-13 record. */
  name: string;
  type: SavVariableType;
  /** Optional variable label (the human-readable description shown in SPSS). */
  label?: string;
  /** Byte width for string variables (defaults to 255, capped at 255). */
  stringWidth?: number;
  /** Decimal places for numeric variables (default 2). */
  decimals?: number;
};

export type SavCellValue = number | string | null;
export type SavRow = Record<string, SavCellValue>;

/** SPSS system-missing value for numeric cells (-DBL_MAX). */
const SYSMIS = -Number.MAX_VALUE;
const HIGHEST = Number.MAX_VALUE;
const LOWEST = -1.7976931348623155e308; // nextafter(-DBL_MAX, 0)

/** SPSS A (string) and F (numeric) print/write format type codes. */
const FORMAT_A = 1;
const FORMAT_F = 5;

/** Growable little-endian byte sink. */
class ByteSink {
  private buf = new Uint8Array(1024);
  private len = 0;

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < this.len + extra) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }

  u8(value: number): void {
    this.ensure(1);
    this.buf[this.len] = value & 0xff;
    this.len += 1;
  }

  i32(value: number): void {
    this.ensure(4);
    const view = new DataView(this.buf.buffer, this.len, 4);
    view.setInt32(0, value, true);
    this.len += 4;
  }

  f64(value: number): void {
    this.ensure(8);
    const view = new DataView(this.buf.buffer, this.len, 8);
    view.setFloat64(0, value, true);
    this.len += 8;
  }

  bytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.buf.set(data, this.len);
    this.len += data.length;
  }

  /** Write `text` as UTF-8, padded/truncated to exactly `width` bytes with `pad`. */
  fixedAscii(text: string, width: number, pad = 0x20): void {
    const encoded = new TextEncoder().encode(text);
    const out = new Uint8Array(width).fill(pad);
    out.set(encoded.subarray(0, width));
    this.bytes(out);
  }

  result(): ArrayBuffer {
    return this.buf.slice(0, this.len).buffer;
  }
}

/** Number of 8-byte slots a variable occupies (numeric=1, string=ceil(w/8)). */
function slotCount(variable: SavVariable): number {
  if (variable.type === "numeric") return 1;
  const width = Math.min(variable.stringWidth ?? 255, 255);
  return Math.max(1, Math.ceil(width / 8));
}

function packFormat(formatType: number, width: number, decimals: number): number {
  return (formatType << 16) | ((width & 0xff) << 8) | (decimals & 0xff);
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Largest byte length ≤ maxLen that does not split a UTF-8 multibyte sequence. */
function utf8TruncatedLength(bytes: Uint8Array, maxLen: number): number {
  if (bytes.length <= maxLen) return bytes.length;
  let len = maxLen;
  // 0b10xxxxxx bytes are UTF-8 continuation bytes; if the cut lands on one we are
  // inside a multibyte char, so back up to its lead byte.
  while (len > 0 && (bytes[len] & 0xc0) === 0x80) len -= 1;
  return len;
}

/** A numeric value as 8 little-endian IEEE-754 bytes. */
function f64Bytes(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, true);
  return out;
}

/** SAV bias-100 compression bias. */
const SAV_BIAS = 100;

/**
 * Build a complete SPSS `.sav` file for the given variables and rows.
 * Rows reference values by the variable's `name`; a missing key is system-missing
 * (numeric) or empty (string).
 */
export function buildSavBuffer(variables: readonly SavVariable[], rows: readonly SavRow[]): ArrayBuffer {
  const sink = new ByteSink();
  const stringWidthOf = (v: SavVariable): number => Math.min(v.stringWidth ?? 255, 255);

  // ── File header record ────────────────────────────────────────────────────
  sink.fixedAscii("$FL2", 4);
  sink.fixedAscii("@(#) SPSS DATA FILE - Chronicle local preprocessor", 60);
  sink.i32(2); // layout_code
  const nominalCaseSize = variables.reduce((sum, v) => sum + slotCount(v), 0);
  sink.i32(nominalCaseSize);
  sink.i32(1); // compression (1 = SAV bias-100 compression)
  sink.i32(0); // weight_index (none)
  sink.i32(rows.length); // ncases
  sink.f64(100); // bias
  sink.fixedAscii("01 Jan 25", 9); // creation_date (fixed for determinism)
  sink.fixedAscii("00:00:00", 8); // creation_time (fixed)
  sink.fixedAscii("Chronicle preprocessed output", 64); // file_label
  sink.bytes(new Uint8Array(3)); // padding

  // ── Variable records (type 2), with continuations for wide strings ─────────
  const shortNames = variables.map((_, i) => `V${i + 1}`);
  variables.forEach((variable, index) => {
    const shortName = shortNames[index];
    const labelBytes = variable.label ? utf8Bytes(variable.label) : null;
    if (variable.type === "numeric") {
      const decimals = variable.decimals ?? 2;
      // Width must leave room for the integer part, sign, and decimal point. A
      // hardcoded 8 fits only ~6 visible chars, so F8.4 / large values render as
      // "*****" in SPSS even though the stored double is intact.
      const numericWidth = Math.max(8, decimals + 11);
      const fmt = packFormat(FORMAT_F, numericWidth, decimals);
      sink.i32(2); // rec_type
      sink.i32(0); // type (numeric)
      sink.i32(labelBytes ? 1 : 0);
      sink.i32(0); // n_missing_values
      sink.i32(fmt); // print format
      sink.i32(fmt); // write format
      sink.fixedAscii(shortName, 8);
      writeVarLabel(sink, labelBytes);
    } else {
      const width = stringWidthOf(variable);
      const fmt = packFormat(FORMAT_A, width, 0);
      sink.i32(2);
      sink.i32(width); // type = string width
      sink.i32(labelBytes ? 1 : 0);
      sink.i32(0);
      sink.i32(fmt);
      sink.i32(fmt);
      sink.fixedAscii(shortName, 8);
      writeVarLabel(sink, labelBytes);
      // Continuation records for each additional 8-byte slot.
      for (let s = 1; s < slotCount(variable); s++) {
        sink.i32(2);
        sink.i32(-1); // continuation
        sink.i32(0);
        sink.i32(0);
        sink.i32(0);
        sink.i32(0);
        sink.fixedAscii("", 8);
      }
    }
  });

  // ── Type-7 info records ────────────────────────────────────────────────────
  // Subtype 3: machine integer info. Field order (8 int32):
  // version_major, version_minor, version_revision, machine_code,
  // floating_point_rep (1=IEEE), compression_code (1), endianness (2=little),
  // character_code (65001=UTF-8). Getting endianness/charset slots wrong makes
  // ReadStat/SPSS reject the file with "unsupported character set".
  sink.i32(7);
  sink.i32(3);
  sink.i32(4);
  sink.i32(8);
  [1, 0, 0, -1, 1, 1, 2, 65001].forEach((v) => sink.i32(v));

  // Subtype 4: machine float info (sysmis, highest, lowest).
  sink.i32(7);
  sink.i32(4);
  sink.i32(8);
  sink.i32(3);
  sink.f64(SYSMIS);
  sink.f64(HIGHEST);
  sink.f64(LOWEST);

  // Subtype 13: long variable names, "SHORT=Long\tSHORT2=Long2".
  const longNames = variables.map((v, i) => `${shortNames[i]}=${v.name}`).join("\t");
  const longNameBytes = utf8Bytes(longNames);
  sink.i32(7);
  sink.i32(13);
  sink.i32(1);
  sink.i32(longNameBytes.length);
  sink.bytes(longNameBytes);

  // Subtype 20: character encoding.
  const encBytes = utf8Bytes("UTF-8");
  sink.i32(7);
  sink.i32(20);
  sink.i32(1);
  sink.i32(encBytes.length);
  sink.bytes(encBytes);

  // ── Dictionary termination (type 999) ─────────────────────────────────────
  sink.i32(999);
  sink.i32(0);

  // ── Data (SAV bias-100 compression) ────────────────────────────────────────
  // The stream is 8-byte command-code blocks, each followed by the literal blocks
  // for the 253 codes in that block, in order. The reader consumes one code per
  // numeric cell and one code per 8-byte string segment.
  const commands: number[] = [];
  const literals: Uint8Array[] = [];
  const flush = (force: boolean): void => {
    if (commands.length === 0) return;
    // Unreachable defensive guard: the only non-forced caller is emit(), which
    // invokes flush(false) exactly when commands.length === 8; the sole
    // end-of-data flush uses force=true. So a non-forced flush of a partial
    // (<8) block never occurs. Kept to make flush() safe under future callers.
    /* v8 ignore start */
    if (!force && commands.length < 8) return;
    /* v8 ignore stop */
    while (commands.length < 8) commands.push(0); // pad final block; reader skips 0
    for (const code of commands) sink.u8(code);
    for (const literal of literals) sink.bytes(literal);
    commands.length = 0;
    literals.length = 0;
  };
  const emit = (code: number, literal?: Uint8Array): void => {
    commands.push(code);
    if (literal) literals.push(literal);
    if (commands.length === 8) flush(false);
  };

  for (const row of rows) {
    for (const variable of variables) {
      const value = variable.name in row ? row[variable.name] : null;
      if (variable.type === "numeric") {
        if (value == null || value === "") {
          emit(255); // system-missing
        } else {
          const num = Number(value);
          const code = num + SAV_BIAS;
          if (Number.isInteger(num) && code >= 1 && code <= 251) {
            emit(code); // small integer compresses to one byte
          } else {
            emit(253, f64Bytes(num)); // literal double follows
          }
        }
      } else {
        // One command code per 8-byte segment, spanning the variable's slots.
        // The value occupies the declared A-format width; the remaining bytes of
        // the final slot are space padding. Truncating to the declared width (not
        // the slot-rounded width) keeps the data consistent with the dictionary,
        // and we back off to a UTF-8 char boundary so a multibyte glyph is never
        // split into an invalid byte sequence.
        const slotWidth = slotCount(variable) * 8;
        const declaredWidth = stringWidthOf(variable);
        const valueBytes = utf8Bytes(value == null ? "" : String(value));
        const keep = utf8TruncatedLength(valueBytes, declaredWidth);
        const padded = new Uint8Array(slotWidth).fill(0x20);
        padded.set(valueBytes.subarray(0, keep));
        for (let offset = 0; offset < slotWidth; offset += 8) {
          const segment = padded.subarray(offset, offset + 8);
          const allSpaces = segment.every((b) => b === 0x20);
          emit(allSpaces ? 254 : 253, allSpaces ? undefined : segment.slice());
        }
      }
    }
  }
  flush(true);

  return sink.result();
}

function writeVarLabel(sink: ByteSink, labelBytes: Uint8Array | null): void {
  if (!labelBytes) return;
  sink.i32(labelBytes.length);
  // Label is padded to a 4-byte boundary.
  const padded = Math.ceil(labelBytes.length / 4) * 4;
  const out = new Uint8Array(padded).fill(0x20);
  out.set(labelBytes);
  sink.bytes(out);
}
