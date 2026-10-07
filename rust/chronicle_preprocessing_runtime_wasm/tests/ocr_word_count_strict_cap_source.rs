use serde::Deserialize;
use serde_json::Number;

const SOURCE_FIXTURE: &str = include_str!("fixtures/ocr_word_count_strict_cap_screenomics.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_artifact: SourceArtifact,
    exact_canonical_setting: CanonicalSetting,
    production_binding_status: String,
    input_boundary: String,
    output_boundary: String,
    comparison: String,
    cap_value: u64,
    limitations: Vec<String>,
    valid_cases: Vec<ValidCase>,
    invalid_cases: Vec<InvalidCase>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
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
struct ValidCase {
    case_id: String,
    screenshot_id: String,
    word_count: Number,
    expected_original_word_count: u64,
    expected_capped_word_count: u64,
    expected_recoded: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidCase {
    case_id: String,
    screenshot_id: String,
    word_count: Option<Number>,
    expected_error: String,
}

#[derive(Debug, PartialEq, Eq)]
struct CappedWordCount {
    screenshot_id: String,
    original_word_count: u64,
    capped_word_count: u64,
    recoded: bool,
}

/// Test-only source-neutral reference for a strict high-side integer cap.
///
/// The caller owns row identity and the derivation of the scalar. The
/// reference retains every valid row and preserves both the source value and
/// the value used after recoding.
fn cap_nonnegative_integer(
    screenshot_id: &str,
    value: Option<&Number>,
    cap: u64,
) -> Result<CappedWordCount, &'static str> {
    let value = value.ok_or("word_count_required")?;
    let original_word_count = value
        .as_u64()
        .ok_or("nonnegative_integer_word_count_required")?;
    let recoded = original_word_count > cap;
    Ok(CappedWordCount {
        screenshot_id: screenshot_id.to_owned(),
        original_word_count,
        capped_word_count: if recoded { cap } else { original_word_count },
        recoded,
    })
}

#[test]
fn specifies_the_strict_row_preserving_ocr_word_count_cap_without_a_production_binding() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");

    assert_eq!(
        fixture.schema_version,
        "chronicle-ocr-word-count-strict-cap-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1016/j.chb.2020.106570");
    assert_eq!(
        (
            fixture.source_artifact.locator.as_str(),
            fixture.source_artifact.sha256.as_str(),
        ),
        (
            ".tmp-literature-review-private/corrective-packet-04-ranks-074-123-20260831/text/096.txt:174-176",
            "381843c86a2703627c94cde70701e54516d01d4bbc74241cb358d144fc17ebaf",
        )
    );
    assert_eq!(
        (
            fixture.exact_canonical_setting.setting_id.as_str(),
            fixture.exact_canonical_setting.parameter_key.as_str(),
            fixture
                .exact_canonical_setting
                .source_observed_setting
                .as_str(),
            fixture.exact_canonical_setting.source_value_sha256.as_str(),
        ),
        (
            "method-setting-b9e7628e706265b033e571a8",
            "text.word_count_cap",
            "text.word_count_cap: {\"above\":150,\"recode_to\":150,\"reason\":\"inflated values including horizontal orientation\"}",
            "dc46f20dfa0115135f5d1a180562fbedf4870b5c3aa95c69d1d7a9773257b4d8",
        )
    );
    assert_eq!(
        fixture.production_binding_status,
        "missing_ocr_word_count_strict_cap_binding"
    );
    assert_eq!(fixture.comparison, "strictly_greater_than");
    assert_eq!(fixture.cap_value, 150);
    assert!(fixture.input_boundary.contains("already OCR-derived"));
    assert!(fixture.input_boundary.contains("nonnegative integer"));
    assert!(fixture.output_boundary.contains("Retain every valid"));
    assert!(fixture
        .output_boundary
        .contains("strictly greater than 150"));
    for required_limitation in [
        "does not implement OCR",
        "does not infer grouping or ordering",
        "Missing, negative, fractional, or out-of-range",
        "no production Chronicle binding exists",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(required_limitation)));
    }

    let valid_row_count = fixture.valid_cases.len();
    let outputs = fixture
        .valid_cases
        .iter()
        .map(|case| {
            let actual = cap_nonnegative_integer(
                &case.screenshot_id,
                Some(&case.word_count),
                fixture.cap_value,
            )
            .unwrap_or_else(|error| panic!("{} unexpectedly failed: {error}", case.case_id));
            assert_eq!(
                actual,
                CappedWordCount {
                    screenshot_id: case.screenshot_id.clone(),
                    original_word_count: case.expected_original_word_count,
                    capped_word_count: case.expected_capped_word_count,
                    recoded: case.expected_recoded,
                },
                "{}",
                case.case_id
            );
            actual
        })
        .collect::<Vec<_>>();
    assert_eq!(outputs.len(), valid_row_count, "valid rows are retained");

    for case in &fixture.invalid_cases {
        assert_eq!(
            cap_nonnegative_integer(
                &case.screenshot_id,
                case.word_count.as_ref(),
                fixture.cap_value,
            ),
            Err(case.expected_error.as_str()),
            "{}",
            case.case_id
        );
    }
}
