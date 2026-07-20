import {
  buildCanonicalRows,
  collectAvailableTimezones,
  dropEmptyTimestampRows,
  getPossibleDeviceModel,
  parseCsvRaw,
  resolveDatetimeOfPreprocessing,
  sortByEventThenIndex,
  type CanonicalRow,
} from "@/lib/browserPipeline";
import { parseInteractionRemap } from "@/lib/interactionTypes";
import { monotonicNonDecreasing } from "@/lib/pipelineGraph/executionRecords";
import { port, stepsOf, wireUnit } from "@/lib/pipelineGraph/stepTypes";
import type { ParseEventsOutput } from "@/lib/pipelineGraph/unitContracts";

const step = stepsOf("parse_events");

export const parseRemapConfig = step({
  id: "parse_remap_config",
  label: "Parse remap config",
  description: "Parse the interaction-type remap option into a lookup map.",
  inputs: {},
  run: (_inputs, ctx) => parseInteractionRemap(ctx.options.interactionTypeRemap),
});

export const csvParse = step({
  id: "csv_parse",
  label: "CSV parse",
  description: "Parse the raw Chronicle CSV text into header-keyed rows (throws on parse errors).",
  inputs: {},
  run: (_inputs, ctx) => parseCsvRaw(ctx.csvText),
});

export const dropEmptyTimestamp = step({
  id: "drop_empty_timestamp",
  label: "Drop empty timestamps",
  description: "Drop raw rows with no event timestamp — unusable by every downstream step.",
  inputs: { raw: csvParse },
  run: ({ raw }) => dropEmptyTimestampRows(raw),
  lossy: true,
});

export const detectDeviceModel = step({
  id: "detect_device_model",
  label: "Detect device model",
  description: "Classify the stream as Amazon Fire vs Android from package-name evidence.",
  inputs: { raw: dropEmptyTimestamp },
  run: ({ raw }) => getPossibleDeviceModel(raw),
});

export const resolvePreprocDatetime = step({
  id: "resolve_preproc_datetime",
  label: "Resolve run datetime",
  description: "Resolve the datetime-of-preprocessing stamp (runtime-pinned for reproducibility).",
  inputs: {},
  run: (_inputs, ctx) => resolveDatetimeOfPreprocessing(ctx.runtime),
});

export const buildCanonicalRowsStep = step({
  id: "build_canonical_rows",
  label: "Build canonical rows",
  description:
    "Build typed canonical rows: normalize strings, remap interaction types, parse ns timestamps, stamp calendar columns.",
  inputs: {
    raw: dropEmptyTimestamp,
    nowText: resolvePreprocDatetime,
    deviceModel: detectDeviceModel,
    remap: parseRemapConfig,
  },
  run: ({ raw, nowText, deviceModel, remap }) =>
    buildCanonicalRows(raw, nowText, deviceModel, remap),
});

export const stableSort = step({
  id: "stable_sort",
  label: "Stable sort",
  description: "Sort rows by event timestamp, ties broken by original row index.",
  inputs: { rows: buildCanonicalRowsStep },
  run: ({ rows }) => sortByEventThenIndex(rows),
  expectations: [
    monotonicNonDecreasing<CanonicalRow>({
      id: "sorted_by_event_time",
      describe: "event_timestamp_ns",
      value: (row) => row.event_timestamp_ns,
    }),
  ],
});

export const collectTimezones = step({
  id: "collect_timezones",
  label: "Collect timezones",
  description: "Collect the distinct, sorted timezones present in the file (drives the timezone picker).",
  inputs: { rows: stableSort },
  run: ({ rows }) => collectAvailableTimezones(rows),
});

export const parseEventsWiring = wireUnit<ParseEventsOutput>(
  "parse_events",
  [
    parseRemapConfig,
    csvParse,
    dropEmptyTimestamp,
    detectDeviceModel,
    resolvePreprocDatetime,
    buildCanonicalRowsStep,
    stableSort,
    collectTimezones,
  ],
  {
    rows: port(stableSort),
    availableTimezones: port(collectTimezones),
    originalRowCount: port(stableSort, (rows) => rows.length),
  },
);
