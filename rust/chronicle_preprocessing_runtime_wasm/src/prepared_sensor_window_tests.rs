use crate::prepared_sensor_window::{
    normalize_autosen_dimension, prepare_sensor_window_csv, reduce_s3_axis,
};
use std::collections::BTreeSet;

const HEADER: &str =
    "participant_id,window_id,sample_id,dimension,value,input_unit,window_duration_seconds\n";

#[test]
fn signed_variable_count_sensor_reductions_match_hand_math() {
    for (samples, expected) in [
        (vec![-2.0, 0.0, 2.0, 4.0], [1.0, -2.0, 4.0, 6.0]),
        (vec![-7.0], [-7.0, -7.0, -7.0, 0.0]),
        (vec![-4.0, -2.0], [-3.0, -4.0, -2.0, 2.0]),
    ] {
        let results = reduce_s3_axis(&samples).unwrap();
        assert_eq!(
            results.iter().map(|x| x.0).collect::<Vec<_>>(),
            ["average", "minimum", "maximum", "peak_to_peak"]
        );
        for ((_, actual), expected) in results.iter().zip(expected) {
            assert_eq!(actual.value, Some(expected));
            assert_eq!(actual.status, "computed");
            assert_eq!(actual.reason, "");
        }
    }
}

#[test]
fn autosen_signed_min_max_formula_and_constant_status_match_hand_math() {
    // Range=6 and numerators=0,2,4,6; normalization removes dimensions of units.
    let results = normalize_autosen_dimension(&[-2.0, 0.0, 2.0, 4.0]).unwrap();
    for (actual, expected) in results.iter().zip([0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0]) {
        assert_eq!(actual.value, Some(expected));
        assert_eq!(actual.status, "computed");
    }
    for actual in normalize_autosen_dimension(&[7.0, 7.0]).unwrap() {
        assert_eq!(actual.value, None);
        assert_eq!(actual.status, "source_undefined");
        assert_eq!(actual.reason, "zero_range_behavior_undisclosed");
    }
}

#[test]
fn actual_csv_keeps_participant_window_dimension_and_lexical_units_separate() {
    let input = format!("{HEADER}P,w,a,accelerometer_x,-2, caller m/s2 ,5\nP,w,b,accelerometer_x,0, caller m/s2 ,5\nP,w,c,accelerometer_x,2, caller m/s2 ,5\nP,w,d,accelerometer_x,4, caller m/s2 ,5\nQ,w,a,accelerometer_x,-7,caller other unit,5\nP,w,a,gyroscope_y,-4,caller rad/s,5\nP,w,b,gyroscope_y,-2,caller rad/s,5\nP,v,a,accelerometer_x,9, caller m/s2 ,5\n");
    let output = prepare_sensor_window_csv(input.as_bytes(), false, None).unwrap();
    assert_eq!(output.source_row_count, 8);
    assert_eq!(output.output_row_count, 16);
    let text = String::from_utf8(output.bytes).unwrap();
    for row in [
        "P,w,accelerometer_x, caller m/s2 ,5,4,,average,1.0,computed,,input_unit",
        "P,w,gyroscope_y,caller rad/s,5,2,,average,-3.0,computed,,input_unit",
        "Q,w,accelerometer_x,caller other unit,5,1,,peak_to_peak,0.0,computed,,input_unit",
        "P,v,accelerometer_x, caller m/s2 ,5,1,,maximum,9.0,computed,,input_unit",
    ] {
        assert!(text.contains(row), "{text}");
    }
    let only_range = BTreeSet::from(["peak_to_peak"]);
    assert_eq!(
        prepare_sensor_window_csv(input.as_bytes(), false, Some(&only_range))
            .unwrap()
            .output_row_count,
        4
    );
}

#[test]
fn actual_csv_normalizes_nonconstant_dimensions_while_preserving_constant_unknowns() {
    let input = format!("{HEADER}P,w,a,elevation,7,opaque height,5\nP,w,b,elevation,7,opaque height,5\nP,w,a,accelerometer_x,-2,caller m/s2,5\nP,w,b,accelerometer_x,0,caller m/s2,5\nP,w,c,accelerometer_x,2,caller m/s2,5\nP,w,d,accelerometer_x,4,caller m/s2,5\n");
    let output = prepare_sensor_window_csv(input.as_bytes(), true, None).unwrap();
    assert_eq!(output.source_row_count, 6);
    assert_eq!(output.output_row_count, 6);
    let text = String::from_utf8(output.bytes).unwrap();
    assert!(text.contains(
        "P,w,accelerometer_x,caller m/s2,5,4,a,min_max_normalization,0.0,computed,,dimensionless"
    ));
    assert!(text.contains("P,w,accelerometer_x,caller m/s2,5,4,b,min_max_normalization,0.3333333333333333,computed,,dimensionless"));
    assert!(text.contains("P,w,elevation,opaque height,5,2,a,min_max_normalization,,source_undefined,zero_range_behavior_undisclosed,dimensionless"));
}

