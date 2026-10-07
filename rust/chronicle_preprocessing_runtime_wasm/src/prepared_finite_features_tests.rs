use crate::prepared_finite_features::*;
use std::collections::BTreeSet;
const REACH: &str = "participant_id,interruption_id,use_state,stage,outcome,feature_stream,sample_id,sample_order,value,input_unit,inventory_complete\n";
const MOOD: &str = "participant_id,prediction_id,metric,slot_index,lag_index,sample_id,value,input_unit,inventory_complete\n";
const SILENCE: &str = "participant_id,call_id,scalar_stream,stage,sample_id,sample_order,value,input_unit,calibration_duration_seconds,inventory_complete\n";
const ALERT: &str = "participant_id,window_id,record_kind,source_row_id,row_order,duration_seconds,app_id,input_unit,inventory_complete\n";
const SCREEN: &str = "participant_id,inventory_id,record_kind,screen_id,screen_order,phrase_occurrence_id,inventory_complete,phrase_text\n";

fn check_reachable_use_state_consistency(between: bool) {
    let (first_stage, first_outcome, second_stage, second_outcome) = if between {
        ("I-D1", "Rc", "I-D3", "Rv")
    } else {
        ("pre_interruption", "none", "pre_interruption", "none")
    };
    let first = format!("P,I,not_in_use,{first_stage},{first_outcome},f,a,0,2,u,true\n");
    let second = format!("P,I,in_use,{second_stage},{second_outcome},f,b,1,4,u,true\n");
    let contradictory = format!("{REACH}{first}{second}");
    let error = prepare_reachable_means_csv(contradictory.as_bytes(), between)
        .err()
        .expect("one supplied interruption must not admit contradictory use states");
    assert!(
        error.contains("one use_state per lexical participant/interruption"),
        "{error}"
    );

    for distinct_second in [
        second.replacen("P,I,", "P,J,", 1),
        second.replacen("P,I,", "P, I ,", 1),
        second.replacen("P,I,", " P ,I,", 1),
    ] {
        let valid = format!("{REACH}{first}{distinct_second}");
        let result = prepare_reachable_means_csv(valid.as_bytes(), between).unwrap();
        assert_eq!((result.source_row_count, result.output_row_count), (2, 2));
        let output = String::from_utf8(result.bytes).unwrap();
        assert!(output.contains(&format!("P,I,not_in_use,{first_stage},{first_outcome},f,u,1,arithmetic_mean,2.0,computed,,input_unit")));
        let identity = distinct_second
            .split(',')
            .take(2)
            .collect::<Vec<_>>()
            .join(",");
        assert!(output.contains(&format!("{identity},in_use,{second_stage},{second_outcome},f,u,1,arithmetic_mean,4.0,computed,,input_unit")));
    }
    let independent = if between {
        format!("{REACH}{first}P,I,not_in_use,I-D1,Eg,f,a,0,4,u,true\nP,I,not_in_use,D1-D2,Eg,f,a,0,6,u,true\nP,I,not_in_use,I-D1,Rc,g,a,0,8,u,true\n")
    } else {
        format!("{REACH}{first}P,I,not_in_use,pre_interruption,none,g,a,0,8,u,true\n")
    };
    let result = prepare_reachable_means_csv(independent.as_bytes(), between).unwrap();
    assert_eq!(result.output_row_count, if between { 4 } else { 2 });
    let output = String::from_utf8(result.bytes).unwrap();
    for value in if between {
        vec![2.0, 4.0, 6.0, 8.0]
    } else {
        vec![2.0, 8.0]
    } {
        assert!(output.contains(&format!(
            ",1,arithmetic_mean,{value:.1},computed,,input_unit"
        )));
    }
}

#[test]
fn reachable_pre_use_state_consistency_and_lexical_identity() {
    check_reachable_use_state_consistency(false);
}

#[test]
fn reachable_between_use_state_consistency_and_lexical_identity() {
    check_reachable_use_state_consistency(true);
}

