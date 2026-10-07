use crate::keyboard_stress_axis_statistics::{
    mean_energy_only, reduce_ordered_axis, AxisStatistic,
};
use crate::prepared_scalar_axis::{
    prepare_stdd_csv, prepare_touchstroke_mean_csv, reduce_stdd_axis, STDD_STATISTICS,
};
use std::collections::BTreeSet;

fn statistic<'a>(results: &'a [AxisStatistic], name: &str) -> &'a AxisStatistic {
    results.iter().find(|x| x.statistic == name).unwrap()
}
fn computed(results: &[AxisStatistic], name: &str, expected: f64) {
    let actual = statistic(results, name);
    assert_eq!(
        (actual.status, actual.reason, actual.output_unit_relation),
        ("computed", "", "input_unit")
    );
    let value = actual.value.unwrap();
    assert!(
        (value - expected).abs() <= 1e-14 * expected.abs().max(1.0),
        "{name}: {value} != {expected}"
    );
}
fn stdd_csv(groups: &[(&str, &str, &str, &str, &[f64])]) -> Vec<u8> {
    let mut csv = "participant_id,device_type,device_id,axis,window_id,sample_id,sample_order,value,input_unit,window_duration_seconds\n".to_owned();
    for (participant, device_type, device_id, axis, values) in groups {
        for (index, value) in values.iter().enumerate().rev() {
            csv.push_str(&format!("{participant},{device_type},{device_id},{axis}, same window ,s{index},{},{value}, opaque unit ,1\n", index * 2));
        }
    }
    csv.into_bytes()
}
fn all() -> BTreeSet<&'static str> {
    BTreeSet::from(STDD_STATISTICS)
}

#[test]
fn fifty_signed_samples_match_independent_hand_math_not_absolute_mean() {
    let samples = [-3.0, 4.0].repeat(25);
    let results = reduce_stdd_axis(&samples).unwrap();
    assert_eq!(results.len(), 9);
    for (name, expected) in [
        ("arithmetic_mean", 0.5),
        ("maximum", 4.0),
        ("minimum", -3.0),
        ("root_mean_square", 12.5_f64.sqrt()),
        ("root_sum_square", 25.0),
        ("sum", 25.0),
        ("sum_absolute_values", 175.0),
        ("mean_absolute_values", 3.5),
        ("range", 7.0),
    ] {
        computed(&results, name, expected);
    }
    let zero = reduce_stdd_axis(&[0.0; 50]).unwrap();
    assert!(zero
        .iter()
        .all(|x| x.value == Some(0.0) && x.status == "computed"));
    assert!(reduce_stdd_axis(&[1.0; 49]).is_err());
    assert!(reduce_stdd_axis(&[f64::NAN; 50]).is_err());
}

#[test]
fn narrow_shared_square_mean_body_preserves_every_old_keyboard_status() {
    for samples in [
        vec![0.0],
        vec![-2.0, 0.0, 2.0, 4.0],
        vec![1.0, 2.0, 3.0],
        vec![f64::MAX],
        vec![1e-200, 2e-200],
        vec![0.0, 0.0, 0.0, 3e-162],
    ] {
        assert_eq!(
            mean_energy_only(&samples).unwrap(),
            *statistic(&reduce_ordered_axis(&samples).unwrap(), "mean_energy")
        );
    }
    assert!(mean_energy_only(&[]).is_err());
    assert!(mean_energy_only(&[f64::INFINITY]).is_err());
}

#[test]
fn arithmetic_loss_is_per_reduction_and_rss_does_not_depend_on_divided_energy() {
    let overflow = reduce_stdd_axis(&[-f64::MAX, f64::MAX].repeat(25)).unwrap();
    for name in ["arithmetic_mean", "sum"] {
        computed(&overflow, name, 0.0);
    }
    computed(&overflow, "maximum", f64::MAX);
    computed(&overflow, "minimum", -f64::MAX);
    for name in [
        "root_mean_square",
        "root_sum_square",
        "sum_absolute_values",
        "mean_absolute_values",
        "range",
    ] {
        assert_eq!(
            (
                statistic(&overflow, name).value,
                statistic(&overflow, name).status
            ),
            (None, "arithmetic_unavailable")
        );
    }
    let mut tiny = vec![0.0; 50];
    tiny[49] = 3e-162;
    let results = reduce_stdd_axis(&tiny).unwrap();
    assert_eq!(
        (
            statistic(&results, "root_mean_square").value,
            statistic(&results, "root_mean_square").reason
        ),
        (None, "floating_point_energy_underflow")
    );
    let rss = statistic(&results, "root_sum_square");
    assert_eq!(rss.status, "computed");
    assert!(rss.value.unwrap() > 0.0 && rss.value.unwrap().is_finite());
    tiny[49] = f64::from_bits(1);
    let loss = reduce_stdd_axis(&tiny).unwrap();
    for name in [
        "arithmetic_mean",
        "mean_absolute_values",
        "root_mean_square",
        "root_sum_square",
    ] {
        assert_eq!(statistic(&loss, name).status, "arithmetic_unavailable");
    }
    assert_eq!(statistic(&loss, "sum").value, Some(f64::from_bits(1)));
}