#[test]
fn transport_qualification_rejects_missing_nonfinite_ambiguous_and_cadence_inputs() {
    let row = "P,w,a,accelerometer_x,1,unit,5\n";
    for input in [
        format!("{HEADER}{}", row.replace(",5", ",20")),
        format!("{HEADER}{}", row.replace(",1,", ",NaN,")),
        format!("{HEADER}{}", row.replace(",1,", ",,")),
        format!("{HEADER}{row}{row}"),
        format!("{HEADER}{row}P,w,b,accelerometer_x,2,other,5\n"),
        format!(
            "{HEADER}{}",
            row.replace("accelerometer_x", "magnetometer_x")
        ),
        format!("{HEADER}{}", row.replace("P,w", ",w")),
        format!("{HEADER}value\n{row}"),
    ] {
        assert!(
            prepare_sensor_window_csv(input.as_bytes(), false, None).is_err(),
            "{input}"
        );
    }
    for values in [vec![], vec![f64::INFINITY], vec![f64::NAN]] {
        assert!(reduce_s3_axis(&values).is_err());
        assert!(normalize_autosen_dimension(&values).is_err());
    }
}

#[test]
fn numerical_unavailability_does_not_suppress_unrelated_source_reductions() {
    let results = reduce_s3_axis(&[-f64::MAX, f64::MAX]).unwrap();
    assert_eq!(results[0].1.value, Some(0.0));
    assert_eq!(results[1].1.value, Some(-f64::MAX));
    assert_eq!(results[2].1.value, Some(f64::MAX));
    assert_eq!(results[3].1.status, "arithmetic_unavailable");
    assert_eq!(results[3].1.value, None);
    assert_eq!(
        reduce_s3_axis(&[f64::MAX, f64::MAX]).unwrap()[0].1.status,
        "arithmetic_unavailable"
    );
    assert_eq!(
        reduce_s3_axis(&[0.0, 0.0, f64::from_bits(1)]).unwrap()[0]
            .1
            .reason,
        "floating_point_mean_underflow"
    );
    assert!(normalize_autosen_dimension(&[-f64::MAX, f64::MAX])
        .unwrap()
        .iter()
        .all(|x| x.status == "arithmetic_unavailable"));
    let input = format!(
        "{HEADER}P,w,a,accelerometer_x,{},unit,5\nP,w,b,accelerometer_x,{},unit,5\n",
        -f64::MAX,
        f64::MAX
    );
    let text = String::from_utf8(
        prepare_sensor_window_csv(input.as_bytes(), false, None)
            .unwrap()
            .bytes,
    )
    .unwrap();
    assert!(text.contains("peak_to_peak,,arithmetic_unavailable,nonfinite_arithmetic,input_unit"));
    assert!(text.contains("average,0.0,computed,,input_unit"));
    let normalized = String::from_utf8(
        prepare_sensor_window_csv(input.as_bytes(), true, None)
            .unwrap()
            .bytes,
    )
    .unwrap();
    assert!(normalized.contains(
        "min_max_normalization,,arithmetic_unavailable,nonfinite_arithmetic,dimensionless"
    ));
    let normalized = normalize_autosen_dimension(&[0.0, f64::from_bits(1), f64::MAX]).unwrap();
    assert_eq!(normalized[0].value, Some(0.0));
    assert_eq!(
        normalized[1].reason,
        "floating_point_normalization_underflow"
    );
    assert_eq!(normalized[1].status, "arithmetic_unavailable");
    assert_eq!(normalized[2].value, Some(1.0));
}

#[test]
fn actual_csv_preserves_padded_identity_scopes_without_trimming_or_merging() {
    let input = format!("{HEADER}P,w,a,accelerometer_x,-2,unit,5\nP,w,b,accelerometer_x,2,unit,5\n P,w,a,accelerometer_x,100,unit,5\nP, w,a,accelerometer_x,200,unit,5\nP,w,a,accelerometer_x ,7,unit,5\nP,w,b,accelerometer_x ,7,unit,5\n");
    let output = prepare_sensor_window_csv(input.as_bytes(), true, None).unwrap();
    assert_eq!(output.output_row_count, 6);
    let mut reader = csv::Reader::from_reader(output.bytes.as_slice());
    let rows = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    let groups = rows
        .iter()
        .map(|row| {
            (
                row[0].to_owned(),
                row[1].to_owned(),
                row[2].to_owned(),
                row[5].to_owned(),
            )
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        groups,
        BTreeSet::from([
            ("P".into(), "w".into(), "accelerometer_x".into(), "2".into()),
            (
                " P".into(),
                "w".into(),
                "accelerometer_x".into(),
                "1".into()
            ),
            (
                "P".into(),
                " w".into(),
                "accelerometer_x".into(),
                "1".into()
            ),
            (
                "P".into(),
                "w".into(),
                "accelerometer_x ".into(),
                "2".into()
            ),
        ])
    );
    assert_eq!(rows.iter().filter(|row| &row[9] == "computed").count(), 2);
    assert_eq!(
        rows.iter()
            .filter(|row| &row[9] == "source_undefined")
            .count(),
        4
    );
}
