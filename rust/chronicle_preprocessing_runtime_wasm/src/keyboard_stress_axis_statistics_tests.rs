use crate::keyboard_stress_axis_statistics::{
    prepare_axis_statistics_csv, reduce_ordered_axis, AxisStatistic,
};
use std::collections::BTreeSet;

fn statistic<'a>(rows: &'a [AxisStatistic], name: &str) -> &'a AxisStatistic {
    rows.iter().find(|row| row.statistic == name).unwrap()
}

fn close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= 1e-12 * expected.abs().max(1.0),
        "{actual} != {expected}"
    );
}

fn computed(rows: &[AxisStatistic], name: &str, expected: f64) {
    let row = statistic(rows, name);
    assert_eq!(row.status, "computed");
    assert_eq!(row.reason, "");
    close(row.value.unwrap(), expected);
}

#[test]
fn all_eighteen_table_entries_match_independent_three_sample_hand_math() {
    // [1,2,3]: squared deviations=2, fourth deviations=2;
    // MCL numerator=2, MTE numerator=2²-3*1=1. Quartile ranks=1,2,3.
    let rows = reduce_ordered_axis(&[1.0, 2.0, 3.0]).unwrap();
    assert_eq!(rows.len(), 18);
    let expected = [
        ("minimum", 1.0),
        ("maximum", 3.0),
        ("sample_standard_deviation", 1.0),
        ("arithmetic_mean", 2.0),
        ("absolute_arithmetic_mean", 2.0),
        ("geometric_mean", 6.0_f64.cbrt()),
        ("harmonic_mean", 18.0 / 11.0),
        ("sum", 6.0),
        ("first_quartile", 1.0),
        ("median", 2.0),
        ("third_quartile", 3.0),
        ("sample_variance", 1.0),
        ("literal_root_skewness", 0.0),
        ("literal_root_kurtosis", 1.0),
        ("zero_crossings", 0.0),
        ("mean_energy", 14.0 / 3.0),
        ("mean_curve_length", 2.0 / 3.0),
        ("mean_teager_energy", 1.0 / 3.0),
    ];
    assert_eq!(
        rows.iter().map(|row| row.statistic).collect::<Vec<_>>(),
        expected.iter().map(|(name, _)| *name).collect::<Vec<_>>()
    );
    for (name, value) in expected {
        computed(&rows, name, value);
    }
}

#[test]
fn signed_window_keeps_fourteen_defined_results_when_four_are_undefined() {
    // AM=1, abs(AM)=1 (not mean(abs(x))=2), deviation squares=20,
    // fourth powers=164, MTE numerator=0²-2*(-2) + 2²-4*0 = 8.
    let rows = reduce_ordered_axis(&[-2.0, 0.0, 2.0, 4.0]).unwrap();
    for (name, value) in [
        ("minimum", -2.0),
        ("maximum", 4.0),
        ("sample_standard_deviation", (20.0_f64 / 3.0).sqrt()),
        ("arithmetic_mean", 1.0),
        ("absolute_arithmetic_mean", 1.0),
        ("geometric_mean", 0.0),
        ("sum", 4.0),
        ("sample_variance", 20.0 / 3.0),
        ("literal_root_skewness", 0.0),
        ("literal_root_kurtosis", 123.0_f64.sqrt() / 10.0),
        ("zero_crossings", 1.0),
        ("mean_energy", 6.0),
        ("mean_curve_length", 1.5),
        ("mean_teager_energy", 2.0),
    ] {
        computed(&rows, name, value);
    }
    for name in [
        "harmonic_mean",
        "first_quartile",
        "median",
        "third_quartile",
    ] {
        let row = statistic(&rows, name);
        assert_eq!(row.status, "source_undefined");
        assert_eq!(row.value, None);
    }
    assert_eq!(
        rows.iter().filter(|row| row.status == "computed").count(),
        14
    );
    assert_eq!(
        statistic(&rows, "mean_teager_energy").output_unit_relation,
        "input_unit_squared"
    );
    assert_eq!(
        statistic(&rows, "literal_root_kurtosis").output_unit_relation,
        "dimensionless"
    );
    assert_eq!(
        statistic(&rows, "zero_crossings").output_unit_relation,
        "count"
    );
}

