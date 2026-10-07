//! Source-located synthetic hand arithmetic, not study observations.
//! HealthyMind Table 2, retained corrective-packet-07-ranks224-276-20260831/text/238.txt,
//! SHA256 e4e8aa55bc990bc5bc4afa8b5f1437f77be5160fe666cff8e57934fbcc09a9e2:
//! viewed/received %, actioned/received %, sent-to-viewed minutes (not click/action delay).
//! Fischer pp183-184 and Figure 1, retained wave3-reference-frontier-followup-wave6/artifacts/extracted/10.1145_2037373.2037402.txt,
//! SHA256 ca46a40ee86468294fd12c53a59b2e2ab2157a049bbb8b779e7cfda405625cd9:
//! acceptance + decision + task including concluding burden rating = response.
//! All event attribution and population admission are supplied, never inferred here.

use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use sha2::{Digest, Sha256};

const RATES: &str = "chronicle.healthymind-notification-rates/v1";
const DELAY: &str = "chronicle.healthymind-response-delay/v1";
const PHASES: &str = "chronicle.fischer-notification-phase-times/v1";
const RATE_HEADER: &str = "source_row_id,participant_id,notification_count_scope_id,count_stage,received_count,viewed_count,actioned_count";
const PAIR_HEADER: &str = "source_row_id,measurement,start_participant_id,end_participant_id,start_notification_id,end_notification_id,start_event_id,end_event_id,start_event_kind,end_event_kind,start_clock_id,end_clock_id,start_timestamp_ns,end_timestamp_ns,anchor_pairing_stage";
const PHASE_HEADER: &str = "source_row_id,participant_id,notification_id,task_id,clock_id,anchor_pairing_stage,notification_delivery_event_id,notification_delivery_timestamp_ns,notification_acceptance_event_id,notification_acceptance_timestamp_ns,task_type_display_event_id,task_type_display_timestamp_ns,task_acceptance_event_id,task_acceptance_timestamp_ns,response_completion_including_burden_event_id,response_completion_including_burden_timestamp_ns";

fn csv(header: &str, rows: &[String]) -> Vec<u8> {
    (std::iter::once(header.to_owned()).chain(rows.iter().cloned()).collect::<Vec<_>>().join("\n") + "\n").into_bytes()
}
fn rates(received: &str, viewed: &str, actioned: &str) -> Vec<u8> {
    csv(RATE_HEADER, &[format!("counts,p,scope,caller-resolved-notification-counts,{received},{viewed},{actioned}")])
}
fn pair(start: i64, end: i64) -> String {
    format!("delay,response_delay,p,p,n,n,sent,viewed,notification_sent_by_triggering_system,notification_viewed_by_user,clock,clock,{start},{end},caller-resolved")
}
fn phases(times: [i64; 5]) -> String {
    format!("response,p,n,t,clock,caller-resolved,delivery,{},notification-click,{},type-display,{},task-accept,{},completion-with-burden,{}", times[0], times[1], times[2], times[3], times[4])
}
fn adapt(component: &str, raw: &[u8]) -> Result<(Vec<csv::StringRecord>, u32, u32), String> {
    let (registration, bindings) = literature_component_execution_unit(component)?;
    assert_eq!(registration.full_profile_execution_status, "blocked");
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
    let result = adapt_literature_inputs(raw, &digest, &bindings, |_| &[])?.ok_or("missing registered output")?;
    assert_eq!(result.receipt.original_input_digest, digest);
    assert_eq!(result.receipt.source_oracle_id, Some(registration.source_oracle_id));
    assert_eq!(result.receipt.setting_ids.len(), bindings.len());
    assert_eq!(result.receipt.duplicate_source_ids_removed, 0);
    assert_eq!(result.receipt.materialized_interval_count, 0);
    let bytes = result.derived_result_bytes.ok_or("missing CSV")?;
    let rows = csv::Reader::from_reader(bytes.as_slice()).records().collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok((rows, result.receipt.source_row_count, result.receipt.emitted_row_count))
}

#[test]
fn only_the_seven_exact_rate_and_timestamp_owners_are_registered() {
    for (component, mut expected) in [
        (RATES, vec!["method-setting-6d56e50aecf74a2503f6d0b1", "method-setting-fffe42f3d588541467ac1c7a"]),
        (DELAY, vec!["method-setting-cc7c4f7ab1fd66651f062b04"]),
        (PHASES, vec!["method-setting-c0108c78946effd5c5b951d9", "method-setting-e75db28a266b92dbd354ea8d", "method-setting-7afe4a47e9a11f43a3a4a37f", "method-setting-eeb8685c57a00c1ed60c3a81"]),
    ] {
        let (registration, bindings) = literature_component_execution_unit(component).unwrap();
        let mut actual = bindings.iter().map(|binding| binding.setting_id.as_str()).collect::<Vec<_>>();
        actual.sort(); expected.sort(); assert_eq!(actual, expected);
        assert_eq!(registration.source_work_id, if component == PHASES {"doi:10.1145/2037373.2037402"} else {"doi:10.1371/journal.pone.0169162"});
    }
}

