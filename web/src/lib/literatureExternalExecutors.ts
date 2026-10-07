import registryJson from "@/generated/literature-external-executor-registry.json" with { type: "json" };

type RegistryCampaignEvidence = {
  method_execution_passed: true;
  published_numeric_oracle_passed: boolean;
  source_job_count: number;
  executed_source_job_count: number;
  generated_result_rows: number;
  published_oracle_rows: number;
  published_oracle_job_count: number;
  numeric_oracle_cells_compared: number;
  numeric_oracle_cells_mismatched: number;
  jobs_without_published_numeric_oracles: number;
  source_jobs_sha256: string;
  source_results_sha256: string;
  generated_result_manifest_sha256: string;
};

export type LiteratureExternalExecutionBinding = {
  executorId: string;
  destinationId: string;
  sourceConfigurationId: string;
  bindingKind: "model" | "campaign";
  settingIds: string[];
  receiptId: string;
  modelName?: string;
  formula?: string;
  observations?: number;
  aggregateEvidence?: {
    methodExecutionPassed: true;
    publishedNumericOraclePassed: boolean;
    sourceJobCount: number;
    executedSourceJobCount: number;
    generatedResultRows: number;
    publishedOracleRows: number;
    publishedOracleJobCount: number;
    numericOracleCellsCompared: number;
    numericOracleCellsMismatched: number;
    jobsWithoutPublishedNumericOracles: number;
    sourceJobsSha256: string;
    sourceResultsSha256: string;
    generatedResultManifestSha256: string;
  };
  runtime: string;
  runtimeVersion: string;
  containerImageDigest: string;
  conformanceFixtureId: string;
  conformanceResultDigest: string;
  executionReceiptDigest: string;
};

type ReceiptIdentity = {
  methodProfileId: string;
  sourceWorkId: string;
  sourceMethodVariantId: string;
  sourceMethodVariantIds: string[];
  methodProfileVersion: string;
};

const key = (identity: ReceiptIdentity): string => [
  identity.methodProfileId,
  identity.sourceWorkId,
  identity.sourceMethodVariantId,
  identity.methodProfileVersion,
  [...identity.sourceMethodVariantIds].sort().join("\u001f"),
].join("\0");
const bindings = new Map<string, LiteratureExternalExecutionBinding>();
for (const executor of registryJson.executors) {
  for (const configuration of executor.configurations) {
    if (configuration.configuration_unit_kind !== "user_selectable_alternative") continue;
    if (!("selected_level_ids" in configuration) || !Array.isArray(configuration.selected_level_ids)) {
      throw new Error("selectable literature external execution lacks configuration levels");
    }
    const bindingKind = configuration.binding_kind === "campaign" ? "campaign" : "model";
    const aggregate = ("aggregate_evidence" in configuration
      ? configuration.aggregate_evidence
      : undefined) as RegistryCampaignEvidence | undefined;
    if (bindingKind === "campaign" && !aggregate) throw new Error("campaign binding lacks aggregate evidence");
    const identity = {
      methodProfileId: executor.method_profile_id,
      sourceWorkId: executor.source_work_id,
      sourceMethodVariantId: executor.source_method_variant_id,
      sourceMethodVariantIds: configuration.selected_level_ids,
      methodProfileVersion: executor.method_profile_version,
    };
    const binding: LiteratureExternalExecutionBinding = {
      executorId: executor.executor_id,
      destinationId: executor.executor_id,
      sourceConfigurationId: configuration.source_configuration_id,
      bindingKind,
      settingIds: configuration.external_setting_ids,
      receiptId: configuration.receipt_id,
      // The campaign arm without aggregate evidence threw above.
      ...(bindingKind === "campaign" && aggregate ? {
        aggregateEvidence: {
          methodExecutionPassed: aggregate.method_execution_passed,
          publishedNumericOraclePassed: aggregate.published_numeric_oracle_passed,
          sourceJobCount: aggregate.source_job_count,
          executedSourceJobCount: aggregate.executed_source_job_count,
          generatedResultRows: aggregate.generated_result_rows,
          publishedOracleRows: aggregate.published_oracle_rows,
          publishedOracleJobCount: aggregate.published_oracle_job_count,
          numericOracleCellsCompared: aggregate.numeric_oracle_cells_compared,
          numericOracleCellsMismatched: aggregate.numeric_oracle_cells_mismatched,
          jobsWithoutPublishedNumericOracles: aggregate.jobs_without_published_numeric_oracles,
          sourceJobsSha256: aggregate.source_jobs_sha256,
          sourceResultsSha256: aggregate.source_results_sha256,
          generatedResultManifestSha256: aggregate.generated_result_manifest_sha256,
        },
      } : {
        modelName: configuration.model_name,
        formula: configuration.formula,
        observations: configuration.observations,
      }),
      runtime: executor.runtime,
      runtimeVersion: executor.executor_version,
      containerImageDigest: executor.container_image_digest,
      conformanceFixtureId: configuration.conformance_fixture_id,
      conformanceResultDigest: configuration.conformance_result_digest,
      executionReceiptDigest: configuration.execution_receipt_sha256,
    };
    const identityKey = key(identity);
    if (bindings.has(identityKey)) throw new Error(`duplicate literature external execution: ${identityKey}`);
    bindings.set(identityKey, binding);
  }
}

export function literatureExternalExecutionForSelection(
  identity: ReceiptIdentity,
): LiteratureExternalExecutionBinding | undefined {
  return bindings.get(key(identity));
}

export function validateLiteratureExternalExecutionBinding(
  identity: ReceiptIdentity,
  candidate: unknown,
): candidate is LiteratureExternalExecutionBinding {
  const registered = literatureExternalExecutionForSelection(identity);
  return registered !== undefined && JSON.stringify(candidate) === JSON.stringify(registered);
}
