#[path = "../src/distance_matrix_medoid.rs"]
mod distance_matrix_medoid;

use distance_matrix_medoid::{distance_matrix_medoid_index, DistanceMatrixMedoidError};
use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/distance_matrix_medoid_source.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_setting_id: String,
    parameter_key: String,
    source_value: String,
    source_value_sha256: String,
    source_artifact: SourceArtifact,
    released_runtime: ReleasedRuntime,
    cases: Vec<FixtureCase>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifact {
    archive_path: String,
    archive_sha256: String,
    member: String,
    member_sha256: String,
    locator: String,
    commit: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleasedRuntime {
    python: String,
    spark: String,
    scikit_learn: String,
    numpy: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureCase {
    case_id: String,
    matrix: Vec<Vec<String>>,
    expected_index: usize,
}

fn numeric(value: &str) -> f64 {
    value.parse::<f64>().expect("fixture numeric value")
}

#[test]
fn replays_released_column_sum_and_first_argmin_medoid_selection() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("source fixture JSON");

    assert_eq!(
        fixture.schema_version,
        "chronicle-distance-matrix-medoid-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1038/s41598-019-47493-x");
    assert_eq!(
        fixture.exact_canonical_setting_id,
        "method-setting-e417f78f692addf3c606620a"
    );
    assert_eq!(fixture.parameter_key, "gps.stop_representative");
    assert_eq!(
        fixture.source_value,
        "medoid minimizing distance to all other points"
    );
    assert_eq!(
        fixture.source_value_sha256,
        "f370619f7de71c71efbe358a8bdfd0ba70fb2a72456c865ba24d099c988f0d49"
    );
    assert!(fixture
        .source_artifact
        .archive_path
        .ends_with("embedded-cited-work--2ec23aa61b8d.tar.gz"));
    assert_eq!(
        fixture.source_artifact.archive_sha256,
        "9213fbdb9cbf590e4c709ef22c40ea7f60d00ad0fb712cfeec6cb0f9a1ad7d08"
    );
    assert_eq!(
        fixture.source_artifact.member,
        "apps-mobility-capacity-strategy-master/pyspark_stop_locations.py"
    );
    assert_eq!(
        fixture.source_artifact.member_sha256,
        "738c92d3b46c0fb01655c547888604a9ecf41f88ad0486134915165361b88a5d"
    );
    assert_eq!(
        fixture.source_artifact.locator,
        "pyspark_stop_locations.py:53-60,115-124"
    );
    assert_eq!(
        fixture.source_artifact.commit,
        "61af2598fdadce4c4de81856be2d95037619b031"
    );
    assert_eq!(fixture.released_runtime.python, "3.6");
    assert_eq!(fixture.released_runtime.spark, "2.2.1");
    assert_eq!(fixture.released_runtime.scikit_learn, "0.19");
    assert_eq!(
        fixture.released_runtime.numpy,
        "not pinned by the released README"
    );
    assert_eq!(fixture.limitations.len(), 3);

    for case in fixture.cases {
        let matrix = case
            .matrix
            .iter()
            .map(|row| row.iter().map(|value| numeric(value)).collect())
            .collect::<Vec<Vec<f64>>>();
        assert_eq!(
            distance_matrix_medoid_index(&matrix),
            Ok(case.expected_index),
            "case {}",
            case.case_id
        );
    }
}

#[test]
fn rejects_malformed_or_nonfinite_distance_matrices() {
    assert_eq!(
        distance_matrix_medoid_index(&[]),
        Err(DistanceMatrixMedoidError::EmptyMatrix)
    );
    assert_eq!(
        distance_matrix_medoid_index(&[vec![0.0, 1.0], vec![1.0]]),
        Err(DistanceMatrixMedoidError::NonSquareMatrix {
            row_index: 1,
            expected: 2,
            actual: 1,
        })
    );
    assert_eq!(
        distance_matrix_medoid_index(&[vec![0.0, f64::NAN], vec![1.0, 0.0]]),
        Err(DistanceMatrixMedoidError::NonFiniteDistance {
            row_index: 0,
            column_index: 1,
        })
    );
}
