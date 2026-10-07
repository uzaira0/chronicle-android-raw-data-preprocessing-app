#[path = "../src/source_artifact_provenance_registry.rs"]
#[allow(
    dead_code,
    reason = "this source test replays registry fixtures; the documentary caller is exercised in runtime tests"
)]
mod registry;

use serde_json::Value;

const REGISTRY_JSON: &str =
    include_str!("../../../web/src/generated/source-artifact-provenance-registry.json");

fn fixture_rows(name: &str) -> Vec<Value> {
    serde_json::from_str::<Value>(REGISTRY_JSON).unwrap()[name]
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn generated_registry_has_exact_identity_and_partition() {
    let summary = registry::validate_registry().unwrap();
    assert_eq!(summary.row_count, 19);
    assert_eq!(summary.receipt_ready_count, 18);
    assert_eq!(summary.positive_fixture_count, 19);
    assert_eq!(summary.negative_fixture_count, 11);
    assert_eq!(
        summary.blocked_method_setting_ids,
        ["method-setting-ba42e53a2bb684a034aa67e0"]
    );
}

#[test]
fn status_swap_cannot_move_the_blocked_identity_even_with_a_fresh_content_digest() {
    let mut artifact = serde_json::from_str::<Value>(REGISTRY_JSON).unwrap();
    let rows = artifact["rows"].as_array_mut().unwrap();
    rows.iter_mut()
        .find(|row| row["method_setting_id"] == "method-setting-ba42e53a2bb684a034aa67e0")
        .unwrap()["candidate_status"] = "ready_for_typed_registry".into();
    rows.iter_mut()
        .find(|row| {
            row["method_setting_id"] != "method-setting-ba42e53a2bb684a034aa67e0"
                && row["candidate_status"] == "ready_for_typed_registry"
        })
        .unwrap()["candidate_status"] =
        "blocked_missing_exact_mounted_provider_version_link".into();
    let mut payload = artifact.clone();
    payload.as_object_mut().unwrap().remove("content_digest");
    artifact["content_digest"] = registry::jcs_digest(&payload).unwrap().into();

    assert_eq!(
        registry::validate_registry_json(&serde_json::to_string(&artifact).unwrap()).unwrap_err(),
        "source-artifact provenance registry row partition drift"
    );
}

#[test]
fn all_positive_receipts_replay_with_exact_jcs_digests() {
    for fixture in fixture_rows("positive_fixtures") {
        assert_eq!(
            registry::jcs_digest(&fixture["input"]).unwrap(),
            fixture["case_digest"]
        );
        let result = registry::register_source_artifact_provenance(&fixture["input"]);
        assert_eq!(result, fixture["expected_result"]);
        assert_eq!(
            registry::jcs_digest(&result).unwrap(),
            fixture["result_digest"]
        );
    }
}

#[test]
fn all_eleven_adversarial_classes_fail_closed() {
    let fixtures = fixture_rows("negative_fixtures");
    assert_eq!(fixtures.len(), 11);
    for fixture in fixtures {
        assert_eq!(
            registry::jcs_digest(&fixture["input"]).unwrap(),
            fixture["case_digest"]
        );
        let result = registry::register_source_artifact_provenance(&fixture["input"]);
        assert_eq!(result, fixture["expected_result"]);
        assert_eq!(
            registry::jcs_digest(&result).unwrap(),
            fixture["result_digest"]
        );
    }
}
