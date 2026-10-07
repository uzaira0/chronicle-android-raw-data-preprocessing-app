//! Independent hand/source-neighbor checks for two retained communication papers.
//! SOCIALCOM rank147:130-151, SHA299b5032…; STRESS fp266-lepri.tex:452-578,
//! in pinned arXiv1410.5816v1 TAR SHA9ebfdf1d…. No author code executes here.
use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{adapt_literature_inputs,literature_component_execution_unit};
use chronicle_preprocessing_runtime_wasm::{execute_literature_component_native,RuntimeArtifactMetadata,RuntimeRequest,RuntimeSupportFiles,EXECUTE_WORKSPACE_COMMAND,RUNTIME_PROTOCOL_VERSION};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
const SLUGS:[&str;7]=["socialcom-prepared-basic-summary","stress-prepared-basic-summary","stress-prepared-response-median","stress-prepared-bluetooth","socialcom-prepared-printed-correction","stress-prepared-printed-correction","stress-prose-count-ratios"];
const HEADER:[&str;8]=["source_row_id","participant_id","device_id","source_context_id","clock_id","value_unit_id","input_stage","prepared_input_json"];
fn digest(b:&[u8])->String {format!("sha256:{}",hex::encode(Sha256::digest(b)))}
fn cases()->Value {serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap()}
fn group(slug:&str)->Value {cases()["groups"].as_array().unwrap().iter().find(|g|g["adapterId"]==format!("chronicle.{slug}/v1")).unwrap().clone()}
fn sample(slug:&str,index:usize)->Vec<String> {
    let g=group(slug);let text=g["cases"][index]["rawCsvLines"].as_array().unwrap().iter().map(|s|s.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n";
    csv::Reader::from_reader(text.as_bytes()).records().next().unwrap().unwrap().iter().map(str::to_owned).collect()
}
fn transport(header:&[&str],rows:&[Vec<String>])->Vec<u8> {
    let mut w=csv::Writer::from_writer(Vec::new());w.write_record(header).unwrap();
    for r in rows {w.write_record(r).unwrap();}w.into_inner().unwrap()
}
fn adapt(slug:&str,header:&[&str],rows:&[Vec<String>])->Result<(Vec<u8>,usize),String> {
    let raw=transport(header,rows);let(registration,bindings)=literature_component_execution_unit(&format!("chronicle.{slug}/v1"))?;
    assert_eq!(registration.full_profile_execution_status,"blocked");assert!(!registration.limitations.is_empty());
    let g=group(slug);
    assert_eq!(bindings.len(),g["cases"].as_array().unwrap().len());
    for b in &bindings {
        let c=g["cases"].as_array().unwrap().iter().find(|c|c["methodSettingId"]==b.setting_id).unwrap();
        assert_eq!(b.source_value,c["sourceValue"]);assert_eq!(registration.source_work_id,c["sourceWorkId"]);
    }
    let out=adapt_literature_inputs(&raw,&digest(&raw),&bindings,|_|&[])?.ok_or("missing artifact")?;
    assert_eq!(out.receipt.original_input_digest,digest(&raw));assert_eq!(out.receipt.source_row_count as usize,rows.len());
    assert_eq!(out.receipt.mapped_event_row_count,0);assert_eq!(out.receipt.materialized_interval_count,0);
    assert_eq!(out.receipt.duplicate_source_ids_removed,0);assert_eq!(out.receipt.source_oracle_id,Some(registration.source_oracle_id));
    let artifact=out.derived_result_bytes.ok_or("missing standalone CSV")?;let receipt=out.receipt.derived_result.ok_or("missing derived receipt")?;
    assert_eq!(receipt.kind,registration.derived_result_kind);assert_eq!(receipt.digest,digest(&artifact));assert_eq!(out.csv_bytes,artifact);
    assert_eq!(receipt.row_count,out.receipt.emitted_row_count);
    Ok((artifact,receipt.row_count as usize))
}
fn run(slug:&str,rows:&[Vec<String>])->Result<Vec<Value>,String> {
    let(out,n)=adapt(slug,&HEADER,rows)?;assert_eq!(n,rows.len());let mut r=csv::Reader::from_reader(out.as_slice());
    let column=r.headers().unwrap().iter().position(|h|h=="prepared_result_json").unwrap();
    r.records().map(|row|serde_json::from_str(row.map_err(|e|e.to_string())?.get(column).ok_or("missing result")?).map_err(|e|e.to_string())).collect()
}
fn with_input(slug:&str,input:Value)->Vec<String>{let mut row=sample(slug,0);row[7]=input.to_string();row}
#[test]
fn all_ten_exact_source_owners_run_registered_csv_receipts_and_standalone_artifacts() {
    let mut owners=0;
    for slug in SLUGS {
        let g=group(slug);
        for (i,c) in g["cases"].as_array().unwrap().iter().enumerate() {
            let h:Vec<&str>=c["rawCsvLines"][0].as_str().unwrap().split(',').collect();
            let(out,n)=adapt(slug,&h,&[sample(slug,i)]).unwrap();assert_eq!(n,if slug==SLUGS[6]{3}else{1});
            let text=String::from_utf8(out).unwrap();
            for s in c["expected"]["outputContains"].as_array().unwrap() {assert!(text.contains(s.as_str().unwrap()),"{slug}: {text}");}
            owners+=1;
        }
    }
    assert_eq!(owners,10);
}
#[test]
fn both_summary_owners_keep_known_mean_extrema_when_even_median_is_unknown() {
    for slug in &SLUGS[..2] {
        let mut v:Value=serde_json::from_str(&sample(slug,0)[7]).unwrap();
        v["members"][0]["value"]=json!(8);v["members"][1]["value"]=json!(-2);v["members"][2]["value"]=json!(3);
        let r=run(slug,&[with_input(slug,v.clone())]).unwrap();assert_eq!(r[0]["mean"],3.0);assert_eq!(r[0]["minimum"],-2.0);assert_eq!(r[0]["median"],3.0);
        v["members"].as_array_mut().unwrap().pop();let r=run(slug,&[with_input(slug,v.clone())]).unwrap();
        assert_eq!(r[0]["mean"],3.0);assert!(r[0]["median"].is_null());assert_eq!(r[0]["median_status"],"even_median_source_undefined");
        v["members"]=json!([]);assert!(run(slug,&[with_input(slug,v.clone())]).unwrap()[0]["mean"].is_null());
        for field in ["members","complete","feature_family","target_day_id"] {
            let mut bad=v.clone();bad.as_object_mut().unwrap().remove(field);assert!(run(slug,&[with_input(slug,bad)]).is_err());
        }
        v["complete"]=json!(false);assert!(run(slug,&[with_input(slug,v)]).is_err());
    }
}
#[test]
fn stress_response_exact_one_ns_odd_hour_equality_next_ns_and_unknown_even() {
    let slug=SLUGS[2];let row=sample(slug,0);let mut v:Value=serde_json::from_str(&row[7]).unwrap();
    let r=run(slug,&[row]).unwrap();assert_eq!(r[0]["median_seconds"],"2.5");assert_eq!(r[0]["latencies"][0]["elapsed_seconds"],"0.000000001");
    v["pairs"]=json!([v["pairs"][2].clone()]);assert_eq!(run(slug,&[with_input(slug,v.clone())]).unwrap()[0]["median_seconds"],"3600");
    v["pairs"][0]["outgoing"]["timestamp_ns"]=json!(3_600_000_000_001_i64);assert!(run(slug,&[with_input(slug,v.clone())]).is_err());
    v["pairs"][0]["outgoing"]["timestamp_ns"]=json!(-1);assert!(run(slug,&[with_input(slug,v.clone())]).is_err());
    v["pairs"][0]["outgoing"]["timestamp_ns"]=json!(0);assert_eq!(run(slug,&[with_input(slug,v.clone())]).unwrap()[0]["median_seconds"],"0");
    v["pairs"][0]["incoming"]["timestamp_ns"]=json!(i64::MIN);v["pairs"][0]["outgoing"]["timestamp_ns"]=json!(i64::MAX);assert!(run(slug,&[with_input(slug,v)]).is_err());
    v=serde_json::from_str(&sample(slug,0)[7]).unwrap();v["pairs"].as_array_mut().unwrap().pop();
    let r=run(slug,&[with_input(slug,v.clone())]).unwrap();assert!(r[0]["median_seconds"].is_null());assert_eq!(r[0]["pair_count"],2);
    v["pairs"]=json!([]);assert_eq!(run(slug,&[with_input(slug,v)]).unwrap()[0]["median_status"],"empty_membership_unavailable");
}
#[test]
fn stress_response_typed_identity_last_incoming_and_common_clock_refuse_conflicts() {
    let slug=SLUGS[2];let v:Value=serde_json::from_str(&sample(slug,0)[7]).unwrap();
    for (field,bad_value) in [("peer_id",json!("peer ")),("clock_id",json!("other")),("channel",json!("call")),("direction",json!("incoming"))] {
        let mut bad=v.clone();bad["pairs"][0]["outgoing"][field]=bad_value;assert!(run(slug,&[with_input(slug,bad)]).is_err());
    }
    let mut bad=v.clone();bad["pairs"][0]["caller_qualified_last_incoming_within_hour"]=json!(false);assert!(run(slug,&[with_input(slug,bad)]).is_err());
    bad=v;bad["pairs"][1]["outgoing"]["event_id"]=bad["pairs"][0]["outgoing"]["event_id"].clone();assert!(run(slug,&[with_input(slug,bad)]).is_err());
}
#[test]
fn bluetooth_tied_frequency_is_scalar_not_owner_and_empty_ratio_not_zero() {
    let slug=SLUGS[3];let mut v:Value=serde_json::from_str(&sample(slug,0)[7]).unwrap();
    v["hits"][1]["bluetooth_id"]=json!("A ");v["hits"][3]["bluetooth_id"]=json!("A ");
    let r=run(slug,&[with_input(slug,v.clone())]).unwrap();assert_eq!(r[0]["distinct_ids"],2);assert_eq!(r[0]["maximum_hit_frequency"],2);
    assert_eq!(r[0]["contacts_hits_ratio"]["value"],0.5);assert!(r[0].get("winning_id").is_none());
    v["hits"][1]["hit_id"]=json!("h0");assert!(run(slug,&[with_input(slug,v.clone())]).is_err());
    v["hits"]=json!([]);let r=run(slug,&[with_input(slug,v.clone())]).unwrap();assert_eq!(r[0]["distinct_ids"],0);assert!(r[0]["maximum_hit_frequency"].is_null());assert!(r[0]["contacts_hits_ratio"].is_null());
    v["caller_qualified_rssi_nonnegative"]=json!(false);assert!(run(slug,&[with_input(slug,v)]).is_err());
}
#[test]
fn bluetooth_supplied_k_strict_equality_zero_max_and_missing_are_distinct() {
    let slug=SLUGS[3];let mut row=sample(slug,3);let mut v:Value=serde_json::from_str(&row[7]).unwrap();
    let r=run(slug,&[row.clone()]).unwrap();assert_eq!(r[0]["qualifying_ids"],json!(["B"]));
    v["k"]=json!(0);row[7]=v.to_string();assert_eq!(run(slug,&[row.clone()]).unwrap()[0]["ids_more_than_k_slots"],2);
    v["k"]=json!(u64::MAX);row[7]=v.to_string();assert_eq!(run(slug,&[row.clone()]).unwrap()[0]["ids_more_than_k_slots"],0);
    v["counts"]=json!([]);row[7]=v.to_string();assert_eq!(run(slug,&[row.clone()]).unwrap()[0]["ids_more_than_k_slots"],0);
    v.as_object_mut().unwrap().remove("k");row[7]=v.to_string();assert!(run(slug,&[row]).is_err());
    let mut row=sample(slug,3);row[5]="hits".into();assert!(run(slug,&[row]).is_err());
}
#[test]
fn both_printed_corrections_support_m_above_denominator_without_borrowed_count_relationship() {
    for slug in &SLUGS[4..6] {
        let r=run(slug,&[with_input(slug,json!({"m_hat":5,"N":1}))]).unwrap();assert_eq!(r[0]["printed_correction"],json!({"numerator":4,"denominator":2,"value":2.0}));
        assert_eq!(run(slug,&[with_input(slug,json!({"m_hat":1,"N":1}))]).unwrap()[0]["printed_correction"]["value"],0.0);
        for v in [json!({"m_hat":0,"N":1}),json!({"m_hat":3,"N":0}),json!({"m_hat":3,"N":u64::MAX}),json!({"m_hat":3,"N":null}),json!({"m_hat":3,"n":8})] {
            assert!(run(slug,&[with_input(slug,v)]).is_err());
        }
    }
}
#[test]
fn stress_ratios_use_existing_count_adapter_and_exact_three_requests() {
    let slug=SLUGS[6];let h=["source_row_id","outgoing","incoming","missed","sms_sent","sms_received"];
    let row=sample(slug,0);let(out,n)=adapt(slug,&h,std::slice::from_ref(&row)).unwrap();assert_eq!(n,3);
    assert!(String::from_utf8(out).unwrap().contains("outgoing_to_incoming_calls,6,3,2"));
    let mut bad=row.clone();bad[2]="0".into();assert!(adapt(slug,&h,&[bad]).is_err());
    bad=row.clone();bad[1]=u64::MAX.to_string();bad[2]="1".into();assert!(adapt(slug,&h,&[bad]).is_err());
    bad=row;bad[1]="0".into();let(out,_)=adapt(slug,&h,&[bad]).unwrap();assert!(String::from_utf8(out).unwrap().contains("outgoing_to_incoming_calls,0,3,0"));
    assert!(adapt(slug,&h,&[sample(slug,0),sample(slug,0)]).is_err());
}
#[test]
fn prepared_scopes_exact_rows_missing_headers_memberships_and_precomputed_output_guard() {
    for slug in &SLUGS[..6] {
        let row=sample(slug,0);let r=run(slug,&[row.clone(),row.clone()]).unwrap();assert_eq!(r.len(),2);assert_eq!(r[0],r[1]);
        let mut bad=row.clone();bad[7]="null".into();assert!(run(slug,&[bad]).is_err());
        bad=row.clone();bad[4]="other-clock".into();assert!(run(slug,&[row.clone(),bad.clone()]).is_err());
        bad[3]="other-context".into();bad[0]="other-row".into();
        if *slug!=SLUGS[2] {assert!(run(slug,&[row.clone(),bad]).is_ok());} // response endpoints must also use the supplied clock
        bad=row.clone();bad[6]="guessed-default".into();assert!(run(slug,&[bad]).is_err());
        let mut h=HEADER.to_vec();h[3]="not_context";assert!(adapt(slug,&h,std::slice::from_ref(&row)).is_err());
        h=HEADER.to_vec();h[7]="participant_id";assert!(adapt(slug,&h,std::slice::from_ref(&row)).is_err());
        h=HEADER.to_vec();h.push("prepared_result_json");bad=row;bad.push("{}".into());assert!(adapt(slug,&h,&[bad]).is_err());
    }
}
#[test]
fn both_summary_owners_actual_sum_and_division_loss_regressions() {
    let mut outputs=Vec::new();
    for slug in &SLUGS[..2] {
        for values in [vec![1e16,1.0,-1e16],vec![1e16,1.0,-1e16,1.0],vec![0.0,0.0,f64::from_bits(1)]] {
            let mut input:Value=serde_json::from_str(&sample(slug,0)[7]).unwrap();
            input["members"]=json!(values.iter().enumerate().map(|(i,value)|json!({"observation_id":format!("e{i}"),"observed":true,"value":value})).collect::<Vec<_>>());
            outputs.push((slug,values,run(slug,&[with_input(slug,input)]).unwrap()[0].clone()));
        }
    }
    let failures=outputs.iter().filter(|(_,_,r)|!r["mean"].is_null()).map(|(slug,v,r)|format!("{slug} {v:?}: lost mean emitted {}",r["mean"])).collect::<Vec<_>>();
    assert!(failures.is_empty(),"{}",failures.join("; "));
    for (_,_,r) in outputs {assert_eq!(r["mean_status"],"arithmetic_unavailable");assert!(r["minimum"].is_number());assert!(r["maximum"].is_number());}
}
#[test]
fn both_summary_owners_arithmetic_loss_leaves_other_summaries_known() {
    for slug in &SLUGS[..2] {
        let make=|values:Vec<f64>| {
            let mut input:Value=serde_json::from_str(&sample(slug,0)[7]).unwrap();
            input["members"]=json!(values.iter().enumerate().map(|(i,value)|json!({"observation_id":format!("p{i}"),"observed":true,"value":value})).collect::<Vec<_>>());
            with_input(slug,input)
        };
        for (values,reason) in [
            (vec![1e16,1.0,-1e16],"accumulation_numeric_loss"),
            (vec![1e16,1.0,-1e16,1.0],"accumulation_numeric_loss"),
            (vec![0.0,0.0,f64::from_bits(1)],"division_to_zero_numeric_loss")
        ] {
            let out=run(slug,&[make(values.clone())]).unwrap();
            assert!(out[0]["mean"].is_null(),"{slug}: lost mean must be unavailable, not {}",out[0]["mean"]);
            assert_eq!(out[0]["mean_status"],"arithmetic_unavailable");assert_eq!(out[0]["mean_reason"],reason);
            assert_eq!(out[0]["minimum"].as_f64(),values.iter().copied().reduce(f64::min));
            assert_eq!(out[0]["maximum"].as_f64(),values.iter().copied().reduce(f64::max));
            if values.len()==3 {assert_eq!(out[0]["median"],if values[0]==0.0{0.0}else{1.0});}
            else {assert!(out[0]["median"].is_null());assert_eq!(out[0]["median_status"],"even_median_source_undefined");}
        }
        for (values,expected) in [(vec![1e16,-1e16,1.0],1.0/3.0),(vec![1e16,-1e16,0.0],0.0),
            (vec![1.0,-1.0,0.0],0.0),(vec![0.0,0.0,0.0],0.0),(vec![0.1,0.2],(0.1+0.2)/2.0)] {
            let out=run(slug,&[make(values)]).unwrap();assert_eq!(out[0]["mean"],expected);assert_eq!(out[0]["mean_status"],"known");assert!(out[0]["mean_reason"].is_null());
        }
        let out=run(slug,&[make(vec![])]).unwrap();assert_eq!(out[0]["mean_status"],"empty_membership_unavailable");assert!(out[0]["minimum"].is_null());
    }
}

#[test]
fn actual_public_native_runner_requires_source_parent_projection_and_exports_matching_bytes() {
    let options:PipelineV2OptionsJson=serde_json::from_value(json!({
        "study_name":"Retained communication source reductions","timezone":"UTC","usage_session_mode":"app_usage",
        "include_app_output":true,"include_screen_output":false,"use_filter_file":false,"use_apps_forcing_screen_open":false,"use_app_codebook":false,
        "correct_duplicate_event_timestamps":false,"allow_stop_event_reuse":false,"use_activity_stopped_as_fallback":true,"apply_threshold_to_fallback":true,
        "long_duration_threshold_ns":43_200_000_000_000_i64,"custom_app_engagement_duration":300.0,"long_data_time_gap_thresholds":[1.0,2.0],
        "long_usage_duration_thresholds":[1.0,2.0],"same_app_stop_types":["Activity Paused","Activity Resumed"],"other_stop_types":["Activity Resumed","Device Shutdown"],
        "interaction_types_to_remove":[],"screen_auto_lock_timeout_seconds":120.0,"screen_auto_lock_tolerance_seconds":30.0,"screen_manual_lock_max_tail_seconds":30.0,
        "screen_keyguard_near_stop_seconds":2.0,"datetime_of_preprocessing":"2026-09-30 00:00:00 UTC","minimum_usage_duration":0.0
    })).unwrap();
    let mut failures=Vec::new();
    for slug in SLUGS {
        let g=group(slug);let c=&g["cases"][0];let header=c["rawCsvLines"][0].as_str().unwrap().split(',').collect::<Vec<_>>();
        let raw=transport(&header,&[sample(slug,0)]);let expected=adapt(slug,&header,&[sample(slug,0)]).unwrap().0;
        let component=format!("chronicle.{slug}/v1");let sha=digest(&raw);
        let request=serde_json::to_string(&RuntimeRequest{
            protocol_version:RUNTIME_PROTOCOL_VERSION.into(),request_id:component.clone(),command:EXECUTE_WORKSPACE_COMMAND.into(),
            workspace_root_digest:None,workspace_id:sha.clone(),input_file_name:"qualified-communication-input.csv".into(),input_sha256:sha,
            known_review_summary_digests:None,participant_partition_batch_id:None,fragmented_participant_tokens:Vec::new(),
            method_profile_receipt:None,method_profile_receipts:Vec::new(),options:options.clone(),
            execution_engine: chronicle_preprocessing_runtime_wasm::ExecutionEngine::Sequential,
            provenance_evidence: false,
        }).unwrap();
        match execute_literature_component_native(&component,&request,&raw,&RuntimeSupportFiles::default()) {
            Err(e)=>failures.push(format!("{component}: {e}")),
            Ok(mut handle)=>{
                let(registration,_)=literature_component_execution_unit(&component).unwrap();let mut found=false;
                for i in 0..handle.artifact_count() {
                    let metadata:RuntimeArtifactMetadata=serde_json::from_str(&handle.artifact_metadata_json(i).unwrap()).unwrap();
                    let bytes=handle.take_artifact_bytes(i).unwrap();assert_eq!(metadata.digest,digest(&bytes));
                    if metadata.kind==registration.derived_result_kind {assert_eq!(bytes,expected);found=true;}
                }
                assert!(found,"source-derived CSV must be an ordinary runtime artifact");
            }
        }
    }
    assert!(failures.is_empty(),"Public native admission/export not yet established:\n{}",failures.join("\n"));
}