#[test]
fn both_fractions_use_received_and_percent_is_a_separate_unit() {
    let (rows, input, output) = adapt(RATES, &rates("8", "3", "2")).unwrap();
    assert_eq!((input, output), (1, 2));
    assert_eq!((&rows[0][3], &rows[0][4], &rows[0][5], &rows[0][6], &rows[0][7]), ("viewed_received", "3", "8", "0.375", "37.5"));
    assert_eq!((&rows[1][3], &rows[1][4], &rows[1][5], &rows[1][6], &rows[1][7]), ("actioned_received", "2", "8", "0.25", "25"));
    let zero = adapt(RATES, &rates("8", "0", "0")).unwrap().0;
    assert_eq!((&zero[0][6], &zero[0][7]), ("0", "0"));
    let max = adapt(RATES, &rates("18446744073709551615", "18446744073709551615", "0")).unwrap().0;
    assert_eq!((&max[0][4], &max[0][5], &max[0][6], &max[0][7]), ("18446744073709551615", "18446744073709551615", "1", "100"));
    // No undocumented cross-numerator relationship is used to infer actions.
    assert!(adapt(RATES, &rates("8", "2", "3")).is_ok());
}

#[test]
fn invalid_or_missing_count_inventories_do_not_become_zero_rates() {
    for raw in [
        rates("0", "0", "0"), rates("8", "9", "0"), rates("8", "0", "9"),
        rates("", "0", "0"), rates("8", "-1", "0"), rates("8", "0.5", "0"),
        rates("18446744073709551616", "0", "0"),
        csv(RATE_HEADER, &[]),
        csv(RATE_HEADER, &["counts,p,scope,raw-notifications,8,3,2".into()]),
        csv(RATE_HEADER, &["counts, ,scope,caller-resolved-notification-counts,8,3,2".into()]),
        csv(RATE_HEADER, &["counts,p,scope,caller-resolved-notification-counts,8,3,2".into(), "counts,p,scope,caller-resolved-notification-counts,8,3,2".into()]),
        csv(&(RATE_HEADER.to_owned() + ",received_count"), &[]),
    ] { assert!(adapt(RATES, &raw).is_err()); }
}

#[test]
fn sent_to_viewed_delay_has_exact_subminute_values_and_minutes_projection() {
    let row = adapt(DELAY, &csv(PAIR_HEADER, &[pair(0, 90_000_000_000)])).unwrap().0.remove(0);
    assert_eq!((&row[15], &row[16], &row[17]), ("90000000000", "90", "1.5"));
    let row = adapt(DELAY, &csv(PAIR_HEADER, &[pair(0, 600_000_000_000_000)])).unwrap().0.remove(0);
    assert_eq!((&row[15], &row[16], &row[17]), ("600000000000000", "600000", "10000"));
    for (start, end, ns, seconds, minute_approx) in [
        (0, 1, "1", "0.000000001", 1.6666666666666667e-11),
        (1, 0, "-1", "-0.000000001", -1.6666666666666667e-11),
        (0, 0, "0", "0", 0.0),
        (i64::MIN, i64::MAX, "18446744073709551615", "18446744073.709551615", 307445734.5618259),
        (i64::MAX, i64::MIN, "-18446744073709551615", "-18446744073.709551615", -307445734.5618259),
    ] {
        let row = adapt(DELAY, &csv(PAIR_HEADER, &[pair(start, end)])).unwrap().0.remove(0);
        assert_eq!((&row[15], &row[16]), (ns, seconds));
        let minutes = row[17].parse::<f64>().unwrap();
        assert!((minutes - minute_approx).abs() <= 1e-15 * minute_approx.abs().max(1e-11));
    }
}

#[test]
fn response_delay_rejects_substitute_roles_and_unresolved_identity_or_clock() {
    for (column, value) in [(8, "notification_received"), (9, "notification_user_click"), (3, "other"), (5, "other"), (11, "other-clock"), (14, "inferred-attention"), (13, "1.5")] {
        let mut fields = pair(0, 1).split(',').map(str::to_owned).collect::<Vec<_>>();
        fields[column] = value.into();
        assert!(adapt(DELAY, &csv(PAIR_HEADER, &[fields.join(",")])).is_err());
    }
    assert!(adapt(DELAY, &csv(&(PAIR_HEADER.to_owned() + ",elapsed_minutes"), &[])).is_err());
    let (rows, input, output) = adapt(DELAY, &csv(PAIR_HEADER, &[pair(0, 1), pair(0, 1)])).unwrap();
    assert_eq!((input, output), (2, 2)); assert_eq!(rows[0], rows[1]);
    let second = pair(0, 2);
    assert!(adapt(DELAY, &csv(PAIR_HEADER, &[pair(0, 1), second])).unwrap_err().contains("conflicting supplied event attribution"));
}

