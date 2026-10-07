use chronicle_preprocessing_runtime_wasm::categorical_threshold_bucketizer;

use categorical_threshold_bucketizer::OrderedThresholdBucketizer;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/tcp_direction_packet_thresholds_canonical_source.json");
const REUSED_OWNER_SOURCE: &str = include_str!("../src/categorical_threshold_bucketizer.rs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    reused_owner: ReusedOwner,
    source_work_id: String,
    source_artifacts: Vec<SourceArtifact>,
    input_measure: String,
    input_boundary: String,
    settings: Vec<Setting>,
    invalid_packet_counts: Vec<InvalidCount>,
    invalid_count_error: String,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReusedOwner {
    component: String,
    source_path: String,
    source_sha256: String,
    semantic_boundary: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    role: String,
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Setting {
    canonical_setting: CanonicalSetting,
    superseded_aliases: Vec<String>,
    minimum_inclusive_packet_count: u64,
    output_boundary: String,
    cases: Vec<BoundaryCase>,
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
struct BoundaryCase {
    case_id: String,
    data_packet_count_in_direction: Value,
    expected_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCount {
    case_id: String,
    data_packet_count_in_direction: Value,
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn directional_data_packet_count(value: &Value) -> Result<u64, &'static str> {
    value
        .as_u64()
        .ok_or("nonnegative_integer_directional_data_packet_count_required")
}

#[test]
fn strict_and_inclusive_packet_count_boundaries_remain_distinct() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-tcp-direction-packet-thresholds-canonical-source-fixture/v1"
    );
    assert_eq!(fixture.reused_owner.component, "OrderedThresholdBucketizer");
    assert_eq!(
        fixture.reused_owner.source_path,
        "rust/chronicle_preprocessing_runtime_wasm/src/categorical_threshold_bucketizer.rs"
    );
    assert_eq!(
        sha256(REUSED_OWNER_SOURCE.as_bytes()),
        fixture.reused_owner.source_sha256
    );
    assert!(fixture
        .reused_owner
        .semantic_boundary
        .contains("nonnegative JSON integer"));
    assert_eq!(fixture.source_work_id, "doi:10.1145/1879141.1879176");
    assert!(fixture.input_measure.contains("one direction"));
    assert!(fixture.input_boundary.contains("caller-supplied"));
    assert!(fixture.input_boundary.contains("TCP transfer construction"));
    assert_eq!(fixture.settings.len(), 2);

    let retransmission = &fixture.settings[0];
    assert_eq!(
        (
            retransmission.canonical_setting.setting_id.as_str(),
            retransmission.canonical_setting.parameter_key.as_str(),
            retransmission
                .canonical_setting
                .source_observed_setting
                .as_str(),
            retransmission
                .canonical_setting
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-79cc8647490f5d49f2004336",
            "performance.retransmission_threshold",
            "performance.retransmission_threshold: direction has more than 10 data packets",
            "ef048484d10e331fc254dbf5243952ac42b9a34a7ce2290345402c2a02bee659",
        )
    );
    assert!(retransmission.superseded_aliases.is_empty());
    assert_eq!(retransmission.minimum_inclusive_packet_count, 11);
    assert!(retransmission.output_boundary.contains("More than 10"));
    assert!(retransmission.output_boundary.contains("at least 11"));

    let throughput = &fixture.settings[1];
    assert_eq!(
        (
            throughput.canonical_setting.setting_id.as_str(),
            throughput.canonical_setting.parameter_key.as_str(),
            throughput
                .canonical_setting
                .source_observed_setting
                .as_str(),
            throughput
                .canonical_setting
                .source_value_sha256
                .as_str(),
        ),
        (
            "method-setting-96c80bf36817f109385d2e48",
            "performance.throughput",
            "performance.throughput: TCP transfer throughput by direction for transfers with at least 10 data packets",
            "271ad87ebc4aba1f3ef09cbfdfd3d88adc7745296c9076d7c13d6fc855341c3e",
        )
    );
    assert!(throughput.superseded_aliases.is_empty());
    assert_eq!(throughput.minimum_inclusive_packet_count, 10);
    assert!(throughput.output_boundary.contains("At least 10"));
    assert!(throughput.output_boundary.contains("includes equality"));

    for setting in &fixture.settings {
        assert_eq!(
            sha256(setting.canonical_setting.source_observed_setting.as_bytes()),
            setting.canonical_setting.source_value_sha256,
            "{} canonical value hash",
            setting.canonical_setting.setting_id
        );

        let bucketizer = OrderedThresholdBucketizer::new(
            vec![setting.minimum_inclusive_packet_count as f64],
            vec![
                "outside_source_analysis_population",
                "inside_source_analysis_population",
            ],
        )
        .expect("one finite lower-inclusive packet-count threshold");
        for case in &setting.cases {
            let count = directional_data_packet_count(&case.data_packet_count_in_direction)
                .unwrap_or_else(|error| panic!("{}: {error}", case.case_id));
            assert_eq!(
                bucketizer.category_for(count as f64).copied(),
                Ok(case.expected_disposition.as_str()),
                "{} / {}",
                setting.canonical_setting.setting_id,
                case.case_id
            );
        }
    }

    let retransmission_equality = retransmission
        .cases
        .iter()
        .find(|case| case.data_packet_count_in_direction == 10)
        .expect("retransmission equality case");
    let throughput_equality = throughput
        .cases
        .iter()
        .find(|case| case.data_packet_count_in_direction == 10)
        .expect("throughput equality case");
    assert_eq!(
        retransmission_equality.expected_disposition,
        "outside_source_analysis_population"
    );
    assert_eq!(
        throughput_equality.expected_disposition,
        "inside_source_analysis_population"
    );

    for artifact in &fixture.source_artifacts {
        assert!(!artifact.role.is_empty());
        assert!(!artifact.locator.is_empty());
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
    assert!(fixture
        .limitations
        .iter()
        .any(|limitation| limitation.contains("does not construct TCP transfers")));
    assert!(fixture
        .limitations
        .iter()
        .any(|limitation| limitation.contains("not computed")));

    for case in &fixture.invalid_packet_counts {
        assert_eq!(
            directional_data_packet_count(&case.data_packet_count_in_direction),
            Err(fixture.invalid_count_error.as_str()),
            "{}",
            case.case_id
        );
    }
}