#[test]
fn actual_stdd_csv_keeps_first_seen_lexical_scopes_and_numeric_order() {
    let signed = [-3.0, 4.0].repeat(25);
    let raw = stdd_csv(&[
        (" P ", "watch", " D ", "z", &signed),
        ("P", "phone", "D", "x", &[0.0; 50]),
    ]);
    let result = prepare_stdd_csv(&raw, &all()).unwrap();
    assert_eq!(
        (result.source_row_count, result.output_row_count),
        (100, 18)
    );
    let text = String::from_utf8(result.bytes).unwrap();
    assert!(text.contains(
        " P ,watch, D ,z, same window , opaque unit ,1,50,arithmetic_mean,0.5,computed,,input_unit"
    ));
    assert!(text.contains(" P ,watch, D ,z, same window , opaque unit ,1,50,mean_absolute_values,3.5,computed,,input_unit"));
    assert!(text.find(" P ,watch").unwrap() < text.find("P,phone").unwrap());
    let subset = prepare_stdd_csv(&raw, &BTreeSet::from(["sum"])).unwrap();
    assert_eq!(subset.output_row_count, 2);
    let partial = stdd_csv(&[("P", "phone", "D", "x", &[0.0; 49])]);
    assert!(prepare_stdd_csv(&partial, &all()).is_err());
    for changed in [
        String::from_utf8(raw.clone())
            .unwrap()
            .replace(",1\n", ",20\n"),
        String::from_utf8(raw.clone())
            .unwrap()
            .replace(",s49,98,4,", ",s0,0,4,"),
        String::from_utf8(raw.clone())
            .unwrap()
            .replace(",s49,98,4,", ",s49,98,NaN,"),
        String::from_utf8(raw.clone())
            .unwrap()
            .replacen(" opaque unit ,1", "different,1", 1),
    ] {
        assert!(prepare_stdd_csv(changed.as_bytes(), &all()).is_err());
    }
}

#[test]
fn actual_touchstroke_mean_csv_keeps_variable_membership_and_only_mean() {
    let raw = b"participant_id,attempt_id,sensor_stream,dimension,sample_id,sample_order,value,input_unit\n P , A ,gyroscope,x,b,9,3, unit \n P , A ,gyroscope,x,a,2,-1, unit \nP,A,raw_accelerometer,magnitude,a,4,5,m/s2\nP,A,raw_accelerometer,magnitude,b,1,3,m/s2\nP,A,gravity,y,a,0,0,g\n";
    let result = prepare_touchstroke_mean_csv(raw).unwrap();
    assert_eq!((result.source_row_count, result.output_row_count), (5, 3));
    let text = String::from_utf8(result.bytes).unwrap();
    assert!(text.contains(" P , A ,gyroscope,x, unit ,2,arithmetic_mean,1.0,computed,,input_unit"));
    assert!(text.contains(
        "P,A,raw_accelerometer,magnitude,m/s2,2,arithmetic_mean,4.0,computed,,input_unit"
    ));
    assert!(text.contains("P,A,gravity,y,g,1,arithmetic_mean,0.0,computed,,input_unit"));
    for dimension in ["x", "y", "z", "magnitude"] {
        for stream in [
            "raw_accelerometer",
            "low_pass_accelerometer",
            "high_pass_accelerometer",
            "gravity",
            "gyroscope",
            "magnetometer",
            "orientation",
        ] {
            let single = format!("participant_id,attempt_id,sensor_stream,dimension,sample_id,sample_order,value,input_unit\nP,A,{stream},{dimension},s,0,2,u\n");
            assert_eq!(
                prepare_touchstroke_mean_csv(single.as_bytes())
                    .unwrap()
                    .output_row_count,
                1
            );
        }
    }
    for changed in [
        String::from_utf8(raw.to_vec())
            .unwrap()
            .replace(",b,9,3,", ",a,2,3,"),
        String::from_utf8(raw.to_vec())
            .unwrap()
            .replace(",b,9,3,", ",b,9,NaN,"),
        String::from_utf8(raw.to_vec())
            .unwrap()
            .replace(",magnitude,b,1,3,", ",magnitude,b,1,-3,"),
        String::from_utf8(raw.to_vec())
            .unwrap()
            .replacen(" unit ", "other", 1),
    ] {
        assert!(prepare_touchstroke_mean_csv(changed.as_bytes()).is_err());
    }
}

#[test]
fn actual_csv_reports_loss_without_dropping_unrelated_supplied_groups() {
    let bad = [-f64::MAX, f64::MAX].repeat(25);
    let stdd = prepare_stdd_csv(
        &stdd_csv(&[
            ("P", "phone", "D", "x", &bad),
            ("Q", "watch", "D", "z", &[2.0; 50]),
        ]),
        &all(),
    )
    .unwrap();
    let text = String::from_utf8(stdd.bytes).unwrap();
    assert!(
        text.contains(",root_sum_square,,arithmetic_unavailable,nonfinite_arithmetic,input_unit")
    );
    assert!(text.contains(
        "Q,watch,D,z, same window , opaque unit ,1,50,arithmetic_mean,2.0,computed,,input_unit"
    ));
    let raw = format!("participant_id,attempt_id,sensor_stream,dimension,sample_id,sample_order,value,input_unit\nP,A,gyroscope,x,a,0,{},u\nP,A,gyroscope,x,b,1,{},u\nQ,A,gyroscope,x,a,0,2,u\n", f64::MAX, f64::MAX);
    let text =
        String::from_utf8(prepare_touchstroke_mean_csv(raw.as_bytes()).unwrap().bytes).unwrap();
    assert!(text.contains("P,A,gyroscope,x,u,2,arithmetic_mean,,arithmetic_unavailable,nonfinite_arithmetic,input_unit"));
    assert!(text.contains("Q,A,gyroscope,x,u,1,arithmetic_mean,2.0,computed,,input_unit"));
}
