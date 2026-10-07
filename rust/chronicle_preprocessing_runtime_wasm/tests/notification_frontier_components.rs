//! Independent synthetic oracles: Dismissed primary p3:4 Burst Filtering,
//! Annotif primary p4 Server steps4-5, Dingler author primary p2 Measures,
//! MyPhoneMe accepted manuscript p3 Figure2/prose (not a generic removal metric).
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{adapt_literature_inputs, literature_component_execution_unit};
use sha2::{Digest, Sha256};
const D: &str = "chronicle.dismissed-supplied-burst-last/v1";
const A: &str = "chronicle.annotif-supplied-summary-hash-filter/v1";
const F: &str = "chronicle.dingler-supplied-foreground-exclusion/v1";
const M: &str = "chronicle.myphoneme-supplied-response-times/v1";
const DH: &str = "source_row_id,participant_id,same_second_burst_id,source_order,callback_kind,input_stage";
const AH: &str = "source_row_id,participant_id,app_day_cluster_id,app_package,day_id,group_key,is_group_summary,content_sha256,source_order,input_stage";
const FH: &str = "source_row_id,participant_id,notification_id,notification_package,foreground_package_at_arrival,input_stage";
const MH: &str = "source_row_id,participant_id,notification_id,clock_id,arrival_event_id,arrival_timestamp_ns,assumed_seen_event_id,assumed_seen_timestamp_ns,action_event_id,action_timestamp_ns,arrival_unlock_state,action_kind,input_stage";
fn csv(header: &str, records: &[String]) -> Vec<u8> {
    (std::iter::once(header.to_owned()).chain(records.iter().cloned()).collect::<Vec<_>>().join("\n") + "\n").into_bytes()
}
fn d(id: &str, p: &str, burst: &str, order: u64) -> String {
    format!("{id},{p},{burst},{order},notification_posted,caller-resolved-same-second-bursts-after-title-cleaning")
}
fn a([id, p, cluster]: [&str; 3], app: &str, day: &str, group: &str, summary: bool, hash: char, order: u64) -> String {
    format!("{id},{p},{cluster},{app},{day},{group},{summary},{},{order},caller-resolved-app-day-clusters-before-summary-filter", hash.to_string().repeat(64))
}
fn f(id: &str, app: &str, foreground: &str) -> String {
    format!("{id},p,n,{app},{foreground},caller-resolved-arrival-foreground")
}
fn m(times: [i64; 3], state: &str, action: &str) -> String {
    format!("response,p,n,clock,arrival,{},seen,{},action,{},{},{},caller-resolved-arrival-seen-action", times[0], times[1], times[2], state, action)
}
fn replace_fields(row: &str, replacements: &[(usize, &str)]) -> String {
    let mut fields = row.split(',').map(str::to_owned).collect::<Vec<_>>();
    for (column, value) in replacements { fields[*column] = (*value).to_owned(); }
    fields.join(",")
}
fn run(component: &str, raw: &[u8]) -> Result<Vec<csv::StringRecord>, String> {
    let (registration, bindings) = literature_component_execution_unit(component)?;
    assert_eq!(bindings.len(), match component {A=>2, M=>4, _=>1});
    assert_eq!(registration.full_profile_execution_status, "blocked");
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
    let output = adapt_literature_inputs(raw, &digest, &bindings, |_| &[])?.ok_or("missing registered output")?;
    let bytes = output.derived_result_bytes.ok_or("missing export CSV")?;
    let derived = output.receipt.derived_result.as_ref().unwrap();
    assert_eq!(derived.kind, registration.derived_result_kind);
    assert_eq!(derived.digest, format!("sha256:{}", hex::encode(Sha256::digest(&bytes))));
    assert_eq!(output.receipt.original_input_digest, digest);
    assert_eq!(output.receipt.source_oracle_id, Some(registration.source_oracle_id));
    assert_eq!(output.receipt.materialized_interval_count, 0);
    assert_eq!(output.receipt.duplicate_source_ids_removed, 0);
    let receipt = serde_json::to_value(&output.receipt).unwrap();
    assert_eq!(receipt["derivedResult"]["rowCount"], output.receipt.emitted_row_count);
    let rows = csv::Reader::from_reader(bytes.as_slice()).records().collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    assert_eq!(rows.len(), output.receipt.emitted_row_count as usize);
    Ok(rows)
}
fn ids(rows: &[csv::StringRecord]) -> Vec<&str> { rows.iter().map(|r| &r[0]).collect() }

#[test]
fn dismissed_retains_last_within_supplied_burst_but_never_infers_contiguity_or_grouping() {
    let rows = run(D, &csv(DH, &[d("a","p","burst",0), d("q","q","burst",0), d("middle","p","other",1), d("last","p","burst",2), d("literal","p"," burst",3)])).unwrap();
    assert_eq!(ids(&rows), ["q","middle","last","literal"]);
    let max = run(D, &csv(DH, &[d("first","p","b",u64::MAX-1), d("last","p","b",u64::MAX)])).unwrap();
    assert_eq!(ids(&max), ["last"]);
    assert_eq!(ids(&run(D, &csv(DH, &[d("same-id","p","b",0),d("same-id","p","other",1)])).unwrap()), ["same-id","same-id"]);
}