#[test]
fn reachable_actual_csv_preserves_pre_and_all_seven_between_cells() {
    let pre = format!("{REACH} P , I ,not_in_use,pre_interruption,none, acceleration ,b,9,4, unit ,true\n P , I ,not_in_use,pre_interruption,none, acceleration ,a,2,-2, unit ,true\nP,I,not_in_use,pre_interruption,none, acceleration ,a,0,0, unit ,true\n");
    let result = prepare_reachable_means_csv(pre.as_bytes(), false).unwrap();
    assert_eq!((result.source_row_count, result.output_row_count), (3, 2));
    let text = String::from_utf8(result.bytes).unwrap();
    assert!(text.contains(" P , I ,not_in_use,pre_interruption,none, acceleration , unit ,2,arithmetic_mean,1.0,computed,,input_unit"));
    assert!(text.find(" P ").unwrap() < text.find("P,I").unwrap());
    let mut between = REACH.to_owned();
    for (state, stage, outcome) in [
        ("not_in_use", "I-D1", "Rc"),
        ("not_in_use", "I-D1", "Eg"),
        ("not_in_use", "I-D1", "Rv"),
        ("not_in_use", "D1-D2", "Eg"),
        ("not_in_use", "D1-D2", "Rv"),
        ("not_in_use", "D2-D3", "Rv"),
        ("in_use", "I-D3", "Rv"),
    ] {
        let interruption = if state == "in_use" { "I-in-use" } else { "I" };
        between += &format!("P,{interruption},{state},{stage},{outcome},f,b,9,4,u,true\nP,{interruption},{state},{stage},{outcome},f,a,2,2,u,true\n");
    }
    let result = prepare_reachable_means_csv(between.as_bytes(), true).unwrap();
    assert_eq!((result.source_row_count, result.output_row_count), (14, 7));
    assert_eq!(
        String::from_utf8(result.bytes)
            .unwrap()
            .matches(",2,arithmetic_mean,3.0,computed,,input_unit")
            .count(),
        7
    );
    assert!(prepare_reachable_means_csv(pre.as_bytes(), true).is_err());
    assert!(prepare_reachable_means_csv(
        between
            .replace("not_in_use,I-D1,Rc", "in_use,I-D1,Rc")
            .as_bytes(),
        true
    )
    .is_err());
    assert!(prepare_reachable_means_csv(pre.replace(",true", ",false").as_bytes(), false).is_err());
    assert!(
        prepare_reachable_means_csv(pre.replace(",9,4,", ",9,NaN,").as_bytes(), false).is_err()
    );
}

