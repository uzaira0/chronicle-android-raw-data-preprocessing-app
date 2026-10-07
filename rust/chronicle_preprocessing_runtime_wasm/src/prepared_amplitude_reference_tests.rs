use crate::prepared_amplitude_reference::*;
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-12, "{actual} != {expected}");
}

#[test]
fn ruegger_sample_then_unweighted_interval_matches_hand_math_not_pooled_amplitudes() {
    let first =
        ruegger_sample_statistics(&[0.0, 2.0, 0.0, 2.0, 0.0, 2.0, 0.0, 2.0, 0.0, 2.0]).unwrap();
    let second = ruegger_sample_statistics(&[3.0; 20]).unwrap();
    for (result, expected) in first.iter().zip([2.0, 1.0, 0.0, 2.0, 1.0, 0.0]) {
        assert_eq!(result.status, "computed");
        assert_eq!(result.value, Some(expected));
    }
    // Population SD=1, not sqrt(10/9). Unequal10/20 amplitude counts give
    // exactly one contribution each to the released outer mean.
    for (index, expected) in [5.5, 2.0, 1.5, 2.5, 0.5, 4.771212547196624]
        .into_iter()
        .enumerate()
    {
        let mean = ruegger_interval_mean(
            &[&first[index], &second[index]],
            RUEGGER_STATISTICS[index],
            first[index].output_unit_relation,
        )
        .unwrap();
        near(mean.value.unwrap(), expected);
    }
}

#[test]
fn ruegger_qualifies_ten_amplitudes_per_sample_and_does_not_clamp_or_gate_other_statistics() {
    assert!(ruegger_sample_statistics(&[1.0; 9]).is_err());
    assert!(ruegger_sample_statistics(&[f64::NAN; 10]).is_err());
    let result = ruegger_sample_statistics(&[-1.0; 10]).unwrap();
    assert_eq!(result[1].value, Some(-1.0));
    assert_eq!(result[4].value, Some(0.0));
    assert_eq!(result[5].status, "source_undefined");
    assert_eq!(result[5].reason, "nonpositive_mean_log10");
    assert!(result[..5].iter().all(|x| x.status == "computed"));
    let empty = ruegger_interval_mean(&[], "minimum", "input_unit").unwrap();
    assert_eq!(empty.reason, "empty_qualified_source_sample_list");
}

#[test]
fn ruegger_arithmetic_loss_is_not_a_zero_population_deviation_or_source_nan() {
    let mut tiny = [0.0; 10];
    tiny[9] = 3e-162;
    let result = ruegger_sample_statistics(&tiny).unwrap();
    assert_eq!(result[4].status, "arithmetic_unavailable");
    assert_eq!(
        result[4].reason,
        "floating_point_population_variance_underflow"
    );
    let overflow = ruegger_sample_statistics(&[f64::MAX; 10]).unwrap();
    assert_eq!(overflow[0].status, "arithmetic_unavailable");
    assert_eq!(overflow[1].status, "arithmetic_unavailable");
    assert_eq!(overflow[2].value, Some(f64::MAX));
    assert_eq!(overflow[3].value, Some(f64::MAX));
    assert_eq!(overflow[4].status, "arithmetic_unavailable");
    let valid = ruegger_sample_statistics(&[1.0; 10]).unwrap();
    assert_eq!(
        ruegger_interval_mean(
            &[&overflow[0], &valid[0]],
            "mean_energy",
            "input_unit_squared"
        )
        .unwrap()
        .status,
        "arithmetic_unavailable"
    );
}