#[test]
fn supplied_source_order_ties_wrong_callback_and_missing_burst_fail_closed() {
    for rows in [
        vec![d("a","p","b",1),d("b","p","b",1)],
        vec![d("a","p","b",1),d("b","p","b",0)],
        vec![d("a","p","",0)],
        vec![d("a","p","b",0).replace("notification_posted","notification_removed")],
        vec![d("a","p","b",0).replace("caller-resolved-same-second-bursts-after-title-cleaning","raw-callbacks")],
    ] { assert!(run(D, &csv(DH, &rows)).is_err()); }
}

#[test]
fn annotif_resolves_summary_before_hash_and_preserves_all_summary_only_members() {
    let rows = run(A, &csv(AH, &[
        a(["summary","p","c"],"app","day","g",true,'a',0),
        a(["child","p","c"],"app","day","g",false,'a',1),
        a(["later-same-hash","p","c"],"app","day","other-group",false,'a',2),
        a(["sole","p","c"],"app","day","only-summaries",true,'b',3),
        a(["second-summary","p","c"],"app","day","only-summaries",true,'c',4),
        a(["literal-group","p","c"],"app","day"," g",true,'d',5),
    ])).unwrap();
    assert_eq!(ids(&rows), ["child","sole","second-summary","literal-group"]);
}

#[test]
fn annotif_hash_first_is_cluster_scoped_and_never_overrides_declared_order() {
    let rows = run(A, &csv(AH, &[
        a(["a","p","c1"],"app","day","g",false,'a',0),
        a(["different-day","p","c2"],"app","other-day","g",false,'a',0),
        a(["other-person","q","c1"],"app","day","g",false,'a',0),
        a(["later","p","c1"],"app","day","other-group",false,'a',1),
        a(["different-app","p","c3"],"App","day","g",false,'a',0),
    ])).unwrap();
    assert_eq!(ids(&rows), ["a","different-day","other-person","different-app"]);
    let first = a(["a","p","c"],"app","day","g",false,'a',0);
    for second in [
        a(["b","p","c"],"app","day","g",false,'b',0),
        a(["b","p","c"],"other","day","g",false,'b',1),
        a(["b","p","c"],"app","other","g",false,'b',1),
        a(["b","p","c"],"app","day","g",false,'z',1),
        a(["b","p","c"],"app","day","g",false,'b',1).replace(",false,",",1,"),
    ] { assert!(run(A, &csv(AH, &[first.clone(),second])).is_err()); }
}

#[test]
fn annotif_rejects_split_aliases_of_one_literal_participant_app_day() {
    let first = a(["first","p","cluster-1"],"app","day","g",false,'a',0);
    let alias = a(["alias","p","cluster-2"],"app","day","g",false,'a',1);
    assert!(run(A, &csv(AH, &[first.clone(), alias])).is_err());
    // A supplied lexical day difference is not normalized or reconstructed.
    let literal = a(["literal","p","cluster-2"],"app"," day","g",false,'a',0);
    assert_eq!(ids(&run(A, &csv(AH, &[first, literal])).unwrap()), ["first", "literal"]);
}

#[test]
fn foreground_filter_is_literal_equality_with_order_and_duplicates_intact() {
    let raw = csv(FH, &[f("equal","app","app"),f("case","app","App"),f("space","app"," app"),f("case","app","App")]);
    let rows = run(F, &raw).unwrap();
    assert_eq!(ids(&rows), ["case","space","case"]);
    assert_eq!(&rows[1][4], " app");
    for raw in [csv(FH,&[f("missing","app","")]),csv(FH,&[f("unknown","","other")]),csv(FH,&[f("unknown","app","other").replace("caller-resolved-arrival-foreground","unknown-at-arrival")])] {
        assert!(run(F,&raw).is_err());
    }
}

#[test]
fn myphoneme_three_metrics_share_assumed_seen_anchor_and_no_two_hour_cap() {
    for action in ["notification_bar_click","corresponding_app_launch","swipe_dismiss"] {
        let rows = run(M,&csv(MH,&[m([0,2_500_000_000,4_000_000_000],"locked",action)])).unwrap();
        assert_eq!(rows[0].iter().skip(13).collect::<Vec<_>>(), ["2500000000","2.5","1500000000","1.5","4000000000","4"]);
    }
    let rows = run(M,&csv(MH,&[m([0,8_000_000_000_000,8_100_000_000_000],"locked","swipe_dismiss")])).unwrap();
    assert_eq!((&rows[0][14],&rows[0][16],&rows[0][18]), ("8000","100","8100"));
    let rows = run(M,&csv(MH,&[m([1,1,2],"already_unlocked_or_in_use","notification_bar_click")])).unwrap();
    assert_eq!(rows[0].iter().skip(13).collect::<Vec<_>>(), ["0","0","1","0.000000001","1","0.000000001"]);
}

