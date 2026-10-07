//! Independent literal membership/maximum oracles from existing primary papers.
//! Xu2020 DOI10.1007/s42486-020-00045-z text101:171–200,386–409:
//! .tmp-literature-review-private/corrective-packet-04-ranks-074-123-20260831/text/101.txt
//! SHA256 2575dc7e6fd36befba46a2b7baae752e32ef4c77336044f1ed330e22524c26a6.
//! Hiniker2016 DOI10.1145/2971648.2971762 physical PDF6–7/printed639–640:
//! .tmp-literature-review-private/ontology-sublation-20260831/work/new-source-audits/sources/hiniker-2016-why-would-you-do-that.pdf
//! SHA256 fcc5170ca754796483aa55519cbc84195bbc903db27d5c9a5891f28b135e2075.
//! Supplied stage/identity/unit declarations are not original collector proofs.

use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const VECTOR: &str = "chronicle.ordered-app-presence-vector/v1";
const LONGEST: &str = "chronicle.supplied-pre-sample-longest-window/v1";
const VECTOR_HEADER: [&str; 8] = [
    "source_row_id", "participant_id", "snapshot_id", "vocabulary_id", "vocabulary_stage",
    "ordered_app_vocabulary_json", "app_presence_stage", "observed_app_presence_json",
];
const LONGEST_HEADER: [&str; 7] = [
    "source_row_id", "participant_id", "source_session_id", "sample_id", "duration_unit_id",
    "window_input_stage", "pre_sample_windows_json",
];

fn vector_row(vocabulary: &str, presence: &str) -> Vec<String> {
    ["r", "p", "snapshot", "vocabulary", "caller_supplied_ordered_vocabulary",
        vocabulary, "caller_supplied_app_presence_set", presence]
        .into_iter().map(str::to_owned).collect()
}
fn window(id: &str, app: &str, duration: f64, unit: &str) -> Value {
    json!({"window_id":id,"app_id":app,"duration":duration,"duration_unit_id":unit})
}
fn longest_row(windows: Value) -> Vec<String> {
    ["r", "p", "session", "sample", "caller-seconds",
        "caller_qualified_pre_sample_windows", &windows.to_string()]
        .into_iter().map(str::to_owned).collect()
}
fn transport(header: &[&str], rows: &[Vec<String>]) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(header).unwrap();
    for row in rows { writer.write_record(row).unwrap(); }
    writer.into_inner().unwrap()
}
fn adapt(component: &str, raw: &[u8]) -> Result<Vec<csv::StringRecord>, String> {
    let (registration, bindings) = literature_component_execution_unit(component)?;
    assert_eq!(registration.full_profile_execution_status, "blocked");
    let mut settings = bindings.iter().map(|binding| binding.setting_id.as_str()).collect::<Vec<_>>();
    settings.sort();
    assert_eq!(settings, if component == VECTOR {
        vec!["method-setting-889fc74d1f6f91c743a09654"]
    } else {
        vec!["method-setting-b84b4b434764a3112e597f66", "method-setting-ed07f45b174ec86eab70becd"]
    });
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
    let result = adapt_literature_inputs(raw, &digest, &bindings, |_| &[])?
        .ok_or("missing bounded source component output")?;
    assert_eq!(result.receipt.original_input_digest, digest);
    assert_eq!(result.receipt.source_oracle_id, Some(registration.source_oracle_id));
    assert_eq!(result.receipt.materialized_interval_count, 0);
    assert_eq!(result.receipt.duplicate_source_ids_removed, 0, "no input rows are removed");
    let bytes = result.derived_result_bytes.ok_or("missing derived CSV")?;
    let derived = result.receipt.derived_result.expect("normal derived-result receipt");
    assert_eq!(derived.kind, registration.derived_result_kind);
    assert_eq!(derived.digest, format!("sha256:{}", hex::encode(Sha256::digest(&bytes))));
    let rows: Vec<csv::StringRecord> = csv::Reader::from_reader(bytes.as_slice()).records()
        .collect::<Result<_, _>>().map_err(|error| error.to_string())?;
    assert_eq!(result.receipt.source_row_count as usize, rows.len());
    assert_eq!(result.receipt.emitted_row_count as usize, rows.len());
    assert_eq!(derived.row_count as usize, rows.len());
    Ok(rows)
}

