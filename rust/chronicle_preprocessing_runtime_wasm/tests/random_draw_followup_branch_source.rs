#[path = "../src/finite_scalar_pivot_classifier.rs"]
mod finite_scalar_pivot_classifier;

use finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/random_draw_followup_branch_challenge.json");

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
    rules: Vec<DrawRule>,
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
    released_code_commit: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DrawRule {
    rule_id: String,
    minimum_draw: i64,
    maximum_draw: i64,
    pivot: f64,
    below_disposition: String,
    equal_disposition: String,
    above_disposition: String,
    cases: Vec<DrawCase>,
    invalid_draws: Vec<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DrawCase {
    draw: i64,
    expected_disposition: String,
}

fn required_bounded_draw(
    draw: Option<i64>,
    minimum: i64,
    maximum: i64,
) -> Result<i64, &'static str> {
    let draw = draw.ok_or("random_draw_required")?;
    if draw < minimum || draw > maximum {
        return Err("random_draw_out_of_source_range");
    }
    Ok(draw)
}

#[test]
fn reproduces_bounded_random_draw_followup_branches_without_inventing_rng_state() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-bounded-random-draw-followup-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/3191754");
    let expected_settings = [
        (
            "method-setting-7d69af05c207b46889d73434",
            "sampling.affect_free_text_followup_probability",
            "sampling.affect_free_text_followup_probability: {\"numerator\":1,\"denominator\":10}",
            "3760ec58e735cf667d419444cceb0afdf9e77475ac0a80de427b3dfcdd2e99e7",
        ),
        (
            "method-setting-ff8cc6f8912ef08cd4384a65",
            "sampling.meaningfulness_free_text_code_probability",
            "sampling.meaningfulness_free_text_code_probability: {\"random_integer_range\":\"0..99\",\"predicate\":\"<=35\",\"implied_probability\":0.36}",
            "b1565a04b3e19607eb2e65492d94e53aa39bc57935404b9415712189dcc46e5d",
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
    assert!(fixture.source_artifact.locator.ends_with(
        "code-data/098-emotion-sampling/app/src/main/java/com/uw/hcde/esm/Sample.java:175-218,443-489"
    ));
    assert_eq!(
        fixture.source_artifact.sha256,
        "0edeae88ed09004873fedb8a3431052096b20c49e079d7b4118c88af58ef9c8b"
    );
    assert_eq!(
        fixture.source_artifact.released_code_commit,
        "2181ae41d0633ae1708df8fe0b0c8e35c3c8fdca"
    );
    assert!(fixture
        .input_boundary
        .contains("exact zero-based integer outcome"));
    assert!(fixture.output_boundary.contains("draw equals 0"));
    assert!(fixture.output_boundary.contains("less than or equal to 35"));
    for excluded_claim in [
        "No random seed",
        "fractional, or out-of-range draw fails closed",
        "prompt construction",
        "not collapsed into one inferred random stream",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(excluded_claim)));
    }

    assert_eq!(fixture.rules.len(), 2);
    for rule in fixture.rules {
        let classifier = FiniteScalarPivotClassifier::new(
            rule.pivot,
            rule.below_disposition,
            rule.equal_disposition,
            rule.above_disposition,
        )
        .expect("source pivot is finite");
        for case in rule.cases {
            let draw = required_bounded_draw(Some(case.draw), rule.minimum_draw, rule.maximum_draw)
                .expect("fixture draw is in the exact nextInt domain");
            assert_eq!(
                classifier.category_for(draw as f64).map(String::as_str),
                Ok(case.expected_disposition.as_str()),
                "{} draw {}",
                rule.rule_id,
                draw
            );
        }
        assert_eq!(
            required_bounded_draw(None, rule.minimum_draw, rule.maximum_draw),
            Err("random_draw_required"),
            "{} missing draw",
            rule.rule_id
        );
        for draw in rule.invalid_draws {
            assert_eq!(
                required_bounded_draw(Some(draw), rule.minimum_draw, rule.maximum_draw),
                Err("random_draw_out_of_source_range"),
                "{} invalid draw {}",
                rule.rule_id,
                draw
            );
        }
    }
}
