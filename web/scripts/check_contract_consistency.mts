import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import {
  AGGREGATE_SHAPE_VALUES,
  BROWSER_PROCESSING_OPTION_KEYS,
  BROWSER_RUNTIME_KEYS,
  BROWSER_SUPPORT_FILE_KEYS,
  OUTPUT_KIND_VALUES,
  TIMEZONE_HANDLING_VALUES,
} from "../src/lib/generatedContract";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");

type LinkMlDocument = {
  classes: Record<string, { slots?: string[] }>;
  slots: Record<string, { required?: boolean; range?: string }>;
  enums: Record<string, { permissible_values?: Record<string, unknown> }>;
};

type OpenApiDocument = {
  components: {
    schemas: Record<
      string,
      {
        properties?: Record<string, unknown>;
        required?: string[];
      }
    >;
  };
};

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function sorted(values: Iterable<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function expectEqual(label: string, actual: readonly string[], expected: readonly string[]): void {
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label} mismatch\nactual: ${JSON.stringify(actualSorted, null, 2)}\nexpected: ${JSON.stringify(expectedSorted, null, 2)}`,
    );
  }
}

async function loadYamlDocument<T>(filePath: string): Promise<T> {
  return parseYaml(await readFile(filePath, "utf-8")) as T;
}

async function main(): Promise<void> {
  const linkml = await loadYamlDocument<LinkMlDocument>(
    path.join(webDir, "schema", "chronicle-local-contract.linkml.yaml"),
  );
  const openapi = await loadYamlDocument<OpenApiDocument>(
    path.join(webDir, "openapi", "chronicle-local-api.yaml"),
  );

  const linkmlOptionSlots =
    linkml.classes.BrowserProcessingOptions?.slots?.map((slot) => snakeToCamel(slot)) ?? [];
  const linkmlRequiredOptions =
    linkml.classes.BrowserProcessingOptions?.slots
      ?.filter((slot) => linkml.slots[slot]?.required)
      .map((slot) => snakeToCamel(slot)) ?? [];
  const openapiOptionProperties = Object.keys(
    openapi.components.schemas.BrowserProcessingOptions?.properties ?? {},
  );
  const openapiRequiredOptions = openapi.components.schemas.BrowserProcessingOptions?.required ?? [];

  expectEqual(
    "BrowserProcessingOptions keys vs LinkML slots",
    BROWSER_PROCESSING_OPTION_KEYS,
    linkmlOptionSlots,
  );
  expectEqual(
    "OpenAPI BrowserProcessingOptions properties vs runtime option keys",
    openapiOptionProperties,
    BROWSER_PROCESSING_OPTION_KEYS,
  );
  expectEqual(
    "OpenAPI BrowserProcessingOptions required fields vs LinkML required fields",
    openapiRequiredOptions,
    linkmlRequiredOptions,
  );

  const linkmlSupportSlots =
    linkml.classes.BrowserSupportFiles?.slots?.map((slot) => snakeToCamel(slot)) ?? [];
  const openapiSupportProperties = Object.keys(
    openapi.components.schemas.BrowserSupportFiles?.properties ?? {},
  );
  expectEqual(
    "BrowserSupportFiles fields vs LinkML slots",
    BROWSER_SUPPORT_FILE_KEYS,
    linkmlSupportSlots,
  );
  expectEqual(
    "OpenAPI BrowserSupportFiles properties vs runtime support file keys",
    openapiSupportProperties,
    BROWSER_SUPPORT_FILE_KEYS,
  );

  const linkmlRuntimeSlots =
    linkml.classes.BrowserProcessingRuntime?.slots?.map((slot) => snakeToCamel(slot)) ?? [];
  const openapiRuntimeProperties = Object.keys(
    openapi.components.schemas.BrowserProcessingRuntime?.properties ?? {},
  );
  expectEqual(
    "BrowserProcessingRuntime fields vs LinkML slots",
    BROWSER_RUNTIME_KEYS,
    linkmlRuntimeSlots,
  );
  expectEqual(
    "OpenAPI BrowserProcessingRuntime properties vs runtime keys",
    openapiRuntimeProperties,
    BROWSER_RUNTIME_KEYS,
  );

  const discoverTimezonesRequestProperties = Object.keys(
    openapi.components.schemas.DiscoverTimezonesRequest?.properties ?? {},
  );
  expectEqual(
    "DiscoverTimezonesRequest fields",
    discoverTimezonesRequestProperties,
    ["csvText", "runtime"],
  );

  const processRawCsvRequestProperties = Object.keys(
    openapi.components.schemas.ProcessRawCsvRequest?.properties ?? {},
  );
  expectEqual(
    "ProcessRawCsvRequest fields",
    processRawCsvRequestProperties,
    ["inputFileName", "csvText", "options", "supportFiles", "runtime"],
  );

  const linkmlTimezoneValues = Object.keys(
    linkml.enums.TimezoneHandlingMode?.permissible_values ?? {},
  );
  const openapiTimezoneValues =
    (openapi.components.schemas.BrowserProcessingOptions?.properties?.timezoneHandling as {
      enum?: string[];
    })?.enum ?? [];
  expectEqual(
    "TimezoneHandling enum values",
    TIMEZONE_HANDLING_VALUES,
    linkmlTimezoneValues,
  );
  expectEqual(
    "OpenAPI TimezoneHandling enum values",
    openapiTimezoneValues,
    TIMEZONE_HANDLING_VALUES,
  );

  const linkmlOutputKindValues = Object.keys(linkml.enums.OutputKind?.permissible_values ?? {});
  const openapiOutputKindValues =
    (openapi.components.schemas.ProcessedOutputFileResult?.properties?.kind as {
      enum?: string[];
    })?.enum ?? [];
  expectEqual("OutputKind enum values", OUTPUT_KIND_VALUES, linkmlOutputKindValues);
  expectEqual("OpenAPI OutputKind enum values", openapiOutputKindValues, OUTPUT_KIND_VALUES);

  const linkmlAggregateShapeValues = Object.keys(
    linkml.enums.AggregateShape?.permissible_values ?? {},
  );
  const openapiAggregateShapeValues =
    (openapi.components.schemas.BrowserProcessingOptions?.properties?.aggregateShape as {
      enum?: string[];
    })?.enum ?? [];
  expectEqual("AggregateShape enum values", AGGREGATE_SHAPE_VALUES, linkmlAggregateShapeValues);
  expectEqual(
    "OpenAPI AggregateShape enum values",
    openapiAggregateShapeValues,
    AGGREGATE_SHAPE_VALUES,
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        optionKeys: BROWSER_PROCESSING_OPTION_KEYS,
        supportFileKeys: BROWSER_SUPPORT_FILE_KEYS,
        runtimeKeys: BROWSER_RUNTIME_KEYS,
      },
      null,
      2,
    ),
  );
}

await main();
