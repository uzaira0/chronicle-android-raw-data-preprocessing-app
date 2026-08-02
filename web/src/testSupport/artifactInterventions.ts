import Papa from "papaparse";
import type {
  SyntheticCatalog,
  SyntheticChronicleCorpus,
} from "@/testSupport/syntheticChronicleCorpus";
import { buildCodebookSlice } from "@/testSupport/syntheticChronicleCorpus";

type CsvRow = Record<string, string>;

export const SUPPORT_ROLE_IDS = [
  "filter_file",
  "apps_forcing_screen_open_file",
  "background_apps_file",
  "app_codebook_file",
  "study_dates_file",
  "device_sharing_file",
  "survey_attribution_file",
  "enrolled_devices_file",
] as const;

export type SupportRoleId = (typeof SUPPORT_ROLE_IDS)[number];
export type InterventionRoleId = "raw_chronicle_csv" | SupportRoleId;

export type SupportArtifact = {
  name: string;
  csv: string;
};

export type ArtifactFixtureState = {
  rawCsv: string;
  supports: Record<SupportRoleId, SupportArtifact>;
};

export type ArtifactIntervention = {
  id: string;
  roleId: InterventionRoleId;
  mutationClass:
    | "field-edit"
    | "row-add"
    | "row-remove"
    | "row-duplicate"
    | "row-reorder"
    | "record-edit"
    | "record-remove"
    | "boundary-edit"
    | "representation-only";
  changedComponents: string[];
  /**
   * Every supplied source column this mutation rewrites, named in the Rust
   * step contract's field namespace (`<role>.<column>`), plus the structural
   * pseudo-fields `source.raw_row_set` / `source.raw_row_order` when the raw
   * row multiset or its order changes. Representation-only controls declare
   * `[]` because they change no field value.
   *
   * `changedComponents` above is prose addressed at a human reading the
   * ledger; this list is the machine-checkable claim the field-level
   * reconciliation gate (`fieldLevelProvenance.test.ts`) seeds its reachability
   * closure from. Columns the engine never reads may appear here — the gate
   * partitions them out and then requires that a mutation confined to unread
   * columns changes no output cell at all.
   */
  sourceFields: string[];
  description: string;
  expectedSemanticEffect: "required" | "equivalent";
  apply: (source: ArtifactFixtureState) => ArtifactFixtureState;
};

type CsvTable = {
  fields: string[];
  rows: CsvRow[];
};

const ALTERNATE_PARTICIPANT = "P-ARTIFACT-999-D1";

function parseTable(csv: string, label: string): CsvTable {
  const parsed = Papa.parse<CsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const firstParseError = parsed.errors[0];
  if (firstParseError) {
    throw new Error(`${label}: ${firstParseError.message}`);
  }
  return {
    fields: parsed.meta.fields ?? [],
    rows: parsed.data.map((row) => ({ ...row })),
  };
}

function serializeTable(table: CsvTable): string {
  return `${Papa.unparse({ fields: table.fields, data: table.rows }, { newline: "\n" })}\n`;
}

function canonicalCsv(csv: string, label: string): string {
  return serializeTable(parseTable(csv, label));
}

function cloneState(source: ArtifactFixtureState): ArtifactFixtureState {
  return {
    rawCsv: source.rawCsv,
    supports: Object.fromEntries(
      SUPPORT_ROLE_IDS.map((roleId) => [roleId, { ...source.supports[roleId] }]),
    ) as Record<SupportRoleId, SupportArtifact>,
  };
}

function mutateRawTable(
  source: ArtifactFixtureState,
  mutate: (table: CsvTable) => void,
): ArtifactFixtureState {
  const target = cloneState(source);
  const table = parseTable(target.rawCsv, "raw intervention");
  mutate(table);
  target.rawCsv = serializeTable(table);
  return target;
}

function mutateSupportTable(
  source: ArtifactFixtureState,
  roleId: SupportRoleId,
  mutate: (table: CsvTable) => void,
): ArtifactFixtureState {
  const target = cloneState(source);
  const table = parseTable(target.supports[roleId].csv, `${roleId} intervention`);
  mutate(table);
  target.supports[roleId].csv = serializeTable(table);
  return target;
}