#[test]
fn ruegger_released_prefix_selects_first_i_before_explicit_nan_removal_and_requires_strictly_more()
{
    let values = [Some(2.0), None, Some(4.0), None];
    assert_eq!(
        ruegger_prefix_mean(&values, 1, "arithmetic_mean", "input_unit")
            .unwrap()
            .value,
        Some(2.0)
    );
    assert_eq!(
        ruegger_prefix_mean(&values, 2, "arithmetic_mean", "input_unit")
            .unwrap()
            .value,
        Some(2.0)
    );
    assert_eq!(
        ruegger_prefix_mean(&values, 3, "arithmetic_mean", "input_unit")
            .unwrap()
            .value,
        Some(3.0)
    );
    assert_eq!(
        ruegger_prefix_mean(&values, 4, "arithmetic_mean", "input_unit")
            .unwrap()
            .reason,
        "source_strict_sample_count_guard"
    );
    assert_eq!(
        ruegger_prefix_mean(&[None, None, None], 2, "arithmetic_mean", "input_unit")
            .unwrap()
            .reason,
        "all_source_nan_prefix_members"
    );
    assert!(ruegger_prefix_mean(&values, 0, "arithmetic_mean", "input_unit").is_err());
    assert!(ruegger_prefix_mean(&values, 13, "arithmetic_mean", "input_unit").is_err());
    assert!(ruegger_prefix_mean(
        &[Some(f64::INFINITY), None],
        1,
        "arithmetic_mean",
        "input_unit"
    )
    .is_err());
    // This tiny finite result is numerical loss, not an explicit source NaN
    // that np.nanmean would be permitted to remove.
    let loss = ruegger_prefix_mean(
        &[Some(f64::from_bits(1)), Some(0.0), Some(0.0)],
        2,
        "arithmetic_mean",
        "input_unit",
    )
    .unwrap();
    assert_eq!(loss.status, "arithmetic_unavailable");
}

#[test]
fn pastime_supplied_caps_and_two_signed_centering_stages_match_hand_math() {
    for (value, expected) in [
        (1.0, 4.0),
        (4.0, 4.0),
        (10.0, 10.0),
        (16.0, 16.0),
        (17.0, 16.0),
    ] {
        let clipped = pastime_usage_clip(value, 10.0, 2.0).unwrap();
        assert_eq!(clipped[0].value, Some(4.0));
        assert_eq!(clipped[1].value, Some(16.0));
        assert_eq!(clipped[2].value, Some(expected));
    }
    assert_eq!(
        pastime_usage_clip(1.0, 10.0, 0.0).unwrap()[2].value,
        Some(10.0)
    );
    assert!(pastime_usage_clip(1.0, 10.0, -1.0).is_err());
    assert_eq!(
        supplied_center(7.0, 10.0, "within_person_usage")
            .unwrap()
            .value,
        Some(-3.0)
    );
    assert_eq!(
        supplied_center(10.0, 8.0, "between_person_usage")
            .unwrap()
            .value,
        Some(2.0)
    );
    assert_eq!(
        pastime_usage_clip(1.0, 10.0, f64::MAX).unwrap()[2].status,
        "arithmetic_unavailable"
    );
    assert_eq!(
        supplied_center(f64::MAX, -f64::MAX, "within_person_usage")
            .unwrap()
            .status,
        "arithmetic_unavailable"
    );
}

#[test]
fn fukazawa_signed_supplied_person_zscore_preserves_domain_and_numeric_statuses() {
    assert_eq!(
        fukazawa_supplied_zscore(-2.0, 2.0, 2.0).unwrap().value,
        Some(-2.0)
    );
    assert_eq!(
        fukazawa_supplied_zscore(-6.0, -2.0, 2.0).unwrap().value,
        Some(-2.0)
    );
    assert_eq!(
        fukazawa_supplied_zscore(-2.0, -2.0, 2.0).unwrap().value,
        Some(0.0)
    );
    assert_eq!(
        fukazawa_supplied_zscore(2.0, 2.0, 0.0).unwrap().reason,
        "zero_supplied_standard_deviation"
    );
    assert!(fukazawa_supplied_zscore(2.0, 2.0, -1.0).is_err());
    assert_eq!(
        fukazawa_supplied_zscore(f64::from_bits(1), 0.0, 2.0)
            .unwrap()
            .reason,
        "floating_point_standardization_underflow"
    );
    assert_eq!(
        fukazawa_supplied_zscore(f64::MAX, -f64::MAX, 2.0)
            .unwrap()
            .status,
        "arithmetic_unavailable"
    );
}

