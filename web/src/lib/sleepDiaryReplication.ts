import Papa from "papaparse";

import { requireDefined } from "./invariant";
import bridgeJson from "../../schema/sleep-diary-catalog.bridge.json" with { type: "json" };
import type {
  DiaryReplicationBindingReceipt,
  DiarySourceAdapterReceipt,
  MethodProfileReceipt,
} from "@/lib/types";

type BridgeVariant = {
  versionDefinitionId: string;
  sourceMethodVariantId: string;
  label: string;
  versionLabel: string;
  profileExecutionStatus: "blocked";
  blockerCodes: string[];
  releasedSourceLayoutIds: string[];
};

type SourceSelector = {
  selector_id: string;
  source_field_name: string;
  source_field_position?: number;
  source_part_id?: string;
  source_path?: string;
};

type DiaryFormElement = {
  form_element_definition_id: string;
  element_kind: string;
  display_order: number;
  display_text?: string;
  response_control?: string;
};

type DiaryScheduleRule = {
  id: string;
  administrationTimingLexical: string | null;
  dayBoundaryRuleLexical: string | null;
  blockers: string[];
};

export type SleepDiaryBridgeProfile = {
  versionDefinitionId: string;
  sourceMethodVariantId: string;
  compositionVersionDefinitionIds: string[];
  profileExecutionStatus: "blocked";
  blockerCodes: string[];
  layoutExecutionStatus: "fixture_verified";
  sourceMethodVariant: { workId: string };
  diaryItems: unknown[];
  diaryScheduleRules: DiaryScheduleRule[];
  formElements: DiaryFormElement[];
  responseDefinitions: unknown[];
  administrationSchedules: unknown[];
  ruleDefinitions: unknown[];
  mappingProfile: {
    mapping_profile_id: string;
    mapping_profile_version: string;
    execution_adapter_id: string;
    execution_adapter_version: string;
    conformance_fixture_ids: string[];
    source_field_selectors: SourceSelector[];
    execution_output_selectors?: SourceSelector[];
    record_assembly?: { parameter_json?: string; record_root_path?: string };
  };
  conformanceFixture: {
    fixture_id: string;
    mapping_profile_id: string;
    execution_adapter_id: string;
    execution_adapter_version: string;
    input_text: string;
    input_sha256: string;
    expected_normalized_sha256: string;
    expected_output_headers: string[];
    expected_output_record_count: number;
  };
};

type SleepDiaryBridge = {
  schemaVersion: "chronicle-sleep-diary-catalog-bridge-v2";
  bridgePayloadSha256: string;
  authority: { catalogSourceSha256: string };
  variants: BridgeVariant[];
  supportedProfiles: SleepDiaryBridgeProfile[];
};

type SourceRow = Record<string, string>;

