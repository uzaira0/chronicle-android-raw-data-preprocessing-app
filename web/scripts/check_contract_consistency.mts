import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import {
  AGGREGATE_SHAPE_VALUES,
  BROWSER_PROCESSING_OPTION_KEYS,
  BROWSER_RUNTIME_KEYS,
  BROWSER_SUPPORT_FILE_KEYS,
  OUTPUT_KIND_VALUES,
  RAW_CHRONICLE_COLUMNS,
  RESEARCH_AXIS_BROWSER_OPTION_KEYS,
  RESEARCH_AXIS_VALUES_BY_OPTION,
  REQUIRED_RAW_COLUMNS,
  TIMEZONE_HANDLING_VALUES,
} from "../src/lib/generatedContract";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");

type LinkMlDocument = {
  classes: Record<string, { slots?: string[] }>;
  slots: Record<
    string,
    {
      annotations?: Record<string, unknown>;
      required?: boolean;
      range?: string;
    }
  >;
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
  const ontology = await loadYamlDocument<LinkMlDocument>(
    path.join(webDir, "schema", "chronicle-research-ontology.linkml.yaml"),
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

  for (const optionKey of RESEARCH_AXIS_BROWSER_OPTION_KEYS) {
    const slotName = linkml.classes.BrowserProcessingOptions?.slots?.find(
      (slot) => snakeToCamel(slot) === optionKey,
    );
    if (!slotName) {
      throw new Error(`Research axis ${optionKey} has no LinkML option slot`);
    }
    const enumName = linkml.slots[slotName]?.annotations?.research_axis_enum;
    if (typeof enumName !== "string") {
      throw new Error(`Research axis ${optionKey} has no research_axis_enum annotation`);
    }
    const generatedValues = RESEARCH_AXIS_VALUES_BY_OPTION[optionKey] as readonly string[];
    const ontologyValues = Object.keys(
      ontology.enums[enumName]?.permissible_values ?? {},
    );
    const openapiValues =
      (openapi.components.schemas.BrowserProcessingOptions?.properties?.[
        optionKey
      ] as { enum?: string[] })?.enum ?? [];
    expectEqual(`${optionKey} generated values vs ${enumName}`, generatedValues, ontologyValues);
    expectEqual(`${optionKey} OpenAPI values`, openapiValues, generatedValues);
  }

  // A key the kernel reads as a plain string cannot take its values from the
  // ontology the way a `research_axis_enum` slot does — its range stays a local
  // contract enum. `research_ontology_enum` is how such a key still gets an
  // ontology term without being routed through the research-axis generator, and
  // this loop is what stops the two vocabularies from drifting apart. Without
  // it the ontology term would be a second, unpoliced declaration of the same
  // value set, which is exactly the parallel authority the architecture rules
  // forbid.
  const ontologyEnumBoundSlots: string[] = [];
  for (const [slotName, slot] of Object.entries(linkml.slots)) {
    const ontologyEnumName = slot?.annotations?.research_ontology_enum;
    if (typeof ontologyEnumName !== "string") continue;
    ontologyEnumBoundSlots.push(slotName);
    if (typeof slot?.annotations?.research_axis_enum === "string") {
      throw new Error(
        `${slotName} carries both research_axis_enum and research_ontology_enum; a key takes its values from exactly one place`,
      );
    }
    const localEnumName = slot.range;
    const localValues = Object.keys(
      (localEnumName && linkml.enums[localEnumName]?.permissible_values) ?? {},
    );
    if (localValues.length === 0) {
      throw new Error(
        `${slotName} names ontology enum ${ontologyEnumName} but its range ${String(localEnumName)} declares no permissible values`,
      );
    }
    const ontologyValues = Object.keys(
      ontology.enums[ontologyEnumName]?.permissible_values ?? {},
    );
    if (ontologyValues.length === 0) {
      throw new Error(`the research ontology declares no enum named ${ontologyEnumName}`);
    }
    expectEqual(
      `${slotName} (${String(localEnumName)}) vs research ontology ${ontologyEnumName}`,
      localValues,
      ontologyValues,
    );
  }
  // The loop above enrolls a slot only through its own annotation, so a
  // deleted or misspelled `research_ontology_enum` (or one written in LinkML's
  // expanded tag/value form, which the string guard skips) would silently
  // disarm the drift check. This list is the external declaration that keeps
  // it armed, the way RESEARCH_AXIS_BROWSER_OPTION_KEYS drives the axis loop.
  expectEqual(
    "slots bound by research_ontology_enum",
    ontologyEnumBoundSlots,
    ["timezone_handling"],
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

  // Raw-input contract: the generated column lists mirror the LinkML class
  // VERBATIM (raw CSV headers are never camelized), and every required
  // column is one of the declared columns. This class is deliberately not
  // part of the OpenAPI surface (raw rows travel inside csvText, not JSON).
  const linkmlRawColumns = linkml.classes.RawChronicleEventRecord?.slots ?? [];
  const linkmlRequiredRawColumns = linkmlRawColumns.filter(
    (slot) => linkml.slots[slot]?.required,
  );
  expectEqual("RawChronicleEventRecord columns vs LinkML slots", RAW_CHRONICLE_COLUMNS, linkmlRawColumns);
  expectEqual(
    "REQUIRED_RAW_COLUMNS vs LinkML required raw slots",
    REQUIRED_RAW_COLUMNS,
    linkmlRequiredRawColumns,
  );
  const rawColumnSet = new Set<string>(RAW_CHRONICLE_COLUMNS);
  const strayRequired = REQUIRED_RAW_COLUMNS.filter((column) => !rawColumnSet.has(column));
  if (strayRequired.length > 0) {
    throw new Error(`REQUIRED_RAW_COLUMNS not subset of RAW_CHRONICLE_COLUMNS: ${strayRequired.join(", ")}`);
  }

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
