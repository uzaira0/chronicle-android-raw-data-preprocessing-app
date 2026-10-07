//! Independent literal hand oracles, not calls to an author implementation.
//! Pi rank153.txt:100–111,226–244 SHA0054e43b008cae345f5b741d252cb6f54935d2f4ee92ee86f0490c5bf9cd50bd.
//! Menthal text134:100–117,164–167,279–294 SHAe2b9bd8632b3c38044588845345dbb2b63455d628cd5511f5a6c036481c52f8e.
//! PACO text208:498–507 SHA555f350be5655fb6daf9f3ceb23448010a3e956f87336c11742e860d7b0187dc.
//! Corona rank18:102–111,150–160 SHA3fb016e65994abf2610f3b01201a55c9ac66beb3fc553e1457b0c66cb5e3349b.
//! Prereg example-hypothesis-testing.pdf pp7/table7, text260–325,
//! SHAacaedccf335ac03c2ddfc176294626ce1e44f7f3a0e85400f5de50e0a50680ea.
//! Source absolute artifact paths and unresolved boundaries are in the frozen receipt.

use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use serde_json::{json, Value};
use sha2::{Digest,Sha256};

const PI: &str = "chronicle.supplied-tracker-weekly-usage/v1";
const MENTHAL: &str = "chronicle.supplied-menthal-weekly-usage/v1";
const PACO: &str = "chronicle.supplied-paco-monitoring-sum/v1";
const CORONA: &str = "chronicle.supplied-corona-weekly-sum/v1";
const PREREG: &str = "chronicle.supplied-prereg-app-window-sum/v1";
const PI_HEADER: [&str;10] = ["source_row_id","participant_id","device_id","observation_window_id",
    "window_days","clock_id","timestamp_unit_id","interval_input_stage","category_input_stage","matched_intervals_json"];
const MENTHAL_HEADER: [&str;9] = ["source_row_id","participant_id","device_id","source_study_id",
    "source_week_id","source_week_ordinal","duration_unit_id","session_input_stage","phone_sessions_json"];
const WINDOW_HEADER: [&str;12] = ["source_row_id","participant_id","device_id","source_session_id",
    "anchor_id","anchor_kind","window_id","window_direction","window_seconds","duration_unit_id",
    "membership_input_stage","app_contributions_json"];