const bridge = bridgeJson as SleepDiaryBridge;
const TRUSTED_BRIDGE_PAYLOAD_SHA256 = "2e5862ec46c9ab6a2cbec57e22d1821555a71cd482188a8ab1d7b0a67b7b2f3a";
const EXPECTED_PROFILE_IDENTITIES = [
  {
    versionDefinitionId: "version-zenodo-sleepdiaries-v1.1.3",
    sourceMethodVariantId: "version-zenodo-sleepdiaries-v1.1.3",
    sourceWorkId: "work-zenodo-sleepdiaries",
    mappingProfileId: "sleepdiaries-v1-csv",
    mappingProfileVersion: "1.1.3",
    adapterId: "direct-tabular-csv-v1",
    adapterVersion: "1",
    fixtureId: "sleepdiaries-v1-csv-basic",
    inputSha256: "9f8f287b9730d0bab3cd0beb0ca5dce14a21d8a02890dca174d7aa8f9d55b2dc",
    normalizedSha256: "9f8f287b9730d0bab3cd0beb0ca5dce14a21d8a02890dca174d7aa8f9d55b2dc",
    blockerCount: 36,
    counts: [41, 41, 27, 8, 8, 33],
  },
  {
    versionDefinitionId: "version-zenodo-minap-v1.0",
    sourceMethodVariantId: "version-zenodo-minap-v1.0",
    sourceWorkId: "work-zenodo-minap-go",
    mappingProfileId: "minap-v1-event-sheet",
    mappingProfileVersion: "1.0",
    adapterId: "chronological-event-pairing-v1",
    adapterVersion: "1",
    fixtureId: "minap-v1-event-pairing-basic",
    inputSha256: "d86b705334e83e808a50107b09dfaa168d267239c842abf93a1c4c83ee8abe89",
    normalizedSha256: "1b11aa4392b5409d8c96149ae27ffa42eb8144cc0fc9d8e3444b4840d958459d",
    blockerCount: 29,
    counts: [16, 16, 15, 3, 3, 35],
  },
  {
    versionDefinitionId: "version-zenodo-sleepdiaries-v1.1.3",
    sourceMethodVariantId: "version-zenodo-sleepdiaries-v1.1.3",
    sourceWorkId: "work-zenodo-sleepdiaries",
    mappingProfileId: "sleepdiaries-v1-json",
    mappingProfileVersion: "1.1.3",
    adapterId: "keyed-object-json-v1",
    adapterVersion: "1",
    fixtureId: "sleepdiaries-v1-json-basic",
    inputSha256: "dff812d78b3c0e4110cf3a359c3d523fd30cc635a7f3fd42e742d18571a411d3",
    normalizedSha256: "95fd59f4d79815cda57eaae68dc18505632db6a6160bb79ac5b3f4663b038d2e",
    blockerCount: 36,
    counts: [41, 41, 27, 8, 8, 33],
  },
] as const;

export const SLEEP_DIARY_VARIANTS = bridge.variants;
export const SLEEP_DIARY_SUPPORTED_PROFILES = bridge.supportedProfiles;
/** Backward-compatible default selection; the registry itself is multi-profile. */
export const SLEEP_DIARY_SUPPORTED_PROFILE = requireDefined(
  bridge.supportedProfiles[0],
  "the sleep-diary bridge ships at least one supported profile",
);
export const SLEEP_DIARY_SETTING_ID = sleepDiarySettingId(SLEEP_DIARY_SUPPORTED_PROFILE);

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function sha256Hex(text: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
}

/** Match the importer's stable JSON encoding exactly before WebCrypto hashing. */
function canonicalBridgeJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBridgeJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalBridgeJson(record[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Sleep diary bridge contains a non-JSON value.");
  return encoded;
}

export async function computeSleepDiaryBridgePayloadSha256(value: unknown): Promise<string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sleep diary bridge payload must be an object.");
  }
  const payload = { ...(value as Record<string, unknown>) };
  delete payload.bridgePayloadSha256;
  return sha256Hex(canonicalBridgeJson(payload));
}

function sleepDiarySettingId(profile: Pick<SleepDiaryBridgeProfile, "versionDefinitionId" | "mappingProfile">): string {
  return `sleep-diary-setting:${profile.versionDefinitionId}:source-layout:${profile.mappingProfile.mapping_profile_id}`;
}

