//! Source-located independent hand expectations, replayed through the pure
//! boundary and the ordinary registered CSV/receipt/derived-export dispatcher.
use super::*;
use crate::literature_input_adapters::{adapt_literature_inputs,literature_component_execution_unit};
use sha2::{Digest,Sha256};
const HAND: &str = include_str!("../tests/fixtures/release_prepared_reductions.json");
const FLEET_REPAIR: &str = include_str!("../tests/fixtures/release_prepared_fleet_inventory_repair.json");
fn digest(bytes: &[u8]) -> String {format!("sha256:{}",hex::encode(Sha256::digest(bytes)))}
fn verify(case: &Value, result: Result<(Vec<u8>,usize,usize),String>) {
    let id=case["id"].as_str().unwrap();
    if let Some(reason)=case["expected"]["errorContains"].as_str() {
        let err=result.expect_err(id);assert!(err.contains(reason),"{id}: {err} lacks {reason}");return;
    }
    let (bytes,sources,outputs)=result.unwrap_or_else(|e|panic!("{id}: {e}"));
    assert_eq!(sources,case["rawCsvLines"].as_array().unwrap().len()-1,"{id}");
    let mut reader=csv::Reader::from_reader(bytes.as_slice());
    assert_eq!(reader.headers().unwrap().iter().collect::<Vec<_>>(),OUTPUT_FIELDS,"{id}");
    let rows=reader.records().collect::<Result<Vec<_>,_>>().unwrap();assert_eq!(rows.len(),outputs,"{id}");
    if let Some(n)=case["expected"]["outputRowCount"].as_u64(){assert_eq!(outputs,n as usize,"{id}");}
    for check in case["expected"]["checks"].as_array().unwrap() {
        let found=rows.iter().any(|r| &r[5]==check["kind"].as_str().unwrap()
            && &r[6]==check["member"].as_str().unwrap() && &r[7]==check["position"].as_str().unwrap()
            && &r[8]==check["value"].as_str().unwrap() && &r[9]==check["status"].as_str().unwrap()
            && &r[11]==check["members"].as_str().unwrap()
            && check.get("device").and_then(Value::as_str).is_none_or(|d|&r[2]==d)
            && check.get("participant").and_then(Value::as_str).is_none_or(|d|&r[1]==d));
        assert!(found,"{id}: missing {check}; rows={rows:?}");
    }
}
fn raw(case: &Value) -> Vec<u8> {(case["rawCsvLines"].as_array().unwrap().iter().map(|x|x.as_str().unwrap()).collect::<Vec<_>>().join("\n")+"\n").into_bytes()}
#[test]
fn release_prepared_reductions_source_hand_math() {
    let hand:Value=serde_json::from_str(HAND).unwrap();
    let repair:Value=serde_json::from_str(FLEET_REPAIR).unwrap();
    let mut unexpected_acceptance=Vec::new();
    for case in hand["cases"].as_array().unwrap().iter().chain(repair["cases"].as_array().unwrap()) {
        let result=reduce(case["adapter"].as_str().unwrap(),&raw(case));
        if case["expected"]["errorContains"].is_string() && result.is_ok() {unexpected_acceptance.push(case["id"].as_str().unwrap());continue;}
        verify(case,result);
    }
    assert!(unexpected_acceptance.is_empty(),"unexpected accepted inventories: {unexpected_acceptance:?}");
    // Existing callers retain the same exact count ordering and ratio errors.
    let old=crate::grouped_distinct_count::count_distinct_members_by_group([(2,"b"),(1,"a"),(2,"b"),(2,"a")]);
    assert_eq!(old.iter().map(|x|(x.group,x.distinct_member_count)).collect::<Vec<_>>(),[(1,1),(2,2)]);
    for (terms,error) in [(vec![],crate::count_ratio::CountRatioError::MissingDenominatorTerms),
        (vec![0],crate::count_ratio::CountRatioError::ZeroDenominator),
        (vec![u64::MAX,1],crate::count_ratio::CountRatioError::DenominatorOverflow)] {
        assert_eq!(construct_named_count_ratios([CountRatioRequest{name:"old",numerator:2,denominator_terms:terms}]),Err(error));
    }
    assert_eq!(construct_named_count_ratios([CountRatioRequest{name:"old",numerator:2,denominator_terms:vec![1,3]}]).unwrap()[0].ratio.value(),0.5);
    assert_eq!(checked_count_sum(&[]),Ok(0));
    assert_eq!(filter_active(&serde_json::json!([{ "packageName":"ab","groupKeyCompat":"c","isGroupSummaryCompat":true },
        { "packageName":"a","groupKeyCompat":"bc","isGroupSummaryCompat":false }])).unwrap().len(),1);
}
#[test]
fn release_prepared_reductions_registered_csv_export() {
    let hand:Value=serde_json::from_str(HAND).unwrap();
    let repair:Value=serde_json::from_str(FLEET_REPAIR).unwrap();
    let mut unexpected_acceptance=Vec::new();
    for case in hand["cases"].as_array().unwrap().iter().chain(repair["cases"].as_array().unwrap()) {
        let input=raw(case);let adapter=case["adapter"].as_str().unwrap();
        let (registration,bindings)=literature_component_execution_unit(&format!("{adapter}/v1")).unwrap();
        assert_eq!(registration.full_profile_execution_status,"blocked");
        assert!(!registration.limitations.is_empty());
        let result=adapt_literature_inputs(&input,&digest(&input),&bindings, |_|&[]).map(|r| {
            let r=r.expect("registered route result");let bytes=r.derived_result_bytes.expect("ordinary derived export");
            let d=r.receipt.derived_result.as_ref().unwrap();
            assert_eq!(d.kind,registration.derived_result_kind);assert_eq!(d.digest,digest(&bytes));
            assert_eq!(r.csv_bytes,bytes);assert_eq!(r.receipt.adapted_input_digest,digest(&bytes));
            assert_eq!(r.receipt.original_input_digest,digest(&input));
            assert_eq!(r.receipt.source_oracle_id,Some(registration.source_oracle_id));
            assert_eq!(r.receipt.materialized_interval_count,0);assert_eq!(r.receipt.duplicate_source_ids_removed,0);
            assert_eq!(r.receipt.participants_removed,0);assert_eq!(r.receipt.mapped_event_row_count,0);
            assert_eq!(d.row_count,r.receipt.emitted_row_count);
            (bytes,r.receipt.source_row_count as usize,r.receipt.emitted_row_count as usize)
        });
        if case["expected"]["errorContains"].is_string() && result.is_ok() {unexpected_acceptance.push(case["id"].as_str().unwrap());continue;}
        verify(case,result);
    }
    assert!(unexpected_acceptance.is_empty(),"unexpected accepted inventories: {unexpected_acceptance:?}");
    assert_eq!(ADAPTERS.len(),9);
}
