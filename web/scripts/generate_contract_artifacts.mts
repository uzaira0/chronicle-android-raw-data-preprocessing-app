import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { stringify as stringifyYaml, parse as parseYaml } from "yaml";

type LinkMlSlot = {
  annotations?: Record<string, unknown>;
  description?: string;
  title?: string;
  example?: string;
  default?: unknown;
  multivalued?: boolean;
  range?: string;
  required?: boolean;
};

type ConfigurationAxis = "computational" | "annotation" | "view" | "execution";

type LinkMlClass = {
  slots?: string[];
};

type LinkMlEnum = {
  permissible_values?: Record<string, unknown>;
};

type LinkMlDocument = {
  classes: Record<string, LinkMlClass>;
  slots: Record<string, LinkMlSlot>;
  enums: Record<string, LinkMlEnum>;
};

type OpenApiSchema = {
  type?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, unknown>;
  items?: unknown;
  enum?: string[];
  nullable?: boolean;
};

type OpenApiDocument = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string }>;
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, OpenApiSchema>;
  };
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const linkmlPath = path.join(webDir, "schema", "chronicle-local-contract.linkml.yaml");
const openApiPath = path.join(webDir, "openapi", "chronicle-local-api.yaml");
const generatedTsPath = path.join(webDir, "src", "lib", "generatedContract.ts");

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toConstArray(values: string[]): string {
  return `[\n${values.map((value) => `  ${JSON.stringify(value)},`).join("\n")}\n] as const`;
}

function assertClassSlots(document: LinkMlDocument, className: string): string[] {
  const slots = document.classes[className]?.slots;
  if (!slots?.length) {
    throw new Error(`LinkML class ${className} has no slots`);
  }
  return slots;
}

// Maps LinkML enum names to the TypeScript type alias emitted in generatedContract.ts.
const ENUM_TYPE_ALIASES: Record<string, string> = {
  TimezoneHandlingMode: "BrowserTimezoneHandling",
  OutputKind: "OutputKind",
  AggregateShape: "AggregateShape",
};

function resolveTsBaseType(document: LinkMlDocument, range: string | undefined): string {
  const r = range ?? "string";
  switch (r) {
    case "boolean": return "boolean";
    case "integer": return "number";
    case "float": return "number";
    case "string": return "string";
    default:
      if (document.enums[r]) return ENUM_TYPE_ALIASES[r] ?? "string";
      if (document.classes[r]) return r;
      throw new Error(`Unknown LinkML range: ${r}`);
  }
}

function buildTsInterface(document: LinkMlDocument, className: string): string {
  const slots = assertClassSlots(document, className);
  const lines = slots.map((slotName) => {
    const slot = document.slots[slotName];
    if (!slot) throw new Error(`Missing slot definition for ${slotName}`);
    const propName = snakeToCamel(slotName);
    const baseType = resolveTsBaseType(document, slot.range);
    const tsType = slot.multivalued ? `${baseType}[]` : baseType;
    const optional = slot.required ? "" : "?";
    return `  ${propName}${optional}: ${tsType};`;
  });
  return `export type ${className} = {\n${lines.join("\n")}\n};`;
}

type SlotCategory = "boolean" | "number" | "number[]" | "string" | "string[]";

function categorizeSlot(document: LinkMlDocument, slotName: string): SlotCategory | null {
  const slot = document.slots[slotName];
  if (!slot) return null;
  const range = slot.range ?? "string";
  const multivalued = slot.multivalued ?? false;
  const required = slot.required ?? false;

  if (range === "boolean") return "boolean";
  if (range === "integer" || range === "float") {
    if (multivalued) return "number[]";
    // non-required non-multivalued numbers are special-cased in the sanitizer
    if (!required) return null;
    return "number";
  }
  if (multivalued) return "string[]";
  return "string"; // string, enum, or other range
}

function buildTsOptionKeysByCategory(
  document: LinkMlDocument,
  className: string,
): Record<SlotCategory, string[]> {
  const result: Record<SlotCategory, string[]> = {
    "boolean": [],
    "number": [],
    "number[]": [],
    "string": [],
    "string[]": [],
  };
  for (const slotName of assertClassSlots(document, className)) {
    const category = categorizeSlot(document, slotName);
    if (category !== null) result[category].push(snakeToCamel(slotName));
  }
  return result;
}

function configurationAxis(slot: LinkMlSlot, slotName: string): ConfigurationAxis {
  const value = slot.annotations?.configuration_axis ?? "computational";
  if (
    value !== "computational" &&
    value !== "annotation" &&
    value !== "view" &&
    value !== "execution"
  ) {
    throw new Error(`Invalid configuration_axis annotation for ${slotName}: ${String(value)}`);
  }
  return value;
}