fn transport(header: &[&str],rows: &[Vec<String>]) -> Vec<u8> {
    let mut writer=csv::Writer::from_writer(Vec::new());writer.write_record(header).unwrap();
    for row in rows {writer.write_record(row).unwrap();}writer.into_inner().unwrap()
}
fn digest(raw: &[u8]) -> String {format!("sha256:{}",hex::encode(Sha256::digest(raw)))}
fn run(component: &str,header: &[&str],rows: &[Vec<String>]) -> Result<Vec<csv::StringRecord>,String> {
    let raw=transport(header,rows);
    let (registration,bindings)=literature_component_execution_unit(component)?;
    assert_eq!(registration.full_profile_execution_status,"blocked");
    assert!(!registration.limitations.is_empty());
    let result=adapt_literature_inputs(&raw,&digest(&raw),&bindings,|_|&[])?.ok_or("missing output")?;
    assert_eq!(result.receipt.source_row_count as usize,rows.len());
    assert_eq!(result.receipt.emitted_row_count as usize,rows.len());
    assert_eq!(result.receipt.original_input_digest,digest(&raw));
    assert_eq!(result.receipt.source_oracle_id,Some(registration.source_oracle_id));
    assert_eq!(result.receipt.duplicate_source_ids_removed,0);
    assert_eq!(result.receipt.materialized_interval_count,0);
    let bytes=result.derived_result_bytes.ok_or("missing CSV artifact")?;
    let derived=result.receipt.derived_result.unwrap();
    assert_eq!(derived.digest,digest(&bytes));
    assert_eq!(derived.kind,registration.derived_result_kind);
    assert_eq!(derived.row_count as usize,rows.len());
    csv::Reader::from_reader(bytes.as_slice()).records().collect::<Result<Vec<_>,_>>().map_err(|error|error.to_string())
}
fn pair(id: &str,app: &str,category: &str,start: i64,end: i64) -> Value {
    let endpoint=|kind: &str,time: i64|json!({"participant_id":"p","device_id":"d","app_id":app,
        "interval_id":id,"event_id":format!("{id}-{kind}"),"event_kind":kind,"clock_id":"c","timestamp_ns":time});
    json!({"interval_id":id,"app_id":app,"category_id":category,
        "opening":endpoint("app_opening",start),"closing":endpoint("app_closing",end)})
}
fn pi_row(intervals: Value) -> Vec<String> {
    ["r","p","d","week","7","c","nanoseconds","caller_matched_complete_seven_day_tracker_intervals",
        "caller_supplied_single_app_category",&intervals.to_string()].into_iter().map(str::to_owned).collect()
}
fn session(id: &str,seconds: f64,visual: bool,unlocked: bool,audio: bool) -> Value {
    json!({"session_id":id,"duration_seconds":seconds,"duration_unit_id":"seconds",
        "active_visual":visual,"unlocked":unlocked,"locked_audio":audio})
}
fn menthal_row(week: &str,ordinal: &str,sessions: Value) -> Vec<String> {
    ["r","p","d","study",week,ordinal,"seconds","caller_qualified_complete_source_week_sessions",
        &sessions.to_string()].into_iter().map(str::to_owned).collect()
}
fn member(id: &str,app: &str,seconds: f64) -> Value {
    json!({"contribution_id":id,"app_id":app,"duration_seconds":seconds,"duration_unit_id":"seconds"})
}
fn window_row(component: &str,direction: &str,width: &str,members: Value) -> Vec<String> {
    let (anchor,stage)=match component {
        PACO=>("survey_opened","caller_qualified_complete_social_app_pre_open_30min"),
        CORONA=>("questionnaire_submitted","caller_qualified_complete_active_app_preceding_seven_day"),
        PREREG=>("esm_assessment","caller_qualified_complete_preregistered_app_use_window"),_=>panic!(),
    };
    ["r","p","d","session","anchor",anchor,"window",direction,width,"seconds",stage,
        &members.to_string()].into_iter().map(str::to_owned).collect()
}
#[test]
fn tracker_exact_signed_subtraction_strict_boundary_single_category_and_other_total() {
    let row=pi_row(json!([pair("negative","A","chat",1,0),pair("zero","A","chat",0,0),
        pair("micro","A","chat",0,999_999_999),pair("equal","A","chat",0,1_000_000_000),
        pair("fraction","A","chat",0,1_500_000_000),pair("other","A ","other",0,2_500_000_000)]));
    let out=run(PI,&PI_HEADER,&[row.clone(),row]).unwrap();
    assert_eq!(out.len(),2);assert_eq!((&out[0][12],&out[0][13]),("5","0.08333333333333333"));
    let intervals: Value=serde_json::from_str(&out[0][10]).unwrap();
    assert_eq!(intervals[0]["duration_nanoseconds"],"-1");assert_eq!(intervals[0]["duration_seconds"],"-0.000000001");
    assert_eq!(intervals[1]["duration_nanoseconds"],"0");
    assert_eq!(intervals[2]["disposition"],"discard_duration_strictly_less_than_one_second");
    assert_eq!(intervals[3]["disposition"],"retained");
    assert_eq!(serde_json::from_str::<Value>(&out[0][11]).unwrap(),json!({"chat":2.5,"other":2.5}));
}
#[test]
fn tracker_known_empty_and_all_discarded_are_zero_not_missing_or_absent_categories() {
    for intervals in [json!([]),json!([pair("short","A","chat",0,1)])] {
        let out=run(PI,&PI_HEADER,&[pi_row(intervals.clone())]).unwrap();
        assert_eq!((&out[0][12],&out[0][13]),("0","0"));
        assert_eq!(serde_json::from_str::<Value>(&out[0][11]).unwrap(),
            if intervals.as_array().unwrap().is_empty(){json!({})}else{json!({"chat":0.0})});
    }
    for missing in ["","null","[null]","{}"] {
        let mut row=pi_row(json!([]));row[9]=missing.into();assert!(run(PI,&PI_HEADER,&[row]).is_err());
    }
}
#[test]
fn tracker_full_i64_difference_is_not_saturated_and_negative_extreme_is_discarded() {
    let out=run(PI,&PI_HEADER,&[pi_row(json!([
        pair("large","A","chat",i64::MIN,i64::MAX),pair("negative","B","other",i64::MAX,i64::MIN)]))]).unwrap();
    let v: Value=serde_json::from_str(&out[0][10]).unwrap();
    assert_eq!(v[0]["duration_nanoseconds"],"18446744073709551615");
    assert_eq!(v[0]["duration_seconds"],"18446744073.709551615");
    assert_eq!(v[1]["duration_nanoseconds"],"-18446744073709551615");
    assert_eq!(v[1]["disposition"],"discard_duration_strictly_less_than_one_second");
}
#[test]
fn tracker_refuses_clock_kind_app_device_pairing_category_conflicts_and_duplicate_members() {
    for (endpoint,field,value) in [("closing","clock_id","other"),("opening","event_kind","Activity Resumed"),
        ("closing","app_id","other"),("closing","device_id","other"),("opening","participant_id","other"),
        ("closing","interval_id","other"),("opening","event_id","")] {
        let mut v=pair("one","A","chat",0,1_000_000_000);v[endpoint][field]=json!(value);
        assert!(run(PI,&PI_HEADER,&[pi_row(json!([v]))]).is_err());
    }
    let a=pair("one","A","chat",0,1_000_000_000);
    assert!(run(PI,&PI_HEADER,&[pi_row(json!([a,a]))]).unwrap_err().contains("distinct"));
    assert!(run(PI,&PI_HEADER,&[pi_row(json!([a,pair("two","A","other",0,1_000_000_000)]))]).unwrap_err().contains("categories"));
    for (field,value) in [(4,"1"),(6,"seconds"),(7,"same_app_matcher"),(8,"infer_from_package"),(0,""),(5,"")] {
        let mut row=pi_row(json!([a]));row[field]=value.into();assert!(run(PI,&PI_HEADER,&[row]).is_err());
    }
}
#[test]
fn tracker_context_and_event_identity_conflicts_fail_without_global_window_aggregation() {
    let a=pi_row(json!([pair("one","A","chat",0,1_000_000_000)]));
    let b=pi_row(json!([pair("one","A","chat",0,2_000_000_000)]));
    assert!(run(PI,&PI_HEADER,&[a.clone(),b.clone()]).unwrap_err().contains("observation-window"));
    let mut other=b;other[3]="other-week".into();
    assert!(run(PI,&PI_HEADER,&[a,other]).unwrap_err().contains("endpoint event"));
}
#[test]
fn menthal_first_week_excluded_then_separate_weekly_sums_no_average() {
    let sessions=json!([session("visual",3600.0,true,true,false),session("fraction",1800.0,true,true,false),
        session("locked-audio",999.0,false,false,true),session("no-visual",888.0,false,true,false),
        session("no-unlock",777.0,true,false,false),session("zero",0.0,true,true,false)]);
    let out=run(MENTHAL,&MENTHAL_HEADER,&[menthal_row("w1","1",sessions.clone()),
        menthal_row("w2","2",sessions),menthal_row("w3","3",json!([])),
        menthal_row("w4","4",json!([session("fourth",3600.0,true,true,false)])),
        menthal_row("w5","5",json!([session("fifth",7200.0,true,true,false)]))]).unwrap();
    assert_eq!((&out[0][9],&out[0][11],&out[0][12]),("excluded_first_source_week","",""));
    assert_eq!((&out[1][11],&out[1][12]),("5400","1.5"));
    assert_eq!((&out[2][11],&out[2][12]),("0","0"));
    assert_eq!(&out[3][12],"1");assert_eq!(&out[4][12],"2");
    let reasons: Value=serde_json::from_str(&out[1][10]).unwrap();
    assert_eq!(reasons[2]["exclusions"],json!(["not_unlocked","not_active_visual","excluded_locked_audio"]));
    assert_eq!(reasons[3]["exclusions"],json!(["not_active_visual"]));
    assert_eq!(reasons[4]["exclusions"],json!(["not_unlocked"]));
}
#[test]
fn menthal_missing_flags_unknown_weeks_duplicate_sessions_units_and_identity_fail() {
    for bad in ["","null","[null]",r#"[{"session_id":"s","duration_seconds":1,"duration_unit_id":"seconds","active_visual":null,"unlocked":true,"locked_audio":false}]"#] {
        let mut row=menthal_row("w","2",json!([]));row[8]=bad.into();assert!(run(MENTHAL,&MENTHAL_HEADER,&[row]).is_err());
    }
    for ordinal in ["0","6","2.0",""] {assert!(run(MENTHAL,&MENTHAL_HEADER,&[menthal_row("w",ordinal,json!([]))]).is_err());}
    let s=session("s",1.0,true,true,false);
    assert!(run(MENTHAL,&MENTHAL_HEADER,&[menthal_row("w","2",json!([s,s]))]).is_err());
    let mut mismatch=s.clone();mismatch["duration_unit_id"]=json!("hours");
    assert!(run(MENTHAL,&MENTHAL_HEADER,&[menthal_row("w","2",json!([mismatch]))]).is_err());
    assert!(run(MENTHAL,&MENTHAL_HEADER,&[menthal_row("w","2",json!([session("s",-1.0,true,true,false)]))]).is_err());
    assert!(run(MENTHAL,&MENTHAL_HEADER,&[menthal_row("w","2",json!([s])),menthal_row("w","2",json!([]))]).is_err());
    assert!(run(MENTHAL,&MENTHAL_HEADER,&[menthal_row("a","2",json!([])),menthal_row("b","2",json!([]))]).is_err());
}
#[test]
fn paco_and_corona_keep_distinct_source_scopes_exact_app_identity_and_repeated_rows() {
    for (component,width,a,b,seconds,hours) in [(PACO,"1800",60.0,30.0,"90","0.025"),(CORONA,"604800",3600.0,1800.0,"5400","1.5")] {
        let row=window_row(component,"before",width,json!([member("a","A",a),member("b","A ",b)]));
        let out=run(component,&WINDOW_HEADER,&[row.clone(),row]).unwrap();
        assert_eq!(out.len(),2);assert_eq!((&out[0][12],&out[0][13]),(seconds,hours));
        let members: Value=serde_json::from_str(&out[0][11]).unwrap();assert_eq!(members[1]["app_id"],"A ");
        let empty=run(component,&WINDOW_HEADER,&[window_row(component,"before",width,json!([]))]).unwrap();
        assert_eq!((&empty[0][12],&empty[0][13]),("0","0"));
    }
}
#[test]
fn prereg_all_four_arms_are_separate_not_pooled_or_first_seen_and_purpose_is_explicit() {
    let rows=[("before","3600",60.0,30.0),("after","3600",120.0,60.0),
        ("before","1800",20.0,10.0),("after","1800",40.0,20.0)].map(|(direction,width,a,b)|
        window_row(PREREG,direction,width,json!([member("same-physical","A",a),member("second","A ",b)])));
    let out=run(PREREG,&WINDOW_HEADER,&rows).unwrap();
    assert_eq!(out.iter().map(|r|(&r[12],&r[13],&r[14])).collect::<Vec<_>>(),
        vec![("90","0.025","primary"),("180","0.05","primary"),
            ("30","0.008333333333333333","sensitivity"),("60","0.016666666666666666","sensitivity")]);
    let reversed=rows.into_iter().rev().collect::<Vec<_>>();
    let out=run(PREREG,&WINDOW_HEADER,&reversed).unwrap();assert_eq!(&out[0][12],"60");
}
#[test]
fn all_window_sums_refuse_missing_membership_duplicate_ids_units_and_wrong_source_scope() {
    for (component,width) in [(PACO,"1800"),(CORONA,"604800"),(PREREG,"3600")] {
        for bad in ["","null","[null]","{}",r#"[{"contribution_id":"x","app_id":"A","duration_seconds":null,"duration_unit_id":"seconds"}]"#] {
            let mut row=window_row(component,"before",width,json!([]));row[11]=bad.into();assert!(run(component,&WINDOW_HEADER,&[row]).is_err());
        }
        for (column,value) in [(0,""),(1,""),(2,""),(3,""),(4,""),(5,"other_anchor"),(6,""),
            (7,"both"),(8,"7200"),(9,"milliseconds"),(10,"infer_from_raw")] {
            let mut row=window_row(component,"before",width,json!([]));row[column]=value.into();assert!(run(component,&WINDOW_HEADER,&[row]).is_err());
        }
        let m=member("x","A",1.0);
        assert!(run(component,&WINDOW_HEADER,&[window_row(component,"before",width,json!([m,m]))]).is_err());
        let mut wrong=m.clone();wrong["duration_unit_id"]=json!("minutes");
        assert!(run(component,&WINDOW_HEADER,&[window_row(component,"before",width,json!([wrong]))]).is_err());
        assert!(run(component,&WINDOW_HEADER,&[window_row(component,"before",width,json!([member("x","A",-1.0)]))]).is_err());
    }
    assert!(run(PACO,&WINDOW_HEADER,&[window_row(PACO,"after","1800",json!([]))]).is_err());
    assert!(run(CORONA,&WINDOW_HEADER,&[window_row(CORONA,"before","1800",json!([]))]).is_err());
}
#[test]
fn window_conflicts_fail_but_caller_qualified_members_may_differ_across_contexts() {
    for (component,width) in [(PACO,"1800"),(CORONA,"604800"),(PREREG,"3600")] {
        let first=window_row(component,"before",width,json!([member("same","A",1.0)]));
        let changed=window_row(component,"before",width,json!([member("same","A",2.0)]));
        assert!(run(component,&WINDOW_HEADER,&[first.clone(),changed.clone()]).unwrap_err().contains("conflicting"));
        let mut other=changed;other[4]="other-anchor".into();
        let out=run(component,&WINDOW_HEADER,&[first,other]).unwrap();
        assert_eq!(out.iter().map(|r|&r[12]).collect::<Vec<_>>(),["1","2"]);
    }
}
#[test]
fn finite_sum_preserves_input_order_without_epsilon_or_silent_candidate_aggregation() {
    let big=9007199254740992.0;
    let a=window_row(CORONA,"before","604800",json!([member("big","A",big),member("b","B",1.0),member("c","C",1.0)]));
    let mut b=window_row(CORONA,"before","604800",json!([member("b","B",1.0),member("c","C",1.0),member("big","A",big)]));
    b[4]="different-context".into();
    let out=run(CORONA,&WINDOW_HEADER,&[a,b]).unwrap();
    assert_eq!((&out[0][12],&out[1][12]),("9007199254740992","9007199254740994"));
    let overflowing=window_row(CORONA,"before","604800",json!([member("a","A",f64::MAX),member("b","B",f64::MAX)]));
    assert!(run(CORONA,&WINDOW_HEADER,&[overflowing]).unwrap_err().contains("overflows"));
}
#[test]
fn source_owner_sets_remain_narrow_and_never_promote_native_or_unavailable_bundles() {
    for (component,n) in [(PI,2),(MENTHAL,5),(PACO,2),(CORONA,1),(PREREG,1)] {
        let (_,bindings)=literature_component_execution_unit(component).unwrap();assert_eq!(bindings.len(),n);
        for binding in bindings {assert!(!["method-setting-049dd0939adfb6d6fea7b4ff",
            "method-setting-7718ac72bb7263cbc86b911f","method-setting-cbf6e172a843808003bb0596",
            "method-setting-897743265c116513100f58b0","method-setting-c0575081d9ecdcfb8dce732b"].contains(&binding.setting_id.as_str()));}
    }
}

