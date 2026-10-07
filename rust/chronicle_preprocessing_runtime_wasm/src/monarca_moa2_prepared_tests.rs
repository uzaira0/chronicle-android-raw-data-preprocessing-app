use crate::monarca_moa2_prepared::{
    prepare_moa2_calendar_csv, prepare_monarca_csv, prepared_daily_rms_mean, prepared_scalar_rms,
};
use chronicle_chrono_kernel_wasm::source_local_calendar_weekday;
use std::collections::BTreeSet;

const HEADER: &str = "participant_id,day_id,stream_id,window_id,window_order,sample_id,sample_order,value,input_unit,window_duration_seconds\n";

#[test]
fn window_rms_and_unweighted_daily_mean_match_independent_hand_math() {
    // (9+9)/2=9 -> RMS3; (16+16+16)/3=16 -> RMS4.
    // Each window contributes once: daily mean=(3+4)/2=3.5, not pooled RMS.
    let windows = [
        prepared_scalar_rms(&[-3.0, 3.0]).unwrap(),
        prepared_scalar_rms(&[-4.0, 4.0, -4.0]).unwrap(),
    ];
    assert_eq!(windows[0].value, Some(3.0));
    assert_eq!(windows[1].value, Some(4.0));
    assert_eq!(prepared_daily_rms_mean(&windows).unwrap().value, Some(3.5));
    assert_eq!(prepared_scalar_rms(&[0.0]).unwrap().value, Some(0.0));
    assert_eq!(
        prepared_scalar_rms(&[1.0, 2.0, 2.0]).unwrap().value,
        Some(3.0_f64.sqrt())
    );
    assert!(prepared_scalar_rms(&[]).is_err());
    assert!(prepared_scalar_rms(&[f64::NAN]).is_err());
    assert!(prepared_daily_rms_mean(&[]).is_err());
}

#[test]
fn actual_csv_keeps_supplied_scopes_units_and_orders_without_a_window_constructor() {
    let input = format!("{HEADER}P,D,S,w2,20,b,20,4, caller scalar ,10\nP,D,S,w1,10,a,20,3, caller scalar ,10\nP,D,S,w2,20,a,10,-4, caller scalar ,10\nP,D,S,w1,10,b,10,-3, caller scalar ,10\nP,D,S,w2,20,c,30,-4, caller scalar ,10\n P,D,S,w1,10,a,0,5, caller scalar ,10\nP, D,S,w1,10,a,0,6, caller scalar ,10\nP,D, S,w1,10,a,0,7, caller scalar ,10\n");
    let output = prepare_monarca_csv(
        input.as_bytes(),
        &BTreeSet::from(["root_mean_square", "daily_mean_root_mean_square"]),
    )
    .unwrap();
    assert_eq!(output.source_row_count, 8);
    assert_eq!(output.output_row_count, 9);
    let text = String::from_utf8(output.bytes).unwrap();
    let a = "P,D,S, caller scalar ,w1,10,10,2,2,root_mean_square,3.0,computed,,input_unit";
    let b = "P,D,S, caller scalar ,w2,20,10,3,2,root_mean_square,4.0,computed,,input_unit";
    assert!(text.find(a).unwrap() < text.find(b).unwrap());
    for row in [
        a,
        b,
        "P,D,S, caller scalar ,,,,5,2,daily_mean_root_mean_square,3.5,computed,,input_unit",
        " P,D,S, caller scalar ,w1,10,10,1,1,root_mean_square,5.0,computed,,input_unit",
        "P, D,S, caller scalar ,w1,10,10,1,1,root_mean_square,6.0,computed,,input_unit",
        "P,D, S, caller scalar ,w1,10,10,1,1,root_mean_square,7.0,computed,,input_unit",
    ] {
        assert!(text.contains(row), "missing {row}: {text}");
    }
    assert_eq!(
        prepare_monarca_csv(
            input.as_bytes(),
            &BTreeSet::from(["daily_mean_root_mean_square"])
        )
        .unwrap()
        .output_row_count,
        4
    );
    assert_eq!(
        prepare_monarca_csv(input.as_bytes(), &BTreeSet::from(["root_mean_square"]))
            .unwrap()
            .output_row_count,
        5
    );
}