fn moodable() -> String {
    let mut raw = MOOD.to_owned();
    for metric in [
        "call_frequency",
        "incoming_text_sentiment",
        "incoming_text_frequency",
    ] {
        for slot in (1..=14).rev() {
            let n = if metric == "call_frequency" { 14 } else { 5 };
            for lag in (1..=n).rev() {
                let value = match metric {
                    "call_frequency" => (lag + slot) as f64,
                    "incoming_text_frequency" => (lag * slot) as f64,
                    _ => {
                        if lag == 1 {
                            if slot % 2 == 1 {
                                -1.0
                            } else {
                                1.0
                            }
                        } else {
                            0.0
                        }
                    }
                };
                raw += &format!(
                    " P , prediction ,{metric},{slot},{lag},lag{lag},{value}, opaque ,true\n"
                );
            }
        }
    }
    raw
}
#[test]
fn moodable_all_fourteen_positions_keep_exact_fourteen_or_five_lags_and_signed_sentiment() {
    let raw = moodable();
    let selected = BTreeSet::from([
        "call_frequency",
        "incoming_text_sentiment",
        "incoming_text_frequency",
    ]);
    let result = prepare_moodable_slots_csv(raw.as_bytes(), &selected).unwrap();
    assert_eq!(
        (result.source_row_count, result.output_row_count),
        (336, 42)
    );
    let text = String::from_utf8(result.bytes).unwrap();
    assert!(text.contains(" P , prediction ,call_frequency,1, opaque ,14,8.5,computed,,input_unit"));
    assert!(
        text.contains(" P , prediction ,call_frequency,14, opaque ,14,21.5,computed,,input_unit")
    );
    assert!(text.contains(
        " P , prediction ,incoming_text_sentiment,1, opaque ,5,-0.2,computed,,input_unit"
    ));
    assert!(text.contains(
        " P , prediction ,incoming_text_sentiment,14, opaque ,5,0.2,computed,,input_unit"
    ));
    assert!(text.contains(
        " P , prediction ,incoming_text_frequency,14, opaque ,5,42.0,computed,,input_unit"
    ));
    let mut observed = BTreeSet::new();
    for row in csv::Reader::from_reader(text.as_bytes()).records() {
        let row = row.unwrap();
        let slot = row[3].parse::<u8>().unwrap();
        assert!(observed.insert((row[2].to_owned(), slot)));
        let expected = match &row[2] {
            "call_frequency" => 7.5 + f64::from(slot),
            "incoming_text_frequency" => 3.0 * f64::from(slot),
            "incoming_text_sentiment" => {
                if slot % 2 == 1 {
                    -0.2
                } else {
                    0.2
                }
            }
            _ => panic!("unexpected metric"),
        };
        assert_eq!(row[6].parse::<f64>().unwrap(), expected);
    }
    assert_eq!(observed.len(), 42);
    let single =
        prepare_moodable_slots_csv(raw.as_bytes(), &BTreeSet::from(["incoming_text_sentiment"]))
            .unwrap();
    assert_eq!(single.output_row_count, 14);
    let missing_lag = raw.replacen(
        " P , prediction ,call_frequency,14,14,lag14,28, opaque ,true\n",
        "",
        1,
    );
    assert!(prepare_moodable_slots_csv(missing_lag.as_bytes(), &selected).is_err());
    let missing_slot = raw
        .lines()
        .filter(|line| !line.contains(",call_frequency,14,"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(prepare_moodable_slots_csv(missing_slot.as_bytes(), &selected).is_err());
    assert!(prepare_moodable_slots_csv(
        raw.replace(
            ",call_frequency,14,14,lag14,28,",
            ",call_frequency,14,14,lag14,-1,"
        )
        .as_bytes(),
        &selected
    )
    .is_err());
    let duplicate = raw.clone() + raw.lines().nth(1).unwrap() + "\n";
    assert!(prepare_moodable_slots_csv(duplicate.as_bytes(), &selected).is_err());
    let inconsistent_prediction = raw.replace(
        " P , prediction ,incoming_text_frequency,",
        "Q,other_prediction,incoming_text_frequency,",
    );
    assert!(prepare_moodable_slots_csv(inconsistent_prediction.as_bytes(), &selected).is_err());
}

#[test]
fn silencer_actual_scalar_calibration_multiplier_and_strict_comparison_are_independent() {
    let raw = format!("{SILENCE} P , C , axis ,post_calibration,e,5,5, unit ,2,true\n P , C , axis ,calibration,b,2,4, unit ,2,true\n P , C , axis ,post_calibration,d,4,7, unit ,2,true\n P , C , axis ,calibration,a,1,2, unit ,2,true\n P , C , axis ,post_calibration,c,3,6, unit ,2,true\n");
    let all = BTreeSet::from([
        "calibration_maximum",
        "calibration_threshold",
        "strict_exceedance",
    ]);
    let result = prepare_silencer_csv(raw.as_bytes(), &all).unwrap();
    assert_eq!((result.source_row_count, result.output_row_count), (5, 5));
    let text = String::from_utf8(result.bytes).unwrap();
    assert!(text.contains(",calibration_maximum,,,4,computed,,input_unit"));
    assert!(text.contains(",calibration_threshold,,,6,computed,,input_unit"));
    assert!(text.contains(",strict_exceedance,c,3,false,computed,,boolean"));
    assert!(text.contains(",strict_exceedance,d,4,true,computed,,boolean"));
    assert!(text.contains(",strict_exceedance,e,5,false,computed,,boolean"));
    assert!(text.find("c,3").unwrap() < text.find("d,4").unwrap());
    let overflow = format!("{SILENCE}P,C,s,calibration,a,1,{},u,2,true\nP,C,s,post_calibration,b,2,0,u,2,true\nQ,C,s,calibration,a,1,0,u,2,true\nQ,C,s,post_calibration,b,2,0,u,2,true\n", f64::MAX);
    let text = String::from_utf8(
        prepare_silencer_csv(overflow.as_bytes(), &all)
            .unwrap()
            .bytes,
    )
    .unwrap();
    assert!(text.contains(
        "P,C,s,u,calibration_threshold,,,,arithmetic_unavailable,nonfinite_arithmetic,input_unit"
    ));
    assert!(text.contains("P,C,s,u,strict_exceedance,b,2,,arithmetic_unavailable,calibration_threshold_unavailable,boolean"));
    assert!(text.contains("Q,C,s,u,strict_exceedance,b,2,false,computed,,boolean"));
    assert!(prepare_silencer_csv(raw.replace(",c,3,6,", ",c,0,6,").as_bytes(), &all).is_err());
    assert!(prepare_silencer_csv(raw.replace(",2,true", ",20,true").as_bytes(), &all).is_err());
}

#[test]
fn alertness_complete_inventory_distinguishes_session_mean_distinct_apps_and_switch_occurrences() {
    let raw = format!("{ALERT} P , T ,session,s2,7,30,, lexical seconds ,true\n P , T ,app_use,a2,4,,A, lexical seconds ,true\n P , T ,window,w,0,,, lexical seconds ,true\n P , T ,session,s1,1,10,, lexical seconds ,true\n P , T ,app_use,a1,2,,A, lexical seconds ,true\n P , T ,app_use,a3,3,, A , lexical seconds ,true\n P , T ,switch,c1,5,,, lexical seconds ,true\n P , T ,switch,c2,6,,, lexical seconds ,true\nQ,T,window,w,0,,,s,true\n");
    let all = BTreeSet::from([
        "session_duration_mean",
        "distinct_app_diversity",
        "switch_occurrence_count",
    ]);
    let result = prepare_alertness_inventory_csv(raw.as_bytes(), &all).unwrap();
    assert_eq!((result.source_row_count, result.output_row_count), (9, 6));
    let text = String::from_utf8(result.bytes).unwrap();
    assert!(text.contains(
        " P , T , lexical seconds ,session_duration_mean,20.0,computed,,seconds_per_session"
    ));
    assert!(
        text.contains(" P , T , lexical seconds ,distinct_app_diversity,2,computed,,distinct_apps")
    );
    assert!(text.contains(
        " P , T , lexical seconds ,switch_occurrence_count,2,computed,,switch_occurrences"
    ));
    assert!(text.contains("Q,T,s,session_duration_mean,,source_undefined,empty_session_mean_not_disclosed,seconds_per_session"));
    assert!(text.contains("Q,T,s,distinct_app_diversity,0,computed,,distinct_apps"));
    assert!(prepare_alertness_inventory_csv(
        raw.replace(" P , T ,window,w,0,,, lexical seconds ,true\n", "")
            .as_bytes(),
        &all
    )
    .is_err());
    assert!(prepare_alertness_inventory_csv(
        raw.replace(",s1,1,10,", ",s1,1,-10,").as_bytes(),
        &all
    )
    .is_err());
}

#[test]
fn screen_density_counts_occurrences_not_unique_phrase_text_and_retains_zero_phrase_screens() {
    let raw = format!("{SCREEN} P , G ,phrase,S1,9,p2,true,A\n P , G ,screen,S2,12,,true,\n P , G ,inventory,,,,true,\n P , G ,phrase,S1,9,p1,true,A\n P , G ,screen,S1,9,,true,\nP,G,inventory,,,,true,\nP,G,screen,S1,0,,true,\nQ,G,inventory,,,,true,\n");
    let all = BTreeSet::from(["screen_update_count", "phrase_occurrence_density"]);
    let result = prepare_screen_density_csv(raw.as_bytes(), &all).unwrap();
    assert_eq!((result.source_row_count, result.output_row_count), (8, 6));
    let text = String::from_utf8(result.bytes).unwrap();
    assert!(text.contains(" P , G ,screen_update_count,,,2,computed,,saved_screen_occurrences"));
    assert!(text.contains(
        " P , G ,phrase_occurrence_density,S1,9,2,computed,,phrase_occurrences_per_screen"
    ));
    assert!(text.contains(
        " P , G ,phrase_occurrence_density,S2,12,0,computed,,phrase_occurrences_per_screen"
    ));
    assert!(text
        .contains("P,G,phrase_occurrence_density,S1,0,0,computed,,phrase_occurrences_per_screen"));
    assert!(text.contains("Q,G,screen_update_count,,,0,computed,,saved_screen_occurrences"));
    assert!(prepare_screen_density_csv(
        raw.replace(" P , G ,screen,S1,9,,true,\n", "").as_bytes(),
        &all
    )
    .is_err());
    assert!(
        prepare_screen_density_csv(raw.replace(",S1,9,p2,", ",S1,9,p1,").as_bytes(), &all).is_err()
    );
    assert!(prepare_screen_density_csv(raw.replace(",S2,12,", ",S2,9,").as_bytes(), &all).is_err());
}

#[test]
fn prepared_mean_arithmetic_statuses_do_not_drop_other_complete_groups() {
    let raw = format!("{REACH}P,I,in_use,pre_interruption,none,f,a,1,{},u,true\nP,I,in_use,pre_interruption,none,f,b,2,{},u,true\nQ,I,in_use,pre_interruption,none,f,a,1,0,u,true\n", f64::MAX, f64::MAX);
    let text = String::from_utf8(
        prepare_reachable_means_csv(raw.as_bytes(), false)
            .unwrap()
            .bytes,
    )
    .unwrap();
    assert!(text.contains("P,I,in_use,pre_interruption,none,f,u,2,arithmetic_mean,,arithmetic_unavailable,nonfinite_arithmetic,input_unit"));
    assert!(text.contains(
        "Q,I,in_use,pre_interruption,none,f,u,1,arithmetic_mean,0.0,computed,,input_unit"
    ));
    let mut mood = MOOD.to_owned();
    for slot in 1..=14 {
        for lag in 1..=5 {
            mood += &format!(
                "P,p,incoming_text_sentiment,{slot},{lag},s{lag},{},u,true\n",
                if lag == 1 { f64::from_bits(1) } else { 0.0 }
            );
            mood += &format!("Q,p,incoming_text_sentiment,{slot},{lag},s{lag},0,u,true\n");
        }
    }
    let text = String::from_utf8(
        prepare_moodable_slots_csv(
            mood.as_bytes(),
            &BTreeSet::from(["incoming_text_sentiment"]),
        )
        .unwrap()
        .bytes,
    )
    .unwrap();
    assert_eq!(
        text.matches(",arithmetic_unavailable,floating_point_mean_underflow,input_unit")
            .count(),
        14
    );
    assert_eq!(text.matches(",0.0,computed,,input_unit").count(), 14);
    let alert = format!("{ALERT}P,T,window,w,0,,,u,true\nP,T,session,a,1,{},,u,true\nP,T,session,b,2,{},,u,true\nP,T,app_use,c,3,,A,u,true\nP,T,switch,d,4,,,u,true\n", f64::MAX, f64::MAX);
    let text = String::from_utf8(
        prepare_alertness_inventory_csv(
            alert.as_bytes(),
            &BTreeSet::from([
                "session_duration_mean",
                "distinct_app_diversity",
                "switch_occurrence_count",
            ]),
        )
        .unwrap()
        .bytes,
    )
    .unwrap();
    assert!(text.contains(
        ",session_duration_mean,,arithmetic_unavailable,nonfinite_arithmetic,seconds_per_session"
    ));
    assert!(text.contains(",distinct_app_diversity,1,computed,,distinct_apps"));
    assert!(text.contains(",switch_occurrence_count,1,computed,,switch_occurrences"));
}
