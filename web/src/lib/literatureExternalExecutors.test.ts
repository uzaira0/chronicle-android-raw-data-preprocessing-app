import { describe, expect, it } from "vitest";

import registry from "@/generated/literature-external-executor-registry.json" with { type: "json" };
import { literatureExternalExecutionForSelection } from "@/lib/literatureExternalExecutors";

describe("literature external executors", () => {
  it("retains campaign jobs as evidence without registering GUI selections", () => {
    const executor = registry.executors[0]!;
    const configuration = executor.configurations[0]!;
    expect(configuration).toMatchObject({
      configuration_unit_kind: "campaign_internal_job_model_cell",
      binding_kind: "model",
    });
    expect(configuration).not.toHaveProperty("selection");
    expect(configuration).not.toHaveProperty("selected_level_ids");
    expect(literatureExternalExecutionForSelection({
      methodProfileId: executor.method_profile_id,
      sourceWorkId: executor.source_work_id,
      sourceMethodVariantId: executor.source_method_variant_id,
      sourceMethodVariantIds: [configuration.source_configuration_id],
      methodProfileVersion: executor.method_profile_version,
    })).toBeUndefined();
  });
});
