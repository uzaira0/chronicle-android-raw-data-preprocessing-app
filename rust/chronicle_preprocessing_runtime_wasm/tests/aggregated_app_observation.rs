#[path = "../src/aggregated_app_observation.rs"]
mod aggregated_app_observation;

use aggregated_app_observation::{
    parse_aggregated_app_observations, AggregatedAppObservation, AGGREGATED_APP_OBSERVATION_FIELDS,
};

const SOURCE_FIXTURE: &[u8] =
    include_bytes!("fixtures/aggregated_app_observations_denadai2019.csv.fixture");
const SOURCE_WORK_ID: &str = "doi:10.1038/s41598-019-47493-x";
const SOURCE_SHA256: &str = "d720426185ece4744a2cec4dcf47ac6e5b73f6dfda46bcd6b3b786bccdf530de";
const SOURCE_LOCATOR: &str =
    ".tmp-literature-review-private/corrective-queue-a-20260831/evidence/rank11.txt:384-420";
const EXACT_CANONICAL_SETTING_IDS: [&str; 2] = [
    "atomic-9661b7837815031b72c22a1e",
    "atomic-e612629ea94aa8c35cba9510",
];

fn csv_with(fields: &[&str], values: &[&str]) -> Vec<u8> {
    format!("{}\n{}\n", fields.join(","), values.join(",")).into_bytes()
}

#[test]
fn source_native_aggregates_are_preserved_and_undisclosed_schema_is_rejected() {
    assert_eq!(SOURCE_WORK_ID, "doi:10.1038/s41598-019-47493-x");
    assert_eq!(SOURCE_SHA256.len(), 64);
    assert!(SOURCE_LOCATOR.ends_with("rank11.txt:384-420"));
    assert_eq!(
        EXACT_CANONICAL_SETTING_IDS,
        [
            "atomic-9661b7837815031b72c22a1e",
            "atomic-e612629ea94aa8c35cba9510",
        ]
    );

    let actual = parse_aggregated_app_observations(SOURCE_FIXTURE)
        .expect("source-shaped aggregated application records");
    assert_eq!(
        actual,
        [
            AggregatedAppObservation {
                user_id: "hashed-user-a".into(),
                date: "2018-06-01".into(),
                application_name: "Communication App A".into(),
                screen_time: "01.250".into(),
                launch_count: "0007".into(),
            },
            AggregatedAppObservation {
                user_id: "hashed-user-a".into(),
                date: "2018-06-01".into(),
                application_name: "Social App B".into(),
                screen_time: "0".into(),
                launch_count: "0".into(),
            },
            AggregatedAppObservation {
                user_id: "hashed-user-b".into(),
                date: "2018-06-02".into(),
                application_name: "Reading App C".into(),
                screen_time: "975.5".into(),
                launch_count: "3".into(),
            },
        ]
    );
    assert_eq!(actual[0].screen_time, "01.250");
    assert_eq!(actual[0].launch_count, "0007");

    let defaults = ["hashed-user", "2018-06-01", "App", "1.5", "2"];
    for missing_field in AGGREGATED_APP_OBSERVATION_FIELDS {
        let kept = AGGREGATED_APP_OBSERVATION_FIELDS
            .iter()
            .zip(defaults)
            .filter(|(field, _)| **field != missing_field)
            .collect::<Vec<_>>();
        let fields = kept.iter().map(|(field, _)| **field).collect::<Vec<_>>();
        let values = kept.iter().map(|(_, value)| *value).collect::<Vec<_>>();
        let error = parse_aggregated_app_observations(&csv_with(&fields, &values))
            .expect_err("missing source field must fail closed");
        assert!(error.to_string().contains(missing_field), "{error}");

        let mut empty_values = defaults;
        empty_values[AGGREGATED_APP_OBSERVATION_FIELDS
            .iter()
            .position(|field| *field == missing_field)
            .expect("fixture field")] = "";
        let error = parse_aggregated_app_observations(&csv_with(
            &AGGREGATED_APP_OBSERVATION_FIELDS,
            &empty_values,
        ))
        .expect_err("empty source field must fail closed");
        assert!(error.to_string().contains(missing_field), "{error}");
    }

    let error = parse_aggregated_app_observations(
        b"user_id,date,application_name,screen_time,launch_count,timestamp\nP1,2018-06-01,App,1,2,00:00\n",
    )
    .expect_err("undisclosed extra identity field must fail closed");
    assert!(error.to_string().contains("timestamp"));
}