#[test]
fn fukazawa_eq12_all_nine_cells_and_exact_threshold_ties_reuse_ordered_bucketizer() {
    for (acc_bucket, acceleration) in [1.0, 2.0, 5.0].into_iter().enumerate() {
        for (br_bucket, brightness) in [299.0, 300.0, 1000.0].into_iter().enumerate() {
            let result = fukazawa_same_sample_one_hot(brightness, acceleration).unwrap();
            assert_eq!(result.iter().sum::<u8>(), 1);
            assert_eq!(result[3 * acc_bucket + br_bucket], 1);
        }
    }
    assert!(fukazawa_same_sample_one_hot(300.0, -1.0).is_err());
    assert!(fukazawa_same_sample_one_hot(f64::NAN, 2.0).is_err());
}

use std::collections::BTreeSet;
const AMP_HEADER: &str = "participant_id,state_interval_id,microphone_stream,input_unit,platform,inventory_complete,source_build,record_kind,sample_id,sample_order,amplitude_id,amplitude_order,value\n";
fn amplitudes() -> String {
    let mut raw = format!(
        "{AMP_HEADER}P,I,mic,amplitude,android,true,MicrophoneStateAggregator/v3,manifest,,,,,\n"
    );
    // Supplied order is deliberately opposite transport order.
    for (id, count) in [("B", 20), ("A", 10)] {
        for a in (0..count).rev() {
            let value = if id == "B" { 3 } else { 2 * (a % 2) };
            let so = if id == "B" { 2 } else { 1 };
            raw.push_str(&format!("P,I,mic,amplitude,android,true,MicrophoneStateAggregator/v3,amplitude,{id},{so},a{a},{a},{value}\n"));
        }
    }
    raw
}
fn output(bytes: &[u8]) -> String {
    std::str::from_utf8(bytes).unwrap().into()
}

#[test]
fn ruegger_actual_csv_unweighted_stage_and_per_stat_statuses_are_independent() {
    let selected = BTreeSet::from(RUEGGER_STATISTICS);
    let result = prepare_ruegger_samples_csv(amplitudes().as_bytes(), &selected).unwrap();
    assert_eq!(result.source_row_count, 31);
    assert_eq!(result.output_row_count, 18);
    let text = output(&result.bytes);
    for expected in [
        "state_unweighted_mean,,,2,mean_energy,5.5,computed",
        "state_unweighted_mean,,,2,arithmetic_mean,2,computed",
        "state_unweighted_mean,,,2,population_standard_deviation,0.5,computed",
        "cleaned_sample,A,1,10,population_standard_deviation,1,computed",
    ] {
        assert!(text.contains(expected), "{text}");
    }
    assert!(text.find("cleaned_sample,A").unwrap() < text.find("cleaned_sample,B").unwrap());
    let negative = amplitudes().replace(",3\n", ",-1\n");
    let text = output(
        &prepare_ruegger_samples_csv(negative.as_bytes(), &selected)
            .unwrap()
            .bytes,
    );
    assert!(text
        .contains("state_unweighted_mean,,,2,decibels,,source_undefined,nonpositive_mean_log10"));
    assert!(text.contains("state_unweighted_mean,,,2,arithmetic_mean,0,computed"));
}