function buildTsOptionKeysByAxis(
  document: LinkMlDocument,
  className: string,
): Record<ConfigurationAxis, string[]> {
  const result: Record<ConfigurationAxis, string[]> = {
    computational: [],
    annotation: [],
    view: [],
    execution: [],
  };
  for (const slotName of assertClassSlots(document, className)) {
    const slot = document.slots[slotName];
    if (!slot) throw new Error(`Missing slot definition for ${slotName}`);
    result[configurationAxis(slot, slotName)].push(snakeToCamel(slotName));
  }
  return result;
}

function toTsValue(value: unknown): string {
  if (value === undefined || value === null) return "undefined";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.map(toTsValue).join(", ")}]`;
  }
  throw new Error(`Cannot convert value to TypeScript literal: ${JSON.stringify(value)}`);
}

function buildDefaultBrowserOptions(document: LinkMlDocument, className: string): string {
  const slots = assertClassSlots(document, className);
  const entries: string[] = [];
  for (const slotName of slots) {
    const slot = document.slots[slotName];
    if (!slot) throw new Error(`Missing slot definition for ${slotName}`);
    const propName = snakeToCamel(slotName);
    const value = "default" in slot ? toTsValue(slot.default) : "undefined";
    entries.push(`  ${propName}: ${value}`);
  }
  return `export const DEFAULT_BROWSER_OPTIONS: BrowserProcessingOptions = {\n${entries.join(",\n")},\n};`;
}

function buildBrowserOptionTooltips(document: LinkMlDocument, className: string): string {
  const slots = assertClassSlots(document, className);
  const entries: string[] = [];
  for (const slotName of slots) {
    const slot = document.slots[slotName];
    if (!slot || (!slot.title && !slot.description)) continue;
    const propName = snakeToCamel(slotName);
    const fields: string[] = [];
    if (slot.title) fields.push(`    title: ${JSON.stringify(slot.title)}`);
    if (slot.description) {
      const body = slot.description.trim().replace(/\s+/g, " ");
      fields.push(`    body: ${JSON.stringify(body)}`);
    }
    if (slot.example) fields.push(`    example: ${JSON.stringify(slot.example)}`);
    entries.push(`  ${propName}: {\n${fields.join(",\n")},\n  }`);
  }
  return `export const BROWSER_OPTION_TOOLTIPS = {\n${entries.join(",\n")},\n} as const;`;
}

function getEnumValues(document: LinkMlDocument, enumName: string): string[] {
  const values = Object.keys(document.enums[enumName]?.permissible_values ?? {});
  if (!values.length) {
    throw new Error(`LinkML enum ${enumName} has no permissible values`);
  }
  return values;
}

function buildOpenApiSchemaForClass(
  document: LinkMlDocument,
  className: string,
  classSlots: string[],
): OpenApiSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const slotName of classSlots) {
    const slot = document.slots[slotName];
    if (!slot) {
      throw new Error(`Missing LinkML slot definition for ${slotName}`);
    }
    const propertyName = snakeToCamel(slotName);
    const baseSchema = buildOpenApiSchemaForSlot(document, slot);
    properties[propertyName] = slot.description
      ? { ...baseSchema, description: slot.description.trim().replace(/\s+/g, " ") }
      : baseSchema;
    if (slot.required) {
      required.push(propertyName);
    }
  }

  return {
    type: "object",
    ...(required.length ? { required } : {}),
    properties,
  };
}

function buildOpenApiSchemaForSlot(
  document: LinkMlDocument,
  slot: LinkMlSlot,
): Record<string, unknown> {
  const schema = buildOpenApiValueSchema(document, slot.range);
  if (!slot.multivalued) {
    return schema;
  }
  return {
    type: "array",
    items: schema,
  };
}

function buildOpenApiValueSchema(
  document: LinkMlDocument,
  range: string | undefined,
): Record<string, unknown> {
  switch (range ?? "string") {
    case "string":
      return { type: "string" };
    case "boolean":
      return { type: "boolean" };
    case "integer":
      return { type: "integer" };
    case "float":
      return { type: "number" };
    default:
      if (document.enums[range ?? ""]) {
        return {
          type: "string",
          enum: Object.keys(document.enums[range ?? ""]?.permissible_values ?? {}),
        };
      }
      if (document.classes[range ?? ""]) {
        return { $ref: `#/components/schemas/${range}` };
      }
      throw new Error(`Unsupported LinkML range ${range ?? "<undefined>"}`);
  }
}