#[test]
fn all_five_routes_refuse_duplicate_headers_missing_columns_and_supplied_outputs() {
    let cases=[
        (PI,PI_HEADER.to_vec(),pi_row(json!([])),"weekly_total_seconds"),
        (MENTHAL,MENTHAL_HEADER.to_vec(),menthal_row("w","2",json!([])),"retained_weekly_hours"),
        (PACO,WINDOW_HEADER.to_vec(),window_row(PACO,"before","1800",json!([])),"total_app_seconds"),
        (CORONA,WINDOW_HEADER.to_vec(),window_row(CORONA,"before","604800",json!([])),"total_app_seconds"),
        (PREREG,WINDOW_HEADER.to_vec(),window_row(PREREG,"after","1800",json!([])),"window_purpose"),
    ];
    for (component,header,row,output) in cases {
        let mut duplicate=header.clone();duplicate.push("source_row_id");
        let mut duplicate_row=row.clone();duplicate_row.push("r".into());
        assert!(run(component,&duplicate,&[duplicate_row]).unwrap_err().contains("duplicate"));
        let mut missing=header.clone();missing.remove(0);let mut missing_row=row.clone();missing_row.remove(0);
        assert!(run(component,&missing,&[missing_row]).is_err());
        let mut supplied=header.clone();supplied.push(output);let mut supplied_row=row.clone();supplied_row.push("99".into());
        assert!(run(component,&supplied,&[supplied_row]).unwrap_err().contains("not supplied"));
    }
}
#[test]
fn repeated_context_cannot_silently_reorder_or_replace_complete_membership() {
    for (component,width) in [(PACO,"1800"),(CORONA,"604800"),(PREREG,"1800")] {
        let a=member("a","A",1.0);let b=member("b","B",2.0);
        let first=window_row(component,"before",width,json!([a,b]));
        let reversed=window_row(component,"before",width,json!([b,a]));
        assert!(run(component,&WINDOW_HEADER,&[first,reversed]).unwrap_err().contains("membership/order"));
    }
    let a=pair("a","A","category",0,1_000_000_000);let b=pair("b","B","category",0,2_000_000_000);
    assert!(run(PI,&PI_HEADER,&[pi_row(json!([a,b])),pi_row(json!([b,a]))]).is_err());
    let a=session("a",1.0,true,true,false);let b=session("b",2.0,true,true,false);
    assert!(run(MENTHAL,&MENTHAL_HEADER,&[menthal_row("w","2",json!([a,b])),menthal_row("w","2",json!([b,a]))]).is_err());
}
