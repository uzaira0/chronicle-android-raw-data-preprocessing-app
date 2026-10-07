#[path = "../src/grouped_column_summary.rs"]
mod grouped_column_summary;

use grouped_column_summary::{
    mean_columns_by_factor_group, summarize_columns_by_first_seen_group, GroupedColumnSummary,
    GroupedColumnSummaryError, GroupedNumericRow,
};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/grouped_column_summary_source.json");

#[test]
fn missing_propagating_means_match_the_retained_r_preparation_stage() {
    let oracle: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/bjerre_preparation_oracle.json")).unwrap();
    let mut compared = 0;
    for case in oracle["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["status"] == "ok")
    {
        // This tests only load_data.R:60-64, not upstream readr/derivation or
        // the subsequent study join/factor conversions/final standardization.
        // The retained course table has male/smoker factored at line72; restore
        // only their declared pre-mean types when selecting numeric columns.
        let course = &case["course"];
        let columns = course["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect::<Vec<_>>();
        let user = columns.iter().position(|name| *name == "user_idx").unwrap();
        let numeric = columns
            .iter()
            .enumerate()
            .filter(|(_, name)| {
                let classes = if **name == "male" {
                    &case["input"]["classes"][*name]
                } else {
                    &course["classes"][*name]
                };
                **name == "smoker"
                    || classes
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|class| class == "numeric" || class == "integer")
            })
            .map(|(index, name)| (index, *name))
            .collect::<Vec<_>>();
        let number =
            |value: &serde_json::Value| value.as_str().map(|text| text.parse::<f64>().unwrap());
        let rows = course["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| GroupedNumericRow {
                group: row[user].as_str().map(str::to_owned),
                values: numeric
                    .iter()
                    .map(|(index, _)| number(&row[*index]))
                    .collect(),
            })
            .collect::<Vec<_>>();
        let mut order = course["levels"]["user_idx"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| Some(value.as_str().unwrap().to_owned()))
            .collect::<Vec<_>>();
        if rows.iter().any(|row| row.group.is_none()) {
            order.push(None);
        }
        let means = mean_columns_by_factor_group(&rows, &order, numeric.len()).unwrap();
        let participant = &case["participant"];
        let expected_columns = participant["columns"].as_array().unwrap();
        let expected_user = expected_columns
            .iter()
            .position(|name| name == "user_idx")
            .unwrap();
        let expected_rows = participant["rows"].as_array().unwrap();
        let observed_order = expected_rows
            .iter()
            .map(|row| row[expected_user].as_str().map(str::to_owned))
            .fold(Vec::new(), |mut groups, group| {
                if !groups.contains(&group) {
                    groups.push(group);
                }
                groups
            });
        assert_eq!(
            means
                .iter()
                .map(|row| row.group.clone())
                .collect::<Vec<_>>(),
            observed_order,
            "{} group order",
            case["name"]
        );
        for row in &means {
            let expected = expected_rows
                .iter()
                .find(|entry| entry[expected_user].as_str() == row.group.as_deref())
                .unwrap();
            for (column, (_, name)) in numeric.iter().enumerate() {
                if *name == "screentime_std" {
                    continue;
                } // overwritten after the later study join
                let target = match *name {
                    "grade" => "gpa",
                    "study" => "study.x",
                    name => name,
                };
                let expected_index = expected_columns
                    .iter()
                    .position(|value| value == target)
                    .unwrap();
                let expected = number(&expected[expected_index]);
                match (row.values[column], expected) {
                    (None, None) => {}
                    (Some(actual), Some(expected)) if actual.is_nan() && expected.is_nan() => {}
                    (Some(actual), Some(expected)) => assert!(
                        actual == expected
                            || (actual - expected).abs() <= 1e-12 * expected.abs().max(1.0),
                        "{} {name}",
                        case["name"]
                    ),
                    _ => panic!("{} {name}: NA/NaN/value distinction changed", case["name"]),
                }
            }
        }
        compared += 1;
    }
    assert_eq!(compared, 25);
    let rows = vec![
        GroupedNumericRow {
            group: None,
            values: vec![Some(2.0), None],
        },
        GroupedNumericRow {
            group: None,
            values: vec![Some(4.0), Some(8.0)],
        },
    ];
    assert_eq!(
        mean_columns_by_factor_group(&rows, &[None], 2).unwrap()[0].values,
        vec![Some(3.0), None]
    );
    assert_eq!(
        mean_columns_by_factor_group(&rows, &[], 2),
        Err(GroupedColumnSummaryError::InvalidGroupOrder)
    );
    assert_eq!(
        mean_columns_by_factor_group(&rows, &[None, None], 2),
        Err(GroupedColumnSummaryError::InvalidGroupOrder)
    );
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_code_sha256: String,
    source_locator: String,
    source_runtime: SourceRuntime,
    exact_canonical_setting_ids: Vec<String>,
    cases: Vec<FixtureCase>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceRuntime {
    original_version_disclosure: String,
    oracle_engine: String,
    oracle_version: String,
    oracle_platform: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    case_id: String,
    rows: Vec<FixtureRow>,
    expected: Option<Vec<ExpectedSummary>>,
    expected_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FixtureRow {
    group: Option<String>,
    values: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedSummary {
    group: Option<String>,
    means: Vec<String>,
    sample_standard_deviations: Vec<String>,
}

fn input_number(value: &str) -> Option<f64> {
    (value != "NA").then(|| value.parse::<f64>().expect("fixture numeric value"))
}

#[test]
fn primitive_matches_released_grouped_mean_and_sample_sd_semantics() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-grouped-column-summary-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1177/2050157921993896");
    assert_eq!(
        fixture.source_code_sha256,
        "951d86185cd8d561e5e12c5fc962b4778f16189e6be06284790d1b541f73805b"
    );
    assert!(fixture
        .source_locator
        .ends_with("itemSelection_preprocessing.R:20-39"));
    assert_eq!(
        fixture.source_runtime.original_version_disclosure,
        "not disclosed"
    );
    assert_eq!(fixture.source_runtime.oracle_engine, "R");
    assert_eq!(fixture.source_runtime.oracle_version, "4.6.1");
    assert_eq!(
        fixture.source_runtime.oracle_platform,
        "aarch64-apple-darwin25.4.0"
    );
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        [
            "method-setting-f8153027f090225acb723955",
            "method-setting-892d9b6b5121e2bf37c75722",
        ]
    );
    assert_eq!(fixture.limitations.len(), 3);

    for case in fixture.cases {
        let rows = case
            .rows
            .into_iter()
            .map(|row| GroupedNumericRow {
                group: row.group,
                values: row.values.iter().map(|value| input_number(value)).collect(),
            })
            .collect::<Vec<_>>();
        let actual = summarize_columns_by_first_seen_group(&rows);

        match (case.expected, case.expected_error.as_deref()) {
            (Some(expected), None) => assert_summaries(
                &case.case_id,
                &actual.expect("expected summaries"),
                &expected,
            ),
            (None, Some("empty_input")) => assert_eq!(
                actual,
                Err(GroupedColumnSummaryError::EmptyInput),
                "case {}",
                case.case_id
            ),
            _ => panic!("case {} has an invalid expected outcome", case.case_id),
        }
    }
}

fn assert_summaries(case_id: &str, actual: &[GroupedColumnSummary], expected: &[ExpectedSummary]) {
    assert_eq!(actual.len(), expected.len(), "case {case_id}");
    for (actual, expected) in actual.iter().zip(expected) {
        assert_eq!(actual.group, expected.group, "case {case_id}");
        assert_numbers(case_id, &actual.means, &expected.means);
        assert_optional_numbers(
            case_id,
            &actual.sample_standard_deviations,
            &expected.sample_standard_deviations,
        );
    }
}

fn assert_numbers(case_id: &str, actual: &[f64], expected: &[String]) {
    assert_eq!(actual.len(), expected.len(), "case {case_id}");
    for (actual, expected) in actual.iter().zip(expected) {
        if expected == "NaN" {
            assert!(actual.is_nan(), "case {case_id}");
        } else {
            let expected = expected.parse::<f64>().expect("finite expected value");
            assert!(
                (actual - expected).abs() <= f64::EPSILON,
                "case {case_id}: expected {expected}, got {actual}"
            );
        }
    }
}

fn assert_optional_numbers(case_id: &str, actual: &[Option<f64>], expected: &[String]) {
    assert_eq!(actual.len(), expected.len(), "case {case_id}");
    for (actual, expected) in actual.iter().zip(expected) {
        if expected == "NA" {
            assert_eq!(*actual, None, "case {case_id}");
        } else {
            let expected = expected.parse::<f64>().expect("finite expected value");
            let actual = actual.expect("expected sample standard deviation");
            assert!(
                (actual - expected).abs() <= f64::EPSILON,
                "case {case_id}: expected {expected}, got {actual}"
            );
        }
    }
}
