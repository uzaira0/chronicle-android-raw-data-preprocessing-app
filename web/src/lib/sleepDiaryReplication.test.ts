import { beforeAll, describe, expect, it } from "vitest";

import bridgeJson from "../../schema/sleep-diary-catalog.bridge.json" with { type: "json" };

import {
  SLEEP_DIARY_SETTING_ID,
  SLEEP_DIARY_SUPPORTED_PROFILE,
  SLEEP_DIARY_SUPPORTED_PROFILES,
  SLEEP_DIARY_VARIANTS,
  computeSleepDiaryBridgePayloadSha256,
  createSleepDiaryMethodProfileReceipt,
  executeSleepDiariesCsvFixture,
  executeSleepDiaryFixture,
  sanitizeDiaryReplicationBinding,
  verifySleepDiaryBridgeAuthority,
} from "@/lib/sleepDiaryReplication";
import {
  loadMethodReceiptValidation,
  sanitizeMethodProfileReceipt,
} from "@/lib/settingsPersistence";

// Receipt validation loads on demand in the app (see loadMethodReceiptValidation);
// these tests validate receipts synchronously, as App does once it has loaded.
beforeAll(async () => {
  await loadMethodReceiptValidation();
});

const MINAP_ID = "version-zenodo-minap-v1.0";
const MINAP_MAPPING_ID = "minap-v1-event-sheet";
const SLEEP_DIARIES_JSON_MAPPING_ID = "sleepdiaries-v1-json";

