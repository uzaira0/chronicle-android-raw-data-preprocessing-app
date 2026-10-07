/**
 * @typedef {{method_setting_id: string, method_applicability_status: string}} LibrarySetting
 * @typedef {{method_profile_id: string, source_work_id: string, source_method_variant_id: string, method_profile_version: string, profile_implementation_status: string, method_settings: LibrarySetting[]}} LibraryProfile
 * @typedef {{componentId: string, parentMethodProfileId: string, sourceWorkId: string, sourceMethodVariantId: string, methodProfileVersion: string, sourceOracleId: string, requiredSupportRoles: string[], fullProfileExecutionStatus: string, canonicalRegistrationStatus?: string, limitations?: string[], additionalMethodSettingIds?: string[], derivedResultKind?: string, tableFormat?: string, adaptedResultKind?: string}} ComponentExecution
 * @typedef {{adapterId: string, adapterVersion: string, inputRole: string, methodSettingIds: string[], componentExecution?: ComponentExecution, routeKind?: string, sourceSchemas?: unknown[], requiredSupportRoles?: string[], optionBindings?: Record<string, unknown>, runtimeOptionOverrides?: Record<string, unknown>, componentConfig?: unknown}} AdapterGroup
 * @typedef {{schemaVersion: string, groups: AdapterGroup[]}} AdapterContract
 * @typedef {{component_id: string, setting_ids: string[], input_role: string, required_support_roles: string[], limitations: string[], source_oracle_id: string, parent_method_profile_id: string, source_work_id: string, source_method_variant_id: string, method_profile_version: string, full_profile_execution_status: string}} RegisteredComponent
 */

/**
 * @param {LibraryProfile[]} libraryProfiles
 * @param {AdapterContract} contract
 * @param {Set<string>} nonretainedSourceWorkIds
 * @returns {Map<string, RegisteredComponent[]>}
 */