#[test]
fn arithmetic_unavailability_never_drops_a_window_from_its_daily_denominator() {
    for samples in [vec![f64::MAX], vec![0.0, 0.0, 0.0, 3e-162]] {
        let failed = prepared_scalar_rms(&samples).unwrap();
        assert_eq!(failed.value, None);
        assert_eq!(failed.status, "arithmetic_unavailable");
        let mean =
            prepared_daily_rms_mean(&[prepared_scalar_rms(&[3.0]).unwrap(), failed]).unwrap();
        assert_eq!(mean.value, None);
        assert_eq!(mean.reason, "window_rms_unavailable");
    }
    let input = format!("{HEADER}P,D,S,tiny,0,a,0,0,u,10\nP,D,S,tiny,0,b,1,0,u,10\nP,D,S,tiny,0,c,2,0,u,10\nP,D,S,tiny,0,d,3,3e-162,u,10\nP,D,S,valid,1,a,0,3,u,10\nQ,D,S,valid,0,a,0,4,u,10\n");
    let text = String::from_utf8(
        prepare_monarca_csv(
            input.as_bytes(),
            &BTreeSet::from(["root_mean_square", "daily_mean_root_mean_square"]),
        )
        .unwrap()
        .bytes,
    )
    .unwrap();
    assert!(text.contains(
        "root_mean_square,,arithmetic_unavailable,floating_point_energy_underflow,input_unit"
    ));
    assert!(text.contains("P,D,S,u,,,,5,2,daily_mean_root_mean_square,,arithmetic_unavailable,window_rms_unavailable,input_unit"));
    assert!(text.contains("Q,D,S,u,,,,1,1,daily_mean_root_mean_square,4.0,computed,,input_unit"));
}

#[test]
fn monarca_qualification_refuses_unknown_missingness_conflicting_units_and_orders() {
    let row = "P,D,S,w,1,a,0,3,u,10\n";
    for input in [
        HEADER.to_owned(),
        format!("{HEADER}{row}{row}"),
        format!("{HEADER}{}", row.replace(",10", ",5")),
        format!("{HEADER}{}", row.replace(",3,u", ",NaN,u")),
        format!("{HEADER}{}", row.replace(",3,u", ",,u")),
        format!("{HEADER}{row}P,D,S,w,1,b,1,4,other,10\n"),
        format!("{HEADER}{row}P,D,S,w,2,b,1,4,u,10\n"),
        format!("{HEADER}{row}P,D,S,v,1,b,1,4,u,10\n"),
        format!("{HEADER}{row}P,D,S,w,1,b,0,4,u,10\n"),
    ] {
        assert!(
            prepare_monarca_csv(input.as_bytes(), &BTreeSet::from(["root_mean_square"])).is_err(),
            "{input}"
        );
    }
}

#[test]
fn date_only_calendar_owner_covers_all_weekdays_leaps_and_non_epoch_dates() {
    for (date, weekday) in [
        ("2026-09-27", 1),
        ("2026-09-28", 2),
        ("2026-09-29", 3),
        ("2026-09-30", 4),
        ("2026-10-01", 5),
        ("2026-10-02", 6),
        ("2026-10-03", 7),
        ("2000-02-29", 3),
        ("2400-02-29", 3),
        ("1600-02-29", 3),
    ] {
        assert_eq!(source_local_calendar_weekday(date), Some(weekday), "{date}");
    }
    for date in [
        "1900-02-29",
        "2026-04-31",
        "2026-09-31",
        "2026-9-28",
        "2026-09-28Z",
        "2026-09-28 00:00:00",
        " 2026-09-28",
        "",
        "2026-13-01",
    ] {
        assert_eq!(source_local_calendar_weekday(date), None, "{date}");
    }
}

#[test]
fn actual_moa2_csv_preserves_lexical_identity_row_order_and_source_local_date() {
    let input = b"participant_id,source_row_id,source_local_date\n P,r,2026-09-26\nP,r,2026-09-28\nP, r,2026-09-27\nP,t,1600-02-29\n";
    let output = prepare_moa2_calendar_csv(input).unwrap();
    assert_eq!((output.source_row_count, output.output_row_count), (4, 4));
    assert_eq!(
        String::from_utf8(output.bytes).unwrap(),
        concat!(
            "participant_id,source_row_id,source_local_date,weekday_weekend_type,status\n",
            " P,r,2026-09-26,weekend,computed\n",
            "P,r,2026-09-28,weekday,computed\n",
            "P, r,2026-09-27,weekend,computed\n",
            "P,t,1600-02-29,weekday,computed\n"
        )
    );
    for input in [
        "participant_id,source_row_id,source_local_date\nP,r,1900-02-29\n",
        "participant_id,source_row_id,source_local_date\nP,r,2026-09-28\nP,r,2026-09-29\n",
        "participant_id,source_row_id,source_local_date\nP,r,2026-09-28T00:00:00Z\n",
    ] {
        assert!(prepare_moa2_calendar_csv(input.as_bytes()).is_err());
    }
}