function sleepDiarySupportedProfile(
  versionDefinitionId: string,
  mappingProfileId?: string,
): SleepDiaryBridgeProfile | undefined {
  const matches = bridge.supportedProfiles.filter((profile) => (
    profile.versionDefinitionId === versionDefinitionId
    && (mappingProfileId === undefined || profile.mappingProfile.mapping_profile_id === mappingProfileId)
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

export async function verifySleepDiaryBridgeAuthority(value: unknown = bridge): Promise<void> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The generated Sleep Scoring diary bridge is unsupported or incomplete.");
  }
  const candidate = value as SleepDiaryBridge;
  if (
    candidate.schemaVersion !== "chronicle-sleep-diary-catalog-bridge-v2"
    || candidate.bridgePayloadSha256 !== TRUSTED_BRIDGE_PAYLOAD_SHA256
    || !/^[0-9a-f]{64}$/.test(candidate.authority.catalogSourceSha256)
    || candidate.variants.length !== 82
    || candidate.variants.some((variant) => variant.profileExecutionStatus !== "blocked" || variant.blockerCodes.length === 0)
    || candidate.supportedProfiles.length !== EXPECTED_PROFILE_IDENTITIES.length
  ) throw new Error("The generated Sleep Scoring diary bridge is unsupported or incomplete.");
  for (const [index, expected] of EXPECTED_PROFILE_IDENTITIES.entries()) {
    const target = candidate.supportedProfiles[index];
    const variant = candidate.variants.find((row) => row.versionDefinitionId === expected.versionDefinitionId);
    if (!target
      || target.versionDefinitionId !== expected.versionDefinitionId
      || target.sourceMethodVariantId !== expected.sourceMethodVariantId
      || target.sourceMethodVariant.workId !== expected.sourceWorkId
      || target.compositionVersionDefinitionIds.length !== 1
      || target.compositionVersionDefinitionIds[0] !== expected.versionDefinitionId
      || target.profileExecutionStatus !== "blocked"
      || target.layoutExecutionStatus !== "fixture_verified"
      || target.blockerCodes.length !== expected.blockerCount
      || target.mappingProfile.mapping_profile_id !== expected.mappingProfileId
      || target.mappingProfile.mapping_profile_version !== expected.mappingProfileVersion
      || target.mappingProfile.execution_adapter_id !== expected.adapterId
      || target.mappingProfile.execution_adapter_version !== expected.adapterVersion
      || JSON.stringify(target.mappingProfile.conformance_fixture_ids) !== JSON.stringify([expected.fixtureId])
      || target.conformanceFixture.fixture_id !== expected.fixtureId
      || target.conformanceFixture.mapping_profile_id !== expected.mappingProfileId
      || target.conformanceFixture.execution_adapter_id !== expected.adapterId
      || target.conformanceFixture.execution_adapter_version !== expected.adapterVersion
      || target.conformanceFixture.input_sha256 !== expected.inputSha256
      || target.conformanceFixture.expected_normalized_sha256 !== expected.normalizedSha256
      || JSON.stringify([
        target.diaryItems.length,
        target.responseDefinitions.length,
        target.formElements.length,
        target.diaryScheduleRules.length,
        target.administrationSchedules.length,
        target.ruleDefinitions.length,
      ]) !== JSON.stringify(expected.counts)
      || !variant
      || variant.sourceMethodVariantId !== target.sourceMethodVariantId
      || JSON.stringify(variant.blockerCodes) !== JSON.stringify(target.blockerCodes)
      || !variant.releasedSourceLayoutIds.includes(expected.mappingProfileId)
    ) throw new Error("The generated Sleep Scoring diary bridge is unsupported or incomplete.");
  }
  const observedDigest = await computeSleepDiaryBridgePayloadSha256(candidate);
  if (observedDigest !== TRUSTED_BRIDGE_PAYLOAD_SHA256) {
    throw new Error("The generated Sleep Scoring diary bridge payload digest is invalid.");
  }
}

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvText(headers: readonly string[], rows: readonly SourceRow[]): string {
  return [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvField(row[header] ?? "")).join(",")),
  ].join("\n") + "\n";
}

function parseExactCsv(profile: SleepDiaryBridgeProfile): { headers: string[]; rows: SourceRow[] } {
  const parsed = Papa.parse<string[]>(profile.conformanceFixture.input_text, { skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`Sleep diary CSV fixture is malformed: ${parsed.errors[0]?.message ?? "parse failure"}`);
  const [headers, ...records] = parsed.data;
  const selectors = profile.mappingProfile.source_field_selectors;
  const expectedHeaders = selectors.map((selector, index) => {
    if (selector.source_field_position !== index + 1) throw new Error("Sleep diary selector positions are not contiguous.");
    return selector.source_field_name;
  });
  if (!headers || JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
    throw new Error("Sleep diary CSV fixture header disagrees with the reviewed ordered schema.");
  }
  if (records.some((row) => row.length !== headers.length)) {
    throw new Error("Sleep diary CSV fixture record shape disagrees with its reviewed contract.");
  }
  return {
    headers,
    rows: records.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))),
  };
}