#[test]
fn ruegger_csv_missing_units_build_members_and_lexical_scope_refusals() {
    let selected = BTreeSet::from(["arithmetic_mean"]);
    for bad in [
        amplitudes().replace("android", "ios"),
        amplitudes().replace("/v3", "/v2"),
        amplitudes().replace("true", "false"),
        amplitudes().replace("amplitude,A,1,a0,0,0", "amplitude,A,1,a0,0,NaN"),
        amplitudes().replace("amplitude,A,1,a0,0,0", "amplitude,A,1,a1,1,0"),
        amplitudes().replace("amplitude,A,1,a0,0,0", "amplitude,A,2,a0,0,0"),
        amplitudes().replace(
            "P,I,mic,amplitude,android,true,MicrophoneStateAggregator/v3,manifest,,,,,\n",
            "",
        ),
    ] {
        assert!(prepare_ruegger_samples_csv(bad.as_bytes(), &selected).is_err());
    }
    let distinct = amplitudes()
        + &amplitudes()
            .replace(AMP_HEADER, "")
            .replace("P,I,", " P,I,");
    let result = prepare_ruegger_samples_csv(distinct.as_bytes(), &selected).unwrap();
    assert_eq!(result.output_row_count, 6);
    assert!(output(&result.bytes).contains(" P,I,mic"));
    let empty =
        format!("{AMP_HEADER}P,E,mic,u,android,true,MicrophoneStateAggregator/v3,manifest,,,,,\n");
    assert!(output(&prepare_ruegger_samples_csv(empty.as_bytes(), &selected).unwrap().bytes)
        .contains("state_unweighted_mean,,,0,arithmetic_mean,,source_undefined,empty_qualified_source_sample_list"));
}

const PREFIX_HEADER: &str = "participant_id,state_interval_id,microphone_stream,input_unit,platform,inventory_complete,source_build,record_kind,sample_id,sample_order,mean_energy,arithmetic_mean,minimum,maximum,population_standard_deviation,decibels\n";
fn prefixes() -> String {
    format!("{PREFIX_HEADER}P,I,mic,u,android,true,MicrophoneStateAggregator/v3,manifest,,,,,,,,\nP,I,mic,u,android,true,MicrophoneStateAggregator/v3,sample_statistics,B,2,source_NaN,source_NaN,source_NaN,source_NaN,source_NaN,source_NaN\nP,I,mic,u,android,true,MicrophoneStateAggregator/v3,sample_statistics,A,1,2,2,2,2,2,2\nP,I,mic,u,android,true,MicrophoneStateAggregator/v3,sample_statistics,C,3,4,4,4,4,4,4\nP,I,mic,u,android,true,MicrophoneStateAggregator/v3,sample_statistics,D,4,source_NaN,source_NaN,source_NaN,source_NaN,source_NaN,source_NaN\n")
}
#[test]
fn released_prefix_actual_csv_preserves_first_i_and_strict_guard_without_missing_value_shortcuts() {
    let result = prepare_ruegger_prefix_csv(prefixes().as_bytes()).unwrap();
    assert_eq!(result.output_row_count, 72);
    let text = output(&result.bytes);
    assert!(text.contains("P,I,mic,u,4,2,arithmetic_mean,2,computed"));
    assert!(text.contains("P,I,mic,u,4,3,arithmetic_mean,3,computed"));
    assert!(text.contains(
        "P,I,mic,u,4,4,arithmetic_mean,,source_undefined,source_strict_sample_count_guard"
    ));
    for bad in [
        prefixes().replace("source_NaN", "NaN"),
        prefixes().replace("source_NaN", ""),
        prefixes().replace("sample_statistics,B,2", "sample_statistics,B,1"),
        prefixes().replace("/v3", "/v2"),
    ] {
        assert!(prepare_ruegger_prefix_csv(bad.as_bytes()).is_err());
    }
    let all_nan = prefixes().replace(
        ",2,2,2,2,2,2\n",
        ",source_NaN,source_NaN,source_NaN,source_NaN,source_NaN,source_NaN\n",
    );
    assert!(output(
        &prepare_ruegger_prefix_csv(all_nan.as_bytes())
            .unwrap()
            .bytes
    )
    .contains("1,arithmetic_mean,,source_undefined,all_source_nan_prefix_members"));
}

