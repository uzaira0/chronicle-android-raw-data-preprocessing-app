//! Chang source-located hand cases: printed p9, p11 Figure4a, p12 Figure5.
use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{adapt_literature_inputs,literature_component_execution_unit};
use sha2::{Digest,Sha256};
const G: &str = "chronicle.chang-supplied-attending-action-gaps/v1";
const M: &str = "chronicle.chang-supplied-occupancy-gap-mean/v1";
const GH: &str = "source_row_id,participant_id,coverage_scope_id,clock_id,attending_action_id,attending_role,source_order,timestamp_ns,input_stage";
const MH: &str = "source_row_id,participant_id,occupancy_id,clock_id,ringer_mode,occupancy_start_ns,occupancy_end_ns,start_attending_action_id,start_timestamp_ns,end_attending_action_id,end_timestamp_ns,input_stage";
fn csv(h: &str,rows: &[String])->Vec<u8> { (std::iter::once(h.to_owned()).chain(rows.iter().cloned()).collect::<Vec<_>>().join("\n")+"\n").into_bytes() }
fn g(id:&str,action:&str,order:u64,time:i64)->String { format!("{id},p,scope,clock,{action},wake_or_unlock,{order},{time},caller-qualified-ordered-general-attending-actions") }
fn m(id:&str,mode:&str,a:&str,start:i64,b:&str,end:i64)->String { format!("{id},p,occ,clock,{mode},0,10000000000,{a},{start},{b},{end},caller-qualified-successive-attending-pairs-strictly-inside-occupancy") }
fn replace(row:&str,index:usize,value:&str)->String { let mut r=row.split(',').map(str::to_owned).collect::<Vec<_>>();r[index]=value.into();r.join(",") }
fn run(component:&str,raw:&[u8])->Result<Vec<csv::StringRecord>,String>{
 let (registration,bindings)=literature_component_execution_unit(component)?;
 assert!(!bindings.is_empty());assert_eq!(registration.full_profile_execution_status,"blocked");
 let digest=format!("sha256:{}",hex::encode(Sha256::digest(raw)));
 let out=adapt_literature_inputs(raw,&digest,&bindings,|_| &[])?.ok_or("missing component")?;
 let bytes=out.derived_result_bytes.ok_or("missing export")?;
 let derived=out.receipt.derived_result.as_ref().unwrap();
 assert_eq!(derived.kind,registration.derived_result_kind);
 assert_eq!(derived.digest,format!("sha256:{}",hex::encode(Sha256::digest(&bytes))));
 assert_eq!(out.receipt.original_input_digest,digest);
 assert_eq!(out.receipt.duplicate_source_ids_removed,0);
 assert_eq!(out.receipt.source_oracle_id,Some(registration.source_oracle_id));
 assert_eq!(out.receipt.materialized_interval_count,0);
 let receipt=serde_json::to_value(&out.receipt).unwrap();
 assert_eq!(receipt["derivedResult"]["rowCount"],out.receipt.emitted_row_count);
 let rows=csv::Reader::from_reader(bytes.as_slice()).records().collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
 assert_eq!(rows.len(),out.receipt.emitted_row_count as usize);Ok(rows)
}
#[test]
fn successive_attending_actions_are_inter_action_gaps_not_notification_latencies(){
 let rows=run(G,&csv(GH,&[g(" first"," a",u64::MAX-2,0),g("second","b",u64::MAX-1,2_500_000_000),g("third","c",u64::MAX,4_000_000_000)])).unwrap();
 assert_eq!(rows.len(),2);assert_eq!((&rows[0][3],&rows[0][5]),(" first"," a"));
 assert_eq!((&rows[0][11],&rows[0][12]),("2500000000","2.5"));
 assert_eq!((&rows[1][11],&rows[1][12]),("1500000000","1.5"));
 let full=run(G,&csv(GH,&[g("a","a",0,i64::MIN),g("b","b",1,i64::MAX)])).unwrap();
 assert_eq!((&full[0][11],&full[0][12]),("18446744073709551615","18446744073.709551615"));
}
#[test]
fn attending_stream_edges_ties_missingness_roles_and_scope_never_become_defaults(){
 let first=g("a","a",0,0);let second=g("b","b",1,1);
 for bad in [replace(&second,1,"q"),replace(&second,2,"other"),replace(&second,3,"other"),replace(&second,4,"a"),
 replace(&second,5,"notification_arrival"),replace(&second,6,"0"),replace(&second,7,"0"),replace(&second,7,"-1"),
 replace(&second,7,"1.5"),replace(&second,7,""),replace(&second,8,"raw-callbacks")] {
 assert!(run(G,&csv(GH,&[first.clone(),bad])).is_err()); }
 for rows in [vec![],vec![first.clone()],vec![first.clone(),first]] {assert!(run(G,&csv(GH,&rows)).is_err());}
 assert!(run(G,&csv(&(GH.to_owned()+",source_row_id"),&[])).is_err());
}
#[test]
fn each_supplied_ringer_occupancy_mean_has_its_own_gap_denominator(){
 for mode in ["Normal","Vibrate","Silent"] {
 let a=m("a",mode,"a",1_000_000_000,"b",3_000_000_000);
 let b=m("b",mode,"b",3_000_000_000,"c",6_000_000_000);
 let rows=run(M,&csv(MH,&[a.clone(),b.clone()])).unwrap();
 assert_eq!(rows.len(),1);assert_eq!((&rows[0][3],&rows[0][6],&rows[0][7],&rows[0][8]),(mode,"2","2.5","0.041666666666666664"));
 let duplicate=run(M,&csv(MH,&[a.clone(),b,a])).unwrap();
 assert_eq!(&duplicate[0][6],"3");assert!((duplicate[0][7].parse::<f64>().unwrap()-7.0/3.0).abs()<1e-12);
 }
}
#[test]
fn occupancy_mean_refuses_unresolved_boundaries_and_inconsistent_source_identity(){
 let first=m("a","Silent","a",1,"b",3);
 for bad in [replace(&first,1,"q"),replace(&first,2,"other"),replace(&first,3,"other"),replace(&first,4,"silent"),
 replace(&first,5,"1"),replace(&first,6,"3"),replace(&first,8,"0"),replace(&first,10,"10000000000"),
 replace(&first,10,"1"),replace(&first,10,"0"),replace(&first,8,""),replace(&first,11,"raw-ringer-events")] {
 assert!(run(M,&csv(MH,&[first.clone(),bad])).is_err()); }
 assert!(run(M,&csv(MH,&[first.clone(),replace(&first,8,"2")])).is_err());
 assert!(run(M,&csv(MH,&[])).is_err());
 assert!(run(M,&csv(&(MH.to_owned()+",source_row_id"),&[])).is_err());
 let lexical=replace(&replace(&first,2," NA"),0," same");
 let rows=run(M,&csv(MH,&[lexical])).unwrap();assert_eq!(&rows[0][1]," NA");
}