function adaptKeyedObjectJson(profile: SleepDiaryBridgeProfile): string {
  const mapping = profile.mappingProfile;
  if (mapping.record_assembly?.record_root_path !== "$.entries[*]") {
    throw new Error("The keyed-object diary root is not the reviewed entries array.");
  }
  const parsed = JSON.parse(profile.conformanceFixture.input_text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The keyed-object diary fixture is not an object.");
  }
  const entries = (parsed as Record<string, unknown>)["entries"];
  if (!Array.isArray(entries)) throw new Error("The keyed-object diary fixture has no entries array.");
  const selectors = mapping.source_field_selectors;
  const output = mapping.execution_output_selectors ?? [];
  const headers = output.map((selector, index) => {
    if (selector.source_field_position !== index + 1) {
      throw new Error("The keyed-object diary output positions are not contiguous.");
    }
    const source = selectors[index];
    if (!source || source.source_field_name !== selector.source_field_name) {
      throw new Error("The keyed-object diary source and output selectors disagree.");
    }
    const expectedPath = source.source_part_id === "entry"
      ? `$.${source.source_field_name}`
      : source.source_part_id === "answers"
        ? `$.answers.${source.source_field_name}`
        : "";
    if (source.source_path !== expectedPath) {
      throw new Error("The keyed-object diary selector path is not registered.");
    }
    return selector.source_field_name;
  });
  if (headers.length !== selectors.length) {
    throw new Error("The keyed-object diary selector vectors disagree.");
  }
  const rows = entries.map((entry): SourceRow => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("The keyed-object diary entries array contains a non-object.");
    }
    const record = entry as Record<string, unknown>;
    const answers = record["answers"];
    if (answers !== undefined && (answers === null || typeof answers !== "object" || Array.isArray(answers))) {
      throw new Error("The keyed-object diary answers member is not an object.");
    }
    return Object.fromEntries(selectors.map((selector) => {
      const value = selector.source_part_id === "entry"
        ? record[selector.source_field_name]
        : (answers as Record<string, unknown> | undefined)?.[selector.source_field_name];
      if (value === undefined || value === null) {
        return [selector.source_field_name, ""];
      }
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error("The keyed-object diary selector resolved to a non-scalar value.");
      }
      return [selector.source_field_name, String(value)];
    }));
  });
  return csvText(headers, rows);
}