#[test]
fn myphoneme_one_supplied_unlock_can_serve_multiple_pending_notifications() {
    let first = m([0,2_500_000_000,4_000_000_000],"locked","swipe_dismiss");
    let second = replace_fields(&m([1_000_000_000,2_500_000_000,5_000_000_000],"locked","notification_bar_click"),
        &[(0,"second"),(2,"n2"),(4,"arrival-2"),(8,"action-2")]);
    let rows = run(M, &csv(MH, &[first.clone(),second.clone()])).unwrap();
    assert_eq!(ids(&rows), ["response", "second"]);
    assert_eq!(rows[0].iter().skip(13).collect::<Vec<_>>(), ["2500000000","2.5","1500000000","1.5","4000000000","4"]);
    assert_eq!(rows[1].iter().skip(13).collect::<Vec<_>>(), ["1500000000","1.5","2500000000","2.5","4000000000","4"]);
    for bad in [
        replace_fields(&second,&[(3,"different-clock")]),
        replace_fields(&second,&[(7,"2500000001")]),
        replace_fields(&second,&[(4,"arrival"),(5,"0")]),
        replace_fields(&second,&[(8,"action"),(9,"4000000000"),(11,"swipe_dismiss")]),
    ] { assert!(run(M, &csv(MH, &[first.clone(),bad])).is_err()); }
}

#[test]
fn myphoneme_anchor_roles_reject_physical_aliases_but_allow_unlocked_arrival_proxy() {
    let locked = m([0,0,0],"locked","swipe_dismiss");
    for bad in [
        replace_fields(&locked,&[(6,"arrival")]),
        replace_fields(&locked,&[(8,"arrival")]),
        replace_fields(&locked,&[(8,"seen")]),
        replace_fields(&locked,&[(4,"e"),(6,"e"),(8,"e")]),
    ] { assert!(run(M, &csv(MH, &[bad])).is_err()); }
    let unlocked = replace_fields(&m([1,1,2],"already_unlocked_or_in_use","notification_bar_click"),&[(6,"arrival")]);
    let rows = run(M, &csv(MH, &[unlocked.clone(),unlocked])).unwrap();
    assert_eq!(rows[0],rows[1]);
    assert_eq!(rows[0].iter().skip(13).collect::<Vec<_>>(), ["0","0","1","0.000000001","1","0.000000001"]);
    let proxy = m([0,0,0],"already_unlocked_or_in_use","swipe_dismiss");
    assert!(run(M, &csv(MH, std::slice::from_ref(&proxy))).is_ok());
    for bad in [replace_fields(&proxy,&[(8,"seen")]),replace_fields(&proxy,&[(8,"arrival")])] {
        assert!(run(M, &csv(MH, &[bad])).is_err());
    }
    let physical_unlock = replace_fields(&locked,&[(0,"later"),(2,"n2"),(4,"arrival-2"),(8,"action-2")]);
    assert!(run(M, &csv(MH, &[proxy,physical_unlock])).is_err());
}

#[test]
fn myphoneme_signed_and_full_range_math_is_exact_without_population_claims() {
    for (times,expected) in [
        ([0,-1,-2],["-1","-0.000000001","-1","-0.000000001","-2","-0.000000002"]),
        ([0,0,0],["0","0","0","0","0","0"]),
        ([i64::MIN,i64::MAX,i64::MIN],["18446744073709551615","18446744073.709551615","-18446744073709551615","-18446744073.709551615","0","0"]),
        ([i64::MAX,i64::MIN,i64::MIN],["-18446744073709551615","-18446744073.709551615","0","0","-18446744073709551615","-18446744073.709551615"]),
    ] {
        let rows=run(M,&csv(MH,&[m(times,"locked","swipe_dismiss")])).unwrap();
        assert_eq!(rows[0].iter().skip(13).collect::<Vec<_>>(),expected);
    }
}

#[test]
fn myphoneme_requires_roles_complete_clock_and_consistent_action_attribution() {
    let first=m([0,1,2],"locked","swipe_dismiss");
    for (column,value) in [(3,""),(7,"1.5"),(10,"unknown"),(10,"already_unlocked_or_in_use"),(11,"notification_removed"),(12,"inferred-attention")] {
        let mut fields=first.split(',').map(str::to_owned).collect::<Vec<_>>();
        fields[column]=value.into(); assert!(run(M,&csv(MH,&[fields.join(",")])).is_err());
    }
    for second in [first.replace(",clock,",",other-clock,"),first.replace(",action,2,",",action,3,"),first.replace("swipe_dismiss","notification_bar_click")] {
        assert!(run(M,&csv(MH,&[first.clone(),second])).is_err());
    }
    let rows=run(M,&csv(MH,&[first.clone(),first])).unwrap(); assert_eq!(rows[0],rows[1]);
}

#[test]
fn empty_prepared_inventories_are_not_fabricated_events_or_zero_outputs() {
    for (component,header) in [(D,DH),(A,AH),(F,FH),(M,MH)] {
        assert!(run(component,&csv(header,&[])).unwrap().is_empty());
        assert!(run(component,&csv(&(header.to_owned()+",source_row_id"),&[])).is_err());
    }
    assert!(run(M,&csv(&(MH.to_owned()+",seen_time_seconds"),&[])).is_err());
}
