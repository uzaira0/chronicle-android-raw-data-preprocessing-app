import { describe, expect, it } from "vitest";

import sourceProof from "@/evidence/emo_released_sample1_models_source.json" with { type: "json" };
import registry from "@/generated/literature-external-executor-registry.json" with { type: "json" };
import { literatureExternalExecutionForSelection } from "@/lib/literatureExternalExecutors";

const executor = registry.executors.find(
  (candidate) => candidate.source_work_id === sourceProof.source_work_id,
);

describe("released Sample-I models for DOI 10.1037/emo0001485", () => {
  it("binds exactly the six published-oracle model calls", () => {
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

    expect(executor!.configurations).toHaveLength(
      sourceProof.counts.executed_with_published_numeric_oracle,
    );
    expect(
      executor!.configurations.map(
        (configuration) => configuration.source_configuration_id,
      ),
    ).toEqual(
      sourceProof.configuration_bindings.map(
        (configuration) => configuration.configuration_id,
      ),
    );

    for (const expected of sourceProof.configuration_bindings) {
      const configuration = executor!.configurations.find(
        (candidate) =>
          candidate.source_configuration_id === expected.configuration_id,
      );
      expect(configuration).toMatchObject({
        configuration_unit_kind:
          sourceProof.execution_boundary.configuration_unit_kind,
        binding_kind: sourceProof.execution_boundary.binding_kind,
        external_setting_ids: expected.setting_ids,
        executable_setting_ids: expected.setting_ids,
        receipt_id: expected.receipt_id,
        model_name: expected.model_name,
        formula: expected.formula,
        observations: expected.observations,
        conformance_fixture_id: sourceProof.executor.fixture_id,
        conformance_result_digest: sourceProof.executor.semantic_digest_sha256,
        execution_receipt_sha256: sourceProof.executor.execution_receipt_sha256,
      });
      expect(configuration).not.toHaveProperty("selection");
      expect(configuration).not.toHaveProperty("selected_level_ids");
      expect(
        literatureExternalExecutionForSelection({
          methodProfileId: executor!.method_profile_id,
          sourceWorkId: executor!.source_work_id,
          sourceMethodVariantId: executor!.source_method_variant_id,
          sourceMethodVariantIds: [expected.configuration_id],
          methodProfileVersion: executor!.method_profile_version,
        }),
      ).toBeUndefined();
    }
  });

  it("keeps every other source unit, including raw preprocessing, hard-NO", () => {
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

    expect(
      sourceProof.counts.executed_with_published_numeric_oracle +
        sourceProof.counts.hard_no,
    ).toBe(sourceProof.counts.source_execution_units);
    expect(
      Object.values(sourceProof.hard_no_boundary.classes).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(sourceProof.counts.hard_no);
    expect(sourceProof.hard_no_boundary.raw_preprocessing_examples).toContain(
      "elmer2025:preprocessing:sample-i-ethica-60m",
    );
    expect(sourceProof.execution_boundary.does_not_claim).toContain(
      "raw Android/Ethica/Behapp preprocessing",
    );
  });
});