function adaptChronologicalEvents(profile: SleepDiaryBridgeProfile): string {
  const { headers, rows } = parseExactCsv(profile);
  const parameters = JSON.parse(profile.mappingProfile.record_assembly?.parameter_json ?? "null") as unknown;
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)
    || (parameters as Record<string, unknown>)["sleep_event_type"] !== "SLEEP"
    || (parameters as Record<string, unknown>)["wake_event_type"] !== "WAKE") {
    throw new Error("chronological-event-pairing-v1 requires the reviewed SLEEP/WAKE parameters.");
  }
  const grouped = new Map<string, SourceRow[]>();
  for (const row of rows) {
    if (row["event_type"] !== "SLEEP" && row["event_type"] !== "WAKE") throw new Error("Event type must be SLEEP or WAKE.");
    const epoch = Number(row["event_epoch_ms"]);
    if (!Number.isSafeInteger(epoch)) throw new Error("Event epoch must be a safe integer number of milliseconds.");
    const key = JSON.stringify([row["study_id"], row["participant_id"]]);
    const group = grouped.get(key);
    if (group) group.push(row);
    else grouped.set(key, [row]);
  }
  const pairs: Array<{ sleep: SourceRow | null; wake: SourceRow | null }> = [];
  for (const events of grouped.values()) {
    events.sort((left, right) => Number(left["event_epoch_ms"]) - Number(right["event_epoch_ms"]));
    const groupPairs: Array<{ sleep: SourceRow | null; wake: SourceRow | null }> = [];
    let openSleep: SourceRow | null = null;
    for (const event of events) {
      if (event["event_type"] === "SLEEP") {
        if (openSleep) groupPairs.push({ sleep: openSleep, wake: null });
        openSleep = event;
      } else {
        groupPairs.push({ sleep: openSleep, wake: event });
        openSleep = null;
      }
    }
    if (openSleep) groupPairs.push({ sleep: openSleep, wake: null });
    pairs.push(...groupPairs.reverse());
  }
  const outputHeaders = [
    ...headers.map((header) => `sleep__${header}`),
    ...headers.map((header) => `wake__${header}`),
    "paired_sleep_duration_minutes",
  ];
  const declaredOutput = profile.mappingProfile.execution_output_selectors ?? [];
  if (declaredOutput.length !== outputHeaders.length || declaredOutput.some((selector, index) => (
    selector.source_field_position !== index + 1 || selector.source_field_name !== outputHeaders[index]
  ))) throw new Error("The declared pairing output selectors do not match the exact emitted header vector.");
  const outputRows = pairs.map(({ sleep, wake }): SourceRow => {
    const output: SourceRow = {};
    headers.forEach((header) => {
      output[`sleep__${header}`] = sleep?.[header] ?? "";
      output[`wake__${header}`] = wake?.[header] ?? "";
    });
    output["paired_sleep_duration_minutes"] = sleep && wake
      ? String(Math.round((Number(wake["event_epoch_ms"]) - Number(sleep["event_epoch_ms"])) / 60_000))
      : "";
    return output;
  });
  return csvText(outputHeaders, outputRows);
}

/**
 * Run the registered source-layout adapter a profile names over that profile's
 * own fixture text, returning the normalized CSV. `executeSleepDiaryFixture`
 * calls this for every profile of the digest-pinned generated bridge; it is
 * exported so each adapter's rules can be exercised against profile shapes the
 * pinned bridge does not contain.
 */
export function normalizeSleepDiaryProfile(profile: SleepDiaryBridgeProfile): string {
  const adapterId = profile.mappingProfile.execution_adapter_id;
  if (adapterId === "direct-tabular-csv-v1") {
    parseExactCsv(profile);
    return profile.conformanceFixture.input_text;
  }
  if (adapterId === "keyed-object-json-v1") return adaptKeyedObjectJson(profile);
  if (adapterId === "chronological-event-pairing-v1") return adaptChronologicalEvents(profile);
  throw new Error("The selected sleep diary source adapter is unsupported.");
}

/** Execute an exact registered source-layout adapter against its shared synthetic fixture. */
export async function executeSleepDiaryFixture(
  versionDefinitionId: string = SLEEP_DIARY_SUPPORTED_PROFILE.versionDefinitionId,
  mappingProfileId: string = SLEEP_DIARY_SUPPORTED_PROFILE.mappingProfile.mapping_profile_id,
): Promise<DiarySourceAdapterReceipt> {
  await verifySleepDiaryBridgeAuthority();
  const target = sleepDiarySupportedProfile(versionDefinitionId, mappingProfileId);
  if (!target) throw new Error("The selected sleep diary source layout is not registered.");
  const { mappingProfile: mapping, conformanceFixture: fixture } = target;
  const normalizedText = normalizeSleepDiaryProfile(target);
  const normalizedRows = Papa.parse<string[]>(normalizedText, { skipEmptyLines: true });
  if (normalizedRows.errors.length) throw new Error("The normalized sleep diary fixture is malformed.");
  const [outputHeaders, ...outputRows] = normalizedRows.data;
  if (!outputHeaders
    || JSON.stringify(outputHeaders) !== JSON.stringify(fixture.expected_output_headers)
    || outputRows.length !== fixture.expected_output_record_count
    || outputRows.some((row) => row.length !== outputHeaders.length)) {
    throw new Error("Sleep diary fixture output disagrees with its reviewed contract.");
  }
  const sourceSha256 = await sha256Hex(fixture.input_text);
  const normalizedSha256 = await sha256Hex(normalizedText);
  if (sourceSha256 !== fixture.input_sha256 || normalizedSha256 !== fixture.expected_normalized_sha256) {
    throw new Error("Sleep diary fixture digest verification failed.");
  }
  return {
    contractVersion: "diary-source-adapter-receipt-v1",
    mappingProfileId: mapping.mapping_profile_id,
    mappingProfileVersion: mapping.mapping_profile_version,
    adapterId: mapping.execution_adapter_id,
    adapterVersion: mapping.execution_adapter_version,
    conformanceFixtureIds: [...mapping.conformance_fixture_ids],
    sourceSha256,
    normalizedSha256,
  };
}

