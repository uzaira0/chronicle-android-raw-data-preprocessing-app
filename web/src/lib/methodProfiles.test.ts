import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";

import {
  compileNativeMethodProfileCampaign,
  compileNativeMethodProfile,
  enumerateMethodConfigurations,
  parseStudyMethodProfile,
  requiresConfigurationSelection,
  selectMethodConfiguration,
  summarizeMethodConfigurationGroups,
} from "@/lib/methodProfiles";
import {
  LITERATURE_INPUT_ADAPTER_CONTRACTS,
  literatureInputAdapterForSetting,
  methodReceiptUsesCallSmsEligibility,
  methodReceiptUsesPhoneStudyEs,
  methodReceiptUsesPhoneStudyPsCommunication,
} from "@/lib/literatureInputAdapters";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  profileProtocolDocumentaryBindingForSetting,
  profileProtocolProfileIdentityForSetting,
  sourceArtifactProfileIdentityForSetting,
  sourceArtifactProvenanceAssertionForSetting,
} from "@/lib/sourceArtifactProvenanceRegistry";

describe("literature method profile compiler", () => {
  it("retains complete output mappings and blocks tuples absent from the generated registry", () => {
    const raw = {
      method_profile_id: "profile:unregistered-output",
      source_work_id: "doi:unregistered-output",
      source_method_variant_id: "fixed",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [
        {
          method_setting_id: "setting:unregistered-output",
source_extraction_id: "extraction:unregistered-output",
method_setting_role: "provenance",
          method_value_json: '"source-time"',
          method_applicability_status: "applicable",
          method_disclosure_status: "declared",
          method_implementation_status: "native",
          method_execution_route: "native_option_binding",
          chronicle_output_kind: "app-csv",
          chronicle_output_column: "start_timestamp",
          source_output_position: 0,
          conformance_fixture_id: "fixture:unregistered-output",
          conformance_result_digest: `sha256:${"a".repeat(64)}`,
          contract_bindings: [
            { contract_slot: "process_app_usage", contract_value_json: "true" },
          ],
        },
      ],
    };
    const parsed = parseStudyMethodProfile(raw);
    expect(parsed.method_settings[0]).toMatchObject({
      chronicle_output_kind: "app-csv",
      chronicle_output_column: "start_timestamp",
      source_output_position: 0,
    });
    expect(compileNativeMethodProfile(parsed)).toMatchObject({
      ok: false,
      blockers: [
        {
          settingId: "setting:unregistered-output",
          code: "missing_conformance",
        },
      ],
    });
    expect(() =>
      parseStudyMethodProfile({
        ...raw,
        method_settings: [
          { ...raw.method_settings[0], source_output_position: undefined },
        ],
      }),
    ).toThrow(/output mapping must declare/);
  });

  it("compiles exact native bindings and refuses unresolved settings", () => {
    const native = parseStudyMethodProfile({
      method_profile_id: "profile:paper",
      source_work_id: "doi:paper",
      source_method_variant_id: "primary",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [
        {
          method_setting_id: "setting:1",
          source_extraction_id: "extraction:1",
          method_setting_role: "provenance",
          method_applicability_status: "applicable",
          method_disclosure_status: "declared",
          method_implementation_status: "native",
          method_execution_route: "native_option_binding",
          conformance_fixture_id: "fixture:paper:duration",
          conformance_result_digest: `sha256:${"a".repeat(64)}`,
          contract_bindings: [
            {
              contract_slot: "minimum_usage_duration",
              contract_value_json: "15",
            },
          ],
        },
      ],
    });
    const compiled = compileNativeMethodProfile(native);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.options.minimumUsageDuration).toBe(15);

    native.profile_implementation_status = "blocked";
    const aggregateStatusChanged = compileNativeMethodProfile(native);
    expect(aggregateStatusChanged).toMatchObject({
      ok: true,
      options: { minimumUsageDuration: 15 },
      legacyBlockers: [{ code: "profile_blocked", detail: "blocked" }],
    });
    native.profile_implementation_status = "executable";

    native.method_settings[0]!.method_implementation_status = "unresolved";
    const blocked = compileNativeMethodProfile(native);
    expect(blocked).toMatchObject({
      ok: false,
      blockers: [{ code: "not_native" }],
    });

    native.method_settings[0]!.method_disclosure_status = "absent";
    native.method_settings[0]!.method_applicability_status = "undetermined";
    native.method_settings[0]!.method_implementation_status =
      "specification_only";
    expect(compileNativeMethodProfile(native)).toMatchObject({
      ok: false,
      blockers: [{ code: "not_native" }],
    });

    native.method_settings[0]!.method_disclosure_status = "declared";
    native.method_settings[0]!.method_applicability_status = "applicable";
    native.method_settings[0]!.method_implementation_status = "native";
    native.method_settings.push({
      method_setting_id: "setting:pending-operator",
      source_extraction_id: "extraction:pending-operator",
      method_setting_role: "provenance",
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "specification_only",
      method_execution_route: "native_operator_parameter",
      contract_bindings: [],
    });
    expect(compileNativeMethodProfile(native)).toMatchObject({
      ok: false,
      blockers: [{ settingId: "setting:pending-operator", code: "not_native" }],
      supportedPlan: {
        options: { minimumUsageDuration: 15 },
        receipt: { settingIds: ["setting:1"] },
      },
    });
  });

  it("round-trips the source's two exact application-label exclusions as separate receipt identities", () => {
    const digest =
      "sha256:cb774beb0ab1295cfb5b41c39d03403d68c81c713e99217f6af241351543f49c";
    const profile = parseStudyMethodProfile({
      method_profile_id:
        "profile:doi:10.1080/15213269.2024.2334025:exact-app-row-filter",
      source_work_id: "doi:10.1080/15213269.2024.2334025",
      source_method_variant_id:
        "source-audit-configuration-space-0fb788bc62d547eaaf91bb9a",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [
        ["method-setting-577ac433c188e9c0d1f21311", "APP_USAGE"],
        ["method-setting-3f07e9131d5492926afe8c63", "YouTube Vanced"],
        ["method-setting-6945d62974714b285e78cca0", "Basic Daydreams"],
      ].map(([method_setting_id, value]) => ({
        method_setting_id,
        source_extraction_id: "extraction-cc1f6a72d75b7f434d75",
        method_setting_role: "provenance",
        source_value_json: JSON.stringify(value),
        method_value_json: JSON.stringify(value),
        method_applicability_status: "applicable",
        method_disclosure_status: "declared",
        method_implementation_status: "native",
        method_execution_route: "protocol_input",
        conformance_fixture_id: "literature-input.exact-categorical-row-filter.v1",
        conformance_result_digest: digest,
        contract_bindings: [],
      })),
    });
    const compiled = compileNativeMethodProfile(profile);
    expect(compiled).toMatchObject({
      ok: true,
      receipt: {
        settingIds: [
          "method-setting-577ac433c188e9c0d1f21311",
          "method-setting-3f07e9131d5492926afe8c63",
          "method-setting-6945d62974714b285e78cca0",
        ],
      },
    });
    if (!compiled.ok) throw new Error("expected exact app-row filter to compile");
    expect(compiled.receipt.bindings).toHaveLength(0);
    expect(
      new Set(compiled.receipt.inputBindings?.map((binding) => binding.settingId)),
    ).toEqual(
      new Set([
        "method-setting-577ac433c188e9c0d1f21311",
        "method-setting-3f07e9131d5492926afe8c63",
        "method-setting-6945d62974714b285e78cca0",
      ]),
    );
  });

  it.each([
    ["downstream", "external_named_executor"],
    ["evidence", "receipt_conformance"],
  ] as const)(
    "keeps a diagnostic native plan while %s completion remains blocked",
    (dimension, route) => {
      const profile = parseStudyMethodProfile({
        method_profile_id: "profile:mixed-routes",
        source_work_id: "doi:mixed-routes",
        source_method_variant_id: "primary",
        method_configuration_structure: "fixed",
        method_profile_version: "v1",
        profile_implementation_status: "blocked",
        method_settings: [
          {
            method_setting_id: "setting:native",
            source_extraction_id: "extraction:native",
            method_setting_role: "provenance",
            method_applicability_status: "applicable",
            method_disclosure_status: "declared",
            method_implementation_status: "native",
            method_execution_route: "native_option_binding",
            conformance_fixture_id: "fixture:native",
            conformance_result_digest: `sha256:${"a".repeat(64)}`,
            contract_bindings: [
              {
                contract_slot: "minimum_usage_duration",
                contract_value_json: "15",
              },
            ],
          },
          {
            method_setting_id: "setting:blocked",
            source_extraction_id: "extraction:blocked",
            method_setting_role: "provenance",
            method_applicability_status: "applicable",
            method_disclosure_status: "declared",
            method_implementation_status: "specification_only",
            method_execution_route: route,
            contract_bindings: [],
          },
        ],
      });

      expect(compileNativeMethodProfile(profile)).toMatchObject({
        ok: false,
        blockers: [{ settingId: "setting:blocked", code: "not_native" }],
        supportedPlan: {
          options: { minimumUsageDuration: 15 },
          receipt: { settingIds: ["setting:native"] },
        },
        readiness: {
          preprocessing: { status: "ready" },
          [dimension]: { status: "blocked" },
          disposition: "preprocessing_reproduced",
        },
      });
    },
  );

  it("compiles the exact 825-setting input-adapter registry into persisted typed receipts", () => {
    expect(
      LITERATURE_INPUT_ADAPTER_CONTRACTS.flatMap(
        (group) => group.methodSettingIds,
      ),
    ).toHaveLength(825);
    const profile = parseStudyMethodProfile({
      method_profile_id: "profile:input-adapters",
      source_work_id: "doi:input-adapters",
      source_method_variant_id: "primary",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [
        {
          method_setting_id: "method-setting-0483653c3edaac4e21150447",
          source_extraction_id: "extraction:event-map",
          method_setting_role: "provenance",
          method_value_json: '"screen on/off"',
          method_applicability_status: "applicable",
          method_disclosure_status: "declared",
          method_implementation_status: "native",
          method_execution_route: "protocol_input",
          conformance_fixture_id:
            "literature-input.local-source-inventory.v1",
          conformance_result_digest: `sha256:${"c".repeat(64)}`,
          contract_bindings: [],
        },
      ],
    });
    const compiled = compileNativeMethodProfile(profile);
    expect(compiled).toMatchObject({
      ok: true,
      receipt: {
        settingIds: ["method-setting-0483653c3edaac4e21150447"],
        inputBindings: [
          {
            adapterId: "chronicle.raw-event-map",
            inputRole: "raw_chronicle_csv",
          },
        ],
      },
    });
  });

  it("disables the unrelated duration floor only for the selected Ethica stream adapter", () => {
    const ethica = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(
      (group) =>
        `${group.adapterId}/${group.adapterVersion}` ===
        "chronicle.ethica-app-usage-stream/v1",
    );
    expect(ethica).toMatchObject({
      runtimeOptionOverrides: { minimumUsageDuration: 0 },
    });
    expect(ethica?.optionBindings).toBeUndefined();
    const sourceValues = new Map<string, unknown>([
      [
        "method-setting-8a1d42e375008c6b34c79e60",
        ["user_id", "app_name", "start_time", "fg_time_ms", "last_used"],
      ],
      [
        "method-setting-283b3d30d8541590046a0451",
        { condition: "fg_time_ms > 0" },
      ],
      [
        "method-setting-ca06a70efe6dd99babafeef0",
        { field: "last_used", add_hours: 2 },
      ],
      [
        "method-setting-60a2079343ab336eda1a7704",
        {
          identity: ["user_id", "apk", "start_time", "fg_time_ms"],
          keep_all: true,
        },
      ],
      [
        "method-setting-26a0aa33a3ea41e02ff64863",
        {
          group_by: ["user_id", "apk", "start_time"],
          order_by: "last_used",
          first: "fg_time_ms[1]",
          subsequent: "diff(fg_time_ms)",
        },
      ],
      [
        "method-setting-dd694b0b2e2e141c40f2a46b",
        { end: "last_used", start: "last_used - reconstructed duration" },
      ],
      [
        "method-setting-5110b31b451f7cc18d750ffb",
        { condition: "duration > 0" },
      ],
    ]);
    const profile = parseStudyMethodProfile({
      method_profile_id:
        "method-profile:doi:10.1177/00936502241276793:ethica-input",
      source_work_id: "doi:10.1177/00936502241276793",
      source_method_variant_id: "fixed-ethica-input",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [...sourceValues].map(([method_setting_id, value]) => ({
        method_setting_id,
        source_extraction_id: `extraction:${method_setting_id}`,
        method_setting_role: "provenance",
        method_value_json: JSON.stringify(value),
        method_applicability_status: "applicable",
        method_disclosure_status: "declared",
        method_implementation_status: "native",
        method_execution_route: "protocol_input",
        conformance_fixture_id: `fixture:${method_setting_id}`,
        conformance_result_digest: `sha256:${"e".repeat(64)}`,
        contract_bindings: [],
      })),
    });
    // A 60 s floor in the starting settings, so the adapter's override is observable.
    const withFloor = { ...DEFAULT_BROWSER_OPTIONS, minimumUsageDuration: 60 };
    const compiled = compileNativeMethodProfile(profile, withFloor);
    expect(compiled).toMatchObject({
      ok: true,
      options: { minimumUsageDuration: 0, filterZeroDurationSessions: false },
      receipt: {
        settingIds: [...sourceValues.keys()],
        bindings: [],
        inputBindings: [...sourceValues.keys()].map((settingId) => ({
          settingId,
          adapterId: "chronicle.ethica-app-usage-stream",
          adapterVersion: "v1",
        })),
      },
    });

    const unrelated = parseStudyMethodProfile({
      method_profile_id: "profile:unrelated-adapter",
      source_work_id: "doi:unrelated-adapter",
      source_method_variant_id: "fixed",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [
        {
          method_setting_id: "method-setting-0483653c3edaac4e21150447",
          source_extraction_id: "extraction:unrelated-adapter",
          method_setting_role: "provenance",
          method_value_json: '"screen on/off"',
          method_applicability_status: "applicable",
          method_disclosure_status: "declared",
          method_implementation_status: "native",
          method_execution_route: "protocol_input",
          conformance_fixture_id: "fixture:unrelated-adapter",
          conformance_result_digest: `sha256:${"f".repeat(64)}`,
          contract_bindings: [],
        },
      ],
    });
    expect(compileNativeMethodProfile(unrelated, withFloor)).toMatchObject({
      ok: true,
      options: { minimumUsageDuration: 60 },
    });
  });

  it("maps the three CompEdu calendar exclusions to explicit study-date intervals without deriving week dates", () => {
    const settingValues = [
      ["method-setting-e5a87fa0f1a10d4184bfe018", "Remove holiday week 6"],
      ["method-setting-acbce6b9d05461111a8792b1", "exam weeks 8"],
      ["method-setting-0c549383fd539ac9ee4fa5f1", 16],
    ] as const;
    const profile = parseStudyMethodProfile({
      method_profile_id: "method-profile:doi:10.1016/j.compedu.2019.103611",
      source_work_id: "doi:10.1016/j.compedu.2019.103611",
      source_method_variant_id:
        "source-configuration-space-786d5a6f9db121084058ea05",
      method_configuration_structure: "fixed",
      method_profile_version: "literature-sublation-v3-atomic",
      profile_implementation_status: "executable",
      method_settings: settingValues.map(([method_setting_id, value]) => ({
        method_setting_id,
        source_extraction_id: "extraction-52cabecb4940f531a261",
        method_setting_role: "provenance",
        method_value_json: JSON.stringify(value),
        method_applicability_status: "applicable",
        method_disclosure_status: "declared",
        method_implementation_status: "native",
        method_execution_route: "native_operator_parameter",
        conformance_fixture_id: "study-window.explicit-interior-exclusions.v1",
        conformance_result_digest: `sha256:${"c".repeat(64)}`,
        contract_bindings: [],
      })),
    });
    const compiled = compileNativeMethodProfile(profile);
    expect(compiled).toMatchObject({
      ok: true,
      options: { enableStudyWindowFilter: true },
      receipt: {
        settingIds: settingValues.map(([settingId]) => settingId),
        inputBindings: settingValues.map(([settingId, value]) => ({
          settingId,
          routeKind: "native_operator_parameter",
          inputRole: "study_dates_file",
          schemaId: "chronicle-study-date-interior-exclusion/v1",
          adapterId: "chronicle.study-date-interior-exclusion",
          adapterVersion: "v1",
          requiredFields: [
            "participant_id",
            "start_date",
            "end_date",
            "exclusion_label",
            "exclusion_start_date",
            "exclusion_end_date",
          ],
          sourceValue: value,
        })),
      },
    });
  });

  it("keeps the two Call/SMS adapters distinct while sharing one support role", () => {
    const volumeSettingId = "method-setting-adda9b69e35b45ac28a7d314";
    const modalitySettingId = "method-setting-7227d4895934a7ef9170232e";
    const volumeAdapter = literatureInputAdapterForSetting(volumeSettingId);
    const modalityAdapter = literatureInputAdapterForSetting(modalitySettingId);

    expect(volumeAdapter).toMatchObject({
      adapterId: "chronicle.call-sms-volume-gate",
      inputRole: "call_sms_eligibility_file",
    });
    expect(modalityAdapter).toMatchObject({
      adapterId: "chronicle.call-modality-availability",
      inputRole: "call_sms_eligibility_file",
    });
    expect(volumeAdapter?.adapterId).not.toBe(modalityAdapter?.adapterId);
    expect(methodReceiptUsesCallSmsEligibility([volumeSettingId])).toBe(true);
    expect(methodReceiptUsesCallSmsEligibility([modalitySettingId])).toBe(true);
  });

  it("keeps the PhoneStudy communication join and ES base activation distinct", () => {
    const joinSettingId = "method-setting-faf89bac61ad22df438c751c";
    const esSettingIds = [
      "method-setting-82e5e52c5cb3226a61e79545",
      "method-setting-9c0a51bb40b069aabe08c488",
      "method-setting-9bab1ec12ac7b8d13b09e1bc",
      "method-setting-2024dc3832e28339c35e77c6",
      "method-setting-25850bf69703fbf97a62f45a",
    ];

    expect(methodReceiptUsesPhoneStudyPsCommunication([joinSettingId])).toBe(
      true,
    );
    expect(methodReceiptUsesPhoneStudyEs([joinSettingId])).toBe(false);
    for (const settingId of esSettingIds) {
      expect(methodReceiptUsesPhoneStudyEs([settingId])).toBe(true);
      expect(methodReceiptUsesPhoneStudyPsCommunication([settingId])).toBe(
        false,
      );
    }
    expect(methodReceiptUsesPhoneStudyEs(["method-setting-unrelated"])).toBe(
      false,
    );
    expect(
      methodReceiptUsesPhoneStudyPsCommunication(["method-setting-unrelated"]),
    ).toBe(false);
  });

  it("round-trips an exact source-schema identity and rejects source-value or work relabeling", () => {
    const setting = {
      method_setting_id: "method-setting-2749a0339e3c4bb4c3b0ba7e",
      source_extraction_id: "extraction-930bceb11f5743f61287",
      method_setting_role: "provenance",
      source_value_sha256:
        "e4951d31dcea641fbc0b49e2e10c55f616c33e4efea82184aea018fc81af079c",
      method_value_json: '"AppOpenEvent"',
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "native",
      method_execution_route: "protocol_input",
      conformance_fixture_id: "event-schema-app-open-canonical-2749a033.v1",
      conformance_result_digest: `sha256:${"d".repeat(64)}`,
      contract_bindings: [],
    };
    const source = (
      source_work_id: string,
      method_value_json = setting.method_value_json,
    ) =>
      parseStudyMethodProfile({
        method_profile_id: "profile:source-schema",
        source_work_id,
        source_method_variant_id: "fixed",
        method_configuration_structure: "fixed",
        method_profile_version: "v1",
        profile_implementation_status: "executable",
        method_settings: [{ ...setting, method_value_json }],
      });
    const compiled = compileNativeMethodProfile(source("doi:10.1007/s00530-018-0601-1"));
    expect(compiled).toMatchObject({
      ok: true,
      receipt: {
        inputBindings: [
          {
            sourceWorkId: "doi:10.1007/s00530-018-0601-1",
            sourceValue: "AppOpenEvent",
            sourceValueSha256: setting.source_value_sha256,
            sourceSchema: { canonicalValue: "Activity Resumed" },
          },
        ],
      },
    });
    expect(compileNativeMethodProfile(source("doi:forged"))).toMatchObject({
      ok: false,
      blockers: [{ code: "missing_conformance" }],
    });
    expect(
      compileNativeMethodProfile(source("doi:10.1007/s00530-018-0601-1", '"AppCloseEvent"')),
    ).toMatchObject({ ok: false, blockers: [{ code: "missing_conformance" }] });
  });

  it("rejects a profile whose declared inventory omits an embedded setting", () => {
    expect(() =>
      parseStudyMethodProfile({
        method_profile_id: "profile:paper",
        source_work_id: "doi:paper",
        source_method_variant_id: "primary",
        method_configuration_structure: "fixed",
        method_profile_version: "v1",
        profile_implementation_status: "blocked",
        method_setting_count: 1,
        method_setting_ids: [],
        method_settings: [
          {
            method_setting_id: "setting:1",
            source_extraction_id: "extraction:1",
            method_setting_role: "provenance",
            method_applicability_status: "applicable",
            method_disclosure_status: "declared",
            method_implementation_status: "unresolved",
            contract_bindings: [],
          },
        ],
      }),
    ).toThrow(/method_setting_ids do not match/);
  });

  it("keeps multiverse branches grouped and visibly pending partition", () => {
    const groups = summarizeMethodConfigurationGroups([
      {
        method_setting_id: "setting:branch",
        source_extraction_id: "extraction:branch",
        method_setting_role: "provenance",
        method_applicability_status: "applicable",
        method_disclosure_status: "declared",
        method_implementation_status: "specification_only",
        contract_bindings: [],
        method_variant_group_id: "group:epoch",
        method_variant_relation: "ALTERNATIVE",
        method_variant_branch_label: "all day",
        method_configuration_json: JSON.stringify({
          kind: "multiverse_branch",
          axis: "epoch",
        }),
      },
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        id: "group:epoch",
        axes: ["epoch"],
        branches: ["all day"],
        partitionRequired: true,
      }),
    ]);
  });

  it("rejects malformed configuration metadata instead of hiding a branch", () => {
    expect(() =>
      parseStudyMethodProfile({
        method_profile_id: "profile:paper",
        source_work_id: "doi:paper",
        source_method_variant_id: "primary",
        method_configuration_structure: "fixed",
        method_profile_version: "v1",
        profile_implementation_status: "blocked",
        method_settings: [
          {
            method_setting_id: "setting:1",
            source_extraction_id: "extraction:1",
            method_setting_role: "provenance",
            method_applicability_status: "applicable",
            method_disclosure_status: "declared",
            method_implementation_status: "specification_only",
            contract_bindings: [],
            method_configuration_json: "{",
          },
        ],
      }),
    ).toThrow(/method_configuration_json is invalid JSON/);
  });

  it("blocks uncompiled typed protocol sections instead of treating them as completed", () => {
    const profile = parseStudyMethodProfile({
      method_profile_id: "profile:paper",
      source_work_id: "doi:paper",
      source_method_variant_id: "primary",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [],
      duration_policies: [{ duration_policy_id: "duration:1" }],
    });
    expect(compileNativeMethodProfile(profile)).toMatchObject({
      ok: false,
      blockers: [
        { code: "uncompiled_profile_section", detail: "duration_policies" },
      ],
      readiness: { preprocessing: { status: "blocked" } },
      legacyBlockers: [
        { code: "uncompiled_profile_section", detail: "duration_policies" },
      ],
    });
  });

  it("compiles only the proven screen-epoch session section while the source's 43-setting profile stays blocked", () => {
    const screenEpochSetting = {
      method_setting_id: "method-setting-2eb3e888e7d8cf28b9d200d3",
      source_extraction_id: "extraction-4bdce7acc64a022bf0a7",
      method_setting_role: "provenance",
      source_work_id: "doi:10.4088/jcp.15m10310",
      source_value_sha256:
        "a8fff991fc34315da0e2910a6a1ec85bbc3c11916d0033b446a29fea090f103a",
      source_value_json:
        '"epoch_boundary: screen-on through successive screen-off"',
      method_value_json: '"screen-on through successive screen-off"',
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "native",
      method_execution_route: "native_option_binding",
      executor_id: "chronicle_preprocessing_runtime_wasm",
      conformance_fixture_id: "reconstruction.screen-on-next-screen-off.v1",
      conformance_result_digest:
        "sha256:898912712a7fe57a486afabc0d5e5b18cc2f5dc5fc6cd529848eeffae897b3b6",
      contract_bindings: [
        { contract_slot: "process_screen_usage", contract_value_json: "true" },
        {
          contract_slot: "screen_session_construction_strategy",
          contract_value_json: '"chronicle_screen_interactive_v1"',
        },
      ],
    };
    const sessionConstructionPolicy = {
      session_construction_policy_id:
        "session-construction-policy:extraction-4bdce7acc64a022bf0a7",
      session_input_layer: "raw_record",
      session_output_layer: "device_session",
      reconstruction_strategy: "screen-on through successive screen-off",
      method_settings: [screenEpochSetting],
      source_locators: [
        // The canonical library records the producing checkout's absolute path;
        // only the repository-relative remainder is compared.
        "/home/researcher/chronicle-android-raw-data-preprocessing-app/.tmp-literature-review-private/corrective-queue-audit-b-20260831/packet-05-ranks-124-173/fulltext/rank127.txt:143-151",
      ],
    };
    const executableSection = parseStudyMethodProfile({
      method_profile_id: "profile:proven-screen-epoch-section",
      source_work_id: "doi:10.4088/jcp.15m10310",
      source_method_variant_id: "fixed-screen-epoch",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [screenEpochSetting],
      session_construction_policies: [sessionConstructionPolicy],
    });
    expect(compileNativeMethodProfile(executableSection)).toMatchObject({
      ok: true,
      options: {
        processAppUsage: false,
        processScreenUsage: true,
        screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
      },
      receipt: {
        settingIds: ["method-setting-2eb3e888e7d8cf28b9d200d3"],
        bindings: [
          { slot: "process_screen_usage", value: true },
          {
            slot: "screen_session_construction_strategy",
            value: "chronicle_screen_interactive_v1",
          },
        ],
      },
    });
    for (const [locator, ok] of [
      [".tmp-literature-review-private/corrective-queue-audit-b-20260831/packet-05-ranks-124-173/fulltext/rank127.txt:143-151", true],
      ["/home/researcher/chronicle-android-raw-data-preprocessing-app/.tmp-literature-review-private/corrective-queue-audit-b-20260831/packet-05-ranks-124-173/fulltext/rank127.txt:143-152", false],
      ["/home/researcher/other-checkout/.tmp-literature-review-private/corrective-queue-audit-b-20260831/packet-05-ranks-124-173/fulltext/rank127.txt:143-151", false],
    ] as const) {
      const relocated = parseStudyMethodProfile({
        method_profile_id: "profile:relocated-screen-epoch-section",
        source_work_id: "doi:10.4088/jcp.15m10310",
        source_method_variant_id: "fixed-screen-epoch",
        method_configuration_structure: "fixed",
        method_profile_version: "v1",
        profile_implementation_status: "executable",
        method_settings: [screenEpochSetting],
        session_construction_policies: [{ ...sessionConstructionPolicy, source_locators: [locator] }],
      });
      expect(compileNativeMethodProfile(relocated).ok, locator).toBe(ok);
    }
    expect(() => parseStudyMethodProfile({
      method_profile_id: "profile:forged-screen-epoch-section",
      source_work_id: "doi:10.4088/jcp.15m10310",
      source_method_variant_id: "fixed-screen-epoch",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [screenEpochSetting],
      session_construction_policies: [
        { ...sessionConstructionPolicy, unsupported_gap_seconds: 999 },
      ],
    })).toThrow(/unknown fields: unsupported_gap_seconds/);
    const unprovenSetting = {
      ...screenEpochSetting,
      source_value_sha256: "b".repeat(64),
    };
    const unprovenSection = parseStudyMethodProfile({
      method_profile_id: "profile:unproven-screen-epoch-section",
      source_work_id: "doi:10.4088/jcp.15m10310",
      source_method_variant_id: "fixed-screen-epoch",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [unprovenSetting],
      session_construction_policies: [
        { ...sessionConstructionPolicy, method_settings: [unprovenSetting] },
      ],
    });
    expect(compileNativeMethodProfile(unprovenSection)).toMatchObject({
      ok: false,
      blockers: [
        {
          code: "uncompiled_profile_section",
          detail: "session_construction_policies",
        },
      ],
      legacyBlockers: [
        {
          code: "uncompiled_profile_section",
          detail: "session_construction_policies",
        },
      ],
    });

    const documentarySettings = Array.from({ length: 42 }, (_, index) => ({
      method_setting_id: `method-setting:provencher-documentary-${index + 1}`,
      source_extraction_id: `extraction:provencher-documentary-${index + 1}`,
      method_setting_role: "provenance",
      source_work_id: "doi:10.4088/jcp.15m10310",
      method_applicability_status: "not_applicable",
      method_disclosure_status: "not_applicable",
      method_implementation_status: "specification_only",
      contract_bindings: [],
    }));
    const blockedSourceProfile = parseStudyMethodProfile({
      method_profile_id: "method-profile:doi:10.4088/jcp.15m10310",
      source_work_id: "doi:10.4088/jcp.15m10310",
      source_method_variant_id:
        "source-configuration-space-c4d94f8f8253dbd23ad0d6fa",
      method_configuration_structure: "evidence_blocked",
      method_profile_version: "literature-sublation-v3-atomic",
      profile_implementation_status: "blocked",
      method_setting_count: 43,
      method_setting_ids: [
        screenEpochSetting.method_setting_id,
        ...documentarySettings.map((setting) => setting.method_setting_id),
      ],
      method_settings: [screenEpochSetting, ...documentarySettings],
      session_construction_policies: [sessionConstructionPolicy],
    });
    const blocked = compileNativeMethodProfile(blockedSourceProfile);
    expect(blocked).toMatchObject({
      ok: true,
      legacyBlockers: [{ code: "profile_blocked", detail: "blocked" }],
    });
    expect(blocked.legacyBlockers).not.toContainEqual(
      expect.objectContaining({
        code: "uncompiled_profile_section",
        detail: "session_construction_policies",
      }),
    );
  });

  it("compiles the registered two-member screen policy and rejects member omission or addition", () => {
    const sourceWorkId = "doi:10.1016/j.compedu.2019.103611";
    const sourceExtractionId = "extraction-7b4e05a756bf5785cc82";
    const sourceLocators = [
      ".tmp-literature-review-private/corrective-packet-08-ranks277-329-20260831/fulltext/rank288-primary.txt:357-364",
    ];
    const bindings = [
      { contract_slot: "process_screen_usage", contract_value_json: "true" },
      {
        contract_slot: "screen_session_construction_strategy",
        contract_value_json: '"chronicle_screen_interactive_v1"',
      },
    ];
    const shared = {
      source_extraction_id: sourceExtractionId,
      method_setting_role: "provenance",
      source_work_id: sourceWorkId,
      source_value_sha256:
        "28775211bf30f2356e868688f4d2fa42265c28229320e45ea2df03b9c17a317a",
      source_value_json:
        '"screen_boundary: Session begins screen-on and ends screen-off"',
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "native",
      method_execution_route: "native_option_binding",
      executor_id: "chronicle_preprocessing_runtime_wasm",
      conformance_fixture_id: "reconstruction.screen-on-next-screen-off.v1",
      conformance_result_digest:
        "sha256:898912712a7fe57a486afabc0d5e5b18cc2f5dc5fc6cd529848eeffae897b3b6",
      contract_bindings: bindings,
      source_locators: sourceLocators,
    };
    const screenOff = {
      ...shared,
      method_setting_id: "method-setting-754cc26cea93f3ad912798ac",
      method_value_json: '"ends screen-off"',
    };
    const screenOn = {
      ...shared,
      method_setting_id: "method-setting-e96f1820c86f22fe7bfd8490",
      method_value_json: '"Session begins screen-on"',
    };
    const policy = {
      session_construction_policy_id:
        "session-construction-policy:extraction-7b4e05a756bf5785cc82",
      session_input_layer: "raw_record",
      session_output_layer: "device_session",
      reconstruction_strategy: "ends screen-off; Session begins screen-on",
      method_settings: [screenOff, screenOn],
      source_locators: sourceLocators,
    };
    const profileBase = {
      source_work_id: sourceWorkId,
      source_method_variant_id: "fixed-screen-session",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [screenOff, screenOn],
    };
    const executable = parseStudyMethodProfile({
      ...profileBase,
      method_profile_id: "profile:registered-compedu-screen-session",
      session_construction_policies: [policy],
    });
    expect(compileNativeMethodProfile(executable)).toMatchObject({
      ok: true,
      options: {
        processScreenUsage: true,
        screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
      },
      receipt: {
        settingIds: [screenOff.method_setting_id, screenOn.method_setting_id],
      },
    });

    const omitted = parseStudyMethodProfile({
      ...profileBase,
      method_profile_id: "profile:omitted-compedu-screen-member",
      session_construction_policies: [
        { ...policy, method_settings: [screenOff] },
      ],
    });
    expect(compileNativeMethodProfile(omitted)).toMatchObject({
      ok: false,
      blockers: [
        {
          code: "uncompiled_profile_section",
          detail: "session_construction_policies",
        },
      ],
      legacyBlockers: [
        {
          code: "uncompiled_profile_section",
          detail: "session_construction_policies",
        },
      ],
    });

    expect(() => parseStudyMethodProfile({
      ...profileBase,
      method_profile_id: "profile:added-compedu-screen-member",
      session_construction_policies: [
        {
          ...policy,
          method_settings: [
            screenOff,
            screenOn,
            { ...screenOn, method_setting_id: "method-setting:forged-extra" },
          ],
        },
      ],
    })).toThrow(/foreign or changed policy member/);

    const unknownObject = parseStudyMethodProfile({
      ...profileBase,
      method_profile_id: "profile:unknown-compedu-session-object",
      session_construction_policies: [
        {
          ...policy,
          session_construction_policy_id:
            "session-construction-policy:forged-unknown",
        },
      ],
    });
    expect(compileNativeMethodProfile(unknownObject)).toMatchObject({
      ok: false,
      blockers: [
        {
          code: "uncompiled_profile_section",
          detail: "session_construction_policies",
        },
      ],
      legacyBlockers: [
        {
          code: "uncompiled_profile_section",
          detail: "session_construction_policies",
        },
      ],
    });

    const documentarySettings = Array.from({ length: 33 }, (_, index) => ({
      method_setting_id: `method-setting:compedu-documentary-${index + 1}`,
      source_extraction_id: `extraction:compedu-documentary-${index + 1}`,
      method_setting_role: "provenance",
      source_work_id: sourceWorkId,
      method_applicability_status: "not_applicable",
      method_disclosure_status: "not_applicable",
      method_implementation_status: "specification_only",
      contract_bindings: [],
    }));
    const blockedSourceProfile = parseStudyMethodProfile({
      method_profile_id: "method-profile:doi:10.1016/j.compedu.2019.103611",
      source_work_id: sourceWorkId,
      source_method_variant_id:
        "source-configuration-space-786d5a6f9db121084058ea05",
      method_configuration_structure: "fixed",
      method_profile_version: "literature-sublation-v3-atomic",
      profile_implementation_status: "blocked",
      method_setting_count: 35,
      method_setting_ids: [
        screenOff.method_setting_id,
        screenOn.method_setting_id,
        ...documentarySettings.map((setting) => setting.method_setting_id),
      ],
      method_settings: [screenOff, screenOn, ...documentarySettings],
      session_construction_policies: [policy],
    });
    const blocked = compileNativeMethodProfile(blockedSourceProfile);
    expect(blocked).toMatchObject({
      ok: true,
      legacyBlockers: [{ code: "profile_blocked", detail: "blocked" }],
    });
    expect(blocked.legacyBlockers).not.toContainEqual(
      expect.objectContaining({
        code: "uncompiled_profile_section",
        detail: "session_construction_policies",
      }),
    );
  });

  it("rejects configuration levels that reference settings outside the profile", () => {
    expect(() =>
      parseStudyMethodProfile({
        method_profile_id: "profile:paper",
        source_work_id: "doi:paper",
        source_method_variant_id: "space:paper",
        method_configuration_structure: "source_declared_axes",
        method_profile_version: "v1",
        profile_implementation_status: "blocked",
        method_settings: [],
        method_configuration_space: {
          method_configuration_space_id: "space:paper",
          method_configuration_structure: "source_declared_axes",
          method_configuration_groups: [
            {
              method_configuration_group_id: "group:1",
              method_configuration_group_kind: "source_sensitivity_axis",
              method_selection_semantics: "selectable",
              method_cross_product_policy:
                "prohibited_without_source_enumeration",
              method_configuration_levels: [
                {
                  method_configuration_level_id: "level:1",
                  method_configuration_level_label: "reported level",
                  included_method_setting_ids: ["missing:setting"],
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/outside the profile inventory/);
  });

  it("selects one exact source level without retaining its excluded alternative", () => {
    const settings = ["common", "left", "right"].map((id) => ({
      method_setting_id: id,
      source_extraction_id: `extraction:${id}`,
      method_setting_role: "provenance",
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "native",
      method_execution_route: "native_option_binding",
      conformance_fixture_id: `fixture:${id}`,
      conformance_result_digest: `sha256:${"a".repeat(64)}`,
      contract_bindings: [
        {
          contract_slot:
            id === "right"
              ? "screen_session_maximum_duration_minutes"
              : "minimum_usage_duration",
          contract_value_json:
            id === "common" ? "15" : id === "left" ? "15" : "30",
        },
      ],
    }));
    const profile = parseStudyMethodProfile({
      method_profile_id: "profile:paper",
      source_work_id: "doi:paper",
      source_method_variant_id: "space:paper",
      method_configuration_structure: "source_declared_axes",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: settings,
      method_configuration_space: {
        method_configuration_space_id: "space:paper",
        method_configuration_structure: "source_declared_axes",
        method_configuration_groups: [
          {
            method_configuration_group_id: "axis:1",
            method_configuration_group_kind: "source_sensitivity_axis",
            method_selection_semantics: "selectable",
            method_cross_product_policy:
              "prohibited_without_source_enumeration",
            method_configuration_levels: [
              {
                method_configuration_level_id: "level:left",
                method_configuration_level_label: "Left",
                included_method_setting_ids: ["common", "left"],
                excluded_method_setting_ids: ["right"],
              },
              {
                method_configuration_level_id: "level:right",
                method_configuration_level_label: "Right",
                included_method_setting_ids: ["common", "right"],
                excluded_method_setting_ids: ["left"],
              },
            ],
          },
        ],
      },
    });
    const selected = selectMethodConfiguration(profile, {
      "axis:1": "level:left",
    });
    expect(selected).toMatchObject({
      ok: true,
      selection: {
        selectedLevelIds: ["level:left"],
        effectiveSettingIds: ["common", "left"],
      },
    });
    expect(compileNativeMethodProfile(profile)).toMatchObject({
      ok: false,
      blockers: [{ code: "configuration_selection_required" }],
    });
    expect(enumerateMethodConfigurations(profile)).toMatchObject({
      ok: true,
      selections: [
        {
          selectedLevelIds: ["level:left"],
          effectiveSettingIds: ["common", "left"],
        },
        {
          selectedLevelIds: ["level:right"],
          effectiveSettingIds: ["common", "right"],
        },
      ],
    });
    expect(compileNativeMethodProfileCampaign(profile)).toMatchObject({
      ok: true,
      runs: [
        {
          selection: { selectedLevelIds: ["level:left"] },
          compilation: { ok: true },
        },
        {
          selection: { selectedLevelIds: ["level:right"] },
          compilation: { ok: true },
        },
      ],
    });
    if (!selected.ok) throw new Error("expected an exact source selection");
    const compiled = compileNativeMethodProfile(
      profile,
      undefined,
      selected.selection,
    );
    expect(compiled).toMatchObject({
      ok: true,
      receipt: {
        sourceMethodVariantId: "space:paper",
        sourceMethodVariantIds: ["level:left"],
        settingIds: ["common", "left"],
      },
    });
    if (!compiled.ok)
      throw new Error("expected the exact source selection to compile");
    expect(
      compiled.receipt.bindings.map((binding) => binding.settingId),
    ).toEqual(["common", "left"]);
  });

  it("rejects a fabricated selection inventory and a non-enumerated source combination", () => {
    const profile = parseStudyMethodProfile({
      method_profile_id: "profile:paper",
      source_work_id: "doi:paper",
      source_method_variant_id: "space:paper",
      method_configuration_structure: "enumerated_combinations",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: ["a1", "a2", "b1", "b2"].map((id) => ({
        method_setting_id: id,
        source_extraction_id: `extraction:${id}`,
        method_setting_role: "provenance",
        method_applicability_status: "applicable",
        method_disclosure_status: "declared",
        method_implementation_status: "native",
        method_execution_route: "native_option_binding",
        conformance_fixture_id: `fixture:${id}`,
        conformance_result_digest: `sha256:${"b".repeat(64)}`,
        contract_bindings: [
          {
            contract_slot: "minimum_usage_duration",
            contract_value_json: "15",
          },
        ],
      })),
      method_configuration_space: {
        method_configuration_space_id: "space:paper",
        method_configuration_structure: "enumerated_combinations",
        method_configuration_groups: [
          {
            method_configuration_group_id: "axis:a",
            method_configuration_group_kind: "source_sensitivity_axis",
            method_selection_semantics: "selectable",
            method_cross_product_policy: "source_enumerated_only",
            method_configuration_levels: [
              {
                method_configuration_level_id: "level:a1",
                method_configuration_level_label: "A1",
                included_method_setting_ids: ["a1"],
                excluded_method_setting_ids: ["a2"],
              },
              {
                method_configuration_level_id: "level:a2",
                method_configuration_level_label: "A2",
                included_method_setting_ids: ["a2"],
                excluded_method_setting_ids: ["a1"],
              },
            ],
          },
          {
            method_configuration_group_id: "axis:b",
            method_configuration_group_kind: "source_sensitivity_axis",
            method_selection_semantics: "selectable",
            method_cross_product_policy: "source_enumerated_only",
            method_configuration_levels: [
              {
                method_configuration_level_id: "level:b1",
                method_configuration_level_label: "B1",
                included_method_setting_ids: ["b1"],
                excluded_method_setting_ids: ["b2"],
              },
              {
                method_configuration_level_id: "level:b2",
                method_configuration_level_label: "B2",
                included_method_setting_ids: ["b2"],
                excluded_method_setting_ids: ["b1"],
              },
            ],
          },
        ],
        allowed_method_combinations: [
          {
            method_configuration_combination_id: "combination:1",
            method_configuration_combination_label: "A1 + B1",
            selected_method_configuration_level_ids: ["level:a1", "level:b1"],
          },
        ],
      },
    });
    expect(
      selectMethodConfiguration(profile, {
        "axis:a": "level:a1",
        "axis:b": "level:b2",
      }),
    ).toMatchObject({
      ok: false,
      blockers: [{ code: "combination_not_enumerated" }],
    });
    const enumerated = selectMethodConfiguration(profile, {
      "axis:a": "level:a1",
      "axis:b": "level:b1",
    });
    expect(enumerated).toMatchObject({
      ok: true,
      selection: {
        selectedLevelIds: ["level:a1", "level:b1"],
        selectedCombinationId: "combination:1",
      },
    });
    expect(enumerateMethodConfigurations(profile)).toMatchObject({
      ok: true,
      selections: [
        {
          selectedLevelIds: ["level:a1", "level:b1"],
          selectedCombinationId: "combination:1",
        },
      ],
    });
    if (!enumerated.ok)
      throw new Error("expected the exact source-enumerated combination");
    expect(
      compileNativeMethodProfile(profile, undefined, enumerated.selection),
    ).toMatchObject({
      ok: true,
      receipt: {
        sourceMethodVariantId: "space:paper",
        sourceMethodVariantIds: ["level:a1", "level:b1"],
        sourceMethodCombinationId: "combination:1",
      },
    });
    expect(
      compileNativeMethodProfile(profile, undefined, {
        selectionId: "fabricated",
        selectedLevelIds: ["level:a1", "level:b1"],
        effectiveSettingIds: ["a1", "b1", "a2"],
      }),
    ).toMatchObject({
      ok: false,
      blockers: [{ code: "configuration_selection_mismatch" }],
    });
  });

  it("enumerates disclosed axes one level at a time when the source forbids a Cartesian product", () => {
    const parallelOutputs = {
      method_configuration_group_id: "output:logical-status",
      method_configuration_group_kind: "parallel_source_outputs",
      method_selection_semantics:
        "all_source_outputs_emitted_in_parallel_no_selection",
      method_cross_product_policy: "parallel_outputs_not_a_configuration_axis",
      method_configuration_levels: ["busy", "alone", "happy", "stressful"].map(
        (status) => ({
          method_configuration_level_id: `output:${status}`,
          method_configuration_level_label: status,
          included_method_setting_ids: [],
        }),
      ),
    };
    const selectableAxis = (axis: string) => ({
      method_configuration_group_id: `axis:${axis}`,
      method_configuration_group_kind: "source_sensitivity_axis",
      method_selection_semantics:
        axis === "a"
          ? "source_levels_selectable_without_cross_group_expansion"
          : "independently_selectable",
      method_cross_product_policy: "not_enumerated_no_cartesian_product",
      unresolved_method_setting_ids: [`${axis}1`, `${axis}2`],
      method_configuration_levels: ["1", "2"].map((level) => ({
        method_configuration_level_id: `level:${axis}${level}`,
        method_configuration_level_label: `${axis}${level}`,
        included_method_setting_ids: [`${axis}${level}`],
        excluded_method_setting_ids: [`${axis}${level === "1" ? "2" : "1"}`],
        unresolved_method_setting_ids: [`${axis}${level}`],
      })),
    });
    expect(requiresConfigurationSelection(parallelOutputs)).toBe(false);
    expect(requiresConfigurationSelection({
      method_selection_semantics: "condition_driven_joint_protocol_no_user_selection",
      method_configuration_levels: [{ method_configuration_level_id: "screen:on" }, { method_configuration_level_id: "screen:off" }],
    })).toBe(false);
    expect(requiresConfigurationSelection(selectableAxis("a"))).toBe(true);
    const profile = parseStudyMethodProfile({
      method_profile_id: "profile:isolated-axes",
      source_work_id: "doi:isolated-axes",
      source_method_variant_id: "space:isolated-axes",
      method_configuration_structure: "source_declared_axes",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: ["a1", "a2", "b1", "b2"].map((id) => ({
        method_setting_id: id,
        source_extraction_id: `extraction:${id}`,
        method_setting_role: "provenance",
        method_applicability_status: "applicable",
        method_disclosure_status: "declared",
        method_implementation_status: "native",
        method_execution_route: "native_option_binding",
        conformance_fixture_id: `fixture:${id}`,
        conformance_result_digest: `sha256:${"d".repeat(64)}`,
        contract_bindings: [
          {
            contract_slot: "minimum_usage_duration",
            contract_value_json: id.endsWith("1") ? "1" : "2",
          },
        ],
      })),
      method_configuration_space: {
        method_configuration_space_id: "space:isolated-axes",
        method_configuration_structure: "source_declared_axes",
        unresolved_method_setting_ids: ["a1", "a2", "b1", "b2"],
        method_configuration_groups: [
          parallelOutputs,
          ...["a", "b"].map(selectableAxis),
        ],
      },
    });
    expect(selectMethodConfiguration(profile, {})).toMatchObject({
      ok: false,
      blockers: [{ code: "missing_level" }, { code: "missing_level" }],
    });
    expect(
      selectMethodConfiguration(profile, {
        "axis:a": "level:a1",
        "axis:b": "level:b1",
      }),
    ).toMatchObject({
      ok: false,
      blockers: [{ code: "cross_group_product_not_enumerated" }],
    });
    expect(
      selectMethodConfiguration(profile, { "axis:a": "level:a1" }),
    ).toMatchObject({
      ok: true,
      selection: {
        selectedLevelIds: ["level:a1"],
        effectiveSettingIds: ["a1"],
      },
    });
    expect(selectMethodConfiguration(profile, {
      "axis:a": "level:a1",
      "output:logical-status": "output:busy",
    })).toMatchObject({
      ok: false,
      blockers: [{ groupId: "output:logical-status", code: "nonselectable_level" }],
    });
    expect(enumerateMethodConfigurations(profile)).toMatchObject({
      ok: true,
      selections: [
        { selectedLevelIds: ["level:a1"], effectiveSettingIds: ["a1"] },
        { selectedLevelIds: ["level:a2"], effectiveSettingIds: ["a2"] },
        { selectedLevelIds: ["level:b1"], effectiveSettingIds: ["b1"] },
        { selectedLevelIds: ["level:b2"], effectiveSettingIds: ["b2"] },
      ],
    });
    const campaign = compileNativeMethodProfileCampaign(profile);
    expect(campaign).toMatchObject({ ok: true });
    if (!campaign.ok)
      throw new Error("expected isolated-axis campaign to compile");
    expect(campaign.runs).toHaveLength(4);
    expect(campaign.runs.every(({ compilation }) => compilation.ok)).toBe(true);
  });

  it("rejects an applicable setting omitted from or conflicting within the selected configuration partition", () => {
    const methodSettings = ["included", "omitted"].map((id) => ({
      method_setting_id: id,
      source_extraction_id: `extraction:${id}`,
      method_setting_role: "provenance",
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "native",
      method_execution_route: "native_option_binding",
      conformance_fixture_id: `fixture:${id}`,
      conformance_result_digest: `sha256:${"c".repeat(64)}`,
      contract_bindings: [
        { contract_slot: "minimum_usage_duration", contract_value_json: "15" },
      ],
    }));
    const source = (
      excludedMethodSettingIds: string[] = [],
      invariantMethodSettingIds: string[] = [],
    ) =>
      parseStudyMethodProfile({
        method_profile_id: "profile:partition-omission",
        source_work_id: "doi:partition-omission",
        source_method_variant_id: "space:partition-omission",
        method_configuration_structure: "source_declared_axes",
        method_profile_version: "v1",
        profile_implementation_status: "executable",
        method_settings: methodSettings,
        method_configuration_space: {
          method_configuration_space_id: "space:partition-omission",
          method_configuration_structure: "source_declared_axes",
          invariant_method_setting_ids: invariantMethodSettingIds,
          method_configuration_groups: [
            {
              method_configuration_group_id: "group:partition-omission",
              method_configuration_group_kind: "fixed_set",
              method_selection_semantics: "joint",
              method_cross_product_policy: "not_applicable",
              method_configuration_levels: [
                {
                  method_configuration_level_id: "level:partition-omission",
                  method_configuration_level_label: "Reported configuration",
                  included_method_setting_ids: ["included"],
                  excluded_method_setting_ids: excludedMethodSettingIds,
                },
              ],
            },
          ],
        },
      });

    const omitted = source();
    const omittedSelection = selectMethodConfiguration(omitted, {});
    if (!omittedSelection.ok)
      throw new Error("expected the one-level source selection");
    expect(
      compileNativeMethodProfile(
        omitted,
        undefined,
        omittedSelection.selection,
      ),
    ).toMatchObject({
      ok: false,
      blockers: [
        {
          settingId: "omitted",
          code: "configuration_selection_mismatch",
          detail:
            "applicable setting is omitted from the selected configuration partition",
        },
      ],
    });

    const conflicting = source(["included", "omitted"]);
    const conflictingSelection = selectMethodConfiguration(conflicting, {});
    if (!conflictingSelection.ok)
      throw new Error("expected the one-level source selection");
    expect(
      compileNativeMethodProfile(
        conflicting,
        undefined,
        conflictingSelection.selection,
      ),
    ).toMatchObject({
      ok: false,
      blockers: [
        expect.objectContaining({
          settingId: "included",
          code: "configuration_selection_mismatch",
          detail:
            "applicable setting is both included and excluded by the selected configuration partition",
        }),
      ],
    });

    const duplicated = source(["omitted"], ["included"]);
    const duplicatedSelection = selectMethodConfiguration(duplicated, {});
    if (!duplicatedSelection.ok)
      throw new Error("expected the one-level source selection");
    expect(
      compileNativeMethodProfile(
        duplicated,
        undefined,
        duplicatedSelection.selection,
      ),
    ).toMatchObject({
      ok: false,
      blockers: [
        {
          settingId: "included",
          code: "configuration_selection_mismatch",
          detail:
            "applicable setting is included more than once by the selected configuration partition",
        },
      ],
    });
  });

  it("validates exact documentary conformance without manufacturing an executable plan", () => {
    const settingId = "method-setting-0d4c2d71ec4c6dea11ac19b0";
    const assertion = sourceArtifactProvenanceAssertionForSetting(settingId);
    const identity = sourceArtifactProfileIdentityForSetting(settingId);
    if (!assertion || !identity)
      throw new Error("expected the registered documentary setting");
    const profile = parseStudyMethodProfile({
      method_profile_id: identity.method_profile_id,
      source_work_id: identity.source_work_id,
      source_method_variant_id: identity.source_method_variant_id,
      method_configuration_structure: "documentary_only",
      method_profile_version: identity.method_profile_version,
      profile_implementation_status: "executable",
      method_settings: [
        {
          method_setting_id: assertion.method_setting_id,
          source_extraction_id: assertion.source_extraction_id,
          method_setting_role: "provenance",
          source_value_sha256: assertion.source_value_sha256,
          method_applicability_status: "applicable",
          method_disclosure_status: "declared",
          method_implementation_status: "native",
          method_execution_route: "receipt_conformance",
          method_execution_destination_id:
            "chronicle.source-artifact-provenance-registry",
          method_execution_parameter_path:
            "/methodProfileReceipt/documentaryBindings",
          executor_id:
            "chronicle_preprocessing_runtime_wasm:source_artifact_provenance_registry",
          conformance_fixture_id: assertion.conformance_fixture_id,
          conformance_result_digest: assertion.conformance_result_digest,
          contract_bindings: [],
        },
      ],
      source_artifact_provenance_assertions: [
        {
          source_artifact_provenance_id: String(
            assertion.source_artifact_provenance.source_artifact_provenance_id,
          ),
          method_setting_id: assertion.method_setting_id,
          source_work_id: assertion.source_work_id,
          source_extraction_id: assertion.source_extraction_id,
          source_value_sha256: assertion.source_value_sha256,
          source_artifact_provenance_object_json: canonicalJson(
            assertion.source_artifact_provenance,
          ),
          source_artifact_provenance_object_digest:
            assertion.source_artifact_provenance_object_digest,
          provenance_keys: assertion.provenance_keys,
          candidate_status: assertion.candidate_status,
          conformance_fixture_id: assertion.conformance_fixture_id,
          conformance_result_digest: assertion.conformance_result_digest,
          execution_eligibility: "documentary_only",
        },
      ],
    });

    const compiled = compileNativeMethodProfile(profile);
    expect(compiled).toMatchObject({
      ok: false,
      blockers: [{ code: "empty_native_plan" }],
      readiness: {
        preprocessing: { status: "blocked" },
        evidence: { status: "ready" },
        disposition: "unresolved",
      },
      legacyBlockers: [],
    });
    expect("supportedPlan" in compiled).toBe(false);
  });

  it("keeps unaudited behavioral settings out of the documentary registry", () => {
    const settingId = "method-setting-fd4fa05728c64c05f27c755a";
    expect(
      profileProtocolDocumentaryBindingForSetting(settingId),
    ).toBeUndefined();
    expect(profileProtocolProfileIdentityForSetting(settingId)).toBeUndefined();
    const profile = parseStudyMethodProfile({
      method_profile_id: "method-profile:doi:10.1007/978-3-319-51394-2_2",
      source_work_id: "doi:10.1007/978-3-319-51394-2_2",
      source_method_variant_id:
        "source-configuration-space-303a0b333c4549977e93",
      method_configuration_structure: "documentary_only",
      method_profile_version: "literature-sublation-v3-atomic",
      profile_implementation_status: "executable",
      method_settings: [
        {
          method_setting_id: settingId,
          source_extraction_id: "extraction:profile-protocol-documentary",
          method_setting_role: "provenance",
          method_applicability_status: "applicable",
          method_disclosure_status: "declared",
          method_implementation_status: "native",
          method_execution_route: "receipt_conformance",
          method_execution_destination_id:
            "chronicle.profile-protocol-documentary-registry",
          method_execution_parameter_path:
            "/methodProfileReceipt/documentaryBindings",
          executor_id:
            "chronicle_preprocessing_runtime_wasm:profile_protocol_documentary_registry",
          conformance_fixture_id: `profile-protocol-documentary.${settingId}.v1`,
          conformance_result_digest: `sha256:${"a".repeat(64)}`,
          contract_bindings: [],
        },
      ],
    });

    const compiled = compileNativeMethodProfile(profile);
    expect(compiled).toMatchObject({
      ok: false,
      blockers: [
        { code: "empty_native_plan" },
        {
          settingId,
          code: "missing_conformance",
          detail:
            "receipt-conformance setting does not exactly match the closed documentary registry",
        },
      ],
      readiness: {
        preprocessing: { status: "blocked" },
        evidence: { status: "blocked" },
        disposition: "unresolved",
      },
      legacyBlockers: [{ settingId, code: "missing_conformance" }],
    });
    expect("supportedPlan" in compiled).toBe(false);
  });
});