#[test]
fn three_distinct_phases_include_burden_and_response_is_their_sum() {
    let (rows, input, output) = adapt(PHASES, &csv(PHASE_HEADER, &[phases([10_000_000_000, 20_000_000_000, 20_000_000_000, 25_000_000_000, 55_000_000_000])])).unwrap();
    assert_eq!((input, output), (1, 1));
    assert_eq!(rows[0].iter().skip(16).collect::<Vec<_>>(), ["10000000000", "10", "5000000000", "5", "30000000000", "30", "45000000000", "45"]);
    // Supplied role boundaries need not be fused: 10 + 8 + 25 = 43, not
    // delivery-to-completion 45. No missing two-second gap is fabricated.
    let row = adapt(PHASES, &csv(PHASE_HEADER, &[phases([0, 10_000_000_000, 12_000_000_000, 20_000_000_000, 45_000_000_000])])).unwrap().0.remove(0);
    assert_eq!((&row[17], &row[19], &row[21], &row[23]), ("10", "8", "25", "43"));
    assert!(adapt(PHASES, &csv(&PHASE_HEADER.replace("response_completion_including_burden_timestamp_ns", "task_completion_without_burden_timestamp_ns"), &[])).is_err());
}

#[test]
fn phase_arithmetic_is_signed_fractional_uncapped_and_overflow_safe() {
    for (times, expected) in [
        ([0, 1, 1, 2, 3], ["1", "0.000000001", "1", "0.000000001", "1", "0.000000001", "3", "0.000000003"]),
        ([0, -1, -1, -2, -3], ["-1", "-0.000000001", "-1", "-0.000000001", "-1", "-0.000000001", "-3", "-0.000000003"]),
        ([0, 0, 0, 0, 0], ["0", "0", "0", "0", "0", "0", "0", "0"]),
        ([i64::MIN, i64::MAX, i64::MIN, i64::MAX, i64::MIN], ["18446744073709551615", "18446744073.709551615", "18446744073709551615", "18446744073.709551615", "-18446744073709551615", "-18446744073.709551615", "18446744073709551615", "18446744073.709551615"]),
        ([i64::MIN, i64::MAX, i64::MIN, 0, i64::MAX], ["18446744073709551615", "18446744073.709551615", "9223372036854775808", "9223372036.854775808", "9223372036854775807", "9223372036.854775807", "36893488147419103230", "36893488147.41910323"]),
        ([i64::MAX, i64::MIN, i64::MAX, 0, i64::MIN], ["-18446744073709551615", "-18446744073.709551615", "-9223372036854775807", "-9223372036.854775807", "-9223372036854775808", "-9223372036.854775808", "-36893488147419103230", "-36893488147.41910323"]),
        ([0, 4_000_000_000_000, 4_000_000_000_000, 4_060_000_000_000, 4_180_000_000_000], ["4000000000000", "4000", "60000000000", "60", "120000000000", "120", "4180000000000", "4180"]),
    ] {
        let row = adapt(PHASES, &csv(PHASE_HEADER, &[phases(times)])).unwrap().0.remove(0);
        assert_eq!(row.iter().skip(16).collect::<Vec<_>>(), expected);
    }
}

#[test]
fn phase_rows_preserve_duplicates_and_require_consistent_complete_attribution() {
    let first = phases([0, 1, 1, 2, 3]);
    let (rows, input, output) = adapt(PHASES, &csv(PHASE_HEADER, &[first.clone(), first.clone()])).unwrap();
    assert_eq!((input, output), (2, 2)); assert_eq!(rows[0], rows[1]);
    for (column, value) in [(2, "other-notification"), (3, "other-task"), (4, "other-clock"), (7, "1"), (5, "inferred-episode"), (15, ""), (9, "0.5")] {
        let mut fields = first.split(',').map(str::to_owned).collect::<Vec<_>>();
        fields[column] = value.into();
        assert!(adapt(PHASES, &csv(PHASE_HEADER, &[first.clone(), fields.join(",")])).is_err());
    }
    // Acceptance click can also display the task type at the same attributed event.
    let same_event = first.replace("type-display", "notification-click");
    assert!(adapt(PHASES, &csv(PHASE_HEADER, &[same_event])).is_ok());
    let (rows, input, output) = adapt(PHASES, &csv(PHASE_HEADER, &[])).unwrap();
    assert!(rows.is_empty()); assert_eq!((input, output), (0, 0));
    for output_column in ["response_time_seconds", "acceptance_time_nanoseconds", "clock_id"] {
        assert!(adapt(PHASES, &csv(&(PHASE_HEADER.to_owned() + "," + output_column), &[])).is_err());
    }
}