function toCrLf(csv: string): string {
  return csv.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
}

function packageColumn(row: CsvRow): string {
  return (row.app_package_name || row.package_name || "").trim();
}

function usedPackageForClass(
  corpus: SyntheticChronicleCorpus,
  catalog: SyntheticCatalog,
  appClass: "filtered" | "background" | "forcing-screen-open",
): string {
  const candidate = catalog.apps.find(
    (app) => corpus.usedPackages.includes(app.packageName) && app.classes.includes(appClass),
  );
  if (!candidate) throw new Error(`corpus has no used ${appClass} package`);
  return candidate.packageName;
}

function removePackage(table: CsvTable, packageName: string): void {
  const before = table.rows.length;
  table.rows = table.rows.filter((row) => packageColumn(row) !== packageName);
  if (table.rows.length !== before - 1) {
    throw new Error(`expected exactly one support row for ${packageName}`);
  }
}

function firstApplicationRow(table: CsvTable): CsvRow {
  const row = table.rows.find((candidate) => packageColumn(candidate) !== "android");
  if (!row) throw new Error("synthetic corpus has no application event");
  return row;
}

function rawFieldIntervention(
  field: string,
  replacement: (current: string, row: CsvRow) => string,
  expectedSemanticEffect: "required" | "equivalent" = "required",
): ArtifactIntervention {
  return {
    id: `raw-field:${field}`,
    roleId: "raw_chronicle_csv",
    mutationClass: "field-edit",
    changedComponents: [`raw.row[application-event].${field}`],
    sourceFields: [`raw_chronicle_csv.${field}`],
    description: `Edit exactly one application-event ${field} field`,
    expectedSemanticEffect,
    apply: (source) =>
      mutateRawTable(source, (table) => {
        const row = firstApplicationRow(table);
        if (!table.fields.includes(field)) throw new Error(`raw fixture omits ${field}`);
        row[field] = replacement(row[field] ?? "", row);
      }),
  };
}

export function buildArtifactFixtureState(input: {
  corpus: SyntheticChronicleCorpus;
  catalog: SyntheticCatalog;
  filterCsv: string;
  forcingCsv: string;
  backgroundCsv: string;
}): ArtifactFixtureState {
  const { corpus, catalog } = input;
  const raw = parseTable(corpus.csv, "synthetic raw corpus");
  const appEvent = firstApplicationRow(raw);
  const surveyTimestamp = appEvent.event_timestamp;
  if (surveyTimestamp === undefined) {
    throw new Error("first application row is missing event_timestamp");
  }
  const surveyRows = raw.rows
    .filter(
      (row) =>
        packageColumn(row) !== "android" &&
        ["Activity Resumed", "Unknown importance: 1"].includes(row.interaction_type ?? ""),
    )
    .map((row) => ({
      participant_id: corpus.participantId,
      event_timestamp: row.event_timestamp ?? "",
      users: "Target Child",
    }));
  const firstDate = surveyTimestamp.slice(0, 10);
  return {
    rawCsv: serializeTable(raw),
    supports: {
      filter_file: {
        name: "apps-to-filter.csv",
        csv: canonicalCsv(input.filterCsv, "filter fixture"),
      },
      apps_forcing_screen_open_file: {
        name: "forcing-screen-open.csv",
        csv: canonicalCsv(input.forcingCsv, "forcing fixture"),
      },
      background_apps_file: {
        name: "background-apps.csv",
        csv: canonicalCsv(input.backgroundCsv, "background fixture"),
      },
      app_codebook_file: {
        name: "codebook.csv",
        csv: canonicalCsv(
          buildCodebookSlice(catalog, corpus.usedPackages),
          "codebook fixture",
        ),
      },
      study_dates_file: {
        name: "study-dates.csv",
        csv: canonicalCsv(
          `participant_id,start_date,end_date\n${corpus.participantId},2026-01-01,2026-12-31\n${ALTERNATE_PARTICIPANT},${firstDate},${firstDate}\n`,
          "study dates fixture",
        ),
      },
      device_sharing_file: {
        name: "device-sharing.csv",
        csv: canonicalCsv(
          `participant_id,sharing_status\n${corpus.participantId},Shared\n${ALTERNATE_PARTICIPANT},Non-Shared\n`,
          "device sharing fixture",
        ),
      },
      survey_attribution_file: {
        name: "survey-attribution.csv",
        csv: serializeTable({
          fields: ["participant_id", "event_timestamp", "users"],
          rows: [
            ...surveyRows,
            {
              participant_id: ALTERNATE_PARTICIPANT,
              event_timestamp: surveyTimestamp,
              users: "Target Child",
            },
          ],
        }),
      },
      enrolled_devices_file: {
        name: "enrolled-devices.csv",
        csv: canonicalCsv(
          `participant_id,device_count\n${corpus.participantId},1\n${ALTERNATE_PARTICIPANT},1\n`,
          "enrolled devices fixture",
        ),
      },
    },
  };
}

