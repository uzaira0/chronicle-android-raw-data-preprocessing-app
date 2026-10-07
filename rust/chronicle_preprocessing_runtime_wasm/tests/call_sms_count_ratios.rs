#[path = "../src/count_ratio.rs"]
mod count_ratio;

use count_ratio::{
    construct_named_count_ratios, CountRatio, CountRatioError, CountRatioRequest, NamedCountRatio,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/call_sms_count_ratios_socialcom_2013.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting: CanonicalSetting,
    source_artifacts: Vec<SourceArtifact>,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    counts: Counts,
    ratio_configuration: Vec<RatioSpecification>,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Counts {
    outgoing: u64,
    incoming: u64,
    missed: u64,
    sms_sent: u64,
    sms_received: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RatioSpecification {
    ratio_id: String,
    numerator_count: String,
    denominator_counts: Vec<String>,
    expected_numerator: u64,
    expected_denominator: u64,
}

fn source_count(counts: &Counts, key: &str) -> u64 {
    match key {
        "outgoing" => counts.outgoing,
        "incoming" => counts.incoming,
        "missed" => counts.missed,
        "sms_sent" => counts.sms_sent,
        "sms_received" => counts.sms_received,
        _ => panic!("fixture contains an unsupported source count key: {key}"),
    }
}

#[test]
fn constructs_all_three_disclosed_call_and_sms_count_ratios() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-count-ratio-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1109/socialcom.2013.118");
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture
                .exact_canonical_setting
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-55f05726b3afe55a886fff1a",
            "features.ratios",
            "features.ratios: [\"outgoing/incoming calls\",\"missed/(outgoing+incoming) calls\",\"SMS sent/received\"]",
            "5343976ab90cb242d8f7caa9e0c1ff71715bb33f644d59ee872d78f5574579b7",
        )
    );
    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("rank147.txt:84-92"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "299b50324299c85002330ac67bc02d33afa7b2865fd4c8f5379530c5c219b295"
    );
    assert!(fixture.source_artifacts[1].locator.contains("rank147.pdf"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "63dcaed448d25876d801e9eaef94df502a78036eec3a9012912b48b8bb2f19c9"
    );
    assert!(fixture
        .input_boundary
        .contains("already-selected source window"));
    assert!(fixture.output_boundary.contains("Three exact rational"));
    for excluded_claim in [
        "does not classify",
        "zero denominator fails closed",
        "does not infer",
        "does not reproduce downstream",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    let counts = fixture.counts;
    let mut expected = Vec::new();
    let requests = fixture
        .ratio_configuration
        .into_iter()
        .map(|specification| {
            let numerator = source_count(&counts, &specification.numerator_count);
            let denominator_terms = specification
                .denominator_counts
                .iter()
                .map(|key| source_count(&counts, key))
                .collect();
            expected.push(NamedCountRatio {
                name: specification.ratio_id.clone(),
                ratio: CountRatio {
                    numerator: specification.expected_numerator,
                    denominator: specification.expected_denominator,
                },
            });
            CountRatioRequest {
                name: specification.ratio_id,
                numerator,
                denominator_terms,
            }
        });
    let actual = construct_named_count_ratios(requests)
        .expect("all three configured denominators are positive and do not overflow");
    assert_eq!(actual, expected);
    for output in actual {
        assert_eq!(
            output.ratio.value(),
            output.ratio.numerator as f64 / output.ratio.denominator as f64
        );
    }

    assert_eq!(
        construct_named_count_ratios([CountRatioRequest {
            name: "missing",
            numerator: 1,
            denominator_terms: vec![],
        }]),
        Err(CountRatioError::MissingDenominatorTerms)
    );
    assert_eq!(
        construct_named_count_ratios([CountRatioRequest {
            name: "zero",
            numerator: 1,
            denominator_terms: vec![0, 0],
        }]),
        Err(CountRatioError::ZeroDenominator)
    );
    assert_eq!(
        construct_named_count_ratios([CountRatioRequest {
            name: "overflow",
            numerator: 1,
            denominator_terms: vec![u64::MAX, 1],
        }]),
        Err(CountRatioError::DenominatorOverflow)
    );
}
