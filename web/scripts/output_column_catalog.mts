// The output-column catalog: the hand-authored semantics in
// schema/chronicle-output-columns.yaml with the app codebook's columns spliced
// in after `broad_app_category`, where the App Usage CSV writes them. The
// codebook columns and their descriptions come from the bundled codebook
// schema, the same file the kernel is handed at run time.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUTPUT_COLUMN_CATALOG_PATH = path.resolve(
  HERE,
  "../schema/chronicle-output-columns.yaml",
);
const CODEBOOK_SCHEMA_PATH = path.resolve(
  HERE,
  "../src/assets/defaults/unified_app_codebook.schema.json",
);

export type OutputColumnCatalogEntry = {
  column_name: string;
  column_outputs: string[];
  value_type: string;
  units?: string;
  column_description: string;
  present_when?: string;
  filter_dependent?: boolean;
  vocabulary_alignment?: string;
};

export async function loadOutputColumnCatalog(): Promise<OutputColumnCatalogEntry[]> {
  const doc = parseYaml(await readFile(OUTPUT_COLUMN_CATALOG_PATH, "utf-8")) as {
    output_columns: OutputColumnCatalogEntry[];
  };
  if (!Array.isArray(doc.output_columns)) throw new Error("catalog missing output_columns list");
  const schema = JSON.parse(await readFile(CODEBOOK_SCHEMA_PATH, "utf-8")) as {
    codebook_columns: Array<{ output_column: string; column_description: string }>;
  };
  const anchor = doc.output_columns.findIndex(
    ({ column_name }) => column_name === "broad_app_category",
  );
  if (anchor < 0) throw new Error("catalog has no broad_app_category entry to anchor the codebook columns");
  const codebook = schema.codebook_columns.map(
    ({ output_column, column_description }): OutputColumnCatalogEntry => ({
      column_name: output_column,
      column_outputs: ["app"],
      value_type: "string",
      present_when: "use_app_codebook",
      column_description,
    }),
  );
  return [
    ...doc.output_columns.slice(0, anchor + 1),
    ...codebook,
    ...doc.output_columns.slice(anchor + 1),
  ];
}
