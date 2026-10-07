use serde::Deserialize;

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/affect_free_text_minimum_utf16_emotion_sampling.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_revision: SourceRevision,
    exact_canonical_setting: CanonicalSetting,
    sibling_setting: SiblingSetting,
    source_artifacts: Vec<SourceArtifact>,
    production_binding_status: String,
    input_boundary: String,
    count_semantics: String,
    output_boundary: String,
    minimum_utf16_code_units: usize,
    limitations: Vec<String>,
    cases: Vec<TextCase>,
    missing_text_case: MissingTextCase,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceRevision {
    commit: String,
    tree: String,
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
struct SiblingSetting {
    setting_id: String,
    parameter_key: String,
    source_observed_setting: String,
    source_value_sha256: String,
    source_locator: String,
    source_artifact_sha256: String,
    shared_predicate: String,
    caller_difference: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TextCase {
    case_id: String,
    text: String,
    expected_utf16_code_units: usize,
    expected_meets_minimum: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissingTextCase {
    case_id: String,
    text: Option<String>,
    expected_error: String,
}

/// Test-only reference for the smallest missing source-neutral primitive.
///
/// Rust strings are UTF-8, whereas the captured Android caller invokes Java
/// `String.length()`. Encoding to UTF-16 reproduces Java's code-unit count
/// without trimming or normalizing the source text.
fn meets_minimum_utf16_code_units(text: &str, minimum: usize) -> bool {
    text.encode_utf16().count() >= minimum
}

fn required_raw_text(text: Option<&str>) -> Result<&str, &'static str> {
    text.ok_or("raw_answer_text_required")
}

#[test]
fn specifies_the_missing_raw_text_utf16_gate_without_claiming_a_production_binding() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");

    assert_eq!(
        fixture.schema_version,
        "chronicle-raw-text-minimum-utf16-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3191754");
    assert_eq!(
        (
            fixture.source_revision.commit.as_str(),
            fixture.source_revision.tree.as_str(),
        ),
        (
            "2181ae41d0633ae1708df8fe0b0c8e35c3c8fdca",
            "74c00e3b1a7f537a00e1fd0d76027b0e5064836c",
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
            "method-setting-b1af907e1494c7266158e17c",
            "sampling.affect_free_text_minimum_characters",
            "sampling.affect_free_text_minimum_characters: 25",
            "3f368ffab8110bf101f11f827edad692fae6c18dc84d58f5feb37c811bb5ff82",
        )
    );
    assert_eq!(
        (
            fixture.sibling_setting.setting_id.as_str(),
            fixture.sibling_setting.parameter_key.as_str(),
            fixture.sibling_setting.source_observed_setting.as_str(),
            fixture.sibling_setting.source_value_sha256.as_str(),
            fixture.sibling_setting.source_locator.as_str(),
            fixture.sibling_setting.source_artifact_sha256.as_str(),
            fixture.sibling_setting.shared_predicate.as_str(),
        ),
        (
            "method-setting-503fde4baa827bcb852902d3",
            "sampling.meaningfulness_free_text_minimum_characters",
            "sampling.meaningfulness_free_text_minimum_characters: 25",
            "b97ac07ba9a9001b7ed3796b6eb1aecc0d4b5b1d183567fee95572d5936ec197",
            ".tmp-literature-review-private/corrective-packet-04-ranks-074-123-20260831/code-data/098-emotion-sampling/app/src/main/java/com/uw/hcde/esm/Sample.java:454-466",
            "0edeae88ed09004873fedb8a3431052096b20c49e079d7b4118c88af58ef9c8b",
            "response.length() >= 25",
        )
    );
    assert_ne!(
        fixture.exact_canonical_setting.setting_id, fixture.sibling_setting.setting_id,
        "the affect and meaningfulness claims remain distinct canonical settings"
    );
    assert!(fixture
        .sibling_setting
        .caller_difference
        .contains("stores affectText before the gate"));
    assert!(fixture
        .sibling_setting
        .caller_difference
        .contains("stores meaningfulnessText"));

    assert_eq!(fixture.source_artifacts.len(), 2);
    assert!(fixture.source_artifacts[0]
        .locator
        .ends_with("Sample.java:183-197"));
    assert_eq!(
        fixture.source_artifacts[0].sha256,
        "0edeae88ed09004873fedb8a3431052096b20c49e079d7b4118c88af58ef9c8b"
    );
    assert_eq!(
        fixture.sibling_setting.source_artifact_sha256, fixture.source_artifacts[0].sha256,
        "both source locations must remain bound to the same pinned Sample.java bytes"
    );
    assert!(fixture.source_artifacts[1]
        .locator
        .ends_with("affect_text.xml:54-69"));
    assert_eq!(
        fixture.source_artifacts[1].sha256,
        "8a1a41ca32e83b4d597992771e28331668b0bd963cc51303e8135b507284da1f"
    );

    assert_eq!(
        fixture.production_binding_status,
        "missing_raw_text_utf16_minimum_gate"
    );
    assert!(fixture
        .input_boundary
        .contains("answer.getText().toString()"));
    assert!(fixture.count_semantics.contains("UTF-16 code units"));
    assert!(fixture.count_semantics.contains("without trimming"));
    assert!(fixture.output_boundary.contains("at least 25"));
    assert!(fixture.output_boundary.contains("Equality advances"));
    assert_eq!(fixture.minimum_utf16_code_units, 25);
    for required_limitation in [
        "does not mutate the questionnaire UI or Event",
        "stores event.affectText before evaluating the gate",
        "different successful-side Event and prompt-completion actions",
        "Whitespace, line breaks, combining marks, and UTF-16 surrogate pairs",
        "missing text field must fail closed",
        "does not claim that a production Chronicle binding exists",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(required_limitation)));
    }

    for case in fixture.cases {
        assert_eq!(
            case.text.encode_utf16().count(),
            case.expected_utf16_code_units,
            "{}",
            case.case_id
        );
        assert_eq!(
            meets_minimum_utf16_code_units(&case.text, fixture.minimum_utf16_code_units),
            case.expected_meets_minimum,
            "{}",
            case.case_id
        );
    }

    assert_eq!(
        required_raw_text(fixture.missing_text_case.text.as_deref()),
        Err(fixture.missing_text_case.expected_error.as_str()),
        "{}",
        fixture.missing_text_case.case_id
    );
}
