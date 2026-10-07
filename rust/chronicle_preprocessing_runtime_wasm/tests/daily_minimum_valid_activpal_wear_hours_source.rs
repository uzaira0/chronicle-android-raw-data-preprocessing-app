#[path = "../src/categorical_threshold_bucketizer.rs"]
mod categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/daily_minimum_valid_activpal_wear_hours_pastime.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_settings: Vec<CanonicalSetting>,
    source_artifact: SourceArtifact,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    minimum_retained_hours: f64,
    dispositions: Vec<String>,
    participant_days: Vec<ParticipantDay>,
    rejected_participant_days: Vec<RejectedParticipantDay>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_observed_setting: String,
    source_value_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParticipantDay {
    participant_day_id: String,
    valid_wear_hours: f64,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RejectedParticipantDay {
    participant_day_id: String,
    valid_wear_hours: Option<String>,
    expected_error: String,
}

fn parse_valid_wear_hours(encoded: Option<&str>) -> Result<f64, &'static str> {
    let encoded = encoded.ok_or("valid_activpal_wear_hours_required")?;
    let hours = match encoded {
        "NaN" => f64::NAN,
        "+inf" => f64::INFINITY,
        "-inf" => f64::NEG_INFINITY,
        value => value
            .parse::<f64>()
            .map_err(|_| "valid_activpal_wear_hours_must_be_finite_and_nonnegative")?,
    };
    if !hours.is_finite() || hours < 0.0 {
        return Err("valid_activpal_wear_hours_must_be_finite_and_nonnegative");
    }
    Ok(hours)
}

#[test]
fn excludes_participant_days_only_below_twenty_valid_activpal_wear_hours() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-daily-minimum-scalar-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1007/s10865-024-00499-x");

    let expected_settings = [
        (
            "method-setting-atomic-6fcfc3398fe5c79806b1",
            "activpal.minimum_valid_wear_hours_day",
            "activpal.minimum_valid_wear_hours_day: 20",
            "bc73c1acf61fd4bcb1ac7b3f728d8da9439c20b464f8fd185ee2dd23c2de900f",
        ),
        (
            "method-setting-atomic-ac4e69c5efb7f5b6321f",
            "activpal.insufficient_wear_disposition",
            "activpal.insufficient_wear_disposition: Exclude day",
            "0e541d1960a679350a5c679a39fcf836255395efd2a369067b847ddf9e938cc9",
        ),
    ];
    assert_eq!(fixture.exact_canonical_settings.len(), 2);
    for (actual, expected) in fixture
        .exact_canonical_settings
        .iter()
        .zip(expected_settings)
    {
        assert_eq!(
            (
                actual.setting_id.as_str(),
                actual.parameter_key.as_str(),
                actual.source_observed_setting.as_str(),
                actual.source_value_sha256.as_str(),
            ),
            expected
        );
    }
    assert!(fixture
        .source_artifact
        .locator
        .ends_with("strict-screen-native-ranks37-73-20260831T0415Z/text/60-pastime.txt:176-177"));
    assert_eq!(
        fixture.source_artifact.sha256,
        "b1dc48785f5c0db64bb3b19349ed7304a315ea8c0abb50d9a8a5a073471bbd53"
    );
    assert!(fixture.input_boundary.contains("PALanalysis-valid"));
    assert!(fixture.output_boundary.contains("strictly below 20 hours"));
    for excluded_claim in [
        "does not reproduce PALanalysis",
        "does not assign activPAL observations to days",
        "is not substituted for activPAL valid wear duration",
        "nonfinite, or negative wear duration fails closed",
        "two excluded days are descriptive evidence",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let bucketizer =
        OrderedThresholdBucketizer::new(vec![fixture.minimum_retained_hours], fixture.dispositions)
            .expect("the source duration threshold is ordered and finite");
    assert_eq!(bucketizer.thresholds(), &[20.0]);
    assert_eq!(
        bucketizer.categories(),
        &["exclude_day".to_owned(), "retain_day".to_owned()]
    );

    for day in fixture.participant_days {
        assert_eq!(
            bucketizer
                .category_for(day.valid_wear_hours)
                .map(String::as_str),
            Ok(day.expected_disposition.as_str()),
            "{}",
            day.participant_day_id
        );
    }

    for rejected in fixture.rejected_participant_days {
        assert_eq!(
            parse_valid_wear_hours(rejected.valid_wear_hours.as_deref()),
            Err(rejected.expected_error.as_str()),
            "{}",
            rejected.participant_day_id
        );
    }
}
