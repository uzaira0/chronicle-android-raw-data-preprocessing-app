import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import {
  BROWSER_PROCESSING_OPTION_KEYS,
  BROWSER_RUNTIME_KEYS,
  BROWSER_SUPPORT_FILE_KEYS,
  TIMEZONE_HANDLING_VALUES,
  USAGE_SESSION_MODE_VALUES,
} from "../src/lib/browserPipeline";

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

function expectEqual(label: string, actual: string[], expected: string[]): void {
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
    BROWSER_PROCESSING_OPTION_KEYS as string[],
    linkmlOptionSlots,
  );
  expectEqual(
    "OpenAPI BrowserProcessingOptions properties vs runtime option keys",
    openapiOptionProperties,
    BROWSER_PROCESSING_OPTION_KEYS as string[],
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
    BROWSER_SUPPORT_FILE_KEYS as string[],
    linkmlSupportSlots,
  );
  expectEqual(
    "OpenAPI BrowserSupportFiles properties vs runtime support file keys",
    openapiSupportProperties,
    BROWSER_SUPPORT_FILE_KEYS as string[],
  );

  const linkmlRuntimeSlots =
    linkml.classes.BrowserProcessingRuntime?.slots?.map((slot) => snakeToCamel(slot)) ?? [];
  const openapiRuntimeProperties = Object.keys(
    openapi.components.schemas.BrowserProcessingRuntime?.properties ?? {},
  );
  expectEqual(
    "BrowserProcessingRuntime fields vs LinkML slots",
    BROWSER_RUNTIME_KEYS as string[],
    linkmlRuntimeSlots,
  );
  expectEqual(
    "OpenAPI BrowserProcessingRuntime properties vs runtime keys",
    openapiRuntimeProperties,
    BROWSER_RUNTIME_KEYS as string[],
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

  const linkmlUsageSessionValues = Object.keys(
    linkml.enums.UsageSessionMode?.permissible_values ?? {},
  );
  const openapiUsageSessionValues =
    (openapi.components.schemas.BrowserProcessingOptions?.properties?.usageSessionMode as {
      enum?: string[];
    })?.enum ?? [];
  expectEqual(
    "UsageSessionMode enum values",
    USAGE_SESSION_MODE_VALUES as string[],
    linkmlUsageSessionValues,
  );
  expectEqual(
    "OpenAPI UsageSessionMode enum values",
    openapiUsageSessionValues,
    USAGE_SESSION_MODE_VALUES as string[],
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
    TIMEZONE_HANDLING_VALUES as string[],
    linkmlTimezoneValues,
  );
  expectEqual(
    "OpenAPI TimezoneHandling enum values",
    openapiTimezoneValues,
    TIMEZONE_HANDLING_VALUES as string[],
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