#[test]
fn geometric_and_harmonic_means_use_the_literal_real_domains_not_a_positive_only_policy() {
    let odd_negative_product = reduce_ordered_axis(&[-1.0, -2.0, -4.0]).unwrap();
    computed(&odd_negative_product, "geometric_mean", -2.0);
    computed(&odd_negative_product, "harmonic_mean", -12.0 / 7.0);
    let even_negative_product = reduce_ordered_axis(&[-1.0, 2.0]).unwrap();
    assert_eq!(
        statistic(&even_negative_product, "geometric_mean").reason,
        "negative_product_even_root_has_no_real_value"
    );
    computed(&even_negative_product, "harmonic_mean", -4.0);
    let zero = reduce_ordered_axis(&[0.0, 2.0]).unwrap();
    computed(&zero, "geometric_mean", 0.0);
    assert_eq!(
        statistic(&zero, "harmonic_mean").reason,
        "zero_sample_reciprocal_undefined"
    );
    let cancelled = reduce_ordered_axis(&[-1.0, 1.0]).unwrap();
    assert_eq!(
        statistic(&cancelled, "harmonic_mean").reason,
        "zero_reciprocal_sum_has_no_finite_value"
    );
    computed(&cancelled, "sum", 0.0);
}

#[test]
fn literal_square_roots_are_not_standard_skewness_or_excess_kurtosis() {
    let positive = reduce_ordered_axis(&[1.0, 1.0, 2.0]).unwrap();
    computed(&positive, "literal_root_skewness", 3.0_f64.powf(-0.25));
    computed(&positive, "literal_root_kurtosis", 1.0);
    computed(&positive, "mean_teager_energy", -1.0 / 3.0);
    let negative = reduce_ordered_axis(&[1.0, 2.0, 2.0]).unwrap();
    let skew = statistic(&negative, "literal_root_skewness");
    assert_eq!(skew.value, None);
    assert_eq!(skew.reason, "printed_square_root_has_negative_radicand");
    computed(&negative, "literal_root_kurtosis", 1.0);
    computed(&negative, "arithmetic_mean", 5.0 / 3.0);
}

#[test]
fn constant_source_sized_window_does_not_invent_interpolation_or_zero_sd_roots() {
    let rows = reduce_ordered_axis(&[1.0; 100]).unwrap();
    computed(&rows, "sum", 100.0);
    computed(&rows, "sample_standard_deviation", 0.0);
    computed(&rows, "mean_energy", 1.0);
    computed(&rows, "mean_curve_length", 0.0);
    computed(&rows, "mean_teager_energy", 0.0);
    // There are 98 terms, each 1²-1*1=0; this is not a square-energy sum.
    for name in ["literal_root_skewness", "literal_root_kurtosis"] {
        assert_eq!(
            statistic(&rows, name).reason,
            "zero_standard_deviation_convention_undisclosed"
        );
    }
    for name in ["first_quartile", "median", "third_quartile"] {
        assert_eq!(
            statistic(&rows, name).reason,
            "fractional_rank_interpolation_undisclosed"
        );
    }
}

#[test]
fn crossings_include_nonzero_to_zero_and_sign_flip_not_zero_departure() {
    for (samples, expected) in [
        (vec![-1.0, 0.0, 1.0, -1.0, 1.0, 0.0], 4.0),
        (vec![0.0, -1.0, 1.0, -1.0, 0.0, 1.0], 3.0),
    ] {
        computed(
            &reduce_ordered_axis(&samples).unwrap(),
            "zero_crossings",
            expected,
        );
    }
}

#[test]
fn csv_uses_explicit_order_and_retains_opaque_units_without_axis_pooling() {
    let input = b"window_id,sample_id,sample_order,axis,value,input_unit\nw,c,30,accelerometer_x,2,caller G label\nw,a,10,accelerometer_x,1,caller G label\nw,b,20,accelerometer_x,3,caller G label\nw,a,10,gyroscope_z,5,caller gyro label\n";
    let output = prepare_axis_statistics_csv(input, None).unwrap();
    assert_eq!(output.source_row_count, 4);
    assert_eq!(output.output_row_count, 36);
    let text = String::from_utf8(output.bytes).unwrap();
    assert!(text.contains(
        "w,accelerometer_x,caller G label,3,mean_curve_length,1.0,computed,,input_unit\n"
    ));
    assert!(text.contains("w,accelerometer_x,caller G label,3,mean_teager_energy,2.3333333333333335,computed,,input_unit_squared\n"));
    assert!(text
        .contains("w,gyroscope_z,caller gyro label,1,arithmetic_mean,5.0,computed,,input_unit\n"));
    assert!(text.contains("w,gyroscope_z,caller gyro label,1,sample_variance,,source_undefined,requires_at_least_two_samples,input_unit_squared\n"));
    let unordered = reduce_ordered_axis(&[1.0, 2.0, 3.0]).unwrap();
    let reordered = reduce_ordered_axis(&[1.0, 3.0, 2.0]).unwrap();
    computed(&unordered, "mean_teager_energy", 1.0 / 3.0);
    computed(&reordered, "mean_teager_energy", 7.0 / 3.0);
}