const REF_HEADER: &str = "participant_id,source_partition_id,feature_stream,source_row_id,row_order,value,input_unit,platform,inventory_complete,reference_id,reference_scope_id,reference_mean,reference_sd\n";
#[test]
fn reference_actual_csv_caps_signed_centers_zscore_and_consistency() {
    let raw = format!("{REF_HEADER}P,D,usage,a,2,17,seconds,android,true,R,S,10,2\nP,D,usage,b,1,4,seconds,android,true,R,S,10,2\n");
    let clip = prepare_reference_csv(
        raw.as_bytes(),
        "usage_clipping",
        &BTreeSet::from(["lower_cap", "upper_cap", "winsorized_usage"]),
    )
    .unwrap();
    assert_eq!(clip.output_row_count, 6);
    assert!(output(&clip.bytes).contains("usage_clipping,winsorized_usage,16,computed"));
    assert!(output(&clip.bytes).contains("usage_clipping,winsorized_usage,4,computed"));
    for (stage, statistic, expected) in [
        (
            "within_person_centering",
            "within_person_centered_usage",
            7.0,
        ),
        (
            "between_person_centering",
            "between_person_centered_usual_usage",
            7.0,
        ),
        ("within_person_zscore", "within_person_zscore", 3.5),
    ] {
        let result =
            prepare_reference_csv(raw.as_bytes(), stage, &BTreeSet::from([statistic])).unwrap();
        assert!(output(&result.bytes).contains(&format!("{stage},{statistic},{expected},computed")));
    }
    let zero = raw.replace(",10,2\n", ",10,0\n");
    assert!(output(
        &prepare_reference_csv(
            zero.as_bytes(),
            "within_person_zscore",
            &BTreeSet::from(["within_person_zscore"])
        )
        .unwrap()
        .bytes
    )
    .contains("within_person_zscore,,source_undefined,zero_supplied_standard_deviation"));
    for bad in [
        raw.replace("b,1", "a,1"),
        raw.replace("b,1", "b,2"),
        raw.replace("b,1,4", "b,1,NaN"),
        raw.replace("b,1,4,seconds", "b,1,4,minutes"),
        raw.replace(
            "b,1,4,seconds,android,true,R,S,10,2",
            "b,1,4,seconds,android,true,R,S,11,2",
        ),
    ] {
        assert!(prepare_reference_csv(
            bad.as_bytes(),
            "usage_clipping",
            &BTreeSet::from(["winsorized_usage"])
        )
        .is_err());
    }
    let distinct = raw.clone() + &raw.replace(REF_HEADER, "").replace("P,D,", " P,D,");
    assert_eq!(
        prepare_reference_csv(
            distinct.as_bytes(),
            "usage_clipping",
            &BTreeSet::from(["winsorized_usage"])
        )
        .unwrap()
        .output_row_count,
        4
    );
}

const EQ12_HEADER: &str = "participant_id,device_id,clock_id,sample_id,same_time_id,row_order,brightness_stream,acceleration_stream,brightness,brightness_unit,gravity_removed_acceleration_magnitude,acceleration_unit,platform,inventory_complete,same_time_qualified,gravity_removed_qualified\n";
#[test]
fn eq12_actual_csv_same_sample_units_identity_and_nine_boundary_cells() {
    let mut raw = EQ12_HEADER.to_owned();
    for (i, (br, acc)) in [299, 300, 1000]
        .into_iter()
        .flat_map(|br| [1, 2, 5].into_iter().map(move |acc| (br, acc)))
        .enumerate()
    {
        raw.push_str(&format!(
            "P,D,C,s{i},t{i},{i},BR,ACC,{br},lux,{acc},m/s^2,android,true,true,true\n"
        ));
    }
    let result = prepare_fukazawa_conjunction_csv(raw.as_bytes()).unwrap();
    assert_eq!(result.output_row_count, 9);
    let mut reader = csv::Reader::from_reader(result.bytes.as_slice());
    for (i, row) in reader.records().enumerate() {
        let row = row.unwrap();
        let expected = 3 * (i % 3) + i / 3;
        for cell in 0..9 {
            assert_eq!(&row[10 + cell], if cell == expected { "1" } else { "0" });
        }
    }
    for bad in [
        raw.replace("lux", "Lux"),
        raw.replace("m/s^2", "g"),
        raw.replace("true,true,true", "true,false,true"),
        raw.replace("BR,ACC", "BR,BR"),
        raw.replace("s1,t1,1", "s0,t1,1"),
    ] {
        assert!(prepare_fukazawa_conjunction_csv(bad.as_bytes()).is_err());
    }
    let distinct = raw.clone() + &raw.replace(EQ12_HEADER, "").replace("P,D,", " P,D,");
    assert_eq!(
        prepare_fukazawa_conjunction_csv(distinct.as_bytes())
            .unwrap()
            .output_row_count,
        18
    );
}

