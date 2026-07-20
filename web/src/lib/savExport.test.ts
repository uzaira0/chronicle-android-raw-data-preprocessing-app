import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { buildSavBuffer, type SavVariable } from "@/lib/savExport";

// sav-reader is CommonJS-only (exports just a `require` condition), so Vite's
// ESM resolver can't import it. Load it through Node's CJS require for this
// test-only round-trip verifier, with a minimal inline type (the package ships
// no resolvable ESM types).
type SavReaderLike = {
  open(): Promise<void>;
  meta: { sysvars: { name: string; label: string; type: number }[] };
  readAllRows(includeNulls?: boolean): Promise<Record<string, unknown>[]>;
};
const require = createRequire(import.meta.url);
const { SavBufferReader } = require("sav-reader") as {
  SavBufferReader: new (buffer: Buffer) => SavReaderLike;
};

async function readSav(bytes: ArrayBuffer): Promise<{
  vars: { name: string; label: string; type: number }[];
  rows: Record<string, unknown>[];
}> {
  const reader = new SavBufferReader(Buffer.from(bytes));
  await reader.open();
  const vars = reader.meta.sysvars.map((v) => ({ name: v.name, label: v.label, type: v.type }));
  const rows = (await reader.readAllRows(true));
  return { vars, rows };
}

const VARS: SavVariable[] = [
  { name: "participant_id", type: "string", stringWidth: 16, label: "Participant" },
  { name: "duration_minutes", type: "numeric", decimals: 4, label: "Duration (min)" },
  { name: "day", type: "numeric", decimals: 0 },
];

describe("buildSavBuffer", () => {
  it("produces a .sav that sav-reader can open with long names + labels", async () => {
    const bytes = buildSavBuffer(VARS, [
      { participant_id: "P01", duration_minutes: 1.5, day: 2 },
      { participant_id: "P02", duration_minutes: null, day: 3 },
    ]);
    const { vars, rows } = await readSav(bytes);
    expect(vars.map((v) => v.name)).toEqual(["participant_id", "duration_minutes", "day"]);
    expect(vars[0].label).toBe("Participant");
    expect(vars[1].label).toBe("Duration (min)");
    expect(rows).toHaveLength(2);
    expect(rows[0].participant_id).toBe("P01");
    expect(rows[0].duration_minutes).toBe(1.5);
    expect(rows[0].day).toBe(2);
    // Missing numeric reads back as system-missing (null).
    expect(rows[1].duration_minutes ?? null).toBe(null);
    expect(rows[1].participant_id).toBe("P02");
  });

  it("is deterministic — identical input yields byte-identical output", () => {
    const a = buildSavBuffer(VARS, [{ participant_id: "P01", duration_minutes: 1, day: 1 }]);
    const b = buildSavBuffer(VARS, [{ participant_id: "P01", duration_minutes: 1, day: 1 }]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("handles a wide string variable (multi-slot) round-trip", async () => {
    const vars: SavVariable[] = [{ name: "pkg", type: "string", stringWidth: 40 }];
    const value = "com.example.some.really.long.package.name";
    const { rows } = await readSav(buildSavBuffer(vars, [{ pkg: value }]));
    expect(String(rows[0].pkg).trimEnd()).toBe(value.slice(0, 40));
  });

  it("round-trips a multibyte UTF-8 value (within a segment)", async () => {
    // sav-reader decodes per 8-byte segment, so this value's multibyte chars stay
    // within one segment. Boundary-straddling multibyte (e.g. "abcdef日本語😀") is
    // verified separately against the independent pyreadstat/ReadStat oracle.
    const vars: SavVariable[] = [{ name: "label", type: "string", stringWidth: 8 }];
    const { rows } = await readSav(buildSavBuffer(vars, [{ label: "Café" }]));
    expect(String(rows[0].label).trimEnd()).toBe("Café");
  });

  it("defaults string width to 255 and numeric decimals to 2 when omitted", async () => {
    // A string variable with no `stringWidth` (→ 255, so ⌈255/8⌉ = 32 slots) and
    // a numeric variable with no `decimals` (→ 2) both round-trip cleanly.
    const vars: SavVariable[] = [
      { name: "note", type: "string" }, // no stringWidth → 255
      { name: "amount", type: "numeric" }, // no decimals → 2
    ];
    const { vars: readVars, rows } = await readSav(
      buildSavBuffer(vars, [{ note: "hello", amount: 3.14 }]),
    );
    expect(readVars.map((v) => v.name)).toEqual(["note", "amount"]);
    expect(String(rows[0].note).trimEnd()).toBe("hello");
    expect(rows[0].amount).toBeCloseTo(3.14, 2);
  });

  it("writes system-missing/empty for row keys that are absent or null", async () => {
    // A row that omits a string key entirely and sets a numeric key to null:
    // the string cell becomes empty (all-spaces segments) and the numeric cell
    // reads back as system-missing (null).
    const vars: SavVariable[] = [
      { name: "participant_id", type: "string", stringWidth: 16 },
      { name: "duration_minutes", type: "numeric", decimals: 2 },
    ];
    const { rows } = await readSav(
      buildSavBuffer(vars, [{ duration_minutes: null }]), // participant_id absent
    );
    expect(rows).toHaveLength(1);
    expect(String((rows[0].participant_id as string | undefined) ?? "").trimEnd()).toBe("");
    expect(rows[0].duration_minutes ?? null).toBe(null);
  });
});