describe("Sleep Scoring diary bridge", () => {
  it("keeps all 82 variants explicit and all fixture profiles fail-closed", () => {
    expect(SLEEP_DIARY_VARIANTS).toHaveLength(82);
    expect(SLEEP_DIARY_VARIANTS.every((variant) => (
      variant.profileExecutionStatus === "blocked" && variant.blockerCodes.length > 0
    ))).toBe(true);
    expect(SLEEP_DIARY_SUPPORTED_PROFILES).toHaveLength(3);
    expect(SLEEP_DIARY_SUPPORTED_PROFILE.blockerCodes).toHaveLength(36);
    expect(SLEEP_DIARY_SUPPORTED_PROFILES[1]).toMatchObject({
      versionDefinitionId: MINAP_ID,
      profileExecutionStatus: "blocked",
      layoutExecutionStatus: "fixture_verified",
    });
    expect(SLEEP_DIARY_SUPPORTED_PROFILES[1]!.blockerCodes).toHaveLength(29);
    expect(SLEEP_DIARY_SUPPORTED_PROFILES[2]).toMatchObject({
      versionDefinitionId: SLEEP_DIARY_SUPPORTED_PROFILE.versionDefinitionId,
      profileExecutionStatus: "blocked",
      layoutExecutionStatus: "fixture_verified",
      mappingProfile: { mapping_profile_id: SLEEP_DIARIES_JSON_MAPPING_ID },
    });
  });

  it("recomputes the bridge digest and rejects content-only and self-consistent source mutations", async () => {
    expect(await computeSleepDiaryBridgePayloadSha256(bridgeJson)).toBe(bridgeJson.bridgePayloadSha256);
    await expect(verifySleepDiaryBridgeAuthority(bridgeJson)).resolves.toBeUndefined();

    const contentForgery = structuredClone(bridgeJson);
    contentForgery.supportedProfiles[1]!.conformanceFixture.input_text += "\n";
    await expect(verifySleepDiaryBridgeAuthority(contentForgery)).rejects.toThrow(
      "The generated Sleep Scoring diary bridge payload digest is invalid.",
    );

    const selfConsistentForgery = structuredClone(contentForgery);
    selfConsistentForgery.bridgePayloadSha256 = await computeSleepDiaryBridgePayloadSha256(selfConsistentForgery);
    await expect(verifySleepDiaryBridgeAuthority(selfConsistentForgery)).rejects.toThrow(
      "The generated Sleep Scoring diary bridge is unsupported or incomplete.",
    );
  });

  it("executes the shared SleepDiaries CSV fixture without changing its bytes", async () => {
    const receipt = await executeSleepDiariesCsvFixture();
    expect(receipt).toEqual({
      contractVersion: "diary-source-adapter-receipt-v1",
      mappingProfileId: "sleepdiaries-v1-csv",
      mappingProfileVersion: "1.1.3",
      adapterId: "direct-tabular-csv-v1",
      adapterVersion: "1",
      conformanceFixtureIds: ["sleepdiaries-v1-csv-basic"],
      sourceSha256: "9f8f287b9730d0bab3cd0beb0ca5dce14a21d8a02890dca174d7aa8f9d55b2dc",
      normalizedSha256: "9f8f287b9730d0bab3cd0beb0ca5dce14a21d8a02890dca174d7aa8f9d55b2dc",
    });
  });

  it("executes the exact SleepDiaries keyed-object JSON fixture", async () => {
    await expect(executeSleepDiaryFixture(
      SLEEP_DIARY_SUPPORTED_PROFILE.versionDefinitionId,
      SLEEP_DIARIES_JSON_MAPPING_ID,
    )).resolves.toEqual({
      contractVersion: "diary-source-adapter-receipt-v1",
      mappingProfileId: SLEEP_DIARIES_JSON_MAPPING_ID,
      mappingProfileVersion: "1.1.3",
      adapterId: "keyed-object-json-v1",
      adapterVersion: "1",
      conformanceFixtureIds: ["sleepdiaries-v1-json-basic"],
      sourceSha256: "dff812d78b3c0e4110cf3a359c3d523fd30cc635a7f3fd42e742d18571a411d3",
      normalizedSha256: "95fd59f4d79815cda57eaae68dc18505632db6a6160bb79ac5b3f4663b038d2e",
    });
  });

  it("executes the exact MiNap chronological pairing fixture", async () => {
    await expect(executeSleepDiaryFixture(MINAP_ID, MINAP_MAPPING_ID)).resolves.toEqual({
      contractVersion: "diary-source-adapter-receipt-v1",
      mappingProfileId: MINAP_MAPPING_ID,
      mappingProfileVersion: "1.0",
      adapterId: "chronological-event-pairing-v1",
      adapterVersion: "1",
      conformanceFixtureIds: ["minap-v1-event-pairing-basic"],
      sourceSha256: "d86b705334e83e808a50107b09dfaa168d267239c842abf93a1c4c83ee8abe89",
      normalizedSha256: "1b11aa4392b5409d8c96149ae27ffa42eb8144cc0fc9d8e3444b4840d958459d",
    });
  });

  it("builds, sanitizes, and persists exact blocked bindings for all profiles", async () => {
    const sleepDiaries = await createSleepDiaryMethodProfileReceipt();
    expect(sleepDiaries.settingIds).toEqual([SLEEP_DIARY_SETTING_ID]);
    expect(sleepDiaries.bindings).toEqual([]);
    expect(sleepDiaries.diaryReplicationBinding).toMatchObject({
      profileExecutionStatus: "blocked",
      blockerCodes: expect.any(Array) as unknown,
      diaryItemCount: 41,
      formElementCount: 27,
      scheduleRuleCount: 8,
      administrationScheduleCount: 8,
      ruleDefinitionCount: 33,
    });
    const minap = await createSleepDiaryMethodProfileReceipt(MINAP_ID, MINAP_MAPPING_ID);
    expect(minap.settingIds).toEqual([
      "sleep-diary-setting:version-zenodo-minap-v1.0:source-layout:minap-v1-event-sheet",
    ]);
    expect(minap.bindings).toEqual([]);
    expect(minap.diaryReplicationBinding).toMatchObject({
      profileExecutionStatus: "blocked",
      diaryItemCount: 16,
      formElementCount: 15,
      scheduleRuleCount: 3,
      administrationScheduleCount: 3,
      ruleDefinitionCount: 35,
    });
    expect(minap.diaryReplicationBinding?.blockerCodes).toHaveLength(29);
    const sleepDiariesJson = await createSleepDiaryMethodProfileReceipt(
      SLEEP_DIARY_SUPPORTED_PROFILE.versionDefinitionId,
      SLEEP_DIARIES_JSON_MAPPING_ID,
    );
    expect(sleepDiariesJson.settingIds).toEqual([
      "sleep-diary-setting:version-zenodo-sleepdiaries-v1.1.3:source-layout:sleepdiaries-v1-json",
    ]);
    expect(sleepDiariesJson.diaryReplicationBinding).toMatchObject({
      mappingProfileId: SLEEP_DIARIES_JSON_MAPPING_ID,
      fixtureId: "sleepdiaries-v1-json-basic",
      profileExecutionStatus: "blocked",
    });
    expect(sleepDiariesJson.diaryReplicationBinding?.blockerCodes).toHaveLength(36);
    expect(sanitizeMethodProfileReceipt(sleepDiariesJson)).toEqual(sleepDiariesJson);
    expect(sanitizeDiaryReplicationBinding(minap.diaryReplicationBinding)).toEqual(minap.diaryReplicationBinding);
    expect(sanitizeMethodProfileReceipt(minap)).toEqual(minap);
  });

  it("rejects digest, unknown-key, cross-variant, and outer-identity forgeries", async () => {
    const minap = await createSleepDiaryMethodProfileReceipt(MINAP_ID, MINAP_MAPPING_ID);
    const sleepDiaries = await createSleepDiaryMethodProfileReceipt();
    const forgedDigest = structuredClone(minap.diaryReplicationBinding!);
    forgedDigest.fixtureInputSha256 = "0".repeat(64);
    expect(sanitizeDiaryReplicationBinding(forgedDigest)).toBeUndefined();

    const unknownOuter = { ...minap.diaryReplicationBinding!, unknown: true };
    expect(sanitizeDiaryReplicationBinding(unknownOuter)).toBeUndefined();
    const unknownInner = structuredClone(minap.diaryReplicationBinding!) as typeof minap.diaryReplicationBinding & {
      sourceAdapterReceipt: Record<string, unknown>;
    };
    unknownInner.sourceAdapterReceipt.unknown = true;
    expect(sanitizeDiaryReplicationBinding(unknownInner)).toBeUndefined();

    const crossVariant = structuredClone(minap.diaryReplicationBinding!);
    crossVariant.mappingProfileId = sleepDiaries.diaryReplicationBinding!.mappingProfileId;
    crossVariant.sourceAdapterReceipt = sleepDiaries.diaryReplicationBinding!.sourceAdapterReceipt;
    expect(sanitizeDiaryReplicationBinding(crossVariant)).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...minap, diaryReplicationBinding: crossVariant })).toBeUndefined();

    expect(sanitizeMethodProfileReceipt({ ...minap, sourceWorkId: "work-forged" })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...minap, sourceMethodVariantId: "version-forged" })).toBeUndefined();
  });
});
