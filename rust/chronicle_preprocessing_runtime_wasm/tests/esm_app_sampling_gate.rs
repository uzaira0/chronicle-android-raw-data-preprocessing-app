#[path = "../src/esm_app_sampling_gate.rs"]
mod esm_app_sampling_gate;

use esm_app_sampling_gate::{
    cooldown_is_eligible, during_use_delay_ms, end_prompt_is_eligible,
    record_successful_app_sample, same_app_is_eligible, CooldownSourceVariant, EsmAppSamplingError,
    GLOBAL_PROMPT_COOLDOWN_MS,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str = include_str!("fixtures/esm_app_sampling_gate_lukoff_2018.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_artifacts: SourceArtifacts,
    source_locator: String,
    exact_canonical_setting_ids: Vec<String>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    during_delay_cases: Vec<DuringDelayCase>,
    end_prompt_cases: Vec<EndPromptCase>,
    same_app_sequence: Vec<String>,
    same_app_expected_after_each_success: Vec<Vec<String>>,
    same_app_candidate_a_eligible_after_each_success: Vec<bool>,
    cooldown_canonical_setting_id: String,
    cooldown_variants: Vec<CooldownVariantFixture>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceArtifacts {
    paper_text_sha256: String,
    released_collector_sha256: String,
    released_sample_sha256: String,
    released_code_commit: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuringDelayCase {
    draw_index: u16,
    expected_delay_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndPromptCase {
    contiguous_use_duration_ms: u64,
    expected_eligible: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CooldownVariantFixture {
    variant_id: String,
    source_artifact_sha256: String,
    configuration_canonical: String,
    configuration_sha256: String,
    equality_outcome_canonical: String,
    equality_outcome_sha256: String,
    expected_eligible_at_exactly_30_minutes: bool,
}

fn sha256(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn cooldown_variant(id: &str) -> CooldownSourceVariant {
    match id {
        "paper_at_least_30_minutes" => CooldownSourceVariant::PaperAtLeastThirtyMinutes,
        "released_code_strictly_after_30_minutes" => {
            CooldownSourceVariant::ReleasedCodeStrictlyAfterThirtyMinutes
        }
        other => panic!("unknown cooldown source variant {other}"),
    }
}

#[test]
fn executes_the_four_source_settings_without_collapsing_cooldown_variants() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("T32 fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-esm-app-sampling-gate-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3191754");
    assert_eq!(
        fixture.source_artifacts.paper_text_sha256,
        "62ca882c4385d020b1462331736224aa48d9a6c9dcf10e384c978af9eb12e62c"
    );
    assert_eq!(
        fixture.source_artifacts.released_collector_sha256,
        "e2007dd9eaadc581b900195409ebf78222ce6ace3660ae18177187e62d1caae3"
    );
    assert_eq!(
        fixture.source_artifacts.released_sample_sha256,
        "0edeae88ed09004873fedb8a3431052096b20c49e079d7b4118c88af58ef9c8b"
    );
    assert_eq!(
        fixture.source_artifacts.released_code_commit,
        "2181ae41d0633ae1708df8fe0b0c8e35c3c8fdca"
    );
    assert!(fixture.source_locator.contains("098.txt:276-296"));
    assert!(fixture
        .source_locator
        .contains("DetectAppsService.java:121-211,447-450"));
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        [
            "method-setting-637f4a759da2b57b320dc1a9",
            "method-setting-e53245d4f933ef1951b8bd61",
            "method-setting-89b295319a78af875144a91f",
            "method-setting-984ba339b7d47ce4ae74beb2",
        ]
    );
    assert!(fixture.input_boundary.contains("caller-observed"));
    assert!(fixture.output_boundary.contains("eligibility"));
    for missing in ["random seed", "polling race", "installed-app", "Prompt UI"] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(missing)));
    }

    for case in fixture.during_delay_cases {
        assert_eq!(
            during_use_delay_ms(case.draw_index).expect("valid source draw"),
            case.expected_delay_ms
        );
    }
    for case in fixture.end_prompt_cases {
        assert_eq!(
            end_prompt_is_eligible(case.contiguous_use_duration_ms),
            case.expected_eligible
        );
    }

    let mut history = Vec::<String>::new();
    for ((package_id, expected), candidate_a_eligible) in fixture
        .same_app_sequence
        .iter()
        .zip(fixture.same_app_expected_after_each_success)
        .zip(fixture.same_app_candidate_a_eligible_after_each_success)
    {
        history = record_successful_app_sample(package_id, &history)
            .unwrap_or_else(|error| panic!("record {package_id}: {error}"));
        assert_eq!(history, expected);
        assert_eq!(
            same_app_is_eligible("app.a", &history).expect("valid history"),
            candidate_a_eligible
        );
    }
    assert!(same_app_is_eligible("app.a", &history).expect("valid history"));

    assert_eq!(
        fixture.cooldown_canonical_setting_id,
        "method-setting-984ba339b7d47ce4ae74beb2"
    );
    assert_eq!(fixture.cooldown_variants.len(), 2);
    for variant in fixture.cooldown_variants {
        assert_eq!(
            sha256(&variant.configuration_canonical),
            variant.configuration_sha256,
            "{} configuration digest",
            variant.variant_id
        );
        assert_eq!(
            sha256(&variant.equality_outcome_canonical),
            variant.equality_outcome_sha256,
            "{} equality-outcome digest",
            variant.variant_id
        );
        let expected_source_digest = match variant.variant_id.as_str() {
            "paper_at_least_30_minutes" => &fixture.source_artifacts.paper_text_sha256,
            "released_code_strictly_after_30_minutes" => {
                &fixture.source_artifacts.released_collector_sha256
            }
            other => panic!("unknown source variant {other}"),
        };
        assert_eq!(&variant.source_artifact_sha256, expected_source_digest);
        assert_eq!(
            cooldown_is_eligible(
                Some(GLOBAL_PROMPT_COOLDOWN_MS),
                cooldown_variant(&variant.variant_id)
            ),
            variant.expected_eligible_at_exactly_30_minutes,
            "{} equality behavior",
            variant.variant_id
        );
    }
}

#[test]
fn invalid_draws_and_impossible_lockout_updates_fail_closed() {
    assert!(matches!(
        during_use_delay_ms(106),
        Err(EsmAppSamplingError::InvalidDuringDelayDrawIndex { .. })
    ));
    assert!(matches!(
        same_app_is_eligible("", &[]),
        Err(EsmAppSamplingError::EmptyPackageId)
    ));
    assert!(matches!(
        same_app_is_eligible("app.a", &["".to_owned()]),
        Err(EsmAppSamplingError::EmptyRecentPackageId { .. })
    ));
    assert!(matches!(
        same_app_is_eligible(
            "app.a",
            &[
                "app.b".to_owned(),
                "app.c".to_owned(),
                "app.d".to_owned(),
                "app.e".to_owned(),
            ]
        ),
        Err(EsmAppSamplingError::TooManyRecentSuccessfulSamples { .. })
    ));
    assert!(matches!(
        record_successful_app_sample("app.a", &["app.a".to_owned()]),
        Err(EsmAppSamplingError::AppStillLockedOut { .. })
    ));

    for variant in [
        CooldownSourceVariant::PaperAtLeastThirtyMinutes,
        CooldownSourceVariant::ReleasedCodeStrictlyAfterThirtyMinutes,
    ] {
        assert!(cooldown_is_eligible(None, variant));
        assert!(!cooldown_is_eligible(
            Some(GLOBAL_PROMPT_COOLDOWN_MS - 1),
            variant
        ));
        assert!(cooldown_is_eligible(
            Some(GLOBAL_PROMPT_COOLDOWN_MS + 1),
            variant
        ));
    }
}
