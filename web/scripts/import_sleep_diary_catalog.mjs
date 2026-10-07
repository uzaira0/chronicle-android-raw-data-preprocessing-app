// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const sleepRoot = process.env.SLEEP_SCORING_WEB_ROOT
  ? resolve(process.env.SLEEP_SCORING_WEB_ROOT)
  : resolve(repoRoot, "../sleep-scoring-web");
const sourceCatalogPath = resolve(sleepRoot, "frontend/src/generated/diary-instrument-catalog.ts");
const sourceStatusPath = resolve(sleepRoot, "shared/sleep-diary-sublation-status.json");
const outputPath = resolve(repoRoot, "web/schema/sleep-diary-catalog.bridge.json");
const targetSpecs = [
  {
    versionDefinitionId: "version-zenodo-sleepdiaries-v1.1.3",
    mappingProfileId: "sleepdiaries-v1-csv",
    adapterId: "direct-tabular-csv-v1",
    mappingProfileVersion: "1.1.3",
    fixtureId: "sleepdiaries-v1-csv-basic",
    blockerCount: 36,
    counts: { diaryItems: 41, responseDefinitions: 41, formElements: 27, diaryScheduleRules: 8, administrationSchedules: 8, ruleDefinitions: 33 },
  },
  {
    versionDefinitionId: "version-zenodo-minap-v1.0",
    mappingProfileId: "minap-v1-event-sheet",
    adapterId: "chronological-event-pairing-v1",
    mappingProfileVersion: "1.0",
    fixtureId: "minap-v1-event-pairing-basic",
    blockerCount: 29,
    counts: { diaryItems: 16, responseDefinitions: 16, formElements: 15, diaryScheduleRules: 3, administrationSchedules: 3, ruleDefinitions: 35 },
  },
  {
    versionDefinitionId: "version-zenodo-sleepdiaries-v1.1.3",
    mappingProfileId: "sleepdiaries-v1-json",
    adapterId: "keyed-object-json-v1",
    mappingProfileVersion: "1.1.3",
    fixtureId: "sleepdiaries-v1-json-basic",
    blockerCount: 36,
    counts: { diaryItems: 41, responseDefinitions: 41, formElements: 27, diaryScheduleRules: 8, administrationSchedules: 8, ruleDefinitions: 33 },
  },
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const sourceCatalogText = readFileSync(sourceCatalogPath, "utf8");
const sourceStatusText = readFileSync(sourceStatusPath, "utf8");
const sourceSha = sourceCatalogText.match(/DIARY_INSTRUMENT_CATALOG_SOURCE_SHA256 = "([0-9a-f]{64})";/)?.[1];
const catalogPrefix = "export const DIARY_INSTRUMENT_CATALOG: DiaryInstrumentCatalog = ";
const catalogStart = sourceCatalogText.indexOf(catalogPrefix);
if (!sourceSha || catalogStart < 0) throw new Error("Sleep Scoring generated catalog identity is missing");
const catalog = JSON.parse(sourceCatalogText.slice(catalogStart + catalogPrefix.length).trim().replace(/;$/, ""));
const status = JSON.parse(sourceStatusText);
if (status.catalogSourceSha256 !== sourceSha) throw new Error("Sleep Scoring catalog and sublation status disagree");
if (catalog.instrumentVersions.length !== 82 || status.counts.retainedVariants !== 82) {
  throw new Error("Sleep Scoring retained-variant boundary changed");
}

const methodByVersion = new Map(catalog.sourceMethodVariants.map((row) => [row.versionDefinitionId, row]));
const blockersByVersion = new Map(status.blockedVariants.map((row) => [row.versionDefinitionId, row.blockerCodes]));
const mappingsByVersion = new Map();
for (const mapping of catalog.sourceMappingProfiles) {
  const current = mappingsByVersion.get(mapping.version_definition_id) ?? [];
  current.push(mapping.mapping_profile_id);
  mappingsByVersion.set(mapping.version_definition_id, current);
}
const variants = catalog.instrumentVersions.map((version) => {
  const method = methodByVersion.get(version.id);
  const blockerCodes = blockersByVersion.get(version.id);
  if (!method || !blockerCodes?.length) throw new Error(`Variant is not explicitly blocked: ${version.id}`);
  return {
    versionDefinitionId: version.id,
    sourceMethodVariantId: method.id,
    label: version.name,
    versionLabel: version.versionLabel,
    profileExecutionStatus: "blocked",
    blockerCodes,
    releasedSourceLayoutIds: [...(mappingsByVersion.get(version.id) ?? [])].sort(),
  };
}).sort((left, right) => left.versionDefinitionId.localeCompare(right.versionDefinitionId));

const supportedProfiles = targetSpecs.map((spec) => {
  const composition = [];
  for (let versionId = spec.versionDefinitionId; versionId;) {
    if (composition.includes(versionId)) throw new Error("Sleep diary host lineage contains a cycle");
    composition.unshift(versionId);
    versionId = methodByVersion.get(versionId)?.hostVersionDefinitionId ?? "";
  }
  const compositionIds = new Set(composition);
  const belongsToComposition = (row) => compositionIds.has(row.versionDefinitionId ?? row.version_definition_id ?? row.protocolId);
  const mappingProfile = catalog.sourceMappingProfiles.find((row) => (
    row.version_definition_id === spec.versionDefinitionId
    && row.mapping_profile_id === spec.mappingProfileId
  ));
  const fixtureIds = mappingProfile?.conformance_fixture_ids ?? [];
  const conformanceFixture = fixtureIds.length === 1
    ? catalog.sourceConformanceFixtures.find((row) => row.fixture_id === fixtureIds[0])
    : undefined;
  const instrumentVersion = catalog.instrumentVersions.find((row) => row.id === spec.versionDefinitionId);
  const sourceMethodVariant = methodByVersion.get(spec.versionDefinitionId);
  const diaryProtocol = catalog.diaryProtocols.find((row) => row.versionDefinitionId === spec.versionDefinitionId);
  const blockerCodes = blockersByVersion.get(spec.versionDefinitionId);
  if (!mappingProfile || !conformanceFixture || !instrumentVersion || !sourceMethodVariant || !diaryProtocol || !blockerCodes) {
    throw new Error(`Sleep diary bridge inputs are incomplete: ${spec.versionDefinitionId}`);
  }
  if (sourceMethodVariant.id !== spec.versionDefinitionId
    || blockerCodes.length !== spec.blockerCount
    || mappingProfile.mapping_profile_version !== spec.mappingProfileVersion
    || mappingProfile.execution_adapter_id !== spec.adapterId
    || mappingProfile.execution_adapter_version !== "1"
    || conformanceFixture.fixture_id !== spec.fixtureId
    || conformanceFixture.mapping_profile_id !== spec.mappingProfileId
    || conformanceFixture.execution_adapter_id !== spec.adapterId
    || conformanceFixture.execution_adapter_version !== "1") {
    throw new Error(`Sleep diary adapter identity changed: ${spec.versionDefinitionId}`);
  }
  const profile = {
    versionDefinitionId: spec.versionDefinitionId,
    sourceMethodVariantId: sourceMethodVariant.id,
    compositionVersionDefinitionIds: composition,
    profileExecutionStatus: "blocked",
    blockerCodes,
    layoutExecutionStatus: "fixture_verified",
    instrumentVersion,
    sourceMethodVariant,
    diaryProtocol,
    diaryItems: catalog.diaryItems.filter(belongsToComposition),
    diaryScheduleRules: catalog.diaryScheduleRules.filter(belongsToComposition),
    formElements: catalog.formElements.filter(belongsToComposition),
    responseDefinitions: catalog.responseDefinitions.filter(belongsToComposition),
    administrationSchedules: catalog.administrationSchedules.filter(belongsToComposition),
    ruleDefinitions: catalog.ruleDefinitions.filter(belongsToComposition),
    mappingProfile,
    conformanceFixture,
  };
  for (const [key, expected] of Object.entries(spec.counts)) {
    if (profile[key].length !== expected) {
      throw new Error(`Sleep diary ${spec.versionDefinitionId} ${key} count changed: ${profile[key].length} != ${expected}`);
    }
  }
  return profile;
});

const bridge = {
  schemaVersion: "chronicle-sleep-diary-catalog-bridge-v2",
  authority: {
    catalogId: catalog.catalogId,
    catalogVersion: catalog.catalogVersion,
    catalogSourceSha256: sourceSha,
    sourceGeneratedArtifact: "frontend/src/generated/diary-instrument-catalog.ts",
    sourceGeneratedArtifactSha256: sha256(sourceCatalogText),
    sourceStatusArtifact: "shared/sleep-diary-sublation-status.json",
    sourceStatusSha256: sha256(sourceStatusText),
  },
  variants,
  supportedProfiles,
};
const output = `${JSON.stringify({ ...bridge, bridgePayloadSha256: sha256(stable(bridge)) }, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== output) throw new Error("Sleep diary bridge catalog is stale");
} else {
  writeFileSync(outputPath, output);
}
console.log(`sleep diary bridge: ${variants.length} blocked variants, ${supportedProfiles.length} fixtures imported`);
