use std::collections::{BTreeMap, BTreeSet};

use chronicle_preprocessing_runtime_wasm::literature_input_adapters::analysis_positive_feature_matrix_result;
use serde::Deserialize;

#[test]
fn loneliness_seven_feature_families_and_opaque_sleep_columns_remain_distinct() {
    // Appendix1:34,55,90,122,124,180,188,200,308,321 (semester-only).
    // Printed integers are fold-selection counts, NOT these participant values.
    // Exact feature labels preserve scope; totalsleep and 0 remain undecoded.
    let columns = [
        (
            "bluetooth",
            "FG6_f_blue_num_scans_of_least_frequent_device_of_others_mo_wkend",
        ),
        ("phone_usage", "FG14_f_screen_first_on_Hour_4_ni_wkdy"),
        ("campus_map", "FG7_f_locMap_study_duration_minutes_af"),
        ("calls", "FG15_f_call_number_incoming_calls_ni_wkend"),
        ("steps", "FG11_f_steps_max_steps_ev_wkdy"),
        ("sleep", "FG13_f_slp_avg_length_bout_awake_ni"),
        ("location", "FG12_f_loc_home_stay_time_percent_10m_ev_wkend"),
        ("sleep", "FG2_f_slp_end_time_min_bout_totalsleep_wkdy"),
        ("sleep", "FG4_f_slp_num_totalsleep_bouts_mo"),
        ("sleep", "FG12_f_slp_num_0_ev_wkend"),
    ];
    assert_eq!(
        columns
            .iter()
            .map(|(family, _)| *family)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "bluetooth",
            "phone_usage",
            "campus_map",
            "calls",
            "steps",
            "sleep",
            "location"
        ])
    );
    let mut cells = Vec::new();
    for (participant, value) in [
        ("example:student-a", "1.0000"),
        ("example:student-b", "2.000"),
    ] {
        for &(family, feature) in &columns {
            cells.push((participant, family, feature, value));
        }
    }
    let encode = |cells: &[(&str, &str, &str, &str)]| {
        let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
        writer
            .write_record([
                "participant_id",
                "feature_id",
                "value",
                "missing_state",
                "feature_set_id",
            ])
            .unwrap();
        for &(participant, family, feature, value) in cells {
            writer
                .write_record([participant, feature, value, "observed", family])
                .unwrap();
        }
        writer.into_inner().unwrap()
    };
    let assert_cells = |cells: &[(&str, &str, &str, &str)]| {
        let (output, count) = analysis_positive_feature_matrix_result(&encode(cells))
            .expect("source-labelled matrix accepted");
        assert_eq!(count as usize, cells.len());
        let mut reader = csv::ReaderBuilder::new().from_reader(output.as_slice());
        let headers = reader.headers().unwrap().clone();
        let column = |name| headers.iter().position(|field| field == name).unwrap();
        let p = column("participant_id");
        let s = column("feature_set_id");
        let f = column("feature_id");
        let input = column("input_value");
        let result = column("output_value");
        let disposition = column("disposition");
        let actual: BTreeMap<_, _> = reader
            .records()
            .map(|row| {
                let row = row.unwrap();
                (
                    (row[p].to_owned(), row[s].to_owned(), row[f].to_owned()),
                    (
                        row[input].to_owned(),
                        row[result].to_owned(),
                        row[disposition].to_owned(),
                    ),
                )
            })
            .collect();
        let expected: BTreeMap<_, _> = cells
            .iter()
            .map(|&(participant, family, feature, value)| {
                (
                    (
                        participant.to_owned(),
                        family.to_owned(),
                        feature.to_owned(),
                    ),
                    (
                        value.to_owned(),
                        value.to_owned(),
                        "retain_observed".to_owned(),
                    ),
                )
            })
            .collect();
        assert_eq!(actual, expected);
    };
    assert_cells(&cells);
    let mut changed = cells.clone();
    changed[0].3 = "17.0000";
    assert_cells(&changed);
    let mut reversed = cells.clone();
    reversed.reverse();
    assert_cells(&reversed);
    let mut duplicate = cells.clone();
    duplicate.push(cells[0]);
    assert!(analysis_positive_feature_matrix_result(&encode(&duplicate))
        .unwrap_err()
        .contains("duplicate feature cell"));
    let mut incomplete = cells.clone();
    incomplete.pop();
    assert!(
        analysis_positive_feature_matrix_result(&encode(&incomplete))
            .unwrap_err()
            .contains("not rectangular")
    );
}

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/positive_feature_matrix_missingness_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    canonical_settings: Vec<CanonicalSetting>,
    superseded_aliases: BTreeMap<String, Vec<String>>,
    source_artifacts: Vec<SourceArtifact>,
    participant_count: u32,
    participant_rule_interpretation: ParticipantRuleInterpretation,
    feature_sets: Vec<FeatureSet>,
    expected_rows: Vec<ExpectedRow>,
    invalid_observed_values: Vec<String>,
    limitations: Vec<String>,
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
    role: String,
    locator: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParticipantRuleInterpretation {
    comparator: String,
    equality_disposition: String,
    rationale: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FeatureSet {
    feature_set_id: String,
    features: Vec<Feature>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Feature {
    feature_id: String,
    base_feature_id: String,
    time_segment_id: String,
    observed_value: String,
    missing_participant_ordinals: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedRow {
    participant_id: String,
    feature_set_id: String,
    feature_id: String,
    feature_missing_participant_count: u32,
    feature_retained: bool,
    participant_missing_feature_count: u32,
    participant_retained_feature_count: u32,
    participant_missing_fraction_percent: String,
    participant_retained: bool,
    output_value: String,
    disposition: String,
}

fn source_matrix(fixture: &Fixture) -> Vec<u8> {
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record([
            "participant_id",
            "feature_id",
            "value",
            "missing_state",
            "feature_set_id",
        ])
        .expect("write source matrix header");
    for ordinal in 1..=fixture.participant_count {
        for feature_set in &fixture.feature_sets {
            for feature in &feature_set.features {
                let missing = feature.missing_participant_ordinals.contains(&ordinal);
                writer
                    .write_record([
                        format!("p{ordinal:02}"),
                        feature.feature_id.clone(),
                        if missing {
                            String::new()
                        } else {
                            feature.observed_value.clone()
                        },
                        if missing { "missing" } else { "observed" }.to_owned(),
                        feature_set.feature_set_id.clone(),
                    ])
                    .expect("write source matrix row");
            }
        }
    }
    writer.into_inner().expect("finish source matrix")
}

#[test]
fn loneliness_missingness_is_scoped_ordered_and_positive_domain_bound() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");
    assert_eq!(
        fixture.schema_version,
        "chronicle-positive-feature-matrix-missingness-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.2196/13209");
    let setting_ids = fixture
        .canonical_settings
        .iter()
        .map(|setting| setting.setting_id.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        setting_ids,
        BTreeSet::from([
            "method-setting-79fb8e1d1c3eb1083e945d33",
            "method-setting-atomic-3e4326e90309d00dc667",
            "method-setting-bc30a690a8f91c0be9c32846",
            "method-setting-d0b0d241f8cb9af3f729ac1a",
        ])
    );
    for setting in &fixture.canonical_settings {
        assert!(!setting.parameter_key.is_empty());
        assert!(setting
            .source_observed_setting
            .starts_with(&format!("{}: ", setting.parameter_key)));
        assert_eq!(setting.source_value_sha256.len(), 64);
    }
    assert_eq!(
        fixture
            .superseded_aliases
            .values()
            .map(Vec::len)
            .sum::<usize>(),
        4
    );
    assert_eq!(fixture.source_artifacts.len(), 3);
    for artifact in &fixture.source_artifacts {
        assert!(!artifact.role.is_empty());
        assert!(!artifact.locator.is_empty());
        assert_eq!(artifact.sha256.len(), 64);
    }
    assert_eq!(
        fixture.participant_rule_interpretation.comparator,
        "missing_count / retained_feature_count >= 0.20"
    );
    assert_eq!(
        fixture.participant_rule_interpretation.equality_disposition,
        "drop_participant"
    );
    assert!(fixture
        .participant_rule_interpretation
        .rationale
        .contains("does not say more than 20%"));
    assert_eq!(fixture.limitations.len(), 3);

    let repeated_base = fixture.feature_sets[0]
        .features
        .iter()
        .filter(|feature| feature.base_feature_id == "phone_unlocks")
        .collect::<Vec<_>>();
    assert_eq!(repeated_base.len(), 2);
    assert_eq!(
        repeated_base
            .iter()
            .map(|feature| feature.time_segment_id.as_str())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["week_01", "week_02"])
    );
    assert_ne!(repeated_base[0].feature_id, repeated_base[1].feature_id);

    let input = source_matrix(&fixture);
    let (output, row_count) =
        analysis_positive_feature_matrix_result(&input).expect("source matrix executes");
    assert_eq!(row_count, 384);
    let mut reader = csv::ReaderBuilder::new().from_reader(output.as_slice());
    let headers = reader.headers().expect("result header").clone();
    let column = |name: &str| {
        headers
            .iter()
            .position(|header| header == name)
            .unwrap_or_else(|| panic!("missing result column {name}"))
    };
    let participant = column("participant_id");
    let feature_set = column("feature_set_id");
    let feature = column("feature_id");
    let feature_missing = column("feature_missing_participant_count");
    let feature_retained = column("feature_retained");
    let participant_missing = column("participant_missing_feature_count");
    let participant_features = column("participant_retained_feature_count");
    let participant_percent = column("participant_missing_fraction_percent");
    let participant_retained = column("participant_retained");
    let output_value = column("output_value");
    let disposition = column("disposition");
    let rows = reader
        .records()
        .map(|record| {
            let record = record.expect("valid result row");
            (
                (
                    record.get(participant).unwrap().to_owned(),
                    record.get(feature_set).unwrap().to_owned(),
                    record.get(feature).unwrap().to_owned(),
                ),
                record,
            )
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(rows.len(), 384);
    for expected in &fixture.expected_rows {
        let row = rows
            .get(&(
                expected.participant_id.clone(),
                expected.feature_set_id.clone(),
                expected.feature_id.clone(),
            ))
            .expect("expected result row");
        assert_eq!(
            row.get(feature_missing).unwrap(),
            expected.feature_missing_participant_count.to_string()
        );
        assert_eq!(
            row.get(feature_retained).unwrap(),
            expected.feature_retained.to_string()
        );
        assert_eq!(
            row.get(participant_missing).unwrap(),
            expected.participant_missing_feature_count.to_string()
        );
        assert_eq!(
            row.get(participant_features).unwrap(),
            expected.participant_retained_feature_count.to_string()
        );
        assert_eq!(
            row.get(participant_percent).unwrap(),
            expected.participant_missing_fraction_percent
        );
        assert_eq!(
            row.get(participant_retained).unwrap(),
            expected.participant_retained.to_string()
        );
        assert_eq!(row.get(output_value).unwrap(), expected.output_value);
        assert_eq!(row.get(disposition).unwrap(), expected.disposition);
    }

    for invalid_value in &fixture.invalid_observed_values {
        let input = format!(
            "participant_id,feature_id,value,missing_state,feature_set_id\np01,f::week_01,{invalid_value},observed,setA\n"
        );
        let error = analysis_positive_feature_matrix_result(input.as_bytes())
            .expect_err("non-positive observed feature must fail closed");
        assert!(error.contains("strictly positive"), "{error}");
    }
}
