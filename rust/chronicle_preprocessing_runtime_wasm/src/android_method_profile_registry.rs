use crate::{MethodProfileOutputBindingReceipt, MethodProfileReceipt};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::OnceLock,
};

const CONFORMANCE_JSON: &str = include_str!("../tests/fixtures/literature_native_conformance.json");
const SOURCE_LIBRARY_SHA256: &str =
    "0f4bcc19c32d096050e982eab7ea9a643a13a3fb1b592aa61ca29d4f23607129";
const SOURCE_EXECUTION_SPEC_SHA256: &str =
    "cb5c33eb2ec25b20c4d5c922173cb6c28da2f9d70db814ffbf14014724aad168";
const REGISTRY_CONTENT_DIGEST: &str =
    "sha256:ecfdaa6f2b6bf3333c1027eec0cd71844cafdbfad7042acb98a7a3ac8752c1c8";
const CONFORMANCE_SHA256: &str = "cceb25f79e97d4748ba1c8f0612ddb2054c7b748f3b8d059b0c44f992672864f";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistrySummary {
    profile_count: usize,
    configuration_count: usize,
    completed_configuration_count: usize,
    blocked_configuration_count: usize,
    setting_count: usize,
    applicable_setting_count: usize,
    group_count: usize,
    level_count: usize,
    explicit_source_variant_count: usize,
    executable_profile_count: usize,
    protocol_documentary_binding_count: usize,
    typed_section_count: usize,
    output_binding_count: usize,
    #[serde(default)]
    registered_component_count: usize,
    #[serde(default)]
    profiles_with_registered_components_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryLevel {
    level_id: String,
    included_setting_ids: Vec<String>,
    excluded_setting_ids: Vec<String>,
    documentary_setting_ids: Vec<String>,
    unresolved_setting_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryGroup {
    group_id: String,
    axis_isolated: bool,
    documentary_setting_ids: Vec<String>,
    unresolved_setting_ids: Vec<String>,
    levels: Vec<RegistryLevel>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryCombination {
    combination_id: String,
    selected_level_ids: Vec<String>,
    included_setting_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryCompletedConfiguration {
    selected_level_ids: Vec<String>,
    #[serde(default)]
    selected_combination_id: Option<String>,
    execution_eligible: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryProtocolDocumentaryBinding {
    setting_id: String,
    registry_input: Value,
    registry_input_sha256: String,
    conformance_fixture_id: String,
    conformance_result_digest: String,
    execution_eligible: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryOutputBinding {
    setting_id: String,
    output_kind: String,
    source_field: String,
    source_position: usize,
    canonical_field: String,
    conformance_fixture_id: String,
    conformance_result_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryComponent {
    component_id: String,
    setting_ids: Vec<String>,
    input_role: String,
    required_support_roles: Vec<String>,
    limitations: Vec<String>,
    source_oracle_id: String,
    parent_method_profile_id: String,
    source_work_id: String,
    source_method_variant_id: String,
    method_profile_version: String,
    full_profile_execution_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistryProfile {
    method_profile_id: String,
    source_work_id: String,
    source_method_variant_id: String,
    method_profile_version: String,
    profile_implementation_status: String,
    configuration_count: usize,
    completed_configuration_count: usize,
    blocked_configuration_count: usize,
    full_profile_blocked_reason: Option<String>,
    completed_configurations: Vec<RegistryCompletedConfiguration>,
    applicable_setting_ids: Vec<String>,
    runtime_setting_ids: Vec<String>,
    #[serde(default)]
    registered_components: Vec<RegistryComponent>,
    protocol_documentary_bindings: Vec<RegistryProtocolDocumentaryBinding>,
    typed_sections: BTreeMap<String, String>,
    #[serde(default)]
    output_bindings: Vec<RegistryOutputBinding>,
    not_applicable_setting_ids: Vec<String>,
    invariant_setting_ids: Vec<String>,
    documentary_setting_ids: Vec<String>,
    unresolved_setting_ids: Vec<String>,
    groups: Vec<RegistryGroup>,
    combinations: Vec<RegistryCombination>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Registry {
    schema_version: String,
    source_library_sha256: String,
    source_execution_spec_sha256: String,
    summary: RegistrySummary,
    profiles: Vec<RegistryProfile>,
    content_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConformanceFixture {
    fixture_id: String,
    method_setting_ids: Vec<String>,
    browser_contract_bindings: BTreeMap<String, Value>,
    #[serde(default)]
    output_bindings: Vec<ConformanceOutputBinding>,
    result_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConformanceOutputBinding {
    method_setting_id: String,
    chronicle_output_kind: String,
    source_output_field: String,
    chronicle_output_column: String,
    source_output_position: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConformanceManifest {
    schema_version: String,
    fixtures: Vec<ConformanceFixture>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReceiptAuthority {
    Canonical,
    ConformanceFixture,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CanonicalReceiptAdmission {
    CompletedProofRequired,
    ConformanceAttempt,
}

pub(crate) fn validate_output_bindings(
    receipt: &MethodProfileReceipt,
    include_app_output: bool,
    include_screen_output: bool,
) -> Result<(), String> {
    let mut setting_ids = BTreeSet::new();
    for binding in &receipt.output_bindings {
        if !setting_ids.insert(binding.setting_id.as_str()) {
            return Err(
                "methodProfileReceipt output bindings contain a duplicate setting ID".into(),
            );
        }
        match binding.output_kind.as_str() {
            "app-csv" if !include_app_output => {
                return Err(
                    "methodProfileReceipt app-csv output binding requires includeAppOutput".into(),
                )
            }
            "screen-csv" if !include_screen_output => {
                return Err(
                    "methodProfileReceipt screen-csv output binding requires includeScreenOutput"
                        .into(),
                )
            }
            _ => {}
        }
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn exact_set(values: &[String]) -> Option<BTreeSet<&str>> {
    let set = values.iter().map(String::as_str).collect::<BTreeSet<_>>();
    (set.len() == values.len() && !set.iter().any(|value| value.is_empty())).then_some(set)
}

fn conformance_manifest() -> Result<ConformanceManifest, String> {
    if sha256(CONFORMANCE_JSON.as_bytes()) != CONFORMANCE_SHA256 {
        return Err("literature conformance fixture registry content drift".into());
    }
    let manifest: ConformanceManifest = serde_json::from_str(CONFORMANCE_JSON)
        .map_err(|error| format!("parse literature conformance fixture registry: {error}"))?;
    if manifest.schema_version != "chronicle-literature-native-conformance/v1"
        || manifest.fixtures.len() != 27
    {
        return Err("literature conformance fixture registry identity drift".into());
    }
    Ok(manifest)
}

fn validate_registry() -> Result<Registry, String> {
    let mut raw: Value = serde_json::from_str(crate::packed_json::ANDROID_REGISTRY.text()?)
        .map_err(|error| format!("parse Android method-profile registry: {error}"))?;
    let registry: Registry = serde_json::from_value(raw.clone())
        .map_err(|error| format!("shape Android method-profile registry: {error}"))?;
    let declared_digest = raw
        .as_object_mut()
        .and_then(|object| object.remove("content_digest"))
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| "Android method-profile registry content_digest is missing".to_owned())?;
    let observed_digest =
        format!(
            "sha256:{}",
            sha256(&serde_jcs::to_vec(&raw).map_err(|error| format!(
                "canonicalize Android method-profile registry: {error}"
            ))?)
        );
    if registry.schema_version != "chronicle-android-method-profile-runtime-registry/v1"
        || registry.source_library_sha256 != SOURCE_LIBRARY_SHA256
        || registry.source_execution_spec_sha256 != SOURCE_EXECUTION_SPEC_SHA256
        || registry.content_digest != declared_digest
        || declared_digest != REGISTRY_CONTENT_DIGEST
        || observed_digest != declared_digest
        || registry.summary.configuration_count == 0
        || registry.summary.completed_configuration_count
            + registry.summary.blocked_configuration_count
            != registry.summary.configuration_count
        || registry.summary.applicable_setting_count > registry.summary.setting_count
        || registry.summary.explicit_source_variant_count > registry.summary.level_count
        || registry.profiles.len() != registry.summary.profile_count
    {
        return Err("Android method-profile registry identity or count drift".into());
    }

    let conformance = conformance_manifest()?;
    let mut conformance_output_bindings = BTreeMap::new();
    for fixture in &conformance.fixtures {
        for binding in &fixture.output_bindings {
            if !fixture
                .method_setting_ids
                .contains(&binding.method_setting_id)
                || conformance_output_bindings
                    .insert(binding.method_setting_id.as_str(), (fixture, binding))
                    .is_some()
            {
                return Err("literature output conformance fixture setting drift".into());
            }
        }
    }
    if conformance_output_bindings.len() != 7 {
        return Err("literature output conformance fixture count drift".into());
    }

    let mut profile_ids = BTreeSet::new();
    let mut work_ids = BTreeSet::new();
    let mut group_ids = BTreeSet::new();
    let mut level_ids = BTreeSet::new();
    let mut setting_count = 0;
    let mut applicable_setting_count = 0;
    let mut configuration_count = 0;
    let mut completed_configuration_count = 0;
    let mut blocked_configuration_count = 0;
    let mut executable_profile_count = 0;
    let mut protocol_documentary_binding_count = 0;
    let mut typed_section_count = 0;
    let mut output_binding_ids = BTreeSet::new();
    let mut registered_component_ids = BTreeSet::new();
    let mut registered_component_setting_ids = BTreeSet::new();
    let mut profiles_with_registered_components_count = 0;
    for profile in &registry.profiles {
        if !profile_ids.insert(profile.method_profile_id.as_str())
            || !work_ids.insert(profile.source_work_id.as_str())
            || profile.source_method_variant_id.is_empty()
            || profile.method_profile_version.is_empty()
            || profile.configuration_count == 0
            || profile.completed_configuration_count + profile.blocked_configuration_count
                != profile.configuration_count
            || profile
                .full_profile_blocked_reason
                .as_ref()
                .is_some_and(|reason| {
                    profile.configuration_count != 1
                        || profile.blocked_configuration_count != 1
                        || reason.trim().is_empty()
                })
            || profile.completed_configurations.len() != profile.completed_configuration_count
            || !matches!(
                profile.profile_implementation_status.as_str(),
                "executable" | "blocked"
            )
            || (profile.profile_implementation_status == "executable")
                != (profile.completed_configuration_count == profile.configuration_count
                    && profile.blocked_configuration_count == 0)
        {
            return Err(
                "Android method-profile registry has duplicate or empty profile identity".into(),
            );
        }
        let applicable = exact_set(&profile.applicable_setting_ids).ok_or_else(|| {
            "Android method-profile registry has invalid applicable settings".to_owned()
        })?;
        let not_applicable = exact_set(&profile.not_applicable_setting_ids).ok_or_else(|| {
            "Android method-profile registry has invalid not-applicable settings".to_owned()
        })?;
        if !applicable.is_disjoint(&not_applicable) {
            return Err("Android method-profile registry setting partition overlaps".into());
        }
        let known = applicable
            .union(&not_applicable)
            .copied()
            .collect::<BTreeSet<_>>();
        let validate_settings = |values: &[String]| {
            exact_set(values).is_some_and(|ids| ids.iter().all(|id| known.contains(id)))
        };
        for values in [
            &profile.runtime_setting_ids,
            &profile.invariant_setting_ids,
            &profile.documentary_setting_ids,
            &profile.unresolved_setting_ids,
        ] {
            if !validate_settings(values) {
                return Err(
                    "Android method-profile registry profile setting ownership drift".into(),
                );
            }
        }
        profiles_with_registered_components_count +=
            usize::from(!profile.registered_components.is_empty());
        for component in &profile.registered_components {
            let setting_ids = exact_set(&component.setting_ids).ok_or_else(|| {
                "Android method-profile component has invalid settings".to_owned()
            })?;
            let (owned, dependencies) =
                crate::literature_input_adapters::literature_component_setting_partition(
                    &component.component_id,
                )?;
            let registered_settings = owned
                .iter()
                .chain(dependencies)
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            if setting_ids != registered_settings
                || registered_settings.len() != owned.len() + dependencies.len()
            {
                return Err(
                    "Android method-profile component setting/dependency partition drift".into(),
                );
            }
            let support_roles = component
                .required_support_roles
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            let limitations = component
                .limitations
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            if component.component_id.trim().is_empty()
                || !registered_component_ids.insert(component.component_id.as_str())
                || setting_ids.is_empty()
                || setting_ids
                    .iter()
                    .any(|setting_id| !applicable.contains(*setting_id))
                || owned
                    .iter()
                    .any(|setting_id| !registered_component_setting_ids.insert(setting_id.as_str()))
                || component.input_role.trim().is_empty()
                || support_roles.len() != component.required_support_roles.len()
                || support_roles
                    .iter()
                    .any(|role| role.trim().is_empty() || !crate::is_registered_support_role(role))
                || limitations.len() != component.limitations.len()
                || limitations
                    .iter()
                    .any(|limitation| limitation.trim().is_empty())
                || component.source_oracle_id.trim().is_empty()
                || component.parent_method_profile_id != profile.method_profile_id
                || component.source_work_id != profile.source_work_id
                || component.source_method_variant_id != profile.source_method_variant_id
                || component.method_profile_version != profile.method_profile_version
                || component.full_profile_execution_status != profile.profile_implementation_status
            {
                return Err("Android method-profile component registry drift".into());
            }
        }
        let mut protocol_documentary_ids = BTreeSet::new();
        for binding in &profile.protocol_documentary_bindings {
            let input = binding.registry_input.as_object().ok_or_else(|| {
                "Android method-profile protocol documentary input is not an object".to_owned()
            })?;
            let input_digest = format!(
                "sha256:{}",
                sha256(
                    &serde_jcs::to_vec(&binding.registry_input).map_err(|error| {
                        format!("canonicalize profile-protocol documentary input: {error}")
                    })?
                )
            );
            let expected_result = serde_json::json!({
                "schema_version": "chronicle-profile-protocol-documentary-result/v1",
                "accepted": true,
                "fixture_id": binding.conformance_fixture_id,
                "registry_input_sha256": binding.registry_input_sha256,
                "execution_eligible": false,
            });
            let result_digest = format!(
                "sha256:{}",
                sha256(&serde_jcs::to_vec(&expected_result).map_err(|error| {
                    format!("canonicalize profile-protocol documentary result: {error}")
                })?)
            );
            if !protocol_documentary_ids.insert(binding.setting_id.as_str())
                || !applicable.contains(binding.setting_id.as_str())
                || !profile.runtime_setting_ids.contains(&binding.setting_id)
                || input.get("schema_version").and_then(Value::as_str)
                    != Some("chronicle-profile-protocol-documentary-binding/v1")
                || input.get("method_profile_id").and_then(Value::as_str)
                    != Some(profile.method_profile_id.as_str())
                || input.get("source_work_id").and_then(Value::as_str)
                    != Some(profile.source_work_id.as_str())
                || input
                    .get("source_method_variant_id")
                    .and_then(Value::as_str)
                    != Some(profile.source_method_variant_id.as_str())
                || input.get("method_profile_version").and_then(Value::as_str)
                    != Some(profile.method_profile_version.as_str())
                || input.get("method_setting_id").and_then(Value::as_str)
                    != Some(binding.setting_id.as_str())
                || input
                    .get("source_locators")
                    .and_then(Value::as_array)
                    .is_none_or(Vec::is_empty)
                || binding.registry_input_sha256 != input_digest
                || binding.conformance_fixture_id
                    != format!("profile-protocol-documentary.{}.v1", binding.setting_id)
                || binding.conformance_result_digest != result_digest
                || binding.execution_eligible
            {
                return Err("Android method-profile protocol documentary registry drift".into());
            }
        }
        protocol_documentary_binding_count += protocol_documentary_ids.len();
        for (section, projection) in &profile.typed_sections {
            if !matches!(
                section.as_str(),
                "method_operations"
                    | "acquisition_protocols"
                    | "session_construction_policies"
                    | "notification_attribution_policies"
                    | "duration_policies"
                    | "timestamp_policies"
                    | "parameter_provenance_assertions"
                    | "protocol_materialization_blockers"
                    | "diary_protocols"
                    | "release_profiles"
            ) {
                return Err("Android method-profile registry has an unknown typed section".into());
            }
            let value: Value = serde_json::from_str(projection)
                .map_err(|error| format!("parse typed section projection: {error}"))?;
            if serde_jcs::to_string(&value)
                .map_err(|error| format!("canonicalize typed section projection: {error}"))?
                != *projection
            {
                return Err("Android method-profile typed section is not canonical".into());
            }
        }
        typed_section_count += profile.typed_sections.len();
        let mut profile_output_binding_ids = BTreeSet::new();
        for binding in &profile.output_bindings {
            let (fixture, expected) = conformance_output_bindings
                .get(binding.setting_id.as_str())
                .ok_or_else(|| {
                    "Android method-profile output binding setting is not registered".to_owned()
                })?;
            if !profile_output_binding_ids.insert(binding.setting_id.as_str())
                || !output_binding_ids.insert(binding.setting_id.as_str())
                || !applicable.contains(binding.setting_id.as_str())
                || !profile.runtime_setting_ids.contains(&binding.setting_id)
                || binding.output_kind != expected.chronicle_output_kind
                || binding.source_field != expected.source_output_field
                || binding.source_position != expected.source_output_position
                || binding.canonical_field != expected.chronicle_output_column
                || binding.conformance_fixture_id != fixture.fixture_id
                || binding.conformance_result_digest != fixture.result_digest
            {
                return Err("Android method-profile output binding registry drift".into());
            }
        }
        let mut profile_level_ids = BTreeSet::new();
        for group in &profile.groups {
            if !group_ids.insert(group.group_id.as_str())
                || !validate_settings(&group.documentary_setting_ids)
                || !validate_settings(&group.unresolved_setting_ids)
            {
                return Err(
                    "Android method-profile registry group identity or ownership drift".into(),
                );
            }
            for level in &group.levels {
                if !level_ids.insert(level.level_id.as_str())
                    || !profile_level_ids.insert(level.level_id.as_str())
                    || !validate_settings(&level.included_setting_ids)
                    || !validate_settings(&level.excluded_setting_ids)
                    || !validate_settings(&level.documentary_setting_ids)
                    || !validate_settings(&level.unresolved_setting_ids)
                {
                    return Err(
                        "Android method-profile registry level identity or ownership drift".into(),
                    );
                }
            }
        }
        let mut completed_configuration_keys = BTreeSet::new();
        for configuration in &profile.completed_configurations {
            let selected = exact_set(&configuration.selected_level_ids).ok_or_else(|| {
                "Android method-profile completed configuration has duplicate levels".to_owned()
            })?;
            if !configuration.execution_eligible
                || (selected.is_empty()
                    && (!profile.groups.is_empty() || profile.runtime_setting_ids.is_empty()))
                || selected
                    .iter()
                    .any(|level_id| !profile_level_ids.contains(*level_id))
                || effective_setting_ids(
                    profile,
                    &configuration.selected_level_ids,
                    configuration.selected_combination_id.as_deref(),
                )
                .is_err()
            {
                return Err("Android method-profile completed configuration is invalid".into());
            }
            let key = format!(
                "{}\0{}",
                selected.into_iter().collect::<Vec<_>>().join("\0"),
                configuration
                    .selected_combination_id
                    .as_deref()
                    .unwrap_or("")
            );
            if !completed_configuration_keys.insert(key) {
                return Err("Android method-profile completed configuration is duplicated".into());
            }
        }
        setting_count += known.len();
        applicable_setting_count += applicable.len();
        configuration_count += profile.configuration_count;
        completed_configuration_count += profile.completed_configuration_count;
        blocked_configuration_count += profile.blocked_configuration_count;
        executable_profile_count +=
            usize::from(profile.profile_implementation_status == "executable");
    }
    if setting_count != registry.summary.setting_count
        || applicable_setting_count != registry.summary.applicable_setting_count
        || configuration_count != registry.summary.configuration_count
        || completed_configuration_count != registry.summary.completed_configuration_count
        || blocked_configuration_count != registry.summary.blocked_configuration_count
        || group_ids.len() != registry.summary.group_count
        || level_ids.len() != registry.summary.level_count
        || level_ids
            .iter()
            .filter(|id| id.starts_with("source-method-variant-"))
            .count()
            != registry.summary.explicit_source_variant_count
        || executable_profile_count != registry.summary.executable_profile_count
        || protocol_documentary_binding_count != registry.summary.protocol_documentary_binding_count
        || typed_section_count != registry.summary.typed_section_count
        || output_binding_ids.len() != registry.summary.output_binding_count
        || registered_component_ids.len() != registry.summary.registered_component_count
        || profiles_with_registered_components_count
            != registry.summary.profiles_with_registered_components_count
    {
        return Err("Android method-profile registry derived counts drift".into());
    }
    Ok(registry)
}

// Keep the outer identity and exact conformance receipt fields explicit at this trust boundary.
#[allow(clippy::too_many_arguments)]
pub(crate) fn validate_protocol_documentary_binding(
    method_profile_id: &str,
    source_work_id: &str,
    source_method_variant_id: &str,
    method_profile_version: &str,
    setting_id: &str,
    registry_input: &Value,
    conformance_fixture_id: &str,
    conformance_result_digest: &str,
    execution_eligible: bool,
) -> Result<bool, String> {
    if registry_input.get("schema_version").and_then(Value::as_str)
        != Some("chronicle-profile-protocol-documentary-binding/v1")
    {
        return Ok(false);
    }
    let profile = registry()?
        .profiles
        .iter()
        .find(|profile| {
            profile.method_profile_id == method_profile_id
                && profile.source_work_id == source_work_id
                && profile.source_method_variant_id == source_method_variant_id
                && profile.method_profile_version == method_profile_version
        })
        .ok_or_else(|| {
            "profile-protocol documentary outer identity is not registered".to_owned()
        })?;
    let binding = profile
        .protocol_documentary_bindings
        .iter()
        .find(|binding| binding.setting_id == setting_id)
        .ok_or_else(|| "profile-protocol documentary setting is not registered".to_owned())?;
    if binding.registry_input != *registry_input
        || binding.conformance_fixture_id != conformance_fixture_id
        || binding.conformance_result_digest != conformance_result_digest
        || binding.execution_eligible != execution_eligible
        || execution_eligible
    {
        return Err("profile-protocol documentary receipt differs from the closed registry".into());
    }
    Ok(true)
}

fn registry() -> Result<&'static Registry, String> {
    static REGISTRY: OnceLock<Result<Registry, String>> = OnceLock::new();
    REGISTRY
        .get_or_init(validate_registry)
        .as_ref()
        .map_err(Clone::clone)
}

pub(crate) fn validate_blocked_component_parent(
    component_id: &str,
    method_profile_id: &str,
    source_work_id: &str,
    source_method_variant_id: &str,
    method_profile_version: &str,
    component_setting_ids: &[String],
) -> Result<(), String> {
    let profile = registry()?
        .profiles
        .iter()
        .find(|profile| profile.method_profile_id == method_profile_id)
        .ok_or_else(|| "literature component parent profile is not registered".to_owned())?;
    if profile.source_work_id != source_work_id
        || profile.source_method_variant_id != source_method_variant_id
        || profile.method_profile_version != method_profile_version
        || profile.profile_implementation_status != "blocked"
        || profile.completed_configuration_count != 0
        || !profile.completed_configurations.is_empty()
        || profile.blocked_configuration_count != profile.configuration_count
    {
        return Err(
            "literature component parent must remain the exact blocked zero-completed canonical profile"
                .into(),
        );
    }
    let component_settings = component_setting_ids.iter().collect::<BTreeSet<_>>();
    if component_settings.len() != component_setting_ids.len()
        || component_settings.is_empty()
        || component_settings
            .iter()
            .any(|setting_id| !profile.applicable_setting_ids.contains(setting_id))
    {
        return Err(
            "literature component settings must be uniquely owned as applicable settings by the canonical blocked parent"
                .into(),
        );
    }
    if profile
        .applicable_setting_ids
        .iter()
        .chain(profile.runtime_setting_ids.iter())
        .any(|setting_id| setting_id == "method-setting-3384532eebdf7e8e4af01aa5")
    {
        return Err(
            "literature component parent still owns the retired generic screen-dedup setting"
                .into(),
        );
    }
    if !profile.registered_components.is_empty()
        && !profile.registered_components.iter().any(|component| {
            component.component_id == component_id
                && exact_set(&component.setting_ids).as_ref()
                    == exact_set(component_setting_ids).as_ref()
        })
    {
        return Err("literature component is not registered under its canonical parent".into());
    }
    Ok(())
}

pub(crate) fn validated_registry_content_digest() -> Result<String, String> {
    Ok(registry()?.content_digest.clone())
}

/// Separately authorized components must not admit or replace a frozen paper.
pub(crate) fn validate_outside_frozen_component_parent(
    method_profile_id: &str, source_work_id: &str, setting_ids: &[String],
) -> Result<(), String> {
    if registry()?.profiles.iter().any(|profile| {
        profile.method_profile_id == method_profile_id || profile.source_work_id == source_work_id
            || profile.applicable_setting_ids.iter().chain(&profile.not_applicable_setting_ids)
                .any(|id| setting_ids.contains(id))
    }) {
        return Err("outside-freeze component collides with the canonical paper registry".into());
    }
    Ok(())
}

fn effective_setting_ids<'a>(
    profile: &'a RegistryProfile,
    selected_level_ids: &[String],
    combination_id: Option<&str>,
) -> Result<BTreeSet<&'a str>, String> {
    let mut selected = BTreeMap::new();
    for selected_id in selected_level_ids {
        let matches = profile
            .groups
            .iter()
            .filter_map(|group| {
                group
                    .levels
                    .iter()
                    .find(|level| level.level_id == *selected_id)
                    .map(|level| (group, level))
            })
            .collect::<Vec<_>>();
        if matches.len() != 1
            || selected
                .insert(matches[0].0.group_id.as_str(), matches[0].1)
                .is_some()
        {
            return Err("methodProfileReceipt sourceMethodVariantIds are not a one-per-group registry selection".into());
        }
    }
    let groups_with_levels = profile
        .groups
        .iter()
        .filter(|group| !group.levels.is_empty())
        .collect::<Vec<_>>();
    let selectable_group_count = groups_with_levels
        .iter()
        .filter(|group| group.levels.len() > 1)
        .count();
    let axis_isolated = profile.combinations.is_empty()
        && selectable_group_count > 1
        && groups_with_levels
            .iter()
            .filter(|group| group.levels.len() > 1)
            .all(|group| group.axis_isolated)
        && selected
            .iter()
            .filter(|(group_id, _)| {
                groups_with_levels
                    .iter()
                    .any(|group| group.group_id == **group_id && group.levels.len() > 1)
            })
            .count()
            == 1
        && groups_with_levels.iter().all(|group| {
            selected.contains_key(group.group_id.as_str())
                || group.levels.len() > 1 && group.axis_isolated
        });
    if selected.len() != groups_with_levels.len() && !axis_isolated {
        return Err(
            "methodProfileReceipt sourceMethodVariantIds omit a registered configuration group"
                .into(),
        );
    }
    let selectable_ids = selected
        .iter()
        .filter(|(group_id, _)| {
            profile
                .groups
                .iter()
                .find(|group| group.group_id == **group_id)
                .is_some_and(|group| group.levels.len() > 1)
        })
        .map(|(_, level)| level.level_id.as_str())
        .collect::<BTreeSet<_>>();
    let combination = if selectable_ids.len() > 1 && profile.combinations.is_empty() {
        return Err(
            "methodProfileReceipt selects a cross-group product the source did not enumerate"
                .into(),
        );
    } else if !selectable_ids.is_empty() && !profile.combinations.is_empty() {
        let matches = profile
            .combinations
            .iter()
            .filter(|candidate| {
                exact_set(&candidate.selected_level_ids).is_some_and(|ids| ids == selectable_ids)
            })
            .collect::<Vec<_>>();
        if matches.len() != 1 || combination_id != Some(matches[0].combination_id.as_str()) {
            return Err("methodProfileReceipt sourceMethodCombinationId is not the exact registered combination".into());
        }
        Some(matches[0])
    } else {
        if combination_id.is_some() {
            return Err(
                "methodProfileReceipt invents an unregistered sourceMethodCombinationId".into(),
            );
        }
        None
    };

    let applicable = profile
        .applicable_setting_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let mut effective = profile
        .invariant_setting_ids
        .iter()
        .chain(&profile.documentary_setting_ids)
        .chain(&profile.unresolved_setting_ids)
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for group in &profile.groups {
        effective.extend(group.documentary_setting_ids.iter().map(String::as_str));
        effective.extend(group.unresolved_setting_ids.iter().map(String::as_str));
    }
    for level in selected.values() {
        effective.extend(level.included_setting_ids.iter().map(String::as_str));
        effective.extend(level.documentary_setting_ids.iter().map(String::as_str));
        effective.extend(level.unresolved_setting_ids.iter().map(String::as_str));
    }
    if axis_isolated {
        for group in profile
            .groups
            .iter()
            .filter(|group| !selected.contains_key(group.group_id.as_str()))
        {
            for setting_id in group
                .documentary_setting_ids
                .iter()
                .chain(&group.unresolved_setting_ids)
                .chain(group.levels.iter().flat_map(|level| {
                    level
                        .included_setting_ids
                        .iter()
                        .chain(&level.documentary_setting_ids)
                        .chain(&level.unresolved_setting_ids)
                }))
            {
                effective.remove(setting_id.as_str());
            }
        }
    }
    if let Some(combination) = combination {
        effective.extend(combination.included_setting_ids.iter().map(String::as_str));
    }
    for level in selected.values() {
        for excluded in &level.excluded_setting_ids {
            effective.remove(excluded.as_str());
        }
    }
    effective.retain(|setting_id| applicable.contains(setting_id));
    Ok(effective)
}

fn output_binding_matches(
    observed: &MethodProfileOutputBindingReceipt,
    expected: &RegistryOutputBinding,
) -> bool {
    observed.setting_id == expected.setting_id
        && observed.output_kind == expected.output_kind
        && observed.source_field == expected.source_field
        && observed.source_position == expected.source_position
        && observed.canonical_field == expected.canonical_field
        && observed.conformance_fixture_id == expected.conformance_fixture_id
        && observed.conformance_result_digest == expected.conformance_result_digest
}

fn validate_exact_output_bindings(
    observed: &[MethodProfileOutputBindingReceipt],
    expected: &[&RegistryOutputBinding],
) -> Result<(), String> {
    if observed.len() != expected.len()
        || expected.iter().any(|expected| {
            observed
                .iter()
                .filter(|observed| output_binding_matches(observed, expected))
                .count()
                != 1
        })
    {
        return Err(
            "methodProfileReceipt outputBindings do not equal the selected closed registry set"
                .into(),
        );
    }
    Ok(())
}

fn validate_exact_conformance_output_bindings(
    observed: &[MethodProfileOutputBindingReceipt],
    fixture: &ConformanceFixture,
) -> Result<(), String> {
    if observed.len() != fixture.output_bindings.len()
        || fixture.output_bindings.iter().any(|expected| {
            observed
                .iter()
                .filter(|observed| {
                    observed.setting_id == expected.method_setting_id
                        && observed.output_kind == expected.chronicle_output_kind
                        && observed.source_field == expected.source_output_field
                        && observed.source_position == expected.source_output_position
                        && observed.canonical_field == expected.chronicle_output_column
                        && observed.conformance_fixture_id == fixture.fixture_id
                        && observed.conformance_result_digest == fixture.result_digest
                })
                .count()
                != 1
        })
    {
        return Err(
            "methodProfileReceipt outputBindings do not equal the conformance fixture set".into(),
        );
    }
    Ok(())
}

fn validate_conformance_receipt(
    receipt: &MethodProfileReceipt,
) -> Result<Option<ReceiptAuthority>, String> {
    const PREFIX: &str = "conformance-fixture:";
    if !receipt.method_profile_id.starts_with(PREFIX) && !receipt.source_work_id.starts_with(PREFIX)
    {
        return Ok(None);
    }
    let manifest = conformance_manifest()?;
    let fixture = manifest
        .fixtures
        .iter()
        .find(|fixture| fixture.fixture_id == receipt.source_method_variant_id)
        .ok_or_else(|| "methodProfileReceipt conformance fixture is not registered".to_owned())?;
    let identity = format!("{PREFIX}{}", fixture.fixture_id);
    if receipt.method_profile_id != identity
        || receipt.source_work_id != identity
        || receipt.method_profile_version != "v1"
        || receipt.source_method_variant_ids != [fixture.fixture_id.as_str()]
        || receipt.source_method_combination_id.is_some()
        || exact_set(&receipt.setting_ids) != exact_set(&fixture.method_setting_ids)
        || !receipt.input_bindings.is_empty()
        || !receipt.documentary_bindings.is_empty()
    {
        return Err(
            "methodProfileReceipt conformance fixture identity or setting membership mismatch"
                .into(),
        );
    }
    validate_exact_conformance_output_bindings(&receipt.output_bindings, fixture)?;
    let expected_binding_count =
        fixture.method_setting_ids.len() * fixture.browser_contract_bindings.len();
    if receipt.bindings.len() != expected_binding_count {
        return Err("methodProfileReceipt conformance fixture binding count mismatch".into());
    }
    for setting_id in &fixture.method_setting_ids {
        for (slot, value) in &fixture.browser_contract_bindings {
            if receipt
                .bindings
                .iter()
                .filter(|binding| {
                    binding.setting_id == *setting_id
                        && binding.slot == *slot
                        && binding.value == *value
                        && binding.conformance_fixture_id == fixture.fixture_id
                        && binding.conformance_result_digest == fixture.result_digest
                })
                .count()
                != 1
            {
                return Err(
                    "methodProfileReceipt conformance fixture binding tuple mismatch".into(),
                );
            }
        }
    }
    Ok(Some(ReceiptAuthority::ConformanceFixture))
}

fn validate_receipt_with_admission(
    receipt: &MethodProfileReceipt,
    admission: CanonicalReceiptAdmission,
) -> Result<ReceiptAuthority, String> {
    if let Some(authority) = validate_conformance_receipt(receipt)? {
        return Ok(authority);
    }
    let registry = registry()?;
    let profile = registry
        .profiles
        .iter()
        .find(|profile| profile.method_profile_id == receipt.method_profile_id)
        .ok_or_else(|| "methodProfileReceipt Android profile is not registered".to_owned())?;
    if profile.source_work_id != receipt.source_work_id
        || profile.source_method_variant_id != receipt.source_method_variant_id
        || profile.method_profile_version != receipt.method_profile_version
    {
        return Err("methodProfileReceipt Android outer identity mismatch".into());
    }
    let selected_levels = exact_set(&receipt.source_method_variant_ids)
        .ok_or_else(|| "methodProfileReceipt selected levels are not unique".to_owned())?;
    if admission == CanonicalReceiptAdmission::CompletedProofRequired {
        let completed = profile
            .completed_configurations
            .iter()
            .find(|configuration| {
                exact_set(&configuration.selected_level_ids).as_ref() == Some(&selected_levels)
                    && configuration.selected_combination_id.as_deref()
                        == receipt.source_method_combination_id.as_deref()
            });
        let completed = completed.ok_or_else(|| {
            "methodProfileReceipt selected Android configuration has no completed execution proof"
                .to_owned()
        })?;
        if !completed.execution_eligible {
            return Err(
                "methodProfileReceipt selected Android configuration is documentary-only".into(),
            );
        }
    }
    let effective = effective_setting_ids(
        profile,
        &receipt.source_method_variant_ids,
        receipt.source_method_combination_id.as_deref(),
    )?;
    let runtime_setting_ids = profile
        .runtime_setting_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let expected = effective
        .intersection(&runtime_setting_ids)
        .copied()
        .collect::<BTreeSet<_>>();
    if exact_set(&receipt.setting_ids).as_ref() != Some(&expected) {
        return Err(
            "methodProfileReceipt settingIds do not equal the registered native source selection"
                .into(),
        );
    }
    let expected_output_bindings = profile
        .output_bindings
        .iter()
        .filter(|binding| expected.contains(binding.setting_id.as_str()))
        .collect::<Vec<_>>();
    validate_exact_output_bindings(&receipt.output_bindings, &expected_output_bindings)?;
    Ok(ReceiptAuthority::Canonical)
}

pub(crate) fn validate_receipt(receipt: &MethodProfileReceipt) -> Result<ReceiptAuthority, String> {
    validate_receipt_with_admission(receipt, CanonicalReceiptAdmission::CompletedProofRequired)
}

pub(crate) fn validate_receipt_for_conformance_attempt(
    receipt: &MethodProfileReceipt,
) -> Result<ReceiptAuthority, String> {
    validate_receipt_with_admission(receipt, CanonicalReceiptAdmission::ConformanceAttempt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outside_frozen_component_cannot_replace_a_canonical_owner() {
        let ids=vec!["outside143:sdu-device-tracker:v1:period_reductions".to_owned()];
        assert!(validate_outside_frozen_component_parent("outside143:sdu-device-tracker:v1",
            "doi:10.1016/j.chbr.2021.100164",&ids).is_ok());
        let canonical=&registry().unwrap().profiles[0];
        assert!(validate_outside_frozen_component_parent(&canonical.method_profile_id,
            "doi:10.1016/j.chbr.2021.100164",&ids).is_err());
        assert!(validate_outside_frozen_component_parent("outside143:sdu-device-tracker:v1",
            &canonical.source_work_id,&ids).is_err());
        let owned=canonical.applicable_setting_ids.first().unwrap();
        assert!(validate_outside_frozen_component_parent("outside143:sdu-device-tracker:v1",
            "doi:10.1016/j.chbr.2021.100164",std::slice::from_ref(owned)).is_err());
        let excluded=registry().unwrap().profiles.iter().flat_map(|p| &p.not_applicable_setting_ids).next().unwrap();
        assert!(validate_outside_frozen_component_parent("outside143:sdu-device-tracker:v1",
            "doi:10.1016/j.chbr.2021.100164",std::slice::from_ref(excluded)).is_err());
    }

    fn conformance_receipt(fixture: &ConformanceFixture) -> MethodProfileReceipt {
        let identity = format!("conformance-fixture:{}", fixture.fixture_id);
        MethodProfileReceipt {
            method_profile_id: identity.clone(),
            source_work_id: identity,
            source_method_variant_id: fixture.fixture_id.clone(),
            source_method_variant_ids: vec![fixture.fixture_id.clone()],
            source_method_combination_id: None,
            method_profile_version: "v1".into(),
            setting_ids: fixture.method_setting_ids.clone(),
            bindings: fixture
                .method_setting_ids
                .iter()
                .flat_map(|setting_id| {
                    fixture
                        .browser_contract_bindings
                        .iter()
                        .map(|(slot, value)| crate::MethodProfileBindingReceipt {
                            setting_id: setting_id.clone(),
                            slot: slot.clone(),
                            value: value.clone(),
                            conformance_fixture_id: fixture.fixture_id.clone(),
                            conformance_result_digest: fixture.result_digest.clone(),
                        })
                })
                .collect(),
            input_bindings: Vec::new(),
            documentary_bindings: Vec::new(),
            output_bindings: fixture
                .output_bindings
                .iter()
                .map(|binding| MethodProfileOutputBindingReceipt {
                    setting_id: binding.method_setting_id.clone(),
                    output_kind: binding.chronicle_output_kind.clone(),
                    source_field: binding.source_output_field.clone(),
                    source_position: binding.source_output_position,
                    canonical_field: binding.chronicle_output_column.clone(),
                    conformance_fixture_id: fixture.fixture_id.clone(),
                    conformance_result_digest: fixture.result_digest.clone(),
                })
                .collect(),
            diary_replication_binding: None,
        }
    }

    #[test]
    fn canonical_registry_rejects_forged_identity_selection_and_settings() {
        let registry = registry().unwrap();
        let profile = registry
            .profiles
            .iter()
            .find(|profile| {
                !profile.groups.is_empty()
                    && profile
                        .groups
                        .iter()
                        .filter(|group| group.levels.len() > 1)
                        .count()
                        <= 1
            })
            .unwrap();
        let selected = profile
            .groups
            .iter()
            .filter_map(|group| group.levels.first().map(|level| level.level_id.clone()))
            .collect::<Vec<_>>();
        let settings = effective_setting_ids(profile, &selected, None).unwrap();
        assert!(!settings.is_empty());
        let mut forged = selected.clone();
        forged[0] = "source-method-variant-forged".into();
        assert!(effective_setting_ids(profile, &forged, None).is_err());
        let mut missing = selected;
        missing.pop();
        assert!(effective_setting_ids(profile, &missing, None).is_err());
    }

    #[test]
    fn conformance_attempt_admits_exact_configuration_without_weakening_production() {
        let registry = registry().unwrap();
        let profile = registry
            .profiles
            .iter()
            .find(|profile| {
                !profile.runtime_setting_ids.is_empty()
                    && profile.combinations.is_empty()
                    && profile.groups.iter().all(|group| group.levels.len() == 1)
            })
            .unwrap();
        assert!(profile.completed_configurations.is_empty());
        let selected = profile
            .groups
            .iter()
            .filter_map(|group| group.levels.first().map(|level| level.level_id.clone()))
            .collect::<Vec<_>>();
        let effective = effective_setting_ids(profile, &selected, None).unwrap();
        let runtime = profile
            .runtime_setting_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let receipt = MethodProfileReceipt {
            method_profile_id: profile.method_profile_id.clone(),
            source_work_id: profile.source_work_id.clone(),
            source_method_variant_id: profile.source_method_variant_id.clone(),
            source_method_variant_ids: selected,
            source_method_combination_id: None,
            method_profile_version: profile.method_profile_version.clone(),
            setting_ids: effective
                .intersection(&runtime)
                .map(|setting_id| (*setting_id).to_owned())
                .collect(),
            bindings: Vec::new(),
            input_bindings: Vec::new(),
            documentary_bindings: Vec::new(),
            output_bindings: Vec::new(),
            diary_replication_binding: None,
        };
        assert!(validate_receipt(&receipt)
            .unwrap_err()
            .contains("no completed execution proof"));
        assert_eq!(
            validate_receipt_for_conformance_attempt(&receipt).unwrap(),
            ReceiptAuthority::Canonical
        );
        assert!(!receipt.setting_ids.is_empty());
        let mut forged = receipt;
        forged.setting_ids.pop();
        assert!(validate_receipt_for_conformance_attempt(&forged)
            .unwrap_err()
            .contains("settingIds do not equal"));
    }

    #[test]
    fn canonical_registry_accepts_one_source_declared_axis_at_a_time() {
        let profile: RegistryProfile = serde_json::from_value(serde_json::json!({
            "method_profile_id": "method-profile:synthetic-axis",
            "source_work_id": "source-work:synthetic-axis",
            "source_method_variant_id": "source-configuration-space:synthetic-axis",
            "method_profile_version": "v1",
            "profile_implementation_status": "blocked",
            "configuration_count": 4,
            "completed_configuration_count": 0,
            "blocked_configuration_count": 4,
            "completed_configurations": [],
            "applicable_setting_ids": ["setting-a0", "setting-a1", "setting-b0", "setting-b1"],
            "runtime_setting_ids": ["setting-a0", "setting-a1", "setting-b0", "setting-b1"],
            "registered_components": [],
            "protocol_documentary_bindings": [],
            "typed_sections": {},
            "output_bindings": [],
            "not_applicable_setting_ids": [],
            "invariant_setting_ids": [],
            "documentary_setting_ids": [],
            "unresolved_setting_ids": [],
            "groups": [
                {
                    "group_id": "group-a",
                    "axis_isolated": true,
                    "documentary_setting_ids": [],
                    "unresolved_setting_ids": [],
                    "levels": [
                        {"level_id": "level-a0", "included_setting_ids": ["setting-a0"], "excluded_setting_ids": ["setting-a1"], "documentary_setting_ids": [], "unresolved_setting_ids": []},
                        {"level_id": "level-a1", "included_setting_ids": ["setting-a1"], "excluded_setting_ids": ["setting-a0"], "documentary_setting_ids": [], "unresolved_setting_ids": []}
                    ]
                },
                {
                    "group_id": "group-b",
                    "axis_isolated": true,
                    "documentary_setting_ids": [],
                    "unresolved_setting_ids": [],
                    "levels": [
                        {"level_id": "level-b0", "included_setting_ids": ["setting-b0"], "excluded_setting_ids": ["setting-b1"], "documentary_setting_ids": [], "unresolved_setting_ids": []},
                        {"level_id": "level-b1", "included_setting_ids": ["setting-b1"], "excluded_setting_ids": ["setting-b0"], "documentary_setting_ids": [], "unresolved_setting_ids": []}
                    ]
                }
            ],
            "combinations": []
        }))
        .unwrap();
        let first_axis = vec!["level-a0".to_owned()];
        assert_eq!(
            effective_setting_ids(&profile, &first_axis, None).unwrap(),
            BTreeSet::from(["setting-a0"])
        );
        let cross_product = vec!["level-a0".to_owned(), "level-b0".to_owned()];
        assert!(effective_setting_ids(&profile, &cross_product, None).is_err());
    }

    #[test]
    fn registry_content_and_counts_are_closed() {
        let registry = registry().unwrap();
        assert_eq!(registry.profiles.len(), registry.summary.profile_count);
        assert_eq!(
            registry.summary.configuration_count,
            registry
                .profiles
                .iter()
                .map(|profile| profile.configuration_count)
                .sum::<usize>()
        );
        assert_eq!(
            registry.summary.completed_configuration_count
                + registry.summary.blocked_configuration_count,
            registry.summary.configuration_count
        );
        assert_eq!(
            registry.summary.level_count,
            registry
                .profiles
                .iter()
                .flat_map(|profile| &profile.groups)
                .map(|group| group.levels.len())
                .sum::<usize>()
        );
    }

    #[test]
    fn protocol_documentary_receipts_are_closed_and_non_executable() {
        let registry = registry().unwrap();
        let (profile, binding) = registry
            .profiles
            .iter()
            .find_map(|profile| {
                profile
                    .protocol_documentary_bindings
                    .first()
                    .map(|binding| (profile, binding))
            })
            .expect("generated registry contains documentary receipts");
        assert!(validate_protocol_documentary_binding(
            &profile.method_profile_id,
            &profile.source_work_id,
            &profile.source_method_variant_id,
            &profile.method_profile_version,
            &binding.setting_id,
            &binding.registry_input,
            &binding.conformance_fixture_id,
            &binding.conformance_result_digest,
            false,
        )
        .unwrap());
        let mut forged = binding.registry_input.clone();
        forged["method_value_json"] = serde_json::json!("forged");
        assert!(validate_protocol_documentary_binding(
            &profile.method_profile_id,
            &profile.source_work_id,
            &profile.source_method_variant_id,
            &profile.method_profile_version,
            &binding.setting_id,
            &forged,
            &binding.conformance_fixture_id,
            &binding.conformance_result_digest,
            false,
        )
        .is_err());
    }

    #[test]
    fn conformance_fixture_namespace_is_closed() {
        let manifest: ConformanceManifest = serde_json::from_str(CONFORMANCE_JSON).unwrap();
        let fixture = &manifest.fixtures[3];
        let receipt = conformance_receipt(fixture);
        assert_eq!(
            validate_receipt(&receipt).unwrap(),
            ReceiptAuthority::ConformanceFixture
        );
        let mut forged = receipt;
        forged.source_work_id = "conformance-fixture:forged".into();
        assert!(validate_receipt(&forged).is_err());
    }

    #[test]
    fn output_binding_receipt_rejects_forged_and_missing_mapping() {
        let manifest = conformance_manifest().unwrap();
        let fixture = manifest
            .fixtures
            .iter()
            .find(|fixture| !fixture.output_bindings.is_empty())
            .unwrap();
        let receipt = conformance_receipt(fixture);
        assert_eq!(
            validate_receipt(&receipt).unwrap(),
            ReceiptAuthority::ConformanceFixture
        );
        assert!(validate_output_bindings(&receipt, false, true)
            .unwrap_err()
            .contains("requires includeAppOutput"));
        validate_output_bindings(&receipt, true, false).unwrap();

        let mut forged = receipt.clone();
        forged.output_bindings[0].source_field = "forged".into();
        assert!(validate_receipt(&forged)
            .unwrap_err()
            .contains("conformance fixture set"));

        let mut missing = receipt;
        missing.output_bindings.pop();
        assert!(validate_receipt(&missing)
            .unwrap_err()
            .contains("conformance fixture set"));
    }
}
