import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { stringify as stringifyYaml, parse as parseYaml } from "yaml";

type LinkMlSlot = {
  description?: string;
  multivalued?: boolean;
  range?: string;
  required?: boolean;
};

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
  const browserOptionSlots = assertClassSlots(document, "BrowserProcessingOptions").map(snakeToCamel);
  const browserRequiredOptionSlots = assertClassSlots(document, "BrowserProcessingOptions")
    .filter((slotName) => document.slots[slotName]?.required)
    .map(snakeToCamel);
  const browserSupportSlots = assertClassSlots(document, "BrowserSupportFiles").map(snakeToCamel);
  const browserRuntimeSlots = assertClassSlots(document, "BrowserProcessingRuntime").map(snakeToCamel);
  const timezoneHandlingValues = getEnumValues(document, "TimezoneHandlingMode");
  const outputKindValues = getEnumValues(document, "OutputKind");

  return `// This file is generated by web/scripts/generate_contract_artifacts.mts.
// Do not edit by hand; update the LinkML contract instead.

export const TIMEZONE_HANDLING_VALUES = ${toConstArray(timezoneHandlingValues)};

export const OUTPUT_KIND_VALUES = ${toConstArray(outputKindValues)};

export const BROWSER_PROCESSING_OPTION_KEYS = ${toConstArray(browserOptionSlots)};

export const BROWSER_REQUIRED_PROCESSING_OPTION_KEYS = ${toConstArray(browserRequiredOptionSlots)};

export const BROWSER_SUPPORT_FILE_KEYS = ${toConstArray(browserSupportSlots)};

export const BROWSER_RUNTIME_KEYS = ${toConstArray(browserRuntimeSlots)};

export type BrowserTimezoneHandling = (typeof TIMEZONE_HANDLING_VALUES)[number];
export type OutputKind = (typeof OUTPUT_KIND_VALUES)[number];
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