export const projectRegisteredComponents = (libraryProfiles, contract, nonretainedSourceWorkIds = new Set()) => {
  if (
    contract?.schemaVersion !==
      "chronicle-literature-input-adapter-contract/v1" ||
    !Array.isArray(contract.groups)
  ) {
    throw new Error("literature input-adapter contract identity changed");
  }
  const profiles = new Map(
    libraryProfiles.map((profile) => [profile.method_profile_id, profile]),
  );
  if (profiles.size !== libraryProfiles.length)
    throw new Error("duplicate component parent profile ID");
  /** @type {Map<string, RegisteredComponent[]>} */
  const byProfile = new Map(
    libraryProfiles.map((profile) => [profile.method_profile_id, []]),
  );
  const componentIds = new Set();
  for (const group of contract.groups) {
    const component = group.componentExecution;
    if (component === undefined) continue;
    if (component.canonicalRegistrationStatus !== undefined &&
        !["blocked_version_mismatch", "linked_artifact_only", "outside_frozen143_extension"].includes(component.canonicalRegistrationStatus)) {
      throw new Error(`${component.componentId}: unrecognized component registration status`);
    }
    if (component.canonicalRegistrationStatus === "outside_frozen143_extension") {
      const extension = component.componentId === "chronicle.sdu-supplied-period-reductions/v1"
        ? ["outside143:sdu-device-tracker:v1", "doi:10.1016/j.chbr.2021.100164", "sdu-device-tracker:source-qualified-outside143:v1", "literature-sdu-supplied-period-reductions-csv", "outside143:sdu-device-tracker:v1:period_reductions", "sdu-primary-supplied-period-reductions-v1/primary-pdf-sha256:31c48a45306cbc1f9bb9675185bd8aa05e35940999a9b8744e4aa378fe5ae04a"]
        : component.componentId === "chronicle.sdu-supplied-validation-arithmetic/v1"
        ? ["outside143:sdu-device-tracker:v1", "doi:10.1016/j.chbr.2021.100164", "sdu-device-tracker:source-qualified-outside143:v1", "literature-sdu-supplied-validation-arithmetic-csv", "outside143:sdu-device-tracker:v1:validation_arithmetic", "sdu-primary-supplied-validation-arithmetic-v1/primary-pdf-sha256:31c48a45306cbc1f9bb9675185bd8aa05e35940999a9b8744e4aa378fe5ae04a"]
        : component.componentId === "chronicle.usage-logger-released-numeric/v1"
        ? ["outside143:usage-logger:v1", "doi:10.3758/s13428-021-01585-7", "usage-logger:source-qualified-outside143:v1", "literature-usage-logger-released-numeric-csv", "outside143:usage-logger:v1:released_numeric", "usage-logger-released-numeric-v1/source-commit:6d1f4d44560ccd9a158c04adb37c6fc988bbbd35"] : undefined;
      const settingId = extension?.[4];
      if (!extension || !settingId || component.parentMethodProfileId !== extension[0] ||
          component.sourceWorkId !== extension[1] || component.sourceMethodVariantId !== extension[2] ||
          component.methodProfileVersion !== "1" ||
          component.derivedResultKind !== extension[3] || component.sourceOracleId !== extension[5] ||
          component.tableFormat !== undefined || component.adaptedResultKind !== undefined ||
          component.componentId !== `${group.adapterId}/${group.adapterVersion}` ||
          group.routeKind !== "protocol_input" || group.inputRole !== "raw_chronicle_csv" ||
          group.methodSettingIds.length !== 1 || group.methodSettingIds[0] !== settingId ||
          (component.additionalMethodSettingIds?.length ?? 0) !== 0 ||
          component.requiredSupportRoles.length !== 0 || (group.requiredSupportRoles?.length ?? 0) !== 0 ||
          (group.sourceSchemas?.length ?? 0) !== 0 ||
          Object.keys(group.optionBindings ?? {}).length !== 0 ||
          Object.keys(group.runtimeOptionOverrides ?? {}).length !== 0 || group.componentConfig != null ||
          component.fullProfileExecutionStatus !== "blocked" || !(component.limitations?.length) ||
          !component.sourceOracleId || componentIds.has(component.componentId) ||
          libraryProfiles.some((p) => p.method_profile_id === component.parentMethodProfileId ||
            p.source_work_id === component.sourceWorkId || p.method_settings.some((s) => s.method_setting_id === settingId))) {
        throw new Error(`${component.componentId}: malformed or colliding outside-freeze registration`);
      }
      componentIds.add(component.componentId);
      continue;
    }
    const profile = profiles.get(component.parentMethodProfileId);
    if (!profile && nonretainedSourceWorkIds.has(component.sourceWorkId)) continue;
    if (
      !profile ||
      profile.source_work_id !== component.sourceWorkId ||
      profile.source_method_variant_id !== component.sourceMethodVariantId
    ) {
      throw new Error(
        `${component.componentId}: component parent identity does not equal the canonical profile`,
      );
    }
    const settingIds = [...group.methodSettingIds, ...(component.additionalMethodSettingIds ?? [])];
    const limitations = component.limitations ?? [];
    const profileSettings = new Map(
      profile.method_settings.map((setting) => [
        setting.method_setting_id,
        setting,
      ]),
    );
    if (component.canonicalRegistrationStatus === "linked_artifact_only") {
      if (component.methodProfileVersion === profile.method_profile_version ||
        limitations.length === 0 ||
        settingIds.length === 0 ||
        settingIds.some((settingId) => profileSettings.has(settingId))) {
        throw new Error(`${component.componentId}: linked artifact overlaps canonical paper settings`);
      }
      continue;
    }
    if (profile.method_profile_version !== component.methodProfileVersion) {
      if (
        component.canonicalRegistrationStatus !== "blocked_version_mismatch" ||
        component.fullProfileExecutionStatus !== "blocked" ||
        limitations.length === 0 ||
        settingIds.some((settingId) => !profileSettings.has(settingId))
      ) {
        throw new Error(
          `${component.componentId}: component parent version mismatch is not explicitly fail-closed`,
        );
      }
      continue;
    }
    if (
      typeof component.componentId !== "string" ||
      !component.componentId ||
      component.componentId !== `${group.adapterId}/${group.adapterVersion}` ||
      componentIds.has(component.componentId) ||
      typeof group.inputRole !== "string" ||
      !group.inputRole ||
      !Array.isArray(component.requiredSupportRoles) ||
      component.requiredSupportRoles.some(
        (role) => typeof role !== "string" || !role,
      ) ||
      new Set(component.requiredSupportRoles).size !==
        component.requiredSupportRoles.length ||
      !Array.isArray(limitations) ||
      limitations.some(
        (limitation) => typeof limitation !== "string" || !limitation,
      ) ||
      new Set(limitations).size !== limitations.length ||
      typeof component.sourceOracleId !== "string" ||
      !component.sourceOracleId ||
      !Array.isArray(settingIds) ||
      settingIds.length === 0 ||
      new Set(settingIds).size !== settingIds.length ||
      settingIds.some((settingId) => {
        const setting = profileSettings.get(settingId);
        return (
          setting === undefined ||
          setting.method_applicability_status === "not_applicable"
        );
      }) ||
      component.fullProfileExecutionStatus !==
        profile.profile_implementation_status
    ) {
      throw new Error(
        `${component.componentId}: component registration or canonical setting ownership drift`,
      );
    }
    componentIds.add(component.componentId);
    const profileComponents = byProfile.get(profile.method_profile_id);
    if (!profileComponents) throw new Error("component parent projection drift");
    profileComponents.push({
      component_id: component.componentId,
      setting_ids: [...settingIds],
      input_role: group.inputRole,
      required_support_roles: [...component.requiredSupportRoles],
      limitations: [...limitations],
      source_oracle_id: component.sourceOracleId,
      parent_method_profile_id: component.parentMethodProfileId,
      source_work_id: component.sourceWorkId,
      source_method_variant_id: component.sourceMethodVariantId,
      method_profile_version: component.methodProfileVersion,
      full_profile_execution_status: component.fullProfileExecutionStatus,
    });
  }
  return byProfile;
};