export async function executeSleepDiariesCsvFixture(): Promise<DiarySourceAdapterReceipt> {
  return executeSleepDiaryFixture();
}

export async function createSleepDiaryMethodProfileReceipt(
  versionDefinitionId: string = SLEEP_DIARY_SUPPORTED_PROFILE.versionDefinitionId,
  mappingProfileId: string = SLEEP_DIARY_SUPPORTED_PROFILE.mappingProfile.mapping_profile_id,
): Promise<MethodProfileReceipt> {
  const target = sleepDiarySupportedProfile(versionDefinitionId, mappingProfileId);
  if (!target) throw new Error("The selected sleep diary source layout is not registered.");
  const fixture = target.conformanceFixture;
  const mapping = target.mappingProfile;
  const settingId = sleepDiarySettingId(target);
  const sourceAdapterReceipt = await executeSleepDiaryFixture(versionDefinitionId, mapping.mapping_profile_id);
  return {
    methodProfileId: `chronicle-diary-replication:${target.versionDefinitionId}:${mapping.mapping_profile_id}`,
    sourceWorkId: target.sourceMethodVariant.workId,
    sourceMethodVariantId: target.sourceMethodVariantId,
    sourceMethodVariantIds: [target.sourceMethodVariantId],
    methodProfileVersion: "1",
    settingIds: [settingId],
    bindings: [],
    diaryReplicationBinding: {
      contractVersion: "chronicle-diary-replication-binding-v1",
      settingId,
      bridgePayloadSha256: bridge.bridgePayloadSha256,
      catalogSourceSha256: bridge.authority.catalogSourceSha256,
      versionDefinitionId: target.versionDefinitionId,
      sourceMethodVariantId: target.sourceMethodVariantId,
      mappingProfileId: mapping.mapping_profile_id,
      mappingProfileVersion: mapping.mapping_profile_version,
      adapterId: mapping.execution_adapter_id,
      adapterVersion: mapping.execution_adapter_version,
      fixtureId: fixture.fixture_id,
      fixtureInputSha256: fixture.input_sha256,
      fixtureNormalizedSha256: fixture.expected_normalized_sha256,
      profileExecutionStatus: "blocked",
      blockerCodes: [...target.blockerCodes],
      diaryItemCount: target.diaryItems.length,
      formElementCount: target.formElements.length,
      scheduleRuleCount: target.diaryScheduleRules.length,
      administrationScheduleCount: target.administrationSchedules.length,
      ruleDefinitionCount: target.ruleDefinitions.length,
      sourceAdapterReceipt,
    },
  };
}