function buildOpenApiDocument(document: LinkMlDocument): OpenApiDocument {
  const browserSupportFileSlots = assertClassSlots(document, "BrowserSupportFile");
  const browserSupportFilesSlots = assertClassSlots(document, "BrowserSupportFiles");
  const browserRuntimeSlots = assertClassSlots(document, "BrowserProcessingRuntime");
  const browserOptionsSlots = assertClassSlots(document, "BrowserProcessingOptions");
  const processedOutputSlots = assertClassSlots(document, "ProcessedOutputFileResult");
  const processedFileSlots = assertClassSlots(document, "ProcessedFileResult");

  return {
    openapi: "3.1.0",
    info: {
      title: "Chronicle Local Processing Contract",
      version: "1.0.0",
      description:
        "Boundary contract for the local-only browser preprocessing surface. The canonical source-of-truth model lives in `web/schema/chronicle-local-contract.linkml.yaml`; this OpenAPI document is generated from that same contract.",
    },
    servers: [{ url: "http://local.worker.invalid" }],
    paths: {
      "/discover-timezones": {
        post: {
          operationId: "discoverTimezones",
          summary: "Discover distinct timezone values from a raw Chronicle CSV payload.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/DiscoverTimezonesRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Distinct timezone values found in the raw file.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/DiscoverTimezonesResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/process-raw-csv": {
        post: {
          operationId: "processRawCsv",
          summary: "Process a raw Chronicle CSV file locally and return app and/or screen outputs.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ProcessRawCsvRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Preprocessing completed successfully.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ProcessedFileResult",
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        BrowserSupportFile: buildOpenApiSchemaForClass(
          document,
          "BrowserSupportFile",
          browserSupportFileSlots,
        ),
        BrowserSupportFiles: buildOpenApiSchemaForClass(document, "BrowserSupportFiles", browserSupportFilesSlots),
        BrowserProcessingRuntime: {
          ...buildOpenApiSchemaForClass(
            document,
            "BrowserProcessingRuntime",
            browserRuntimeSlots,
          ),
          description:
            "Internal/test-only runtime metadata that should not be surfaced as end-user options.",
        },
        BrowserProcessingOptions: buildOpenApiSchemaForClass(document, "BrowserProcessingOptions", browserOptionsSlots),
        DiscoverTimezonesRequest: {
          type: "object",
          required: ["csvText"],
          properties: {
            csvText: { type: "string" },
            runtime: { $ref: "#/components/schemas/BrowserProcessingRuntime" },
          },
        },
        DiscoverTimezonesResponse: {
          type: "object",
          required: ["timezones"],
          properties: {
            timezones: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        ProcessRawCsvRequest: {
          type: "object",
          required: ["inputFileName", "csvText", "options"],
          properties: {
            inputFileName: { type: "string" },
            csvText: { type: "string" },
            options: { $ref: "#/components/schemas/BrowserProcessingOptions" },
            supportFiles: { $ref: "#/components/schemas/BrowserSupportFiles" },
            runtime: { $ref: "#/components/schemas/BrowserProcessingRuntime" },
          },
        },
        ProcessedOutputFileResult: buildOpenApiSchemaForClass(
          document,
          "ProcessedOutputFileResult",
          processedOutputSlots,
        ),
        ProcessedFileResult: buildOpenApiSchemaForClass(document, "ProcessedFileResult", processedFileSlots),
      },
    },
  };
}

function buildGeneratedTypeScript(document: LinkMlDocument): string {
  // Raw CSV column headers are emitted VERBATIM (never camelized): the slot
  // names of RawChronicleEventRecord are the literal Chronicle export headers.
  const rawColumnSlots = assertClassSlots(document, "RawChronicleEventRecord");
  const requiredRawColumns = rawColumnSlots.filter(
    (slotName) => document.slots[slotName]?.required,
  );
  const browserOptionSlots = assertClassSlots(document, "BrowserProcessingOptions").map(snakeToCamel);
  const browserRequiredOptionSlots = assertClassSlots(document, "BrowserProcessingOptions")
    .filter((slotName) => document.slots[slotName]?.required)
    .map(snakeToCamel);
  const browserSupportSlots = assertClassSlots(document, "BrowserSupportFiles").map(snakeToCamel);
  const browserRuntimeSlots = assertClassSlots(document, "BrowserProcessingRuntime").map(snakeToCamel);
  const timezoneHandlingValues = getEnumValues(document, "TimezoneHandlingMode");
  const outputKindValues = getEnumValues(document, "OutputKind");
  const aggregateShapeValues = getEnumValues(document, "AggregateShape");
  const optionsInterface = buildTsInterface(document, "BrowserProcessingOptions");
  const keysByCategory = buildTsOptionKeysByCategory(document, "BrowserProcessingOptions");
  const keysByAxis = buildTsOptionKeysByAxis(document, "BrowserProcessingOptions");
  const defaultOptions = buildDefaultBrowserOptions(document, "BrowserProcessingOptions");
  const optionTooltips = buildBrowserOptionTooltips(document, "BrowserProcessingOptions");

  return `// This file is generated by web/scripts/generate_contract_artifacts.mts.
// Do not edit by hand; update the LinkML contract instead.

export const TIMEZONE_HANDLING_VALUES = ${toConstArray(timezoneHandlingValues)};

export const OUTPUT_KIND_VALUES = ${toConstArray(outputKindValues)};

export const AGGREGATE_SHAPE_VALUES = ${toConstArray(aggregateShapeValues)};

export const BROWSER_PROCESSING_OPTION_KEYS = ${toConstArray(browserOptionSlots)};

// Product-local configuration axes. Only computational keys participate in
// the semantic configuration lattice; the other axes are verified separately
// for annotation-only, view-only, or execution-strategy invariance.
export const COMPUTATIONAL_BROWSER_OPTION_KEYS = ${toConstArray(keysByAxis.computational)};
export const ANNOTATION_BROWSER_OPTION_KEYS = ${toConstArray(keysByAxis.annotation)};
export const VIEW_BROWSER_OPTION_KEYS = ${toConstArray(keysByAxis.view)};
export const EXECUTION_BROWSER_OPTION_KEYS = ${toConstArray(keysByAxis.execution)};

export const BROWSER_REQUIRED_PROCESSING_OPTION_KEYS = ${toConstArray(browserRequiredOptionSlots)};

export const BROWSER_SUPPORT_FILE_KEYS = ${toConstArray(browserSupportSlots)};

export const BROWSER_RUNTIME_KEYS = ${toConstArray(browserRuntimeSlots)};

// Literal raw Chronicle CSV column headers (RawChronicleEventRecord slots).
export const RAW_CHRONICLE_COLUMNS = ${toConstArray(rawColumnSlots)};

// Advisory presence expectation: fileInspection WARNS (never blocks) when one
// of these headers is missing — desktop-parity ingest tolerance is unchanged.
export const REQUIRED_RAW_COLUMNS = ${toConstArray(requiredRawColumns)};

export type BrowserTimezoneHandling = (typeof TIMEZONE_HANDLING_VALUES)[number];
export type OutputKind = (typeof OUTPUT_KIND_VALUES)[number];
export type AggregateShape = (typeof AGGREGATE_SHAPE_VALUES)[number];

${optionsInterface}

// Key arrays by sanitization type — used by settingsPersistence to stay in sync with the schema.
export const BOOLEAN_BROWSER_OPTION_KEYS = ${toConstArray(keysByCategory["boolean"])};
export const NUMBER_BROWSER_OPTION_KEYS = ${toConstArray(keysByCategory["number"])};
export const NUMBER_ARRAY_BROWSER_OPTION_KEYS = ${toConstArray(keysByCategory["number[]"])};
export const STRING_BROWSER_OPTION_KEYS = ${toConstArray(keysByCategory["string"])};
export const STRING_ARRAY_BROWSER_OPTION_KEYS = ${toConstArray(keysByCategory["string[]"])};

${defaultOptions}

${optionTooltips}
`;
}

async function loadLinkMlDocument(): Promise<LinkMlDocument> {
  return parseYaml(await readFile(linkmlPath, "utf-8")) as LinkMlDocument;
}

async function writeIfChanged(
  filePath: string,
  nextContents: string,
  checkOnly: boolean,
): Promise<void> {
  const currentContents = await readFile(filePath, "utf-8").catch(() => null);
  if (currentContents === nextContents) {
    return;
  }
  if (checkOnly) {
    throw new Error(`${path.relative(webDir, filePath)} is out of date; run npm run generate:contract`);
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, nextContents, "utf-8");
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const document = await loadLinkMlDocument();

  const nextGeneratedTs = buildGeneratedTypeScript(document);
  const nextOpenApi = `${stringifyYaml(buildOpenApiDocument(document))}`;

  await writeIfChanged(generatedTsPath, nextGeneratedTs, checkOnly);
  await writeIfChanged(openApiPath, nextOpenApi, checkOnly);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: checkOnly ? "check" : "write",
        artifacts: [
          path.relative(webDir, generatedTsPath),
          path.relative(webDir, openApiPath),
        ],
      },
      null,
      2,
    ),
  );
}

await main();
