#[path = "../src/categorical_response_rate.rs"]
mod categorical_response_rate;

use categorical_response_rate::{
    categorical_response_rate, CategoricalResponseRateError, CategoricalResponseRateInput,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/categorical_response_rate_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_code_sha256: String,
    source_test_sha256: String,
    source_feature_metadata_sha256: String,
    source_locator: String,
    source_call_site_locator: String,
    source_test_locator: String,
    source_runtime: SourceRuntime,
    exact_canonical_setting_ids: Vec<String>,
    formula_source_value_sha256: String,
    source_call_sites: Vec<SourceCallSite>,
    upstream_dependencies: Vec<String>,
    cases: Vec<FixtureCase>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceRuntime {
    container_image: String,
    container_image_id: String,
    python: String,
    numpy: String,
    pandas: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    case_id: String,
    input: FixtureInput,
    expected: Option<String>,
    expected_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceCallSite {
    feature_setting_id: String,
    feature_source_value_sha256: String,
    formula_setting_id: String,
    relationship: String,
    label_column: String,
    output_field: String,
    feature_metadata_locator: String,
    revision2_id: u8,
    feature_status: String,
    typed_boundary_labels: Vec<String>,
    expected: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum FixtureInput {
    Present {
        labels: Vec<Option<String>>,
    },
    MissingColumn {
        #[serde(rename = "rowCount")]
        row_count: usize,
    },
}

#[test]
fn primitive_matches_the_pinned_released_source_oracle() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-categorical-response-rate-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1002/per.2309");
    assert_eq!(
        fixture.source_code_sha256,
        "74de549e3b9c068339d4a68d94dae623b63e2a8120f06886427ce491a1175532"
    );
    assert_eq!(
        fixture.source_test_sha256,
        "8257552c5fa29eb72ede03b884be65e4cb4a091212f477509928a81a5d7907c6"
    );
    assert_eq!(
        fixture.source_feature_metadata_sha256,
        "145925c5780646c3501487658c2f6b292e3b5541bdac6f673485dc1803d1711e"
    );
    assert!(fixture.source_locator.ends_with("state.py:108-120"));
    assert!(fixture
        .source_call_site_locator
        .ends_with("state.py:199-200"));
    assert!(fixture.source_test_locator.ends_with("test_state.py:60-82"));
    assert_eq!(
        fixture.source_runtime.container_image,
        "chronicle/rueegger-per2309:python3.7.1"
    );
    assert_eq!(
        fixture.source_runtime.container_image_id,
        "sha256:1ef375425fbba3b0f47c7c07838c12c78d94bea31e06307ed3cfa7834b80f58d"
    );
    assert_eq!(fixture.source_runtime.python, "3.7.1");
    assert_eq!(fixture.source_runtime.numpy, "1.16.2");
    assert_eq!(fixture.source_runtime.pandas, "1.0.5");
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        [
            "method-setting-89f05ccdfebf96d26c4dac88",
            "method-setting-5facd691213333bd0e7a5c8d",
            "method-setting-7cdca72ce4ba1dae3e06c65d",
        ]
    );
    assert_eq!(
        fixture.formula_source_value_sha256,
        "1d6d43a2a4819b709944f49238e30d196d62a9ddbcfab814e60b0ff29d2f101c"
    );
    assert_eq!(fixture.limitations.len(), 3);

    let expected_call_sites = [
        (
            "method-setting-5facd691213333bd0e7a5c8d",
            "cec43190d2fcf9b0f45a7478ac101a4bab6db054199f6dfb56d752260dddec87",
            "response_to_user_label",
            "Stachl_responserate_calls_others",
            "feature_metadata.csv:39",
            38,
            1.0,
        ),
        (
            "method-setting-7cdca72ce4ba1dae3e06c65d",
            "ffbeb102c08f9ec34b382391fc296d80d158e7fcdbeee487ceae2ddc3cf8ee4e",
            "response_of_user_label",
            "Stachl_responserate_calls_user",
            "feature_metadata.csv:40",
            39,
            0.5,
        ),
    ];
    assert_eq!(fixture.source_call_sites.len(), expected_call_sites.len());
    for (call_site, expected) in fixture.source_call_sites.iter().zip(expected_call_sites) {
        assert_eq!(call_site.feature_setting_id, expected.0);
        assert_eq!(call_site.feature_source_value_sha256, expected.1);
        assert_eq!(
            call_site.formula_setting_id,
            "method-setting-89f05ccdfebf96d26c4dac88"
        );
        assert_eq!(
            call_site.relationship,
            "distinct_source_feature_depends_on_shared_formula"
        );
        assert_eq!(call_site.label_column, expected.2);
        assert_eq!(call_site.output_field, expected.3);
        assert_eq!(call_site.feature_metadata_locator, expected.4);
        assert_eq!(call_site.revision2_id, expected.5);
        assert_eq!(call_site.feature_status, "excluded");

        let labels = call_site
            .typed_boundary_labels
            .iter()
            .map(|label| Some(label.as_str()))
            .collect::<Vec<_>>();
        let actual = categorical_response_rate(CategoricalResponseRateInput::Present(&labels))
            .expect("source call site has its selected label column");
        let declared = call_site
            .expected
            .parse::<f64>()
            .expect("finite source call-site expectation");
        assert_eq!(declared, expected.6);
        assert_eq!(actual, declared);
    }
    for required_dependency in [
        "method-setting-e36f8db35beae75e7dba31dd",
        "method-setting-7a8120fcc9e3fecfab462223",
        "method-setting-41cd423bea34eb27d528548b",
        "peach.calls.get_matching_labeled_calls",
    ] {
        assert!(fixture
            .upstream_dependencies
            .iter()
            .any(|dependency| dependency.contains(required_dependency)));
    }

    for case in fixture.cases {
        let result = match &case.input {
            FixtureInput::Present { labels } => {
                let labels = labels
                    .iter()
                    .map(|label| label.as_deref())
                    .collect::<Vec<_>>();
                categorical_response_rate(CategoricalResponseRateInput::Present(&labels))
            }
            FixtureInput::MissingColumn { row_count } => {
                categorical_response_rate(CategoricalResponseRateInput::MissingColumn {
                    row_count: *row_count,
                })
            }
        };

        match (case.expected.as_deref(), case.expected_error.as_deref()) {
            (Some("NaN"), None) => assert!(
                result.expect("expected numeric result").is_nan(),
                "case {}",
                case.case_id
            ),
            (Some(expected), None) => {
                let expected = expected.parse::<f64>().expect("finite expected value");
                let actual = result.expect("expected numeric result");
                assert!(
                    (actual - expected).abs() <= f64::EPSILON,
                    "case {}: expected {expected}, got {actual}",
                    case.case_id
                );
            }
            (None, Some("missing_label_column")) => assert_eq!(
                result,
                Err(CategoricalResponseRateError::MissingLabelColumn),
                "case {}",
                case.case_id
            ),
            _ => panic!("case {} has an invalid expected outcome", case.case_id),
        }
    }
}
