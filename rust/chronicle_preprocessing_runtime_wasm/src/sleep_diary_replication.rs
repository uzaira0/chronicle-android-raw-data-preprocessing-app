use csv::{ReaderBuilder, StringRecord, Terminator, WriterBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Cursor};

const TRUSTED_BRIDGE_PAYLOAD_SHA256: &str =
    "2e5862ec46c9ab6a2cbec57e22d1821555a71cd482188a8ab1d7b0a67b7b2f3a";
#[cfg(test)]
pub const SLEEP_DIARY_SETTING_ID: &str =
    "sleep-diary-setting:version-zenodo-sleepdiaries-v1.1.3:source-layout:sleepdiaries-v1-csv";
#[cfg(test)]
pub const MINAP_SLEEP_DIARY_SETTING_ID: &str =
    "sleep-diary-setting:version-zenodo-minap-v1.0:source-layout:minap-v1-event-sheet";
#[cfg(test)]
pub const SLEEP_DIARIES_JSON_SETTING_ID: &str =
    "sleep-diary-setting:version-zenodo-sleepdiaries-v1.1.3:source-layout:sleepdiaries-v1-json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiarySourceAdapterReceipt {
    pub contract_version: String,
    pub mapping_profile_id: String,
    pub mapping_profile_version: String,
    pub adapter_id: String,
    pub adapter_version: String,
    pub conformance_fixture_ids: Vec<String>,
    pub source_sha256: String,
    pub normalized_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiaryReplicationBindingReceipt {
    pub contract_version: String,
    pub setting_id: String,
    pub bridge_payload_sha256: String,
    pub catalog_source_sha256: String,
    pub version_definition_id: String,
    pub source_method_variant_id: String,
    pub mapping_profile_id: String,
    pub mapping_profile_version: String,
    pub adapter_id: String,
    pub adapter_version: String,
    pub fixture_id: String,
    pub fixture_input_sha256: String,
    pub fixture_normalized_sha256: String,
    pub profile_execution_status: String,
    pub blocker_codes: Vec<String>,
    pub diary_item_count: usize,
    pub form_element_count: usize,
    pub schedule_rule_count: usize,
    pub administration_schedule_count: usize,
    pub rule_definition_count: usize,
    pub source_adapter_receipt: DiarySourceAdapterReceipt,
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn bridge() -> Result<Value, String> {
    let mut value: Value = serde_json::from_str(crate::packed_json::SLEEP_DIARY_BRIDGE.text()?)
        .map_err(|error| format!("parse embedded sleep diary bridge: {error}"))?;
    if value.get("supportedProfile").is_none() {
        let profile = value
            .get("supportedProfiles")
            .and_then(Value::as_array)
            .and_then(|profiles| profiles.first())
            .cloned()
            .ok_or_else(|| "embedded sleep diary bridge has no supported profile".to_string())?;
        value
            .as_object_mut()
            .ok_or_else(|| "embedded sleep diary bridge is not an object".to_string())?
            .insert("supportedProfile".into(), profile);
    }
    Ok(value)
}

fn bridge_for_identity(
    version_definition_id: &str,
    mapping_profile_id: &str,
) -> Result<Value, String> {
    let mut value = bridge()?;
    let matches = value
        .get("supportedProfiles")
        .and_then(Value::as_array)
        .ok_or_else(|| "embedded sleep diary bridge has no supported profile registry".to_string())?
        .iter()
        .filter(|profile| {
            profile.get("versionDefinitionId").and_then(Value::as_str)
                == Some(version_definition_id)
                && profile
                    .pointer("/mappingProfile/mapping_profile_id")
                    .and_then(Value::as_str)
                    == Some(mapping_profile_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err("sleep diary binding does not select exactly one registered profile".into());
    }
    value
        .as_object_mut()
        .ok_or_else(|| "embedded sleep diary bridge is not an object".to_string())?
        .insert("supportedProfile".into(), matches[0].clone());
    Ok(value)
}

fn string_at<'a>(value: &'a Value, pointer: &str) -> Result<&'a str, String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("embedded sleep diary bridge is missing {pointer}"))
}

fn string_array_at(value: &Value, pointer: &str) -> Result<Vec<String>, String> {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("embedded sleep diary bridge is missing {pointer}"))?
        .iter()
        .map(|entry| {
            entry.as_str().map(str::to_owned).ok_or_else(|| {
                format!("embedded sleep diary bridge contains a non-string at {pointer}")
            })
        })
        .collect()
}