#[test]
fn vector_is_n_length_exact_membership_in_supplied_order_not_lexical_order() {
    for (vocabulary, presence, expected, n) in [
        (r#"["C","A","B"]"#, r#"["B","B","C"]"#, "[1,0,1]", "3"),
        (r#"["B","A"]"#, r#"["A"]"#, "[0,1]", "2"),
        (r#"["A","B"]"#, r#"["A"]"#, "[1,0]", "2"),
        (r#"["C","A","B"]"#, "[]", "[0,0,0]", "3"),
        ("[]", "[]", "[]", "0"),
    ] {
        let rows = adapt(VECTOR, &transport(&VECTOR_HEADER, &[vector_row(vocabulary, presence)])).unwrap();
        assert_eq!((&rows[0][8], &rows[0][9]), (expected, n));
    }
}

#[test]
fn vector_preserves_lexical_package_identity_duplicates_and_participant_scope() {
    let first = vector_row(r#"["org.A","org.a","org.A ","é","e\u0301"]"#,
                           r#"["org.a","org.A ","e\u0301","org.a"]"#);
    let mut other = vector_row(r#"["other"]"#, r#"["other"]"#); other[1] = "other-participant".into();
    let rows = adapt(VECTOR, &transport(&VECTOR_HEADER, &[first.clone(), first, other])).unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(&rows[0][8], "[0,1,1,0,1]");
    assert_eq!(&rows[1][8], "[0,1,1,0,1]");
    assert_eq!(&rows[2][8], "[1]");
}

#[test]
fn vector_refuses_missing_vocabulary_unknown_dimensions_and_identity_conflicts() {
    for bad in ["", "null", "[null]", "[1]", "{}"] {
        assert!(adapt(VECTOR, &transport(&VECTOR_HEADER, &[vector_row(bad, "[]")])).unwrap_err().contains("JSON array"));
        assert!(adapt(VECTOR, &transport(&VECTOR_HEADER, &[vector_row("[]", bad)])).unwrap_err().contains("JSON array"));
    }
    for (vocabulary, presence, message) in [
        (r#"["A","A"]"#, "[]", "distinct ordered"),
        (r#"["A"]"#, r#"["B"]"#, "outside supplied"),
        (r#"[""]"#, "[]", "nonempty app"),
    ] {
        assert!(adapt(VECTOR, &transport(&VECTOR_HEADER, &[vector_row(vocabulary, presence)])).unwrap_err().contains(message));
    }
    for (column, value, message) in [(0,"","identities"),(4,"infer_from_first_seen","stages"),(6,"collector_raw_events","stages")] {
        let mut row = vector_row(r#"["A"]"#, "[]"); row[column] = value.into();
        assert!(adapt(VECTOR, &transport(&VECTOR_HEADER, &[row])).unwrap_err().contains(message));
    }
    let first = vector_row(r#"["A","B"]"#, r#"["A"]"#);
    let changed_order = vector_row(r#"["B","A"]"#, r#"["A"]"#);
    assert!(adapt(VECTOR, &transport(&VECTOR_HEADER, &[first.clone(),changed_order])).unwrap_err().contains("vocabulary order"));
    let changed_presence = vector_row(r#"["A","B"]"#, r#"["B"]"#);
    assert!(adapt(VECTOR, &transport(&VECTOR_HEADER, &[first,changed_presence])).unwrap_err().contains("snapshot app presence"));
}

#[test]
fn longest_selects_one_window_not_per_app_total_and_is_order_independent() {
    let candidates = vec![window("A","chat",1.25,"caller-seconds"),
                          window("B","reading",2.5,"caller-seconds"),
                          window("C","chat",2.0,"caller-seconds")];
    for windows in [json!(candidates), json!([candidates[2],candidates[1],candidates[0]])] {
        let rows = adapt(LONGEST, &transport(&LONGEST_HEADER, &[longest_row(windows)])).unwrap();
        assert_eq!((&rows[0][7],&rows[0][8],&rows[0][9],&rows[0][10]),
                   ("unique_maximum","B","reading","2.5"));
    }
}

#[test]
fn tied_window_owner_is_undefined_even_for_same_app_but_max_scalar_is_known() {
    for apps in [("same","same"),("A","B")] {
        let rows = adapt(LONGEST, &transport(&LONGEST_HEADER, &[longest_row(json!([
            window("first",apps.0,2.5,"caller-seconds"),window("second",apps.1,2.5,"caller-seconds")
        ]))])).unwrap();
        assert_eq!((&rows[0][7],&rows[0][8],&rows[0][9],&rows[0][10]),
                   ("source_undefined_tied_argmax","","","2.5"));
    }
    let rows = adapt(LONGEST, &transport(&LONGEST_HEADER, &[longest_row(json!([]))])).unwrap();
    assert_eq!((&rows[0][7],&rows[0][8],&rows[0][9],&rows[0][10]),
               ("source_undefined_no_windows","","",""));
    let rows = adapt(LONGEST, &transport(&LONGEST_HEADER, &[longest_row(json!([
        window("zero","zero-app",0.0,"caller-seconds")
    ]))])).unwrap();
    assert_eq!((&rows[0][7],&rows[0][8],&rows[0][9],&rows[0][10]),
               ("unique_maximum","zero","zero-app","0"));
}

#[test]
fn longest_has_no_epsilon_and_retains_supplied_units_and_app_identity() {
    let rows = adapt(LONGEST, &transport(&LONGEST_HEADER, &[longest_row(json!([
        window("first","org.app",1.0,"caller-seconds"),
        window("second","org.app ",1.0000000000000002,"caller-seconds")
    ]))])).unwrap();
    assert_eq!((&rows[0][8],&rows[0][9],&rows[0][10]),("second","org.app ","1.0000000000000002"));
    let mut row = longest_row(json!([window("w","app",2500.0,"caller-milliseconds")]));
    row[4] = "caller-milliseconds".into();
    let rows = adapt(LONGEST, &transport(&LONGEST_HEADER, &[row])).unwrap();
    assert_eq!((&rows[0][4],&rows[0][10]),("caller-milliseconds","2500"));
}

#[test]
fn windows_are_scoped_to_session_sample_and_may_change_in_later_contexts() {
    let first = longest_row(json!([window("same-physical-window","app",1.0,"caller-seconds")]));
    let mut later = longest_row(json!([window("same-physical-window","app",2.0,"caller-seconds")]));
    later[3] = "later-sample".into();
    let mut other_session = longest_row(json!([window("same-physical-window","app",3.0,"caller-seconds")]));
    other_session[2] = "other-session".into();
    let mut other_person = longest_row(json!([window("same-physical-window","app",4.0,"caller-seconds")]));
    other_person[1] = "other-person".into();
    let rows = adapt(LONGEST, &transport(&LONGEST_HEADER, &[first.clone(),first.clone(),later,other_session,other_person])).unwrap();
    assert_eq!(rows.iter().map(|row| &row[10]).collect::<Vec<_>>(),["1","1","2","3","4"]);
    let changed_same_context = longest_row(json!([window("same-physical-window","app",2.0,"caller-seconds")]));
    assert!(adapt(LONGEST,&transport(&LONGEST_HEADER,&[first,changed_same_context])).unwrap_err().contains("conflicting supplied sample-context"));
}

#[test]
fn longest_refuses_unqualified_missing_duplicate_or_incoherent_candidates() {
    for bad in ["","null","[null]","[1]","{}",r#"[{"window_id":"w","app_id":"a","duration":null,"duration_unit_id":"caller-seconds"}]"#,
                r#"[{"window_id":"w","app_id":"a","duration":"NaN","duration_unit_id":"caller-seconds"}]"#,
                r#"[{"window_id":"w","app_id":"a","duration":1e400,"duration_unit_id":"caller-seconds"}]"#] {
        let mut row = longest_row(json!([])); row[6] = bad.into();
        assert!(adapt(LONGEST,&transport(&LONGEST_HEADER,&[row])).unwrap_err().contains("JSON array"));
    }
    for (windows,message) in [
        (json!([window("w","a",-1.0,"caller-seconds")]),"nonnegative"),
        (json!([window("w","a",1.0,"milliseconds")]),"matching supplied duration units"),
        (json!([window("w","a",1.0,"caller-seconds"),window("w","a",1.0,"caller-seconds")]),"duplicate candidate"),
        (json!([window("","a",1.0,"caller-seconds")]),"window/app identities"),
    ] {
        assert!(adapt(LONGEST,&transport(&LONGEST_HEADER,&[longest_row(windows)])).unwrap_err().contains(message));
    }
    for (column,value,message) in [(1,"","identities"),(2,"","identities"),(3,"","identities"),(4,"","identities"),(5,"all_session_windows","pre-sample")] {
        let mut row = longest_row(json!([])); row[column]=value.into();
        assert!(adapt(LONGEST,&transport(&LONGEST_HEADER,&[row])).unwrap_err().contains(message));
    }
}

#[test]
fn new_components_refuse_duplicate_headers_precomputed_outputs_and_missing_columns() {
    for (component,header,row,derived) in [
        (VECTOR,VECTOR_HEADER.as_slice(),vector_row("[]","[]"),"app_presence_vector_json"),
        (LONGEST,LONGEST_HEADER.as_slice(),longest_row(json!([])),"longest_window_duration"),
    ] {
        let mut duplicate=header.to_vec();duplicate.push(header[0]);
        let mut extended=row.clone();extended.push("unused".into());
        assert!(adapt(component,&transport(&duplicate,&[extended.clone()])).unwrap_err().contains("duplicate"));
        let mut supplied=header.to_vec();supplied.push(derived);
        assert!(adapt(component,&transport(&supplied,&[extended])).unwrap_err().contains("supplied"));
        assert!(adapt(component,&transport(&header[..header.len()-1],&[row[..row.len()-1].to_vec()])).is_err());
    }
}
