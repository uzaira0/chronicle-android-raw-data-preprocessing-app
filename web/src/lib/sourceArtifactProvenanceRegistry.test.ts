import { describe, expect, it } from "vitest";

import registry from "@/generated/source-artifact-provenance-registry.json" with { type: "json" };
import androidRegistry from "@/generated/android-method-profile-runtime-registry.json" with { type: "json" };
import {
  androidMethodProfileRegisteredComponents,
  methodProfileOutputBindingForSetting,
  methodProfileOutputBindingProfileIdentityForSetting,
  methodProfileTypedSectionMatchesRegistry,
  profileProtocolDocumentaryBindingForSetting,
  profileProtocolProfileIdentityForSetting,
  registerSourceArtifactProvenance,
  sourceArtifactProvenanceJcsDigest,
  validateMethodProfileDocumentaryBinding,
  validateMethodProfileOutputBindings,
  validateSourceArtifactProvenanceRegistry,
} from "@/lib/sourceArtifactProvenanceRegistry";

describe("source artifact provenance closed registry", () => {
  it("validates the exact 19-row, 18-ready, one-blocked generated registry", async () => {
    await expect(validateSourceArtifactProvenanceRegistry()).resolves.toBeUndefined();
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.rows[0])).toBe(true);
    expect(registry.rows).toHaveLength(19);
    expect(
      registry.rows.filter(
        (row) => row.candidate_status === "ready_for_typed_registry",
      ),
    ).toHaveLength(18);
    expect(registry.source_packet.blocked_method_setting_ids)
      .toEqual(["method-setting-ba42e53a2bb684a034aa67e0"]);
    expect(registry.source_packet.packet_manifest_sha256)
      .toBe("sha256:54fe6f58398f34e66377950dfc53ba37f1225f3b7ee6255f48c22f69fdc1c10e");
    expect(registry.source_packet.selected_immutable_source_projection_sha256)
      .toBe("sha256:acc53ad3dc930ed7e3d7a3c620e7a42c7132b36f34c8966dbe4efce4ffebe297");
    expect(registry.profile_identities).toEqual([
      { method_profile_id: "method-profile:doi:10.1016/j.chb.2023.107977", source_work_id: "doi:10.1016/j.chb.2023.107977", source_method_variant_id: "source-configuration-space-8b14e63d69954819163df993", method_profile_version: "literature-sublation-v3-atomic" },
      { method_profile_id: "method-profile:doi:10.1080/15213269.2020.1768122", source_work_id: "doi:10.1080/15213269.2020.1768122", source_method_variant_id: "source-configuration-space-9a5dfdec15e1a632fd9a13f4", method_profile_version: "literature-sublation-v3-atomic" },
      { method_profile_id: "method-profile:doi:10.1177/00936502241276793", source_work_id: "doi:10.1177/00936502241276793", source_method_variant_id: "source-configuration-space-e9ce7cff19d18e050e47a180", method_profile_version: "literature-sublation-v3-atomic" },
    ]);
  });

  it("replays all positive receipt fixtures with exact JCS digests", async () => {
    for (const fixture of registry.positive_fixtures) {
      expect(await sourceArtifactProvenanceJcsDigest(fixture.input))
        .toBe(fixture.case_digest);
      const result = await registerSourceArtifactProvenance(fixture.input);
      expect(result).toEqual(fixture.expected_result);
      expect(await sourceArtifactProvenanceJcsDigest(result)).toBe(fixture.result_digest);
    }
  });

  it("rejects all 11 identity, digest, selector, version, and key forgeries", async () => {
    expect(registry.negative_fixtures).toHaveLength(11);
    for (const fixture of registry.negative_fixtures) {
      expect(await sourceArtifactProvenanceJcsDigest(fixture.input))
        .toBe(fixture.case_digest);
      const result = await registerSourceArtifactProvenance(fixture.input);
      expect(result).toEqual(fixture.expected_result);
      expect(await sourceArtifactProvenanceJcsDigest(result)).toBe(fixture.result_digest);
    }
  });

  it("closes every generated profile-protocol documentary binding over exact profile identity", () => {
    const bindings = androidRegistry.profiles.flatMap((profile) => profile.protocol_documentary_bindings);
    expect(bindings).toHaveLength(androidRegistry.summary.protocol_documentary_binding_count);
    for (const { setting_id: settingId } of bindings) {
      const binding = profileProtocolDocumentaryBindingForSetting(settingId)!;
      const identity = profileProtocolProfileIdentityForSetting(settingId)!;
      const receiptIdentity = {
        methodProfileId: identity.method_profile_id,
        sourceWorkId: identity.source_work_id,
        sourceMethodVariantId: identity.source_method_variant_id,
        methodProfileVersion: identity.method_profile_version,
      };
      expect(validateMethodProfileDocumentaryBinding(binding, receiptIdentity)).toBe(true);
      expect(validateMethodProfileDocumentaryBinding({
        ...binding,
        conformanceResultDigest: `sha256:${"0".repeat(64)}`,
      }, receiptIdentity)).toBe(false);
      expect(validateMethodProfileDocumentaryBinding(binding, {
        ...receiptIdentity,
        methodProfileId: "forged",
      })).toBe(false);
    }
  });

  it("closes every generated source-output mapping over its exact tuple and profile identity", () => {
    const profiles = androidRegistry.profiles as Array<(typeof androidRegistry.profiles)[number] & {
      output_bindings?: Array<{ setting_id: string }>;
    }>;
    const settingIds = profiles.flatMap((profile) => profile.output_bindings ?? [])
      .map((binding) => binding.setting_id);
    const expectedCount = (androidRegistry.summary as typeof androidRegistry.summary & { output_binding_count?: number })
      .output_binding_count ?? 0;
    expect(settingIds).toHaveLength(expectedCount);
    for (const settingId of settingIds) {
      const binding = methodProfileOutputBindingForSetting(settingId)!;
      const profile = methodProfileOutputBindingProfileIdentityForSetting(settingId)!;
      const identity = {
        methodProfileId: profile.method_profile_id,
        sourceWorkId: profile.source_work_id,
        sourceMethodVariantId: profile.source_method_variant_id,
        methodProfileVersion: profile.method_profile_version,
      };
      expect(validateMethodProfileOutputBindings([binding], identity, [settingId])).toBe(true);
      expect(validateMethodProfileOutputBindings([], identity, [settingId])).toBe(false);
      expect(validateMethodProfileOutputBindings([{
        ...binding,
        canonicalField: `${binding.canonicalField}-forged`,
      }], identity, [settingId])).toBe(false);
      expect(validateMethodProfileOutputBindings([binding], {
        ...identity,
        methodProfileId: "forged",
      }, [settingId])).toBe(false);
    }
  });

  it("reconciles every typed section through exact generated projections", () => {
    expect(androidRegistry.profiles.reduce(
      (count, profile) => count + Object.keys(profile.typed_sections).length,
      0,
    )).toBe(androidRegistry.summary.typed_section_count);
    const withoutNestedSettings = androidRegistry.profiles.flatMap((profile) =>
      Object.entries(profile.typed_sections as Record<string, string>)
        .filter(([, projection]) => !projection.includes('"method_settings"'))
        .map(([section, projection]) => ({ profile, section, value: JSON.parse(projection) as unknown })));
    expect(withoutNestedSettings.length).toBeGreaterThan(0);
    for (const { profile, section, value } of withoutNestedSettings) {
      expect(methodProfileTypedSectionMatchesRegistry(profile, section, value, [])).toBe(true);
    }
    const { profile, section, value } = withoutNestedSettings[0]!;
    expect(methodProfileTypedSectionMatchesRegistry(profile, section, [
      ...value as unknown[],
      { forged: true },
    ], [])).toBe(false);
    expect(methodProfileTypedSectionMatchesRegistry({ ...profile, method_profile_id: "forged" }, section, value, [])).toBe(false);
  });

  it("returns registered components only for an identity the android registry carries", () => {
    const identity = androidRegistry.profiles[0]!;
    expect(androidMethodProfileRegisteredComponents(identity)).toEqual(
      identity.registered_components ?? [],
    );
    expect(androidMethodProfileRegisteredComponents({
      ...identity,
      method_profile_id: "forged",
    })).toEqual([]);
  });
});