#[test]
fn malformed_typed_samples_fail_without_silent_drops_merges_or_unit_conversion() {
    let header = "window_id,sample_id,sample_order,axis,value,input_unit\n";
    for invalid in [
        "w,a,1,accelerometer_x,NaN,G\n",
        "w,a,1,accelerometer_x,,G\n",
        "w,a,1,accelerometer_x,1, \n",
        "w,a,1.5,accelerometer_x,1,G\n",
        "w,a,1,magnitude,1,G\n",
        " ,a,1,accelerometer_x,1,G\n",
        "w,a,1,accelerometer_x,1,G\nw,a,2,accelerometer_x,2,G\n",
        "w,a,1,accelerometer_x,1,G\nw,b,1,accelerometer_x,2,G\n",
        "w,a,1,accelerometer_x,1,G\nw,b,2,accelerometer_x,2,m/s2\n",
    ] {
        assert!(
            prepare_axis_statistics_csv(format!("{header}{invalid}").as_bytes(), None).is_err(),
            "{invalid}"
        );
    }
    assert!(prepare_axis_statistics_csv(
        b"window_id,sample_id,sample_order,axis,value,input_unit,value\n",
        None
    )
    .is_err());
    assert!(reduce_ordered_axis(&[]).is_err());
    assert!(reduce_ordered_axis(&[f64::INFINITY]).is_err());
}

#[test]
fn binding_subset_emits_only_its_precise_formula_rows_without_losing_undefined_rows() {
    let input = b"window_id,sample_id,sample_order,axis,value,input_unit\nw,a,1,accelerometer_x,-2,u\nw,b,2,accelerometer_x,0,u\nw,c,3,accelerometer_x,2,u\nw,d,4,accelerometer_x,4,u\n";
    let selected = BTreeSet::from(["mean_teager_energy", "first_quartile"]);
    let output = prepare_axis_statistics_csv(input, Some(&selected)).unwrap();
    assert_eq!(output.output_row_count, 2);
    let text = String::from_utf8(output.bytes).unwrap();
    assert!(text.contains(
        "first_quartile,,source_undefined,fractional_rank_interpolation_undisclosed,input_unit"
    ));
    assert!(text.contains("mean_teager_energy,2.0,computed,,input_unit_squared"));
    assert!(!text.contains("geometric_mean"));
}

#[test]
fn numerical_failure_is_not_mislabeled_as_an_unknown_source_convention() {
    let rows = reduce_ordered_axis(&[f64::MAX, f64::MAX]).unwrap();
    computed(&rows, "minimum", f64::MAX);
    computed(&rows, "maximum", f64::MAX);
    for name in ["sum", "arithmetic_mean", "geometric_mean", "mean_energy"] {
        assert_eq!(statistic(&rows, name).status, "arithmetic_unavailable");
        assert_eq!(statistic(&rows, name).value, None);
    }
    let tiny = reduce_ordered_axis(&[f64::MIN_POSITIVE; 2]).unwrap();
    assert_eq!(
        statistic(&tiny, "geometric_mean").reason,
        "floating_point_product_underflow"
    );
    computed(&tiny, "maximum", f64::MIN_POSITIVE);
    let underflow = reduce_ordered_axis(&[1e-200, 2e-200]).unwrap();
    for name in [
        "sample_standard_deviation",
        "sample_variance",
        "literal_root_skewness",
        "literal_root_kurtosis",
        "mean_energy",
    ] {
        assert_eq!(statistic(&underflow, name).status, "arithmetic_unavailable");
    }
    // These sums survive as positive subnormal numbers, but division then
    // rounds them to zero. This is numerical loss, not a true zero-S domain.
    for (samples, names) in [
        (
            vec![0.0, 0.0, 3e-162],
            vec![
                "sample_standard_deviation",
                "sample_variance",
                "literal_root_skewness",
                "literal_root_kurtosis",
            ],
        ),
        (vec![0.0, 0.0, 0.0, 3e-162], vec!["mean_energy"]),
    ] {
        let rows = reduce_ordered_axis(&samples).unwrap();
        let input = format!(
            "window_id,sample_id,sample_order,axis,value,input_unit\n{}",
            samples
                .iter()
                .enumerate()
                .map(|(index, value)| format!("w,s{index},{index},accelerometer_x,{value},u\n"))
                .collect::<String>()
        );
        let csv = String::from_utf8(
            prepare_axis_statistics_csv(input.as_bytes(), None)
                .unwrap()
                .bytes,
        )
        .unwrap();
        for name in names {
            let result = statistic(&rows, name);
            let reason = if name == "mean_energy" {
                "floating_point_energy_underflow"
            } else {
                "floating_point_moment_underflow"
            };
            assert_eq!(result.status, "arithmetic_unavailable", "{name}");
            assert_eq!(result.value, None, "{name}");
            assert_eq!(result.reason, reason, "{name}");
            assert!(
                csv.contains(&format!("{name},,arithmetic_unavailable,{reason},")),
                "{name}"
            );
            assert!(!csv.contains(&format!("{name},0.0,computed,")), "{name}");
        }
    }
}