#[test]
fn every_old_shared_predicate_preserves_literal_row_identity_and_rejects_ambiguous_headers() {
 let contract:serde_json::Value=serde_json::from_str(include_str!("../../../web/schema/literature-input-adapter-contract.json")).unwrap();
 let fixtures:serde_json::Value=serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap();
 let groups=contract["groups"].as_array().unwrap().iter().filter(|g|
   g["componentExecution"]["derivedResultKind"]=="literature-source-bound-scalar-predicate-csv"
   && !g["adapterId"].as_str().unwrap().contains("-supplied-"));
 let mut count=0;
 for group in groups {
   count+=1;
   let component=group["componentExecution"]["componentId"].as_str().unwrap();
   let fixture=fixtures["groups"].as_array().unwrap().iter().find(|g|g["adapterId"]==component).unwrap();
   let lines=fixture["cases"][0]["rawCsvLines"].as_array().unwrap();
   let raw=lines.iter().map(|v|v.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n";
   let mut reader=csv::Reader::from_reader(raw.as_bytes());
   let headers=reader.headers().unwrap().clone();
   let row=reader.records().next().unwrap().unwrap();
   let id_column=headers.iter().position(|h|h=="source_row_id").unwrap();
   let numeric_column=headers.iter().position(|h|h==group["componentConfig"]["inputField"].as_str().unwrap()).unwrap();
   let make=|id:&str| {row.iter().enumerate().map(|(i,v)|if i==id_column{id.to_owned()}else if i==numeric_column{format!(" {v} ")}else{v.to_owned()}).collect::<Vec<_>>()};
   let mut writer=csv::Writer::from_writer(Vec::new());writer.write_record(&headers).unwrap();
   for id in [" row ", "row", "NA", " row "] {writer.write_record(make(id)).unwrap();}
   let bytes=writer.into_inner().unwrap();let out=run(component,&bytes).unwrap();
   assert_eq!(out.len(),4,"{component}");
   assert_eq!(out.iter().map(|r|&r[0]).collect::<Vec<_>>(),vec![" row ","row","NA"," row "],"{component}");
   for id in ["", "   "] {
     let mut w=csv::Writer::from_writer(Vec::new());w.write_record(&headers).unwrap();w.write_record(make(id)).unwrap();
     assert!(run(component,&w.into_inner().unwrap()).is_err(),"{component}");
   }
   let mut duplicate=headers.clone();duplicate.push_field("source_row_id");
   let mut w=csv::Writer::from_writer(Vec::new());w.write_record(&duplicate).unwrap();
   assert!(run(component,&w.into_inner().unwrap()).is_err(),"{component}");
 }
 assert_eq!(count,62,"all prior aliases must remain covered");
}

#[test]
fn prepared_predicate_boundaries_use_independent_values_and_exact_source_stages() {
 let fixtures:serde_json::Value=serde_json::from_str(include_str!("fixtures/literature_input_adapter_conformance.json")).unwrap();
 for (component,field,domain,stage) in [
   ("chronicle.pulse-supplied-off-elapsed-criterion/v1", "off_elapsed_seconds", "finite_nonnegative", "caller-qualified-pulse-screen-off-elapsed"),
   ("chronicle.pulse-supplied-entry-criterion/v1", "entered_pulse", "boolean", "caller-qualified-explicit-pulse-entry"),
   ("chronicle.mathur-supplied-no-unlock-predicate/v1", "has_unlock", "boolean", "caller-qualified-sessionlogger-unlock-presence"),
   ("chronicle.mathur-supplied-merge-eligibility/v1", "session_separation_seconds", "finite_nonnegative", "caller-qualified-sessionlogger-session-separation"),
   ("chronicle.rodrigues-supplied-passive-char-predicate/v1", "passive_character_count", "unsigned_integer", "caller-qualified-passive-character-count"),
   ("chronicle.rodrigues-supplied-passive-wordcount-predicate/v1", "passive_wordcount_mismatch", "boolean", "caller-qualified-passive-wordcount-mismatch"),
   ("chronicle.rodrigues-supplied-passive-hold-predicate/v1", "passive_mean_hold_seconds", "finite_nonnegative", "caller-qualified-passive-mean-hold"),
 ] {
   let fixture=fixtures["groups"].as_array().unwrap().iter().find(|g|g["adapterId"]==component).unwrap();
   let case=&fixture["cases"][0];
   let lines=case["rawCsvLines"].as_array().unwrap();
   let raw=lines.iter().map(|v|v.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n";
   let rows=run(component,raw.as_bytes()).unwrap();
   let actual=rows.iter().map(|r|r.iter().collect::<Vec<_>>().join(",")).collect::<Vec<_>>();
   assert_eq!(actual,case["expected"]["outputContains"].as_array().unwrap().iter().map(|v|v.as_str().unwrap().to_owned()).collect::<Vec<_>>(),"{component}");
   let h=format!("source_row_id,{field},input_stage");
   let value=if domain=="boolean"{"true"}else{"1"};
   let duplicate=csv(&h,&[format!(" literal ,{value},{stage}"),format!("literal,{value},{stage}"),format!(" literal ,{value},{stage}")]);
   let out=run(component,&duplicate).unwrap();
   assert_eq!(out.iter().map(|r|&r[0]).collect::<Vec<_>>(),vec![" literal ","literal"," literal "],"{component}");
   for bad_stage in ["", "raw-callbacks", "caller-qualified-experience-task", "caller-qualified-quantapp-app-episode"] {
     assert!(run(component,&csv(&h,&[format!("a,{value},{bad_stage}")])).is_err(),"{component}");
   }
   for invalid in ["", "NaN", "inf", "-1", "TRUE", "false-as-zero"] {
     assert!(run(component,&csv(&h,&[format!("a,{invalid},{stage}")])).is_err(),"{component}");
   }
   assert!(run(component,&csv(&(h.clone()+",input_stage"),&[])).is_err(),"{component}");
   assert!(run(component,&csv(&format!("source_row_id,{field}"),&[format!("a,{value}")])).is_err(),"{component}");
   if domain=="unsigned_integer" {
     assert!(run(component,&csv(&h,&[format!("a,9.5,{stage}")])).is_err());
     let big=run(component,&csv(&h,&[format!("a,18446744073709551615,{stage}")])).unwrap();
     assert_eq!(&big[0][2],"not_discarded_by_short_trial_predicate");
     assert!(run(component,&csv(&h,&[format!("a,18446744073709551616,{stage}")])).is_err());
   }
 }
}

#[test]
fn exact_equality_neighbors_do_not_acquire_tolerance_or_unknown_combined_policies() {
 for (component,field,stage,boundary,equal,above) in [
   ("chronicle.pulse-supplied-off-elapsed-criterion/v1","off_elapsed_seconds","caller-qualified-pulse-screen-off-elapsed",30.0,"off_duration_criterion_not_met","off_duration_criterion_met"),
   ("chronicle.mathur-supplied-merge-eligibility/v1","session_separation_seconds","caller-qualified-sessionlogger-session-separation",5.0,"merge_eligible","not_merge_eligible"),
   ("chronicle.rodrigues-supplied-passive-hold-predicate/v1","passive_mean_hold_seconds","caller-qualified-passive-mean-hold",1.0,"not_discarded_by_mean_hold_predicate","discard_passive_mean_hold_gt_one_second"),
 ] {
   let h=format!("source_row_id,{field},input_stage");
   let boundary:f64=boundary;
   let next=f64::from_bits(boundary.to_bits()+1);
   let previous=f64::from_bits(boundary.to_bits()-1);
   let rows=run(component,&csv(&h,&[format!("previous,{previous},{stage}"),format!("equal,{boundary},{stage}"),format!("next,{next},{stage}")])).unwrap();
   assert_eq!((&rows[1][2],&rows[2][2]),(equal,above));
   assert_ne!(&rows[0][2],above);
 }
}

#[test]
fn known_supplied_succession_contradictions_fail_without_constructing_or_selecting_pairs() {
 let mut accepted=Vec::new();
 for (case,first,second) in [
   ("branch",m("first","Silent","a",1_000_000_000,"b",3_000_000_000),m("second","Silent","a",1_000_000_000,"c",6_000_000_000)),
   ("predecessor",m("first","Silent","a",1_000_000_000,"c",6_000_000_000),m("second","Silent","b",3_000_000_000,"c",6_000_000_000)),
   ("cross",m("first","Silent","a",1_000_000_000,"b",4_000_000_000),m("second","Silent","c",2_000_000_000,"d",5_000_000_000)),
   ("nest",m("first","Silent","a",1_000_000_000,"d",8_000_000_000),m("second","Silent","b",2_000_000_000,"c",4_000_000_000)),
   ("equal_time_distinct_successors",m("first","Silent","a",1_000_000_000,"b",3_000_000_000),m("second","Silent","a",1_000_000_000,"c",3_000_000_000)),
   ("equal_time_distinct_predecessors",m("first","Silent","a",1_000_000_000,"c",3_000_000_000),m("second","Silent","b",1_000_000_000,"c",3_000_000_000)),
 ] {
   if run(M,&csv(MH,&[first,second])).is_ok(){accepted.push(case);}
 }
 assert!(accepted.is_empty(),"accepted contradictory supplied succession: {accepted:?}");
}

#[test]
fn declared_pairs_keep_duplicate_weight_and_order_without_gap_fill_or_missing_anchor_inference() {
 let first=m(" first ","Silent","a",1_000_000_000,"b",3_000_000_000);
 let second=m("second","Silent","b",3_000_000_000,"c",6_000_000_000);
 let rows=run(M,&csv(MH,&[second.clone(),first.clone(),first.clone()])).unwrap();
 assert_eq!(&rows[0][6],"3");assert!((rows[0][7].parse::<f64>().unwrap()-7.0/3.0).abs()<1e-12);
 let lone=run(M,&csv(MH,&[first.clone(),first])).unwrap();
 assert_eq!((&lone[0][6],&lone[0][7]),("2","2"));
 // Separate supplied chains do not establish an unavailable middle pair.
 let detached=m("detached","Silent","d",7_000_000_000,"e",9_000_000_000);
 let detached_rows=run(M,&csv(MH,&[second,detached])).unwrap();
 assert_eq!((&detached_rows[0][6],&detached_rows[0][7]),("2","2.5"));
}