#[test]
fn actual_csv_numeric_loss_stays_unavailable_and_other_reductions_compute() {
    let mut tiny =
        format!("{AMP_HEADER}P,T,mic,u,android,true,MicrophoneStateAggregator/v3,manifest,,,,,\n");
    for i in 0..10 {
        let value = if i == 9 { "3e-162" } else { "0" };
        tiny.push_str(&format!(
            "P,T,mic,u,android,true,MicrophoneStateAggregator/v3,amplitude,A,0,a{i},{i},{value}\n"
        ));
    }
    let selected = BTreeSet::from(["mean_energy", "population_standard_deviation", "minimum"]);
    let text = output(
        &prepare_ruegger_samples_csv(tiny.as_bytes(), &selected)
            .unwrap()
            .bytes,
    );
    assert!(text.contains(
        "cleaned_sample,A,0,10,mean_energy,,arithmetic_unavailable,floating_point_energy_underflow"
    ));
    assert!(text.contains("state_unweighted_mean,,,1,population_standard_deviation,,arithmetic_unavailable,floating_point_population_variance_underflow"));
    assert!(text.contains("state_unweighted_mean,,,1,minimum,0,computed"));
    let z = format!("{REF_HEADER}P,D,F,a,0,5e-324,u,android,true,R,S,0,2\n");
    assert!(output(&prepare_reference_csv(z.as_bytes(), "within_person_zscore", &BTreeSet::from(["within_person_zscore"])).unwrap().bytes)
        .contains("within_person_zscore,,arithmetic_unavailable,floating_point_standardization_underflow,dimensionless"));
    let cap =
        format!("{REF_HEADER}P,D,usage,a,0,1,seconds,android,true,R,S,10,1.7976931348623157e308\n");
    assert!(output(
        &prepare_reference_csv(
            cap.as_bytes(),
            "usage_clipping",
            &BTreeSet::from(["winsorized_usage"])
        )
        .unwrap()
        .bytes
    )
    .contains(
        "winsorized_usage,,arithmetic_unavailable,nonfinite_supplied_cap_arithmetic,input_unit"
    ));
}

#[test]
fn supplied_csv_blank_duplicate_header_units_and_cross_stream_sample_conflicts_refuse() {
    let selected = BTreeSet::from(["arithmetic_mean"]);
    let duplicate_header = amplitudes().replace(
        "amplitude_id,amplitude_order,value",
        "value,amplitude_order,value",
    );
    assert!(prepare_ruegger_samples_csv(duplicate_header.as_bytes(), &selected).is_err());
    let conflicting_unit = amplitudes().replace(
        "P,I,mic,amplitude,android,true,MicrophoneStateAggregator/v3,amplitude,A,1,a0",
        "P,I,mic,other_unit,android,true,MicrophoneStateAggregator/v3,amplitude,A,1,a0",
    );
    assert!(prepare_ruegger_samples_csv(conflicting_unit.as_bytes(), &selected).is_err());
    let mut raw =
        format!("{EQ12_HEADER}P,D,C,s,t,0,BR,ACC,300,lux,2,m/s^2,android,true,true,true\n");
    raw.push_str("P,D,C,s,other_time,1,BR2,ACC2,300,lux,2,m/s^2,android,true,true,true\n");
    assert!(prepare_fukazawa_conjunction_csv(raw.as_bytes()).is_err());
}