fn array_len_at(value: &Value, pointer: &str) -> Result<usize, String> {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .map(Vec::len)
        .ok_or_else(|| format!("embedded sleep diary bridge is missing {pointer}"))
}

fn validate_bridge_digest(value: &Value) -> Result<&str, String> {
    let declared = string_at(value, "/bridgePayloadSha256")?;
    if declared != TRUSTED_BRIDGE_PAYLOAD_SHA256 {
        return Err("embedded sleep diary bridge does not match the trusted payload digest".into());
    }
    let mut payload = value.clone();
    payload
        .as_object_mut()
        .ok_or_else(|| "embedded sleep diary bridge is not an object".to_string())?
        .remove("bridgePayloadSha256");
    if payload.get("supportedProfiles").is_some() {
        payload
            .as_object_mut()
            .expect("payload object was checked above")
            .remove("supportedProfile");
    }
    let canonical = serde_jcs::to_vec(&payload)
        .map_err(|error| format!("canonicalize embedded sleep diary bridge: {error}"))?;
    if sha256_hex(&canonical) != declared {
        return Err("embedded sleep diary bridge payload digest is invalid".into());
    }
    Ok(declared)
}

fn verify_direct_csv_fixture(value: &Value) -> Result<(String, String), String> {
    let input = string_at(value, "/supportedProfile/conformanceFixture/input_text")?;
    let expected_input_sha = string_at(value, "/supportedProfile/conformanceFixture/input_sha256")?;
    let expected_normalized_sha = string_at(
        value,
        "/supportedProfile/conformanceFixture/expected_normalized_sha256",
    )?;
    let observed_input_sha = sha256_hex(input.as_bytes());
    let observed_normalized_sha = sha256_hex(input.as_bytes());
    if observed_input_sha != expected_input_sha
        || observed_normalized_sha != expected_normalized_sha
    {
        return Err("embedded sleep diary fixture digest verification failed".into());
    }

    let expected_headers = value
        .pointer("/supportedProfile/mappingProfile/source_field_selectors")
        .and_then(Value::as_array)
        .ok_or_else(|| "embedded sleep diary selectors are missing".to_string())?
        .iter()
        .enumerate()
        .map(|(index, selector)| {
            let position = selector
                .get("source_field_position")
                .and_then(Value::as_u64);
            if position != Some((index + 1) as u64) {
                return Err(
                    "embedded sleep diary selector positions are not contiguous".to_string()
                );
            }
            selector
                .get("source_field_name")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| "embedded sleep diary selector name is missing".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let fixture_headers = string_array_at(
        value,
        "/supportedProfile/conformanceFixture/expected_output_headers",
    )?;
    if fixture_headers != expected_headers {
        return Err(
            "embedded sleep diary fixture headers disagree with the reviewed mapping".into(),
        );
    }

    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(Cursor::new(input.as_bytes()));
    let observed_headers = reader
        .headers()
        .map_err(|error| format!("parse embedded sleep diary fixture headers: {error}"))?
        .iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if observed_headers != expected_headers {
        return Err(
            "embedded sleep diary fixture header does not match the reviewed ordered schema".into(),
        );
    }
    let record_count = reader
        .records()
        .map(|record| {
            record.map_err(|error| format!("parse embedded sleep diary fixture row: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?
        .len();
    let expected_record_count = value
        .pointer("/supportedProfile/conformanceFixture/expected_output_record_count")
        .and_then(Value::as_u64)
        .ok_or_else(|| "embedded sleep diary fixture record count is missing".to_string())?
        as usize;
    if record_count != expected_record_count {
        return Err("embedded sleep diary fixture record count is invalid".into());
    }
    Ok((observed_input_sha, observed_normalized_sha))
}

fn json_scalar_text(value: Option<&Value>) -> Result<String, String> {
    match value {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(value)) => Ok(value.clone()),
        Some(Value::Bool(value)) => Ok(value.to_string()),
        Some(Value::Number(value)) => Ok(value.to_string()),
        Some(_) => Err("embedded keyed-object diary selector resolved to a non-scalar".into()),
    }
}

fn verify_keyed_object_json_fixture(value: &Value) -> Result<(String, String), String> {
    let input = string_at(value, "/supportedProfile/conformanceFixture/input_text")?;
    let expected_input_sha = string_at(value, "/supportedProfile/conformanceFixture/input_sha256")?;
    let expected_normalized_sha = string_at(
        value,
        "/supportedProfile/conformanceFixture/expected_normalized_sha256",
    )?;
    if string_at(
        value,
        "/supportedProfile/mappingProfile/record_assembly/record_root_path",
    )? != "$.entries[*]"
    {
        return Err("embedded keyed-object diary root is not the reviewed entries array".into());
    }
    let selectors = value
        .pointer("/supportedProfile/mappingProfile/source_field_selectors")
        .and_then(Value::as_array)
        .ok_or_else(|| "embedded keyed-object diary selectors are missing".to_string())?;
    let outputs = value
        .pointer("/supportedProfile/mappingProfile/execution_output_selectors")
        .and_then(Value::as_array)
        .ok_or_else(|| "embedded keyed-object diary output selectors are missing".to_string())?;
    if selectors.len() != outputs.len() {
        return Err("embedded keyed-object diary selector vectors disagree".into());
    }
    let headers = selectors
        .iter()
        .zip(outputs)
        .enumerate()
        .map(|(index, (selector, output))| {
            let name = selector
                .get("source_field_name")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    "embedded keyed-object diary selector name is missing".to_string()
                })?;
            if output.get("source_field_position").and_then(Value::as_u64)
                != Some((index + 1) as u64)
                || output.get("source_field_name").and_then(Value::as_str) != Some(name)
            {
                return Err(
                    "embedded keyed-object diary source and output selectors disagree".to_string(),
                );
            }
            let part = selector.get("source_part_id").and_then(Value::as_str);
            let expected_path = match part {
                Some("entry") => format!("$.{name}"),
                Some("answers") => format!("$.answers.{name}"),
                _ => String::new(),
            };
            if selector.get("source_path").and_then(Value::as_str) != Some(expected_path.as_str()) {
                return Err(
                    "embedded keyed-object diary selector path is not registered".to_string(),
                );
            }
            Ok((name.to_string(), part.unwrap().to_string()))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let document: Value = serde_json::from_str(input)
        .map_err(|error| format!("parse embedded keyed-object diary fixture: {error}"))?;
    let entries = document
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| "embedded keyed-object diary fixture has no entries array".to_string())?;
    let mut writer = WriterBuilder::new()
        .has_headers(false)
        .terminator(Terminator::Any(b'\n'))
        .from_writer(Vec::new());
    writer
        .write_record(headers.iter().map(|(name, _)| name))
        .map_err(|error| format!("write keyed-object diary output header: {error}"))?;
    for entry in entries {
        let entry = entry.as_object().ok_or_else(|| {
            "embedded keyed-object diary entries array contains a non-object".to_string()
        })?;
        let answers = match entry.get("answers") {
            None => None,
            Some(value) => Some(value.as_object().ok_or_else(|| {
                "embedded keyed-object diary answers member is not an object".to_string()
            })?),
        };
        let row = headers
            .iter()
            .map(|(name, part)| {
                json_scalar_text(if part == "entry" {
                    entry.get(name)
                } else {
                    answers.and_then(|answers| answers.get(name))
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        writer
            .write_record(row)
            .map_err(|error| format!("write keyed-object diary output row: {error}"))?;
    }
    let normalized = writer
        .into_inner()
        .map_err(|error| format!("finish keyed-object diary output: {}", error.into_error()))?;
    let observed_input_sha = sha256_hex(input.as_bytes());
    let observed_normalized_sha = sha256_hex(&normalized);
    if observed_input_sha != expected_input_sha
        || observed_normalized_sha != expected_normalized_sha
    {
        return Err("embedded keyed-object diary fixture digest verification failed".into());
    }
    if string_array_at(
        value,
        "/supportedProfile/conformanceFixture/expected_output_headers",
    )? != headers
        .iter()
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>()
    {
        return Err(
            "embedded keyed-object diary fixture headers disagree with the reviewed mapping".into(),
        );
    }
    let expected_count = value
        .pointer("/supportedProfile/conformanceFixture/expected_output_record_count")
        .and_then(Value::as_u64)
        .ok_or_else(|| "embedded keyed-object diary fixture record count is missing".to_string())?;
    if entries.len() as u64 != expected_count {
        return Err("embedded keyed-object diary fixture record count is invalid".into());
    }
    Ok((observed_input_sha, observed_normalized_sha))
}

fn row_from_record(headers: &[String], record: &StringRecord) -> BTreeMap<String, String> {
    headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            (
                header.clone(),
                record.get(index).unwrap_or_default().to_string(),
            )
        })
        .collect()
}

fn event_epoch(row: &BTreeMap<String, String>) -> Result<i64, String> {
    const MAX_SAFE_INTEGER: i64 = (1_i64 << 53) - 1;
    let value = row
        .get("event_epoch_ms")
        .ok_or_else(|| "MiNap event row has no event_epoch_ms".to_string())?
        .parse::<i64>()
        .map_err(|_| "MiNap event epoch is not an integer".to_string())?;
    if value.unsigned_abs() > MAX_SAFE_INTEGER as u64 {
        return Err("MiNap event epoch exceeds the exact safe-integer boundary".into());
    }
    Ok(value)
}

fn verify_chronological_pairing_fixture(value: &Value) -> Result<(String, String), String> {
    let input = string_at(value, "/supportedProfile/conformanceFixture/input_text")?;
    let expected_input_sha = string_at(value, "/supportedProfile/conformanceFixture/input_sha256")?;
    let expected_normalized_sha = string_at(
        value,
        "/supportedProfile/conformanceFixture/expected_normalized_sha256",
    )?;
    let parameters: Value = serde_json::from_str(string_at(
        value,
        "/supportedProfile/mappingProfile/record_assembly/parameter_json",
    )?)
    .map_err(|error| format!("parse MiNap pairing parameters: {error}"))?;
    if parameters.get("sleep_event_type").and_then(Value::as_str) != Some("SLEEP")
        || parameters.get("wake_event_type").and_then(Value::as_str) != Some("WAKE")
    {
        return Err("MiNap pairing parameters are not the reviewed SLEEP/WAKE contract".into());
    }

    let selectors = value
        .pointer("/supportedProfile/mappingProfile/source_field_selectors")
        .and_then(Value::as_array)
        .ok_or_else(|| "embedded MiNap source selectors are missing".to_string())?;
    let source_headers = selectors
        .iter()
        .enumerate()
        .map(|(index, selector)| {
            if selector
                .get("source_field_position")
                .and_then(Value::as_u64)
                != Some((index + 1) as u64)
            {
                return Err("embedded MiNap selector positions are not contiguous".to_string());
            }
            selector
                .get("source_field_name")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| "embedded MiNap selector name is missing".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(Cursor::new(input.as_bytes()));
    let observed_headers = reader
        .headers()
        .map_err(|error| format!("parse embedded MiNap fixture headers: {error}"))?
        .iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if observed_headers != source_headers {
        return Err("embedded MiNap header does not match the reviewed ordered schema".into());
    }
    let rows = reader
        .records()
        .map(|record| {
            record
                .map(|record| row_from_record(&source_headers, &record))
                .map_err(|error| format!("parse embedded MiNap fixture row: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if rows.is_empty() {
        return Err("embedded MiNap fixture has no event rows".into());
    }

    let mut groups: Vec<(String, Vec<BTreeMap<String, String>>)> = Vec::new();
    for row in rows {
        let event_type = row.get("event_type").map(String::as_str);
        if event_type != Some("SLEEP") && event_type != Some("WAKE") {
            return Err("MiNap event type must be SLEEP or WAKE".into());
        }
        event_epoch(&row)?;
        let key = format!(
            "{}\u{0}{}",
            row.get("study_id").map(String::as_str).unwrap_or_default(),
            row.get("participant_id")
                .map(String::as_str)
                .unwrap_or_default()
        );
        if let Some((_, events)) = groups.iter_mut().find(|(candidate, _)| candidate == &key) {
            events.push(row);
        } else {
            groups.push((key, vec![row]));
        }
    }

    type Pair = (
        Option<BTreeMap<String, String>>,
        Option<BTreeMap<String, String>>,
    );
    let mut pairs: Vec<Pair> = Vec::new();
    for (_, mut events) in groups {
        events.sort_by_key(|row| event_epoch(row).expect("validated MiNap event epoch"));
        let mut group_pairs: Vec<Pair> = Vec::new();
        let mut open_sleep = None;
        for event in events {
            if event.get("event_type").map(String::as_str) == Some("SLEEP") {
                if let Some(previous) = open_sleep.replace(event) {
                    group_pairs.push((Some(previous), None));
                }
            } else {
                group_pairs.push((open_sleep.take(), Some(event)));
            }
        }
        if let Some(previous) = open_sleep {
            group_pairs.push((Some(previous), None));
        }
        pairs.extend(group_pairs.into_iter().rev());
    }

    let output_headers = source_headers
        .iter()
        .map(|header| format!("sleep__{header}"))
        .chain(
            source_headers
                .iter()
                .map(|header| format!("wake__{header}")),
        )
        .chain(std::iter::once("paired_sleep_duration_minutes".to_string()))
        .collect::<Vec<_>>();
    let output_selectors = value
        .pointer("/supportedProfile/mappingProfile/execution_output_selectors")
        .and_then(Value::as_array)
        .ok_or_else(|| "embedded MiNap output selectors are missing".to_string())?;
    if output_selectors.len() != output_headers.len()
        || output_selectors
            .iter()
            .zip(&output_headers)
            .enumerate()
            .any(|(index, (selector, header))| {
                selector
                    .get("source_field_position")
                    .and_then(Value::as_u64)
                    != Some((index + 1) as u64)
                    || selector.get("source_field_name").and_then(Value::as_str)
                        != Some(header.as_str())
            })
    {
        return Err("embedded MiNap output selectors do not match the emitted schema".into());
    }

    let mut writer = WriterBuilder::new()
        .has_headers(false)
        .terminator(Terminator::Any(b'\n'))
        .from_writer(Vec::new());
    writer
        .write_record(&output_headers)
        .map_err(|error| format!("write MiNap output header: {error}"))?;
    for (sleep, wake) in pairs {
        let mut output = source_headers
            .iter()
            .map(|header| {
                sleep
                    .as_ref()
                    .and_then(|row| row.get(header))
                    .cloned()
                    .unwrap_or_default()
            })
            .chain(source_headers.iter().map(|header| {
                wake.as_ref()
                    .and_then(|row| row.get(header))
                    .cloned()
                    .unwrap_or_default()
            }))
            .collect::<Vec<_>>();
        let duration = match (&sleep, &wake) {
            (Some(sleep), Some(wake)) => {
                let milliseconds = event_epoch(wake)? - event_epoch(sleep)?;
                (((milliseconds as f64 / 60_000.0) + 0.5).floor() as i64).to_string()
            }
            _ => String::new(),
        };
        output.push(duration);
        writer
            .write_record(&output)
            .map_err(|error| format!("write MiNap output row: {error}"))?;
    }
    let normalized = writer
        .into_inner()
        .map_err(|error| format!("finish MiNap output: {}", error.into_error()))?;
    let observed_input_sha = sha256_hex(input.as_bytes());
    let observed_normalized_sha = sha256_hex(&normalized);
    if observed_input_sha != expected_input_sha
        || observed_normalized_sha != expected_normalized_sha
    {
        return Err("embedded MiNap fixture digest verification failed".into());
    }
    let fixture_headers = string_array_at(
        value,
        "/supportedProfile/conformanceFixture/expected_output_headers",
    )?;
    if fixture_headers != output_headers {
        return Err("embedded MiNap fixture headers disagree with paired output".into());
    }
    let expected_count = value
        .pointer("/supportedProfile/conformanceFixture/expected_output_record_count")
        .and_then(Value::as_u64)
        .ok_or_else(|| "embedded MiNap output count is missing".to_string())?;
    let mut normalized_reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(Cursor::new(&normalized));
    let observed_count = normalized_reader.records().count() as u64;
    if observed_count != expected_count {
        return Err("embedded MiNap fixture record count is invalid".into());
    }
    Ok((observed_input_sha, observed_normalized_sha))
}

fn verify_registered_fixture(value: &Value) -> Result<(String, String), String> {
    match string_at(
        value,
        "/supportedProfile/mappingProfile/execution_adapter_id",
    )? {
        "direct-tabular-csv-v1" => verify_direct_csv_fixture(value),
        "keyed-object-json-v1" => verify_keyed_object_json_fixture(value),
        "chronological-event-pairing-v1" => verify_chronological_pairing_fixture(value),
        adapter => Err(format!(
            "unsupported embedded sleep diary adapter: {adapter}"
        )),
    }
}

pub fn validate_sleep_diary_binding(
    binding: &DiaryReplicationBindingReceipt,
) -> Result<(), String> {
    let value = bridge_for_identity(&binding.version_definition_id, &binding.mapping_profile_id)?;
    let bridge_digest = validate_bridge_digest(&value)?;
    let (source_sha, normalized_sha) = verify_registered_fixture(&value)?;
    let blockers = string_array_at(&value, "/supportedProfile/blockerCodes")?;
    let fixture_ids = string_array_at(
        &value,
        "/supportedProfile/mappingProfile/conformance_fixture_ids",
    )?;

    let expected_setting_id = format!(
        "sleep-diary-setting:{}:source-layout:{}",
        binding.version_definition_id, binding.mapping_profile_id
    );
    let valid = binding.contract_version == "chronicle-diary-replication-binding-v1"
        && binding.setting_id == expected_setting_id
        && binding.bridge_payload_sha256 == bridge_digest
        && binding.catalog_source_sha256 == string_at(&value, "/authority/catalogSourceSha256")?
        && binding.version_definition_id
            == string_at(&value, "/supportedProfile/versionDefinitionId")?
        && binding.source_method_variant_id
            == string_at(&value, "/supportedProfile/sourceMethodVariantId")?
        && binding.mapping_profile_id
            == string_at(
                &value,
                "/supportedProfile/mappingProfile/mapping_profile_id",
            )?
        && binding.mapping_profile_version
            == string_at(
                &value,
                "/supportedProfile/mappingProfile/mapping_profile_version",
            )?
        && binding.adapter_id
            == string_at(
                &value,
                "/supportedProfile/mappingProfile/execution_adapter_id",
            )?
        && binding.adapter_version
            == string_at(
                &value,
                "/supportedProfile/mappingProfile/execution_adapter_version",
            )?
        && binding.fixture_id
            == string_at(&value, "/supportedProfile/conformanceFixture/fixture_id")?
        && binding.fixture_input_sha256 == source_sha
        && binding.fixture_normalized_sha256 == normalized_sha
        && binding.profile_execution_status == "blocked"
        && binding.blocker_codes == blockers
        && binding.diary_item_count == array_len_at(&value, "/supportedProfile/diaryItems")?
        && binding.form_element_count == array_len_at(&value, "/supportedProfile/formElements")?
        && binding.schedule_rule_count
            == array_len_at(&value, "/supportedProfile/diaryScheduleRules")?
        && binding.administration_schedule_count
            == array_len_at(&value, "/supportedProfile/administrationSchedules")?
        && binding.rule_definition_count
            == array_len_at(&value, "/supportedProfile/ruleDefinitions")?;
    if !valid {
        return Err("methodProfileReceipt diary replication binding is not the registered Sleep Scoring fixture binding".into());
    }
    let adapter = &binding.source_adapter_receipt;
    if adapter.contract_version != "diary-source-adapter-receipt-v1"
        || adapter.mapping_profile_id != binding.mapping_profile_id
        || adapter.mapping_profile_version != binding.mapping_profile_version
        || adapter.adapter_id != binding.adapter_id
        || adapter.adapter_version != binding.adapter_version
        || adapter.conformance_fixture_ids != fixture_ids
        || adapter.source_sha256 != source_sha
        || adapter.normalized_sha256 != normalized_sha
    {
        return Err("methodProfileReceipt diary source adapter receipt is invalid".into());
    }
    Ok(())
}

pub fn validate_sleep_diary_receipt_identity(
    method_profile_id: &str,
    source_work_id: &str,
    source_method_variant_id: &str,
    method_profile_version: &str,
    binding: &DiaryReplicationBindingReceipt,
) -> Result<(), String> {
    let value = bridge_for_identity(&binding.version_definition_id, &binding.mapping_profile_id)?;
    let expected_method_profile_id = format!(
        "chronicle-diary-replication:{}:{}",
        binding.version_definition_id, binding.mapping_profile_id
    );
    if method_profile_id != expected_method_profile_id
        || source_work_id != string_at(&value, "/supportedProfile/sourceMethodVariant/workId")?
        || source_method_variant_id != string_at(&value, "/supportedProfile/sourceMethodVariantId")?
        || method_profile_version != "1"
        || binding.source_method_variant_id != source_method_variant_id
    {
        return Err(
            "methodProfileReceipt outer diary identity disagrees with the registered binding"
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn registered_binding() -> DiaryReplicationBindingReceipt {
        registered_binding_for("version-zenodo-sleepdiaries-v1.1.3", "sleepdiaries-v1-csv")
    }

    pub(crate) fn registered_minap_binding() -> DiaryReplicationBindingReceipt {
        registered_binding_for("version-zenodo-minap-v1.0", "minap-v1-event-sheet")
    }

    pub(crate) fn registered_sleepdiaries_json_binding() -> DiaryReplicationBindingReceipt {
        registered_binding_for("version-zenodo-sleepdiaries-v1.1.3", "sleepdiaries-v1-json")
    }

    fn registered_binding_for(
        version_definition_id: &str,
        mapping_profile_id: &str,
    ) -> DiaryReplicationBindingReceipt {
        let value = bridge_for_identity(version_definition_id, mapping_profile_id).unwrap();
        let (source_sha, normalized_sha) = verify_registered_fixture(&value).unwrap();
        DiaryReplicationBindingReceipt {
            contract_version: "chronicle-diary-replication-binding-v1".into(),
            setting_id: format!(
                "sleep-diary-setting:{version_definition_id}:source-layout:{mapping_profile_id}"
            ),
            bridge_payload_sha256: validate_bridge_digest(&value).unwrap().into(),
            catalog_source_sha256: string_at(&value, "/authority/catalogSourceSha256")
                .unwrap()
                .into(),
            version_definition_id: string_at(&value, "/supportedProfile/versionDefinitionId")
                .unwrap()
                .into(),
            source_method_variant_id: string_at(&value, "/supportedProfile/sourceMethodVariantId")
                .unwrap()
                .into(),
            mapping_profile_id: string_at(
                &value,
                "/supportedProfile/mappingProfile/mapping_profile_id",
            )
            .unwrap()
            .into(),
            mapping_profile_version: string_at(
                &value,
                "/supportedProfile/mappingProfile/mapping_profile_version",
            )
            .unwrap()
            .into(),
            adapter_id: string_at(
                &value,
                "/supportedProfile/mappingProfile/execution_adapter_id",
            )
            .unwrap()
            .into(),
            adapter_version: string_at(
                &value,
                "/supportedProfile/mappingProfile/execution_adapter_version",
            )
            .unwrap()
            .into(),
            fixture_id: string_at(&value, "/supportedProfile/conformanceFixture/fixture_id")
                .unwrap()
                .into(),
            fixture_input_sha256: source_sha.clone(),
            fixture_normalized_sha256: normalized_sha.clone(),
            profile_execution_status: "blocked".into(),
            blocker_codes: string_array_at(&value, "/supportedProfile/blockerCodes").unwrap(),
            diary_item_count: array_len_at(&value, "/supportedProfile/diaryItems").unwrap(),
            form_element_count: array_len_at(&value, "/supportedProfile/formElements").unwrap(),
            schedule_rule_count: array_len_at(&value, "/supportedProfile/diaryScheduleRules")
                .unwrap(),
            administration_schedule_count: array_len_at(
                &value,
                "/supportedProfile/administrationSchedules",
            )
            .unwrap(),
            rule_definition_count: array_len_at(&value, "/supportedProfile/ruleDefinitions")
                .unwrap(),
            source_adapter_receipt: DiarySourceAdapterReceipt {
                contract_version: "diary-source-adapter-receipt-v1".into(),
                mapping_profile_id: string_at(
                    &value,
                    "/supportedProfile/mappingProfile/mapping_profile_id",
                )
                .unwrap()
                .into(),
                mapping_profile_version: string_at(
                    &value,
                    "/supportedProfile/mappingProfile/mapping_profile_version",
                )
                .unwrap()
                .into(),
                adapter_id: string_at(
                    &value,
                    "/supportedProfile/mappingProfile/execution_adapter_id",
                )
                .unwrap()
                .into(),
                adapter_version: string_at(
                    &value,
                    "/supportedProfile/mappingProfile/execution_adapter_version",
                )
                .unwrap()
                .into(),
                conformance_fixture_ids: string_array_at(
                    &value,
                    "/supportedProfile/mappingProfile/conformance_fixture_ids",
                )
                .unwrap(),
                source_sha256: source_sha,
                normalized_sha256: normalized_sha,
            },
        }
    }

    #[test]
    fn validates_the_registered_fixture_binding() {
        let binding = registered_binding();
        validate_sleep_diary_binding(&binding).unwrap();
        assert_eq!(binding.setting_id, SLEEP_DIARY_SETTING_ID);
    }

    #[test]
    fn validates_the_registered_minap_pairing_binding_as_blocked() {
        let binding = registered_minap_binding();
        validate_sleep_diary_binding(&binding).unwrap();
        assert_eq!(binding.setting_id, MINAP_SLEEP_DIARY_SETTING_ID);
        assert_eq!(binding.blocker_codes.len(), 29);
        assert_eq!(binding.diary_item_count, 16);
        assert_eq!(binding.form_element_count, 15);
        assert_eq!(binding.schedule_rule_count, 3);
        assert_eq!(binding.administration_schedule_count, 3);
        assert_eq!(binding.rule_definition_count, 35);
        assert_eq!(
            binding.fixture_input_sha256,
            "d86b705334e83e808a50107b09dfaa168d267239c842abf93a1c4c83ee8abe89"
        );
        assert_eq!(
            binding.fixture_normalized_sha256,
            "1b11aa4392b5409d8c96149ae27ffa42eb8144cc0fc9d8e3444b4840d958459d"
        );
        assert_eq!(binding.profile_execution_status, "blocked");
    }

    #[test]
    fn validates_the_registered_sleepdiaries_json_binding_as_blocked() {
        let binding = registered_sleepdiaries_json_binding();
        validate_sleep_diary_binding(&binding).unwrap();
        assert_eq!(binding.setting_id, SLEEP_DIARIES_JSON_SETTING_ID);
        assert_eq!(binding.blocker_codes.len(), 36);
        assert_eq!(
            binding.fixture_input_sha256,
            "dff812d78b3c0e4110cf3a359c3d523fd30cc635a7f3fd42e742d18571a411d3"
        );
        assert_eq!(
            binding.fixture_normalized_sha256,
            "95fd59f4d79815cda57eaae68dc18505632db6a6160bb79ac5b3f4663b038d2e"
        );
        assert_eq!(binding.profile_execution_status, "blocked");
    }

    #[test]
    fn rejects_a_forged_fixture_digest() {
        let mut binding = registered_binding();
        binding.fixture_normalized_sha256 = "0".repeat(64);
        assert!(validate_sleep_diary_binding(&binding).is_err());
    }

    #[test]
    fn rejects_unknown_keys_cross_variant_identity_and_self_consistent_source_mutation() {
        let binding = registered_minap_binding();
        let mut serialized = serde_json::to_value(&binding).unwrap();
        serialized
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), Value::Bool(true));
        assert!(serde_json::from_value::<DiaryReplicationBindingReceipt>(serialized).is_err());

        let mut inner = serde_json::to_value(&binding).unwrap();
        inner["sourceAdapterReceipt"]
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), Value::Bool(true));
        assert!(serde_json::from_value::<DiaryReplicationBindingReceipt>(inner).is_err());

        let mut cross_variant = binding.clone();
        cross_variant.mapping_profile_id = "sleepdiaries-v1-csv".into();
        assert!(validate_sleep_diary_binding(&cross_variant).is_err());

        let mut mutated = bridge().unwrap();
        mutated["supportedProfiles"][1]["conformanceFixture"]["input_text"] =
            Value::String("forged-source".into());
        let mut canonical_payload = mutated.clone();
        canonical_payload
            .as_object_mut()
            .unwrap()
            .remove("bridgePayloadSha256");
        canonical_payload
            .as_object_mut()
            .unwrap()
            .remove("supportedProfile");
        let forged_digest = sha256_hex(&serde_jcs::to_vec(&canonical_payload).unwrap());
        mutated["bridgePayloadSha256"] = Value::String(forged_digest);
        assert!(validate_bridge_digest(&mutated).is_err());
    }
}
