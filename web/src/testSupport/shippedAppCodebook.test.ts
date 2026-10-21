import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Papa from "papaparse";
import { describe, expect, it } from "vitest";

/**
 * The shipped app codebook is no longer test input (the synthetic corpora
 * sample the frozen `fixtures/synthetic-catalog-app-codebook.csv`), so this
 * check is what guards it. The schema's own shape is validated by LinkML in
 * `check:workflow-schema`; the kernel re-validates it on every run.
 */
const webRoot = resolve(import.meta.dirname, "../..");
const COPIES = {
  csv: [
    "src/assets/defaults/unified_app_codebook.csv",
    "../app_codebook_files/unified_app_codebook.csv",
  ],
  schema: [
    "src/assets/defaults/unified_app_codebook.schema.json",
    "../app_codebook_files/unified_app_codebook.schema.json",
  ],
} as const;

type CodebookSchema = {
  key_column: string;
  codebook_columns: { source_column: string }[];
};

/** Every reason the codebook CSV cannot serve its schema; empty when it can. */
function shippedCodebookProblems(csv: string, schemaJson: string): string[] {
  const schema = JSON.parse(schemaJson) as CodebookSchema;
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const problems = parsed.errors.map(
    (error) => `CSV row ${error.row ?? "?"}: ${error.message}`,
  );
  const header = new Set(parsed.meta.fields ?? []);
  for (const column of [
    schema.key_column,
    ...schema.codebook_columns.map(({ source_column }) => source_column),
  ]) {
    if (!header.has(column)) problems.push(`header lacks schema column ${column}`);
  }
  const seen = new Set<string>();
  for (const row of parsed.data) {
    const key = row[schema.key_column] ?? "";
    if (key === "") problems.push("a row has an empty key");
    else if (seen.has(key)) problems.push(`key ${key} is repeated`);
    seen.add(key);
  }
  return problems;
}

const read = (path: string) => readFileSync(resolve(webRoot, path), "utf8");

describe("shipped app codebook", () => {
  it("keeps both shipped copies of the CSV and the schema byte-identical", () => {
    for (const [first, second] of Object.values(COPIES)) {
      expect(read(second), `${second} differs from ${first}`).toBe(read(first));
    }
  });

  it("carries every schema column and exactly one row per package", () => {
    expect(shippedCodebookProblems(read(COPIES.csv[0]), read(COPIES.schema[0]))).toEqual([]);
  });

  it("names a planted duplicate package and a missing schema column", () => {
    const schema = read(COPIES.schema[0]);
    const csv = read(COPIES.csv[0]);
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    const fields = parsed.meta.fields ?? [];
    const first = parsed.data[0]!;
    const newline = csv.includes("\r\n") ? "\r\n" : "\n";
    const duplicate = Papa.unparse({ fields, data: [first] }, { header: false, newline });
    expect(shippedCodebookProblems(`${csv.trimEnd()}${newline}${duplicate}${newline}`, schema)).toEqual([
      `key ${first.app_package_name} is repeated`,
    ]);
    const header = csv.slice(0, csv.indexOf(newline));
    const firstSource = (JSON.parse(schema) as CodebookSchema).codebook_columns[0]!
      .source_column;
    const renamed = csv.replace(header, header.replace(firstSource, "renamed_column"));
    expect(shippedCodebookProblems(renamed, schema)).toContain(
      `header lacks schema column ${firstSource}`,
    );
  });
});