export function sanitizeDiaryReplicationBinding(value: unknown): DiaryReplicationBindingReceipt | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!exactKeys(candidate, [
    "contractVersion", "settingId", "bridgePayloadSha256", "catalogSourceSha256",
    "versionDefinitionId", "sourceMethodVariantId", "mappingProfileId", "mappingProfileVersion",
    "adapterId", "adapterVersion", "fixtureId", "fixtureInputSha256", "fixtureNormalizedSha256",
    "profileExecutionStatus", "blockerCodes", "diaryItemCount", "formElementCount", "scheduleRuleCount",
    "administrationScheduleCount", "ruleDefinitionCount", "sourceAdapterReceipt",
  ])) return undefined;
  if (typeof candidate.versionDefinitionId !== "string" || typeof candidate.mappingProfileId !== "string") return undefined;
  const target = sleepDiarySupportedProfile(candidate.versionDefinitionId, candidate.mappingProfileId);
  if (!target) return undefined;
  const mapping = target.mappingProfile;
  const fixture = target.conformanceFixture;
  const receipt = candidate.sourceAdapterReceipt;
  if (
    candidate.contractVersion !== "chronicle-diary-replication-binding-v1"
    || candidate.settingId !== sleepDiarySettingId(target)
    || candidate.bridgePayloadSha256 !== bridge.bridgePayloadSha256
    || candidate.catalogSourceSha256 !== bridge.authority.catalogSourceSha256
    || candidate.sourceMethodVariantId !== target.sourceMethodVariantId
    || candidate.mappingProfileVersion !== mapping.mapping_profile_version
    || candidate.adapterId !== mapping.execution_adapter_id
    || candidate.adapterVersion !== mapping.execution_adapter_version
    || candidate.fixtureId !== fixture.fixture_id
    || candidate.fixtureInputSha256 !== fixture.input_sha256
    || candidate.fixtureNormalizedSha256 !== fixture.expected_normalized_sha256
    || candidate.profileExecutionStatus !== "blocked"
    || JSON.stringify(candidate.blockerCodes) !== JSON.stringify(target.blockerCodes)
    || candidate.diaryItemCount !== target.diaryItems.length
    || candidate.formElementCount !== target.formElements.length
    || candidate.scheduleRuleCount !== target.diaryScheduleRules.length
    || candidate.administrationScheduleCount !== target.administrationSchedules.length
    || candidate.ruleDefinitionCount !== target.ruleDefinitions.length
    || receipt === null || typeof receipt !== "object" || Array.isArray(receipt)
  ) return undefined;
  const adapter = receipt as Record<string, unknown>;
  if (
    !exactKeys(adapter, ["contractVersion", "mappingProfileId", "mappingProfileVersion", "adapterId", "adapterVersion", "conformanceFixtureIds", "sourceSha256", "normalizedSha256"])
    || adapter.contractVersion !== "diary-source-adapter-receipt-v1"
    || adapter.mappingProfileId !== mapping.mapping_profile_id
    || adapter.mappingProfileVersion !== mapping.mapping_profile_version
    || adapter.adapterId !== mapping.execution_adapter_id
    || adapter.adapterVersion !== mapping.execution_adapter_version
    || JSON.stringify(adapter.conformanceFixtureIds) !== JSON.stringify(mapping.conformance_fixture_ids)
    || adapter.sourceSha256 !== fixture.input_sha256
    || adapter.normalizedSha256 !== fixture.expected_normalized_sha256
  ) return undefined;
  return structuredClone(value) as DiaryReplicationBindingReceipt;
}

export function sleepDiaryReceiptIdentityMatches(
  methodProfileId: string,
  sourceWorkId: string,
  sourceMethodVariantId: string,
  methodProfileVersion: string,
  binding: DiaryReplicationBindingReceipt,
): boolean {
  const target = sleepDiarySupportedProfile(binding.versionDefinitionId, binding.mappingProfileId);
  return target !== undefined
    && methodProfileId === `chronicle-diary-replication:${target.versionDefinitionId}:${target.mappingProfile.mapping_profile_id}`
    && methodProfileVersion === "1"
    && sourceWorkId === target.sourceMethodVariant.workId
    && sourceMethodVariantId === target.sourceMethodVariantId
    && binding.sourceMethodVariantId === sourceMethodVariantId;
}
