
//! Independent prepared-input hand examples for the bounded frozen143 sources.
//! Exact primary paths, hashes, locators and authoritative source tuples are
//! retained in supplied-prepared-android-reductions-frozen-receipt.json.
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
const HEADER:[&str;8]=["source_row_id","participant_id","device_id","source_context_id","clock_id","value_unit_id","input_stage","prepared_input_json"];
const PREFIXES:[&str;11]=["autosen-prepared-fill","jsyst-prepared-entities","practic-prepared-weekly-top5","appsensor-prepared-chain","backapp-prepared-gap","backapp-prepared-triple","shin-prepared-screen-day","estar-prepared-byte-plan","socialcom-prepared-communication","stress-prepared-communication","battery-prepared-static-mean"];
fn digest(bytes:&[u8])->String {format!("sha256:{}",hex::encode(Sha256::digest(bytes)))}
fn transport(header:&[&str],rows:&[Vec<String>])->Vec<u8> {
    let mut w=csv::Writer::from_writer(Vec::new());w.write_record(header).unwrap();
    for row in rows {w.write_record(row).unwrap();}w.into_inner().unwrap()
}
fn run_header(slug:&str,header:&[&str],rows:&[Vec<String>])->Result<Vec<Value>,String> {
    let raw=transport(header,rows);
    let (registration,bindings)=literature_component_execution_unit(&format!("chronicle.{slug}/v1"))?;
    assert_eq!(registration.full_profile_execution_status,"blocked");
    assert!(!registration.limitations.is_empty());assert!(!bindings.is_empty());
    let result=adapt_literature_inputs(&raw,&digest(&raw),&bindings,|_|&[])?.ok_or("missing output")?;
    assert_eq!(result.receipt.original_input_digest,digest(&raw));
    assert_eq!(result.receipt.source_row_count as usize,rows.len());assert_eq!(result.receipt.emitted_row_count as usize,rows.len());
    assert_eq!(result.receipt.duplicate_source_ids_removed,0);assert_eq!(result.receipt.materialized_interval_count,0);
    assert_eq!(result.receipt.mapped_event_row_count,0);
    assert_eq!(result.receipt.source_oracle_id,Some(registration.source_oracle_id));
    let csv=result.derived_result_bytes.ok_or("missing standalone artifact")?;
    let derived=result.receipt.derived_result.ok_or("missing artifact receipt")?;
    assert_eq!(derived.kind,registration.derived_result_kind);assert_eq!(derived.digest,digest(&csv));
    assert_eq!(derived.row_count as usize,rows.len());assert_eq!(result.csv_bytes,csv);
    let mut reader=csv::Reader::from_reader(csv.as_slice());
    assert_eq!(reader.headers().unwrap().get(header.len()),Some("prepared_result_json"));
    reader.records().map(|r| {
        let r=r.map_err(|e|e.to_string())?;serde_json::from_str(r.get(header.len()).ok_or("missing result cell")?).map_err(|e|e.to_string())
    }).collect()
}
fn run(slug:&str,rows:&[Vec<String>])->Result<Vec<Value>,String>{run_header(slug,&HEADER,rows)}
#[test]
fn shin_and_hamilton_reject_duplicate_json_fields_in_single_or_later_rows() {
    for (slug,input) in [
        ("shin-prepared-no-app-day",r#"{"sessions":[{"session_id":"s","on_event_id":"on","off_event_id":"off","on_timestamp_ns":0,"off_timestamp_ns":1,"app_identities":["app.a"],"app_identities":[]}]}"#),
        ("shin-prepared-no-app-day",r#"{"sessions":[{"session_id":"s","on_event_id":"on","off_event_id":"off","on_timestamp_ns":2,"on_timestamp_ns":0,"off_timestamp_ns":1,"app_identities":[]}]}"#),
        ("hamilton-supplied-no-use-hour-policy",r#"{"hour_id":"h","category_scope_id":"c","complete":true,"segment_minutes":60,"valid_yielded_minutes":30,"no_usage_captured":false,"no_usage_captured":true}"#),
        ("hamilton-supplied-no-use-hour-policy",r#"{"hour_id":"h","category_scope_id":"c","complete":false,"complete":true,"segment_minutes":60,"valid_yielded_minutes":30,"no_usage_captured":true}"#),
    ] {
        let valid=sample(slug);let mut invalid=valid.clone();invalid[7]=input.into();
        assert!(run(slug,&[invalid.clone()]).unwrap_err().contains("duplicate field"),"{slug}");
        invalid[0].push_str("-second");invalid[3].push_str("-second");
        assert!(run(slug,&[valid,invalid]).unwrap_err().contains("duplicate field"),"{slug}");
    }
}
fn cases()->Value {serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap()}
fn sample(slug:&str)->Vec<String> {
    let f=cases();let g=f["groups"].as_array().unwrap().iter().find(|g|g["adapterId"]==format!("chronicle.{slug}/v1")).unwrap();
    let text=g["cases"][0]["rawCsvLines"].as_array().unwrap().iter().map(|s|s.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n";
    csv::Reader::from_reader(text.as_bytes()).records().next().unwrap().unwrap().iter().map(str::to_owned).collect()
}
fn with_input(slug:&str,input:Value,unit:Option<&str>)->Vec<String>{
    let mut r=sample(slug);r[7]=input.to_string();if let Some(u)=unit{r[5]=u.into();}r
}
#[test]
fn every_new_source_setting_case_executes_normal_csv_with_exact_registered_receipt_artifact() {
    let f=cases();let mut owners=0;
    for slug in PREFIXES {
        let component=format!("chronicle.{slug}/v1");
        let g=f["groups"].as_array().unwrap().iter().find(|g|g["adapterId"]==component).unwrap();
        let(_,bindings)=literature_component_execution_unit(&component).unwrap();
        assert_eq!(bindings.len(),g["cases"].as_array().unwrap().len());
        for c in g["cases"].as_array().unwrap() {
            let text=c["rawCsvLines"].as_array().unwrap().iter().map(|s|s.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n";
            let rows=csv::Reader::from_reader(text.as_bytes()).records().map(|r|r.unwrap().iter().map(str::to_owned).collect()).collect::<Vec<Vec<String>>>();
            let out=run(slug,&rows).unwrap();assert_eq!(out.len(),1);assert!(out[0].is_object());owners+=1;
        }
    }
    assert_eq!(owners,40);
}

#[test]
fn rapids_released_resample_custom_category_boundary_and_metadata_pooling_are_source_qualified() {
    let slug="rapids-prepared-resample-categories";let input:Value=serde_json::from_str(&sample(slug)[7]).unwrap();
    let r=run(slug,&[with_input(slug,input.clone(),None)]).unwrap().remove(0);
    assert_eq!(r["resampled_endpoints"].as_array().unwrap().len(),4);assert_eq!(r["chunks"].as_array().unwrap().len(),1);
    assert_eq!(r["chunks"][0]["duration_minutes"],1.0);assert_eq!(r["features"][0]["categories"][0]["countevent"],1);
    assert!(r["features"][0]["categories"][2]["sumduration_minutes"].is_null());
    let base=input["episodes"][0]["start_timestamp"].as_i64().unwrap();
    let episode=|width:i64,offset:i64,label:&str| {
        let mut e=input["episodes"][0].clone();e["row_id"]=json!(label);e["start_timestamp"]=json!(base+offset);e["end_timestamp"]=json!(base+offset+width);
        let n=1+width/60001;let template=e["endpoint_memberships"][0]["selected_segment"].clone();
        e["endpoint_memberships"]=json!((0..n).flat_map(|i|["start","end"].map(|endpoint|
            json!({"resample_index":i,"endpoint":endpoint,"selected_segment":template}))).collect::<Vec<_>>());e
    };
    for (width,endpoint_count,expected_ms) in [(0,2,0),(60000,2,59999),(60001,4,60000),(120001,4,119998)] {
        let mut v=input.clone();v["episodes"]=json!([episode(width,0,"boundary")]);let r=run(slug,&[with_input(slug,v,None)]).unwrap().remove(0);
        assert_eq!(r["resampled_endpoints"].as_array().unwrap().len(),endpoint_count);
        assert!((r["chunks"][0]["duration_minutes"].as_f64().unwrap()-expected_ms as f64/60000.0).abs()<1e-12);
    }
    let mut mixed=input.clone();let first=episode(29999,120000,"late");let mut second=episode(29999,0,"early");
    mixed["episodes"]=json!([first.clone(),second.clone()]);let r=run(slug,&[with_input(slug,mixed.clone(),None)]).unwrap().remove(0);
    assert_eq!(r["chunks"].as_array().unwrap().len(),1);assert_eq!(r["chunks"][0]["start_timestamp"],base+120000);
    assert_eq!(r["chunks"][0]["end_timestamp"],base+29999);assert_eq!(r["features"][0]["categories"][0]["countevent"],1);
    let mut extra=mixed.clone();
    for i in 0..2 {extra["episodes"][i]["metadata"].as_array_mut().unwrap().push(json!({"column":"source_counter","value":9007199254740992_i64+i as i64}));}
    let r=run(slug,&[with_input(slug,extra.clone(),None)]).unwrap().remove(0);
    assert_eq!(r["chunks"].as_array().unwrap().len(),2);assert_eq!(r["features"][0]["categories"][0]["countevent"],2);
    extra["episodes"][0]["metadata"][6]["value"]=json!(true);extra["episodes"][1]["metadata"][6]["value"]=json!(1.0);
    let r=run(slug,&[with_input(slug,extra,None)]).unwrap().remove(0);assert_eq!(r["chunks"].as_array().unwrap().len(),1);
    second["metadata"][0]["value"]=json!("device-B");mixed["episodes"][1]=second.clone();
    let r=run(slug,&[with_input(slug,mixed.clone(),None)]).unwrap().remove(0);
    assert_eq!(r["chunks"].as_array().unwrap().len(),2);assert_eq!(r["features"][0]["categories"][0]["countevent"],2);
    second["start_timestamp"]=first["start_timestamp"].clone();second["end_timestamp"]=first["end_timestamp"].clone();
    mixed["episodes"][1]=second;let r=run(slug,&[with_input(slug,mixed,None)]).unwrap().remove(0);
    assert_eq!(r["chunks"].as_array().unwrap().len(),1);assert_eq!(r["chunks"][0]["metadata"]["device_id"],"device-A");
    let mut missing=input.clone();missing["episodes"][0]["metadata"][1]["value"]=Value::Null;
    let r=run(slug,&[with_input(slug,missing,None)]).unwrap().remove(0);assert_eq!(r["chunks"].as_array().unwrap().len(),1);
    let mut missing_owner=input.clone();missing_owner["episodes"][0]["metadata"].as_array_mut().unwrap().push(json!({"column":"participant_id","value":null}));
    assert!(run(slug,&[with_input(slug,missing_owner,None)]).is_ok());
    for column in ["segment_start_timestamp","segment_end_timestamp","source-counter-reserved-test"] {
        let mut v=input.clone();v["episodes"][0]["metadata"].as_array_mut().unwrap().push(json!({"column":column,"value":0}));
        if column=="source-counter-reserved-test" {assert!(run(slug,&[with_input(slug,v,None)]).is_ok());}
        else {assert!(run(slug,&[with_input(slug,v,None)]).is_err());}
    }
    let mut inactive=input.clone();inactive["excluded_categories"]=json!(["SNS"]);
    inactive["custom_categories"].as_array_mut().unwrap().push(json!({"category":"empty","packages":[]}));
    let r=run(slug,&[with_input(slug,inactive,None)]).unwrap().remove(0);
    assert_eq!(r["features"][0]["categories"].as_array().unwrap().len(),2);assert_eq!(r["features"][0]["categories"][0]["category"],"Broad");
    let mut outside=input.clone();for e in outside["episodes"][0]["endpoint_memberships"].as_array_mut().unwrap() {e["selected_segment"]=Value::Null;}
    let r=run(slug,&[with_input(slug,outside,None)]).unwrap().remove(0);assert!(r["chunks"].as_array().unwrap().is_empty());
    let mut split=input.clone();let memberships=split["episodes"][0]["endpoint_memberships"].as_array_mut().unwrap();
    memberships.truncate(2);split["episodes"][0]["end_timestamp"]=json!(base+59999);
    split["episodes"][0]["endpoint_memberships"][0]["selected_segment"]["end_timestamp"]=json!(base+30000);
    split["episodes"][0]["endpoint_memberships"][1]["selected_segment"]["local_segment"]=json!("caller-qualified-second-segment");
    split["episodes"][0]["endpoint_memberships"][1]["selected_segment"]["start_timestamp"]=json!(base+30000);
    let r=run(slug,&[with_input(slug,split,None)]).unwrap().remove(0);assert_eq!(r["chunks"].as_array().unwrap().len(),2);
    assert_eq!(r["chunks"][0]["duration_minutes"],0.5);
    let mut unlisted=input.clone();unlisted["episodes"][0]["metadata"][2]["value"]=json!("unlisted");
    let r=run(slug,&[with_input(slug,unlisted,None)]).unwrap().remove(0);assert!(r["features"].as_array().unwrap().is_empty());
    for field in ["calendar_id","complete","episodes","custom_categories","excluded_categories","excluded_apps"] {
        let mut bad=input.clone();bad.as_object_mut().unwrap().remove(field);assert!(run(slug,&[with_input(slug,bad,None)]).is_err(),"{field}");
    }
    let mut empty=input.clone();empty["episodes"]=json!([]);
    let r=run(slug,&[with_input(slug,empty,None)]).unwrap().remove(0);
    for field in ["resampled_endpoints","chunks","features"] {assert!(r[field].as_array().unwrap().is_empty());}
    for (field,value) in [("complete",json!(false)),("calendar_id",json!(" "))] {
        let mut bad=input.clone();bad[field]=value;assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
    let mut bad=input.clone();bad["episodes"][0]["endpoint_memberships"][0].as_object_mut().unwrap().remove("selected_segment");
    assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    assert!(run(slug,&[with_input(slug,input.clone(),Some("seconds"))]).is_err());
    let mut bad=input.clone();bad["episodes"][0]["metadata"].as_array_mut().unwrap().push(json!({"column":"participant_id","value":"foreign"}));
    assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
}

#[test]
fn sdu_validation_arithmetic_preserves_signed_orientation_fractional_days_and_refuses_undefined_inputs() {
    let slug="sdu-supplied-validation-arithmetic";
    let percentage=|difference:f64,mean:f64|json!({"operation":"percentage_pair_mean",
        "quantity":"android_daily_activation_count_comparison","difference_orientation":"supplied SDU minus ActionDash",
        "signed_difference":difference,"pair_mean":mean});
    for (difference,mean,expected) in [(20.0,100.0,20.0),(-20.0,100.0,-20.0),(25.0,50.0,50.0),(0.0,100.0,0.0)] {
        let r=run(slug,&[with_input(slug,percentage(difference,mean),None)]).unwrap().remove(0);
        assert_eq!(r["percentage_of_pair_mean"],expected);
        assert_eq!(r["difference_orientation"],"supplied SDU minus ActionDash");
    }
    let reliability=|icc:f64|json!({"operation":"spearman_brown_required_days",
        "quantity":"daily_screen_time_reliability","single_day_icc":icc});
    // Independently evaluated inverse: 0.5 -> 7/3,4,9; 0.8 -> 7/12,1,9/4.
    // Rounded pooled Table5 ICC 0.58 -> 49/29,84/29,189/29, not source model replay.
    for (icc,expected) in [(0.5,[7.0/3.0,4.0,9.0]),(0.8,[7.0/12.0,1.0,9.0/4.0]),(0.58,[49.0/29.0,84.0/29.0,189.0/29.0])] {
        let r=run(slug,&[with_input(slug,reliability(icc),None)]).unwrap().remove(0);
        assert_eq!(r["single_day_icc"],icc);
        for (i,expected) in expected.into_iter().enumerate() {
            assert_eq!(r["targets"][i]["target_reliability"],[0.7,0.8,0.9][i]);
            assert!((r["targets"][i]["fractional_required_days"].as_f64().unwrap()-expected).abs()<1e-12);
        }
    }
    for icc in [0.0,1.0,-0.1,1.1,f64::from_bits(1)] {
        assert!(run(slug,&[with_input(slug,reliability(icc),None)]).is_err());
    }
    for input in [percentage(1.0,0.0),percentage(1.0,-1.0),percentage(f64::MAX,1.0),percentage(f64::from_bits(1),f64::MAX)] {
        assert!(run(slug,&[with_input(slug,input,None)]).is_err());
    }
    let input=percentage(20.0,100.0);
    for (field,value) in [("difference_orientation",json!(" ")),("quantity",json!("screen_time")),
        ("signed_difference",Value::Null),("pair_mean",Value::Null),("guessed_default",json!(1))] {
        let mut bad=input.clone();bad[field]=value;assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
    for missing in ["operation","quantity","difference_orientation","signed_difference","pair_mean"] {
        let mut bad=input.clone();bad.as_object_mut().unwrap().remove(missing);
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
    let row=with_input(slug,input,None);
    for literal in ["1e-400","-1e-400"] {
        let mut bad=row.clone();bad[7]=bad[7].replace("\"signed_difference\":20.0",&format!("\"signed_difference\":{literal}"));
        assert!(run(slug,&[bad]).is_err(),"nonzero lexical underflow {literal} must not become0%");
    }
    for literal in ["0e-400","-0e-400","0.000e99"] {
        let mut zero=row.clone();zero[7]=zero[7].replace("\"signed_difference\":20.0",&format!("\"signed_difference\":{literal}"));
        assert_eq!(run(slug,&[zero]).unwrap()[0]["percentage_of_pair_mean"],0.0);
    }
    for json in [r#"{"operation":"spearman_brown_required_days","quantity":"daily_screen_time_reliability","single_day_icc":0.5,"single_day_icc":0.8}"#,
        r#"{"operation":"percentage_pair_mean","quantity":"android_daily_activation_count_comparison","difference_orientation":"supplied","signed_difference":20,"signed_difference":10,"pair_mean":100}"#,
        r#"{"operation":"spearman_brown_required_days","quantity":"daily_screen_time_reliability","single_day_icc":1e400}"#] {
        let mut bad=row.clone();bad[7]=json.into();assert!(run(slug,&[bad]).is_err());
    }
    assert_eq!(run(slug,&[row.clone(),row.clone()]).unwrap().len(),2);
    let mut bad=row.clone();bad[7]=reliability(0.5).to_string();assert!(run(slug,&[row.clone(),bad]).is_err());
    let mut bad=row.clone();bad[5]="seconds".into();assert!(run(slug,&[bad]).is_err());
    let mut bad=row;bad[6]="caller_qualified_complete_sdu_android_period_contributions".into();assert!(run(slug,&[bad]).is_err());
}

#[test]
fn usage_logger_matches_unchanged_numeric_oracles_and_retrospective_cleaning_boundaries() {
    let slug="usage-logger-released-numeric";
    let events=[(1,"screen on"),(2,"App: Alpha"),(12,"App: Beta"),(32,"screen off"),
        (42,"screen on"),(43,"App: Alpha"),(48,"screen off"),(49,"screen on")].iter().enumerate()
        .map(|(i,(s,event))|json!({"row_id":format!("r{i}"),"timestamp_ms":1700000000000_i64+s*1000,
            "event":event,"day_of_month":14})).collect::<Vec<_>>();
    for variant in ["continuous_python","continuous_r"] {
        let input=json!({"analysis_variant":variant,"calendar_id":"explicit-UTC-oracle","complete":true,"events":events});
        let result=run(slug,&[with_input(slug,input,None)]).unwrap();let r=&result[0];
        assert_eq!(r["screen_duration"],37000);
        assert_eq!(r["retained_rows"].as_array().unwrap().iter().map(|r|r["duration"].as_i64().unwrap()).collect::<Vec<_>>(),[1000,10000,20000,10000,1000,5000,1000,0]);
        assert_eq!(r["apps"][0]["app"],"App: Beta");assert_eq!(r["apps"][0]["duration"],20000);
        assert_eq!(r["apps"][1]["duration"],15000);
        assert_eq!(r["apps"][1]["hours"].as_f64().unwrap(),15000.0_f64/1000.0/60.0/60.0);
    }
    let retro=|rows:&[(i64,&str,i64)]|json!({"analysis_variant":"retrospective_python","calendar_id":"explicit-UTC-oracle","complete":true,
        "events":rows.iter().enumerate().map(|(i,(ms,app,event))|json!({"row_id":format!("r{i}"),"timestamp_ms":ms,"app":app,"event":event,"day_of_month":14})).collect::<Vec<_>>()});
    let input=retro(&[(1700000001000,"Alpha",1),(1700000011000,"Alpha",2),(1700000021000,"Beta",1),(1700000051000,"Beta",2)]);
    let r=run(slug,&[with_input(slug,input,None)]).unwrap().remove(0);
    assert_eq!(r["screen_duration"],40);
    assert_eq!(r["retained_rows"].as_array().unwrap().iter().map(|r|r["duration"].as_i64().unwrap()).collect::<Vec<_>>(),[10,10,30]);
    assert_eq!(r["apps"][0]["duration"],30);assert_eq!(r["apps"][1]["duration"],10);
    assert_eq!(r["apps"][1]["hours"].as_f64().unwrap(),10.0_f64/60.0/60.0);
    let r=run(slug,&[with_input(slug,retro(&[(0,"X",1),(1000,"A",1),(2000,"A",2),(2000,"A",1),(3000,"B",1)]),None)]).unwrap().remove(0);
    assert_eq!(r["retained_rows"].as_array().unwrap().iter().map(|r|r["row_id"].as_str().unwrap()).collect::<Vec<_>>(),["r0","r1","r4"]);
    let r=run(slug,&[with_input(slug,retro(&[(0,"A",1),(1000,"A",7),(2000,"A",1),(3000,"B",1)]),None)]).unwrap().remove(0);
    assert_eq!(r["retained_rows"][0]["duration"],3);
    assert_eq!(r["retained_rows"].as_array().unwrap().len(),2);
    let r=run(slug,&[with_input(slug,retro(&[(0,"A",1),(7200000,"B",2),(14401000,"C",1),(21602000,"startup",27),(21602000,"B",2)]),None)]).unwrap().remove(0);
    assert_eq!(r["retained_rows"].as_array().unwrap().iter().map(|r|r["duration"].as_i64().unwrap()).collect::<Vec<_>>(),[7200,7201,0]);
    assert_eq!(r["screen_duration"],7200);
    assert!(run(slug,&[with_input(slug,retro(&[(0,"A",15)]),None)]).unwrap_err().contains("no retained rows"));
}

#[test]
fn usage_logger_retrospective_r_preserves_one_based_cleaning_null_index_errors_and_cap_variant() {
    let slug="usage-logger-released-numeric";
    let rows=[(0,"X",1),(1000,"A",1),(2000,"A",2),(2000,"A",1),(3000,"B",1),(4000,"B",7),
        (5000,"B",1),(6000,"C",1),(7000,"C",2),(7000,"C",1),(8000,"D",1),(8000,"E",2)];
    let mut input=json!({"analysis_variant":"retrospective_r","calendar_id":"caller-qualified-R-local-days","complete":true,
        "events":rows.iter().enumerate().map(|(i,(ms,app,event))|json!({"row_id":format!("r{i}"),"timestamp_ms":ms,"app":app,"event":event,"day_of_month":1})).collect::<Vec<_>>()});
    let r=run(slug,&[with_input(slug,input.clone(),None)]).unwrap().remove(0);
    assert_eq!(r["screen_duration"],8);
    assert_eq!(r["retained_rows"].as_array().unwrap().iter().map(|r|r["row_id"].as_str().unwrap()).collect::<Vec<_>>(),["r0","r1","r4","r7","r10"]);
    assert_eq!(r["retained_rows"].as_array().unwrap().iter().map(|r|r["duration"].as_i64().unwrap()).collect::<Vec<_>>(),[1,2,3,2,0]);
    let mut overflow=input.clone();overflow["events"][0]["timestamp_ms"]=json!(2147483647000_i64);
    overflow["events"][1]["timestamp_ms"]=json!(-2147483647000_i64);
    assert!(run(slug,&[with_input(slug,overflow,None)]).unwrap_err().contains("signed32 duration subtraction produces NA"));
    let mut reserved_na=input.clone();reserved_na["events"][0]["timestamp_ms"]=json!(2147483647000_i64);
    reserved_na["events"][1]["timestamp_ms"]=json!(-1000);reserved_na["events"][2]["timestamp_ms"]=json!(0);reserved_na["events"][3]["timestamp_ms"]=json!(0);
    assert!(run(slug,&[with_input(slug,reserved_na,None)]).unwrap_err().contains("signed32 duration subtraction produces NA"));
    let mut no_drop=input.clone();no_drop["events"]=json!([
        {"row_id":"x","timestamp_ms":0,"app":"A","event":1,"day_of_month":1},
        {"row_id":"y","timestamp_ms":1000,"app":"B","event":2,"day_of_month":1}]);
    assert!(run(slug,&[with_input(slug,no_drop,None)]).unwrap_err().contains("cleaning2 fails on unary minus of NULL"));
    let mut all_filtered=input.clone();
    all_filtered["events"]=json!([
        {"row_id":"x","timestamp_ms":0,"app":"A","event":15,"day_of_month":1},
        {"row_id":"y","timestamp_ms":1000,"app":"B","event":15,"day_of_month":1}]);
    assert!(run(slug,&[with_input(slug,all_filtered,None)]).unwrap_err().contains("cleaning2 fails on length-zero condition"));
    let mut no_triple=input.clone();no_triple["events"][5]["app"]=json!("different-app");
    assert!(run(slug,&[with_input(slug,no_triple,None)]).unwrap_err().contains("cleaning3 fails on unary minus of NULL"));
    let mut no_cap_drop=input.clone();no_cap_drop["events"][11]["event"]=json!(1);
    assert!(run(slug,&[with_input(slug,no_cap_drop,None)]).unwrap_err().contains("cleaning4 fails on unary minus of NULL"));
    let mut day_only_background=input.clone();
    let events=day_only_background["events"].as_array_mut().unwrap();
    events.insert(11,json!({"row_id":"background-day","timestamp_ms":86400000,"app":"F","event":2,"day_of_month":2}));
    events[12]["timestamp_ms"]=json!(86401000);events[12]["day_of_month"]=json!(2);
    let r=run(slug,&[with_input(slug,day_only_background.clone(),None)]).unwrap().remove(0);
    assert_eq!(r["daily_screen_duration"][0]["duration"],8);
    assert_eq!(r["daily_screen_duration"][1]["day_of_month"],2);assert_eq!(r["daily_screen_duration"][1]["duration"],0);
    day_only_background["analysis_variant"]=json!("retrospective_python");
    let p=run(slug,&[with_input(slug,day_only_background,None)]).unwrap().remove(0);
    assert_eq!(p["daily_screen_duration"].as_array().unwrap().len(),1);
    let events=input["events"].as_array_mut().unwrap();
    events.insert(10,json!({"row_id":"background-long","timestamp_ms":7500,"app":"F","event":2,"day_of_month":1}));
    events[11]["timestamp_ms"]=json!(7209000);events[12]["timestamp_ms"]=json!(7209000);
    let r=run(slug,&[with_input(slug,input.clone(),None)]).unwrap().remove(0);
    assert!(!r["retained_rows"].as_array().unwrap().iter().any(|r|r["row_id"]=="background-long"));
    input["analysis_variant"]=json!("retrospective_python");
    let p=run(slug,&[with_input(slug,input,None)]).unwrap().remove(0);
    assert!(p["retained_rows"].as_array().unwrap().iter().any(|r|r["row_id"]=="background-long" && r["duration"]==7202));
}

#[test]
fn usage_logger_preserves_signed_source_order_and_refuses_incomplete_or_contradictory_inputs() {
    let slug="usage-logger-released-numeric";let input:Value=serde_json::from_str(&sample(slug)[7]).unwrap();
    for field in ["analysis_variant","calendar_id","complete","events"] {
        let mut bad=input.clone();bad.as_object_mut().unwrap().remove(field);
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err(),"{field}");
    }
    for (field,value) in [("complete",json!(false)),("events",json!([])),("analysis_variant",json!("undisclosed_variant")),("calendar_id",json!(" "))] {
        let mut bad=input.clone();bad[field]=value;assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
    for (field,value) in [("day_of_month",json!(0)),("day_of_month",json!(32)),("row_id",json!("on")),
        ("timestamp_ms",json!(9007199254740992_i64)),("timestamp_ms",json!(0.5)),("event",json!(null))] {
        let mut bad=input.clone();bad["events"][1][field]=value;assert!(run(slug,&[with_input(slug,bad,None)]).is_err(),"{field}");
    }
    let mut bad=input.clone();bad["events"][0]["inferred_foreground"]=json!(true);
    assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    assert!(run(slug,&[with_input(slug,input.clone(),Some("seconds"))]).is_err());
    let mut duplicate=sample(slug);duplicate[7]=r#"{"analysis_variant":"continuous_python","calendar_id":"c","complete":true,"events":[],"events":[]}"#.into();
    assert!(run(slug,&[duplicate]).unwrap_err().contains("duplicate field"));
    let unordered=json!({"analysis_variant":"continuous_r","calendar_id":"supplied-UTC-days","complete":true,"events":[
        {"row_id":"a","timestamp_ms":5000,"event":"screen on","day_of_month":1},
        {"row_id":"b","timestamp_ms":1000,"event":"App: A","day_of_month":1},
        {"row_id":"c","timestamp_ms":2000,"event":"screen off","day_of_month":1}]});
    let r=run(slug,&[with_input(slug,unordered,None)]).unwrap().remove(0);
    assert_eq!(r["screen_duration"],-3000);assert_eq!(r["retained_rows"][0]["duration"],-4000);
    assert_eq!(r["apps"][0]["duration"],1000);
}

#[test]
fn sdu_complete_period_boundary_refuses_missing_duplicate_or_implicit_memberships() {
    let slug="sdu-supplied-period-reductions";
    let input:Value=serde_json::from_str(&sample(slug)[7]).unwrap();
    let result=run(slug,&[with_input(slug,input.clone(),None)]).unwrap();
    assert_eq!(result[0]["periods"][1]["screen_duration_nanoseconds"],"30000000001");
    assert_eq!(result[0]["periods"][1]["screen_activation_count"],0);
    for field in ["complete","activation_ids","duration_fragments","source_period_id"] {
        let mut bad=input.clone();bad["periods"][0].as_object_mut().unwrap().remove(field);
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err(),"{field}");
    }
    for (field,value) in [("complete",json!(false)),("activation_ids",json!(["wake","wake"])),
        ("activation_ids",json!(null)),("period_kind",json!("minute")),("source_period_id",json!(" "))] {
        let mut bad=input.clone();bad["periods"][0][field]=value;
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err(),"{field}");
    }
    for value in [json!(-1),json!(0.1),json!(null),json!("1")] {
        let mut bad=input.clone();bad["periods"][0]["duration_fragments"][0]["duration_ns"]=value;
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
    let mut bad=input.clone();bad["periods"][0]["duration_fragments"][1]["fragment_id"]=json!("f1");
    assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    bad=input.clone();bad["periods"].as_array_mut().unwrap().push(input["periods"][0].clone());
    assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    bad=input.clone();bad["periods"][0]["inferred_unlock_count"]=json!(1);
    assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    assert!(run(slug,&[with_input(slug,input.clone(),Some("seconds"))]).is_err());
    let mut huge=input;for f in huge["periods"][0]["duration_fragments"].as_array_mut().unwrap() { f["duration_ns"]=json!(u64::MAX); }
    let result=run(slug,&[with_input(slug,huge,None)]).unwrap();
    assert_eq!(result[0]["periods"][0]["screen_duration_nanoseconds"],"36893488147419103230");
    assert_eq!(result[0]["periods"][0]["screen_duration_seconds"],"36893488147.41910323");
    let mut contradictory=sample(slug);
    contradictory[7]=r#"{"periods":[{"period_kind":"day","source_period_id":"d","complete":true,"duration_fragments":[],"activation_ids":["wake"],"activation_ids":[]}]}"#.into();
    assert!(run(slug,&[contradictory]).unwrap_err().contains("duplicate field"));
}
#[test]
fn autosen_signed_axes_are_not_forced_through_nonnegative_adapter_or_recursive_fill() {
    let slug=PREFIXES[0];
    let observed=|values:Vec<f64>|values.into_iter().enumerate().map(|(i,v)|json!({"record_id":format!("a{i}"),"source_order":i,"observed":true,"value":v})).collect::<Vec<_>>();
    let input=json!({"sensor_kind":"other","sensor_id":"magnetometer","dimension_id":"supplied_z","target_record_id":"m","target_source_order":6,
        "target_missing":true,"previous_observed":observed(vec![-10.0,-5.0,-2.0,0.0,2.0])});
    assert_eq!(run(slug,&[with_input(slug,input.clone(),Some("native_axis_units"))]).unwrap()[0]["filled_value"],-3.0);
    for field in ["sensor_id","dimension_id","target_missing","previous_observed"] {
        let mut bad=input.clone();bad.as_object_mut().unwrap().remove(field);
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
    let mut bad=input.clone();bad["sensor_id"]=json!("GPS");assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    bad=input;bad["previous_observed"][1]["source_order"]=json!(0);assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
}
#[test]
fn jsyst20_literal_zero_missing_overflow_and_distribution_order() {
    let slug=PREFIXES[1];
    let counts=(0..20).map(|i|json!({"entity_id":format!("e{i}"),"count":if i==0{3}else if i==19{1}else{0}})).collect::<Vec<_>>();
    let v=json!({"operation":"valid_top20","entity_kind":"domain","counts":counts});
    let out=run(slug,&[with_input(slug,v.clone(),None)]).unwrap();
    assert_eq!(out[0]["distribution"][0]["entity_id"],"e0");assert_eq!(out[0]["distribution"][19]["ratio"]["value"],0.25);
    let mut zero=v.clone();for c in zero["counts"].as_array_mut().unwrap(){c["count"]=json!(0);}
    assert_eq!(run(slug,&[with_input(slug,zero,None)]).unwrap()[0]["status"],"zero_total_unavailable");
    let mut bad=v.clone();bad["counts"][1]["entity_id"]=json!("e0");assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    bad=v.clone();bad["counts"][1]["count"]=json!(null);assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    bad=v;bad["counts"][0]["count"]=json!(u64::MAX);assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
}
#[test]
fn weekly_top5_boundary_ties_and_undersized_are_visible_unknown_not_tie_break_or_zero_fill() {
    let slug=PREFIXES[2];let mut row=sample(slug);let mut input:Value=serde_json::from_str(&row[7]).unwrap();
    input["apps"][5]["frequency"]=json!(5);row[7]=input.to_string();
    assert_eq!(run(slug,&[row]).unwrap()[0]["status"],"tied_top5_source_undefined");
    input["apps"].as_array_mut().unwrap().truncate(4);
    assert!(run(slug,&[with_input(slug,input,None)]).unwrap()[0]["top5"].is_null());
    assert!(run(slug,&[with_input(slug,json!({"apps":null}),None)]).is_err());
}
#[test]
fn chain_literal_order_empty_first_unknown_and_no_duplicate_occurrence_removal() {
    let slug=PREFIXES[3];let r=sample(slug);let out=run(slug,&[r.clone(),r.clone()]).unwrap();
    assert_eq!(out.len(),2);assert_eq!(out[0]["occurrence_count"],3);assert_eq!(out[0]["distinct_app_count"],2);
    let mut v:Value=serde_json::from_str(&r[7]).unwrap();v["occurrences"].as_array_mut().unwrap().swap(0,1);
    assert_eq!(run(slug,&[with_input(slug,v.clone(),None)]).unwrap()[0]["first_app_and_category"]["app_id"],"A ");
    v["occurrences"][0]["occurrence_id"]=json!("o3");assert!(run(slug,&[with_input(slug,v,None)]).is_err());
    let out=run(slug,&[with_input(slug,json!({"occurrences":[]}),None)]).unwrap();
    assert_eq!(out[0]["occurrence_count"],0);assert!(out[0]["first_app_and_category"].is_null());
}
#[test]
fn backapp_native_integer_gap_equality_neighbor_negative_and_lexical_triple() {
    let slug=PREFIXES[4];let mut row=sample(slug);let mut v:Value=serde_json::from_str(&row[7]).unwrap();
    assert_eq!(run(slug,&[row.clone()]).unwrap()[0]["split"],false);
    v["current_timestamp_ns"]=json!(70_000_000_001_i64);row[7]=v.to_string();
    assert_eq!(run(slug,&[row.clone()]).unwrap()[0]["split"],true);
    v["current_timestamp_ns"]=json!(0);row[7]=v.to_string();assert_eq!(run(slug,&[row.clone()]).unwrap()[0]["gap_seconds"],"-10");
    row[5]="seconds".into();assert!(run(slug,&[row]).is_err());
    let slug=PREFIXES[5];let row=sample(slug);let mut v:Value=serde_json::from_str(&row[7]).unwrap();
    assert_eq!(run(slug,&[row]).unwrap()[0]["is_x_y_x"],true);
    v["apps"][2]["app_id"]=json!("A ");assert_eq!(run(slug,&[with_input(slug,v.clone(),None)]).unwrap()[0]["is_x_y_x"],false);
    v["apps"][1]["is_launcher"]=json!(true);assert!(run(slug,&[with_input(slug,v,None)]).is_err());
}
#[test]
fn shin_complete_empty_zero_and_touching_endpoints_retained_overlap_refuses() {
    let slug=PREFIXES[6];let row=sample(slug);let out=run(slug,std::slice::from_ref(&row)).unwrap();
    assert_eq!(out[0]["screen_session_count"],2);assert_eq!(out[0]["active_hours"],1.5);
    let mut v:Value=serde_json::from_str(&row[7]).unwrap();v["sessions"][1]["on_timestamp_ns"]=json!(3_599_999_999_999_i64);
    assert!(run(slug,&[with_input(slug,v,None)]).is_err());
    assert_eq!(run(slug,&[with_input(slug,json!({"sessions":[]}),None)]).unwrap()[0]["active_hours"],0.0);
    assert!(run(slug,&[with_input(slug,json!({"sessions":null}),None)]).is_err());
}
#[test]
fn shin_joint_no_app_day_preserves_lengths_and_refuses_unknown_inventory_or_bad_endpoints() {
    let slug="shin-prepared-no-app-day";
    let row=sample(slug);
    let input:Value=serde_json::from_str(&row[7]).unwrap();
    let result=run(slug,std::slice::from_ref(&row)).unwrap();
    assert_eq!(result[0],json!({"no_app_session_count":1,"no_app_sessions":[{
        "session_id":"s1","elapsed_nanoseconds":"150000000000","duration_seconds":150.0,"duration_minutes":2.5}]}));
    assert_eq!(run(slug,&[with_input(slug,json!({"sessions":[]}),None)]).unwrap()[0],
        json!({"no_app_session_count":0,"no_app_sessions":[]}));
    for field in ["app_identities","on_event_id","off_timestamp_ns"] {
        let mut bad=input.clone();bad["sessions"][0].as_object_mut().unwrap().remove(field);
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
    for apps in [json!(null),json!([""]),json!([" "])] {
        let mut bad=input.clone();bad["sessions"][0]["app_identities"]=apps;
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
    for apps in [json!(["A "]),json!(["A","A"])] {
        let mut known=input.clone();known["sessions"][0]["app_identities"]=apps;
        assert_eq!(run(slug,&[with_input(slug,known,None)]).unwrap()[0]["no_app_session_count"],0);
    }
    for (field,value) in [("session_id",json!("s1")),("on_event_id",json!("on1")),
        ("on_timestamp_ns",json!(149_999_999_999_i64)),("off_timestamp_ns",json!(149_999_999_999_i64))] {
        let mut bad=input.clone();bad["sessions"][1][field]=value;
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err(),"{field}");
    }
    let mut nanosecond=input;nanosecond["sessions"][0]["off_timestamp_ns"]=json!(1);
    let result=run(slug,&[with_input(slug,nanosecond,None)]).unwrap();
    assert_eq!(result[0]["no_app_sessions"][0]["elapsed_nanoseconds"],"1");
    assert_eq!(result[0]["no_app_sessions"][0]["duration_seconds"],1e-9);
}
#[test]
fn hamilton_paper_no_use_hour_zero_na_exact_thirty_boundary_without_grid_inference() {
    let slug="hamilton-supplied-no-use-hour-policy";
    let input:Value=serde_json::from_str(&sample(slug)[7]).unwrap();
    for (minutes,expected) in [(0,"NA"),(29,"NA"),(30,"0.00"),(31,"0.00"),(60,"0.00")] {
        let mut qualified=input.clone();qualified["valid_yielded_minutes"]=json!(minutes);
        let result=run(slug,&[with_input(slug,qualified,None)]).unwrap();
        assert_eq!(result,json!([{"hour_id":"h0","category_scope_id":"supplied-social-category","duration_minutes":expected}]).as_array().unwrap().clone());
    }
    assert!(run(slug,&[]).unwrap().is_empty());
    for minutes in [json!(-1),json!(61),json!(30.5),json!(null),json!("30"),json!("NaN")] {
        let mut bad=input.clone();bad["valid_yielded_minutes"]=minutes;
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
    for (field,value) in [("no_usage_captured",json!(false)),("complete",json!(false)),
        ("segment_minutes",json!(59)),("hour_id",json!("")),("category_scope_id",json!(" "))] {
        let mut bad=input.clone();bad[field]=value;
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err(),"{field}");
    }
    for field in ["no_usage_captured","complete","valid_yielded_minutes","hour_id"] {
        let mut bad=input.clone();bad.as_object_mut().unwrap().remove(field);
        assert!(run(slug,&[with_input(slug,bad,None)]).is_err());
    }
}
#[test]
fn nine_paper_prepared_additions_use_unchanged_scope_clock_and_result_guards() {
    for slug in ["shin-prepared-no-app-day","hamilton-supplied-no-use-hour-policy"] {
        let row=sample(slug);
        assert_eq!(run(slug,&[row.clone(),row.clone()]).unwrap().len(),2);
        for column in 0..7 {
            let mut bad=row.clone();bad[column]=String::new();
            assert!(run(slug,&[bad]).is_err(),"{slug}:{column}");
        }
        let mut conflict=row.clone();conflict[4]="different-clock".into();
        assert!(run(slug,&[row.clone(),conflict]).unwrap_err().contains("conflicting"));
        let mut headers=HEADER;headers[1]="source_row_id";
        assert!(run_header(slug,&headers,std::slice::from_ref(&row)).is_err());
        let mut headers=HEADER.to_vec();headers.push("prepared_result_json");
        let mut supplied_result=row;supplied_result.push("{}".into());
        assert!(run_header(slug,&headers,&[supplied_result]).is_err());
    }
}
#[test]
fn estar_known_scalar_stages_survive_exact_multiple_conflict_without_random_schedule() {
    let slug=PREFIXES[7];
    let out=run(slug,&[with_input(slug,json!({"sent_bytes":7,"received_bytes":12400}),None)]).unwrap();
    assert_eq!(out[0]["K"],2);assert_eq!(out[0]["send_share"]["value"],3.5);
    assert!(out[0]["receive_plan"].is_null());assert_eq!(out[0]["receive_disposition"],"exact_multiple_source_conflict");
    assert_eq!(out[0]["timing_reconstruction_computed"],false);
    let out=run(slug,&[with_input(slug,json!({"sent_bytes":7,"received_bytes":0}),None)]).unwrap();
    assert_eq!(out[0]["K"],0);assert!(out[0]["send_share"].is_null());
    assert!(run(slug,&[with_input(slug,json!({"sent_bytes":7,"received_bytes":-1}),None)]).is_err());
}
#[test]
fn communication_direction_domains_zero_ratio_empty_mean_and_units_are_distinct() {
    let stress=PREFIXES[9];let out=run(stress,&[sample(stress)]).unwrap();
    assert_eq!(out[0]["calls_total_incoming_plus_outgoing"],2);assert_eq!(out[0]["call_missed"],1);
    assert_eq!(run(stress,&[with_input(stress,json!({"operation":"event_counts","events":[]}),None)]).unwrap()[0]["call_incoming"],0);
    let diversity=json!({"operation":"contact_diversity","memberships":[{"channel":"calls_incoming_plus_outgoing","interactions":[]}]});
    let out=run(stress,&[with_input(stress,diversity.clone(),Some("interactions"))]).unwrap();
    assert_eq!(out[0]["contact_summaries"][0]["summary"]["unique_contacts"],0);assert!(out[0]["contact_summaries"][0]["summary"]["ratio"].is_null());
    assert!(run(stress,&[with_input(stress,diversity,Some("events"))]).is_err());
    let v=json!({"operation":"interevent_mean","channel":"bluetooth","pairs":[]});
    let out=run(stress,&[with_input(stress,v.clone(),Some("seconds"))]).unwrap();
    assert!(out[0]["mean"].is_null());assert!(run(PREFIXES[8],&[with_input(PREFIXES[8],v,Some("seconds"))]).is_err());
    assert!(run(stress,&[with_input(stress,json!({"operation":"event_counts","events":null}),None)]).is_err());
}
#[test]
fn battery_waiting_literal_repair_accepts_waiting_and_refuses_idle() {
    let slug=PREFIXES[10];
    let mut input:Value=serde_json::from_str(&sample(slug)[7]).unwrap();
    input["rates"][0]["state_id"]=json!("Waiting");
    assert_eq!(run(slug,&[with_input(slug,input.clone(),None)]).unwrap()[0]["static_mean_rate"],3.0);
    let mut idle=input.clone();idle["rates"][0]["state_id"]=json!("Idle");
    assert!(run(slug,&[with_input(slug,idle,None)]).is_err(),"Idle is not the paper Waiting token; no synonym mapper");
    for field in ["state_id","rate"] {
        let mut missing=input.clone();missing["rates"][0].as_object_mut().unwrap().remove(field);
        assert!(run(slug,&[with_input(slug,missing,None)]).is_err());
    }
    let mut duplicate=input.clone();duplicate["rates"][0]["state_id"]=json!("WiFi");
    assert!(run(slug,&[with_input(slug,duplicate,None)]).is_err());
    let mut zero=input;for rate in zero["rates"].as_array_mut().unwrap(){rate["rate"]=json!(0.0);}
    assert_eq!(run(slug,&[with_input(slug,zero,None)]).unwrap()[0]["static_mean_rate"],0.0);
}

#[test]
fn static_five_mean_registered_path_rejects_stored_result_and_missing_state() {
    let slug=PREFIXES[10];let row=sample(slug);assert_eq!(run(slug,std::slice::from_ref(&row)).unwrap()[0]["static_mean_rate"],3.0);
    let mut v:Value=serde_json::from_str(&row[7]).unwrap();v["rates"][4]["state_id"]=json!("WiFi");
    assert!(run(slug,&[with_input(slug,v,None)]).is_err());
    assert!(run(slug,&[with_input(slug,json!({"static_mean_rate":0.2006}),None)]).is_err());
}
#[test]
fn all_components_refuse_missing_scope_stages_headers_outputs_and_context_conflicts_preserve_rows() {
    for slug in PREFIXES {
        let row=sample(slug);
        let out=run(slug,&[row.clone(),row.clone()]).unwrap();assert_eq!(out.len(),2);assert_eq!(out[0],out[1]);
        for index in 0..7 {let mut bad=row.clone();bad[index]="".into();assert!(run(slug,&[bad]).is_err(),"{slug}:{index}");}
        for missing in ["","null","{}","[]"]{let mut bad=row.clone();bad[7]=missing.into();assert!(run(slug,&[bad]).is_err(),"{slug}:{missing}");}
        let mut contradiction=row.clone();contradiction[4]="other_clock".into();
        assert!(run(slug,&[row.clone(),contradiction]).unwrap_err().contains("conflicting"));
        let mut other=row.clone();other[0]="r2".into();other[3]="other_source_context".into();
        assert_eq!(run(slug,&[row.clone(),other]).unwrap().len(),2);
        let mut headers=HEADER;headers[1]="source_row_id";assert!(run_header(slug,&headers,std::slice::from_ref(&row)).is_err());
        let mut h=HEADER.to_vec();h.push("prepared_result_json");let mut r=row;r.push("{}".into());
        assert!(run_header(slug,&h,&[r]).is_err());
    }
}
