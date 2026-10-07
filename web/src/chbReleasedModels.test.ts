import { describe, expect, it } from "vitest";

import registry from "@/generated/literature-external-executor-registry.json" with { type: "json" };
import runtimeRegistry from "@/generated/android-method-profile-runtime-registry.json" with { type: "json" };
import { literatureExternalExecutionForSelection } from "@/lib/literatureExternalExecutors";
import sourceProof from "@/evidence/chb_released_models_source.json" with { type: "json" };

const executor = registry.executors.find(
  (candidate) => candidate.source_work_id === sourceProof.source_work_id,
);

describe("released-data analysis execution for DOI 10.1016/j.chb.2023.107977", () => {
  it("keeps the corrected PhoneStudy input and five-second prose documentary", () => {
    const profile = runtimeRegistry.profiles.find(
      (candidate) => candidate.source_work_id === sourceProof.source_work_id,
    );
    const documentary = profile?.protocol_documentary_bindings ?? [];
    const input = documentary.find(
      (binding) => binding.setting_id === "atomic-bc7544176806c9eac5bab762",
    );
    const prose = documentary.find(
      (binding) => binding.setting_id === "method-setting-fb6f6a598d30f304909ffb88",
    );
    expect(input?.registry_input.method_value_json).toContain("raw time-stamped PhoneStudy event rows");
    expect(input?.registry_input.method_value_json).not.toContain("accessibility");
    expect(input?.execution_eligible).toBe(false);
    expect(prose?.registry_input.method_value_json).toContain("Count screen events that occur within 5 seconds");
    expect(prose?.execution_eligible).toBe(false);
    expect(profile?.registered_components.find(
      (component) => component.component_id === "chronicle.schoedel-screen-preprocessing/v1",
    )?.setting_ids).toContain("method-setting-21088bd2743bd3054e5fbb5b");
  });

  it("binds exactly the 68 executed campaign model cells to the pinned receipt", () => {
    expect(executor).toBeDefined();
    expect(executor).toMatchObject({
      executor_id: sourceProof.executor.executor_id,
      executor_version: sourceProof.executor.executor_version,
      runtime: sourceProof.executor.runtime,
      container_image_digest: sourceProof.executor.container_image_digest,
      method_profile_id: sourceProof.method_profile_id,
      source_work_id: sourceProof.source_work_id,
      source_method_variant_id: sourceProof.source_method_variant_id,
      method_profile_version: sourceProof.method_profile_version,
      semantic_digest: sourceProof.executor.semantic_digest_sha256,
    });

    const expectedConfigurationIds = sourceProof.configuration_groups.flatMap(
      (group) => group.configuration_ids,
    );
    const actualConfigurationIds = executor!.configurations.map(
      (configuration) => configuration.source_configuration_id,
    );
    expect([...actualConfigurationIds].sort()).toEqual(
      [...expectedConfigurationIds].sort(),
    );
    expect(new Set(actualConfigurationIds).size).toBe(
      sourceProof.counts.executed_configurations,
    );

    for (const group of sourceProof.configuration_groups) {
      const groupConfigurations = executor!.configurations.filter(
        (configuration) => configuration.receipt_id === group.receipt_id,
      );
      expect(
        groupConfigurations.map(
          (configuration) => configuration.source_configuration_id,
        ),
      ).toEqual(group.configuration_ids);
    }

    for (const configuration of executor!.configurations) {
      expect(configuration).toMatchObject({
        configuration_unit_kind:
          sourceProof.execution_boundary.configuration_unit_kind,
        binding_kind: sourceProof.execution_boundary.binding_kind,
        conformance_fixture_id: sourceProof.executor.fixture_id,
        conformance_result_digest: sourceProof.executor.semantic_digest_sha256,
        execution_receipt_sha256: sourceProof.executor.execution_receipt_sha256,
      });
      expect(configuration.external_setting_ids).toEqual(
        configuration.executable_setting_ids,
      );
      expect(configuration.external_setting_ids.length).toBeGreaterThan(0);
      expect(configuration.model_name.length).toBeGreaterThan(0);
      expect(configuration.formula.length).toBeGreaterThan(0);
      expect(configuration.observations).toBeGreaterThan(0);
      expect(configuration).not.toHaveProperty("selection");
      expect(configuration).not.toHaveProperty("selected_level_ids");
      expect(
        literatureExternalExecutionForSelection({
          methodProfileId: executor!.method_profile_id,
          sourceWorkId: executor!.source_work_id,
          sourceMethodVariantId: executor!.source_method_variant_id,
          sourceMethodVariantIds: [configuration.source_configuration_id],
          methodProfileVersion: executor!.method_profile_version,
        }),
      ).toBeUndefined();
    }
  });

  it("claims exactly the source-backed settings and leaves raw reconstruction blocked", () => {
    const actualSettingIds = [
      ...new Set(
        executor!.configurations.flatMap(
          (configuration) => configuration.executable_setting_ids,
        ),
      ),
    ].sort();
    expect(actualSettingIds).toEqual(sourceProof.executable_setting_ids);
    expect(actualSettingIds).toHaveLength(
      sourceProof.counts.unique_executable_settings,
    );

    const registeredConfigurationIds = new Set(
      executor!.configurations.map(
        (configuration) => configuration.source_configuration_id,
      ),
    );
    for (const blocked of sourceProof.blocked_source_configurations) {
      expect(registeredConfigurationIds.has(blocked.configuration_id)).toBe(
        false,
      );
    }
    expect(
      sourceProof.counts.executed_configurations +
        sourceProof.counts.blocked_source_configurations,
    ).toBe(sourceProof.counts.source_configurations);
    expect(sourceProof.execution_boundary.does_not_claim).toContain(
      "private timestamped Android",
    );
  });
});