export function buildArtifactInterventions(input: {
  corpus: SyntheticChronicleCorpus;
  catalog: SyntheticCatalog;
}): ArtifactIntervention[] {
  const { corpus, catalog } = input;
  const firstCorpusTimestamp = parseTable(corpus.csv, "artifact intervention corpus")
    .rows[0]?.event_timestamp;
  if (firstCorpusTimestamp === undefined) {
    throw new Error("artifact intervention corpus has no timestamped rows");
  }
  const firstDataDate = firstCorpusTimestamp.slice(0, 10);
  const backgroundPackage = usedPackageForClass(corpus, catalog, "background");
  const rawRows = parseTable(corpus.csv, "artifact intervention corpus").rows;
  const filterActivationEvent = rawRows.find((row) => {
    const app = catalog.apps.find((candidate) => candidate.packageName === packageColumn(row));
    return (
      app?.classes.includes("catalog") &&
      [
        "Activity Resumed",
        "Activity Paused",
        "Activity Stopped",
        "Activity Destroyed",
      ].includes(row.interaction_type ?? "")
    );
  });
  if (!filterActivationEvent) {
    throw new Error("corpus has no catalog-only application event for filter activation");
  }
  let forcingActivationEvent: CsvRow | undefined;
  for (let stopIndex = 0; stopIndex < rawRows.length; stopIndex += 1) {
    if (rawRows[stopIndex]?.interaction_type !== "Screen Non-Interactive") continue;
    for (let candidateIndex = stopIndex - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = rawRows[candidateIndex];
      if (candidate === undefined) continue;
      if (packageColumn(candidate) === "android") continue;
      if (!["Activity Resumed", "Unknown importance: 1"].includes(candidate.interaction_type ?? "")) {
        continue;
      }
      const app = catalog.apps.find(
        (catalogApp) => catalogApp.packageName === packageColumn(candidate),
      );
      if (!app?.classes.includes("forcing-screen-open")) {
        forcingActivationEvent = candidate;
        break;
      }
    }
    if (forcingActivationEvent) break;
  }
  if (!forcingActivationEvent) {
    throw new Error("corpus has no non-forcing application before a screen stop");
  }
  const codebookPackage = corpus.usedPackages.find((packageName) =>
    catalog.codebookByPackage.has(packageName),
  );
  if (!codebookPackage) throw new Error("corpus has no codebook-backed package");

  const rawFieldInterventions = [
    rawFieldIntervention("study_id", (value) => `${value}-intervention`),
    rawFieldIntervention("participant_id", () => ALTERNATE_PARTICIPANT),
    rawFieldIntervention(
      "possible_device_model",
      () => "Ignored supplied model",
      "equivalent",
    ),
    rawFieldIntervention("username", () => "Other"),
    rawFieldIntervention("application_label", (value) => `${value} [intervention]`),
    rawFieldIntervention("interaction_type", () => "Notification Seen"),
    rawFieldIntervention(
      "app_package_name",
      (value) => `${value}.artifact-intervention`,
    ),
    rawFieldIntervention("event_timestamp", () => "2026-04-05 23:59:59.000000"),
    rawFieldIntervention(
      "start_timestamp",
      () => "2026-04-05 23:58:00.000000",
      "equivalent",
    ),
    rawFieldIntervention(
      "stop_timestamp",
      () => "2026-04-05 23:59:00.000000",
      "equivalent",
    ),
    rawFieldIntervention("timezone", (value) =>
      value === "America/New_York" ? "America/Chicago" : "America/New_York",
    ),
  ];

  const rowInterventions: ArtifactIntervention[] = [
    {
      id: "raw-row:add",
      roleId: "raw_chronicle_csv",
      mutationClass: "row-add",
      changedComponents: ["raw.rows"],
      sourceFields: ["source.raw_row_set"],
      description: "Add one valid application event",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateRawTable(source, (table) => {
          const added = { ...firstApplicationRow(table) };
          added.event_timestamp = "2026-12-31 23:59:59.000000";
          added.interaction_type = "Notification Seen";
          table.rows.push(added);
        }),
    },
    {
      id: "raw-row:remove",
      roleId: "raw_chronicle_csv",
      mutationClass: "row-remove",
      changedComponents: ["raw.rows"],
      sourceFields: ["source.raw_row_set"],
      description: "Remove one application event",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateRawTable(source, (table) => {
          const row = firstApplicationRow(table);
          table.rows.splice(table.rows.indexOf(row), 1);
        }),
    },
    {
      id: "raw-row:duplicate",
      roleId: "raw_chronicle_csv",
      mutationClass: "row-duplicate",
      changedComponents: ["raw.rows"],
      sourceFields: ["source.raw_row_set"],
      description: "Duplicate one application event exactly",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateRawTable(source, (table) => {
          const row = firstApplicationRow(table);
          table.rows.splice(table.rows.indexOf(row) + 1, 0, { ...row });
        }),
    },
    {
      id: "raw-row:reorder",
      roleId: "raw_chronicle_csv",
      mutationClass: "row-reorder",
      changedComponents: ["raw.row_order", "raw.source_row_correspondence"],
      sourceFields: ["source.raw_row_order"],
      description: "Reverse raw record order while preserving record values",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateRawTable(source, (table) => {
          table.rows.reverse();
        }),
    },
  ];

  const supportInterventions: ArtifactIntervention[] = [
    {
      id: "support:filter-activate-used-package",
      roleId: "filter_file",
      mutationClass: "row-add",
      changedComponents: [
        `filter_file.package[${packageColumn(filterActivationEvent)}]`,
      ],
      sourceFields: [
        "filter_file.app_package_name",
        "filter_file.known_application_labels",
        "filter_file.app_filter_category",
        "filter_file.filter_bool",
      ],
      description: "Add a package-wide filter rule for one previously unfiltered used package",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateSupportTable(source, "filter_file", (table) => {
          const packageName = packageColumn(filterActivationEvent);
          if (table.rows.some((row) => packageColumn(row) === packageName)) {
            throw new Error(`filter fixture unexpectedly already contains ${packageName}`);
          }
          const row = Object.fromEntries(table.fields.map((field) => [field, ""]));
          row.app_package_name = packageName;
          // Empty labels deliberately activate package-wide matching. Shipped
          // labels may contain commas, whose support-file meaning is a list of
          // aliases rather than one literal label.
          row.known_application_labels = "";
          row.app_filter_category = "artifact-intervention";
          row.filter_bool = "1";
          table.rows.push(row);
        }),
    },
    {
      id: "support:forcing-activate-screen-tail-package",
      roleId: "apps_forcing_screen_open_file",
      mutationClass: "row-add",
      changedComponents: [
        `apps_forcing_screen_open_file.package[${packageColumn(forcingActivationEvent)}]`,
      ],
      sourceFields: [
        "apps_forcing_screen_open_file.package_name",
        "apps_forcing_screen_open_file.label_or_note",
      ],
      description: "Mark the last meaningful package before a screen stop as screen-forcing",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateSupportTable(source, "apps_forcing_screen_open_file", (table) => {
          const packageName = packageColumn(forcingActivationEvent);
          if (table.rows.some((row) => packageColumn(row) === packageName)) {
            throw new Error(`forcing fixture unexpectedly already contains ${packageName}`);
          }
          const row = Object.fromEntries(table.fields.map((field) => [field, ""]));
          row.package_name = packageName;
          row.label_or_note = "Artifact intervention screen-tail witness";
          table.rows.push(row);
        }),
    },
    {
      id: "support:background-remove-used-package",
      roleId: "background_apps_file",
      mutationClass: "record-remove",
      changedComponents: [`background_apps_file.package[${backgroundPackage}]`],
      sourceFields: [
        "background_apps_file.package_name",
        "background_apps_file.app_package_name",
      ],
      description: "Remove one used background package",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateSupportTable(source, "background_apps_file", (table) =>
          removePackage(table, backgroundPackage),
        ),
    },
    {
      id: "support:codebook-edit-category",
      roleId: "app_codebook_file",
      mutationClass: "record-edit",
      changedComponents: [`app_codebook_file.package[${codebookPackage}].bcm_play_store_genreId`],
      sourceFields: ["app_codebook_file.bcm_play_store_genreId"],
      description: "Change one used package's codebook category",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateSupportTable(source, "app_codebook_file", (table) => {
          const row = table.rows.find((candidate) => packageColumn(candidate) === codebookPackage);
          if (!row) throw new Error(`codebook row missing for ${codebookPackage}`);
          row.bcm_play_store_genreId = "ARTIFACT_INTERVENTION_CATEGORY";
        }),
    },
    {
      id: "support:study-window-narrow",
      roleId: "study_dates_file",
      mutationClass: "record-edit",
      changedComponents: [
        `study_dates_file.participant[${corpus.participantId}].start_date`,
        `study_dates_file.participant[${corpus.participantId}].end_date`,
      ],
      sourceFields: ["study_dates_file.start_date", "study_dates_file.end_date"],
      description: "Narrow the participant study window to its first day",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateSupportTable(source, "study_dates_file", (table) => {
          const row = table.rows.find(
            (candidate) => candidate.participant_id === corpus.participantId,
          );
          if (!row) throw new Error("study-window participant missing");
          row.start_date = firstDataDate;
          row.end_date = firstDataDate;
        }),
    },
    {
      id: "support:sharing-shared-to-nonshared",
      roleId: "device_sharing_file",
      mutationClass: "record-edit",
      changedComponents: [
        `device_sharing_file.participant[${corpus.participantId}].sharing_status`,
      ],
      sourceFields: ["device_sharing_file.sharing_status"],
      description: "Change one participant from shared to non-shared",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateSupportTable(source, "device_sharing_file", (table) => {
          const row = table.rows.find(
            (candidate) => candidate.participant_id === corpus.participantId,
          );
          if (!row) throw new Error("sharing participant missing");
          row.sharing_status = "Non-Shared";
        }),
    },
    {
      id: "support:survey-target-to-other",
      roleId: "survey_attribution_file",
      mutationClass: "record-edit",
      changedComponents: [
        `survey_attribution_file.participant[${corpus.participantId}].users[*]`,
      ],
      sourceFields: ["survey_attribution_file.users"],
      description: "Change every exact session-start survey attribution to Other",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateSupportTable(source, "survey_attribution_file", (table) => {
          const rows = table.rows.filter(
            (candidate) => candidate.participant_id === corpus.participantId,
          );
          if (rows.length === 0) throw new Error("survey participant missing");
          for (const row of rows) row.users = "Other";
        }),
    },
    {
      id: "support:enrollment-one-to-two-devices",
      roleId: "enrolled_devices_file",
      mutationClass: "record-edit",
      changedComponents: [
        `enrolled_devices_file.participant[${corpus.participantId}].device_count`,
      ],
      sourceFields: ["enrolled_devices_file.device_count"],
      description: "Change one participant's enrolled-device denominator",
      expectedSemanticEffect: "required",
      apply: (source) =>
        mutateSupportTable(source, "enrolled_devices_file", (table) => {
          const row = table.rows.find(
            (candidate) => candidate.participant_id === corpus.participantId,
          );
          if (!row) throw new Error("enrollment participant missing");
          row.device_count = "2";
        }),
    },
  ];

  const representationControls: ArtifactIntervention[] = [
    {
      id: "raw-representation:crlf",
      roleId: "raw_chronicle_csv",
      mutationClass: "representation-only",
      changedComponents: ["raw.line_endings"],
      sourceFields: [],
      description: "Replace LF record separators with CRLF",
      expectedSemanticEffect: "equivalent",
      apply: (source) => ({ ...cloneState(source), rawCsv: toCrLf(source.rawCsv) }),
    },
    ...SUPPORT_ROLE_IDS.map(
      (roleId): ArtifactIntervention => ({
        id: `support-representation:${roleId}:crlf`,
        roleId,
        mutationClass: "representation-only",
        changedComponents: [`${roleId}.line_endings`],
        sourceFields: [],
        description: `Replace ${roleId} LF record separators with CRLF`,
        expectedSemanticEffect: "equivalent",
        apply: (source) => {
          const target = cloneState(source);
          target.supports[roleId].csv = toCrLf(source.supports[roleId].csv);
          return target;
        },
      }),
    ),
  ];

  return [
    ...rawFieldInterventions,
    ...rowInterventions,
    ...supportInterventions,
    ...representationControls,
  ];
}

function formatTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Product-local raw timestamp boundary catalog. Each mutation changes one
 * event timestamp while retaining all other raw/support/configuration state.
 * The values surround every currently declared second/minute/hour/half-day
 * threshold family and explicit local calendar/DST joints.
 */
export function buildRawBoundaryInterventions(): ArtifactIntervention[] {
  const gapSeconds = [
    0, 1, 2, 29, 30, 31, 59, 60, 61, 119, 120, 121, 299, 300, 301, 3_599,
    3_600, 3_601, 43_199, 43_200, 43_201,
  ];
  const gaps = gapSeconds.map<ArtifactIntervention>((seconds) => ({
    id: `raw-boundary:adjacent-gap:${seconds}s`,
    roleId: "raw_chronicle_csv",
    mutationClass: "boundary-edit",
    changedComponents: [
      "raw.row[second-application-event].event_timestamp",
      `boundary.adjacent_gap_seconds.${seconds}`,
    ],
    sourceFields: ["raw_chronicle_csv.event_timestamp"],
    description: `Move the second application event to exactly ${seconds} second(s) after the first`,
    expectedSemanticEffect: "required",
    apply: (source) =>
      mutateRawTable(source, (table) => {
        const rows = table.rows.filter((row) => packageColumn(row) !== "android");
        const firstRowTimestamp = rows[0]?.event_timestamp;
        if (firstRowTimestamp === undefined) {
          throw new Error("boundary fixture needs an application event");
        }
        const origin = new Date(`${firstRowTimestamp.replace(" ", "T")}Z`);
        if (Number.isNaN(origin.valueOf())) {
          throw new Error(`invalid boundary origin ${firstRowTimestamp}`);
        }
        const desired = formatTimestamp(new Date(origin.valueOf() + seconds * 1_000));
        const target = rows.find((row, index) => {
          if (index === 0) return false;
          const current = new Date(`${(row.event_timestamp ?? "").replace(" ", "T")}Z`);
          return !Number.isNaN(current.valueOf()) && current.valueOf() !== origin.valueOf() + seconds * 1_000;
        });
        if (!target) {
          throw new Error(`boundary fixture has no event distinct from ${desired}`);
        }
        target.event_timestamp = desired;
      }),
  }));
  const calendarJoints: Array<[label: string, timestamp: string]> = [
    ["spring-forward-before", "2026-03-08 01:59:59"],
    ["spring-forward-after", "2026-03-08 03:00:00"],
    ["fall-back-before", "2026-11-01 00:59:59"],
    ["fall-back-after", "2026-11-01 02:00:00"],
    ["day-end", "2026-06-15 23:59:59"],
    ["day-start", "2026-06-16 00:00:00"],
  ];
  const calendarValues = calendarJoints.map<ArtifactIntervention>(([label, timestamp]) => ({
    id: `raw-boundary:calendar:${label}`,
    roleId: "raw_chronicle_csv",
    mutationClass: "boundary-edit",
    changedComponents: [
      "raw.row[application-event].event_timestamp",
      `boundary.calendar.${label}`,
    ],
    sourceFields: ["raw_chronicle_csv.event_timestamp"],
    description: `Move one application event to the ${label} calendar joint`,
    expectedSemanticEffect: "required",
    apply: (source) =>
      mutateRawTable(source, (table) => {
        firstApplicationRow(table).event_timestamp = timestamp;
      }),
  }));
  return [...gaps, ...calendarValues];
}
