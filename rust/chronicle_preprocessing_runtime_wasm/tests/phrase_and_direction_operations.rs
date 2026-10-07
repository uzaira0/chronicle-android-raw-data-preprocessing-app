//! Tiny independent set/run oracles, not original participant records.
//! Teng2024 primary PDF physical p4 §3.3 and p5 Figure3:
//! .tmp-literature-review-private/ontology-sublation-20260831/work/new-source-audits/screen-text-sensor-2024.pdf
//! SHA256 49e3eee4aa4957fc636e08fc464d80044bc594ab918c44d3507bf1cae3f4982a.
//! BoD2013 text349:235–247/254–263 (printed p2392; physical PDF p4):
//! .tmp-literature-review-private/corrective-packet-09-ranks330-381-20260831/text/349.txt
//! SHA256 e8b429165176c0bcd5cdfff6ae1208290865969858aed16d377d72a5445ddc18.
//! Tests own expected values literally; they do not reuse the set/run operators.

use chronicle_preprocessing_runtime_wasm::literature_input_adapters::{
    adapt_literature_inputs, literature_component_execution_unit,
};
use sha2::{Digest, Sha256};

const PHRASES: &str = "chronicle.accessibility-phrase-set-difference/v1";
const DIRECTIONS: &str = "chronicle.bod-shape-direction-run-collapse/v1";
const PHRASE_HEADER: [&str; 9] = [
    "source_row_id", "previous_participant_id", "current_participant_id",
    "previous_screen_id", "current_screen_id", "previous_phrases_json",
    "current_phrases_json", "phrase_input_stage", "screen_pairing_stage",
];
const DIRECTION_HEADER: [&str; 6] = [
    "source_row_id", "participant_id", "shape_id", "shape_boundary",
    "direction_input_stage", "recognized_directions_json",
];

fn phrase_row(previous: &str, current: &str) -> Vec<String> {
    ["r", "p", "p", "first", "second", previous, current,
        "caller_supplied_accessibility_phrases", "caller_resolved_sequential_screens"]
        .into_iter().map(str::to_owned).collect()
}

fn direction_row(shape: &str, directions: &str) -> Vec<String> {
    [shape, "p", shape, "finger_lift", "caller_supplied_recognized_directions", directions]
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
    assert_eq!(bindings.len(), 1, "owns only the narrow set/run source setting");
    let digest = format!("sha256:{}", hex::encode(Sha256::digest(raw)));
    let result = adapt_literature_inputs(raw, &digest, &bindings, |_| &[])?
        .ok_or("missing bounded source component")?;
    assert_eq!(result.receipt.original_input_digest, digest);
    assert_eq!(result.receipt.source_oracle_id, Some(registration.source_oracle_id));
    assert_eq!(result.receipt.materialized_interval_count, 0);
    assert_eq!(result.receipt.duplicate_source_ids_removed, 0, "no input rows are removed");
    let bytes = result.derived_result_bytes.ok_or("missing derived CSV")?;
    let rows: Vec<csv::StringRecord> = csv::Reader::from_reader(bytes.as_slice())
        .records().collect::<Result<_, _>>().map_err(|error| error.to_string())?;
    assert_eq!(result.receipt.source_row_count as usize, rows.len());
    assert_eq!(result.receipt.emitted_row_count as usize, rows.len());
    Ok(rows)
}

#[test]
fn paper_phrase_example_includes_removed_and_added_sets() {
    for (previous, current) in [(r#"["A","B"]"#, r#"["B","C","D"]"#),
                               (r#"["B","C","D"]"#, r#"["A","B"]"#)] {
        let rows = adapt(PHRASES, &transport(&PHRASE_HEADER, &[phrase_row(previous, current)])).unwrap();
        assert_eq!((&rows[0][9], &rows[0][10]), (r#"["A","C","D"]"#, "3"));
    }
}

#[test]
fn phrase_identity_is_exact_and_duplicates_are_set_membership_only() {
    // Uppercase, spaces and composed/decomposed Unicode remain distinct phrases.
    let rows = adapt(PHRASES, &transport(&PHRASE_HEADER, &[phrase_row(
        r#"["A","A","é","x ","A B"]"#, r#"["a","e\u0301","x","A","B"]"#,
    )])).unwrap();
    let difference: Vec<String> = serde_json::from_str(&rows[0][9]).unwrap();
    assert_eq!(difference, vec!["A B", "B", "a", "e\u{301}", "x", "x ", "é"]);
    assert_eq!(&rows[0][10], "7");
    // Multiplicity and list order are irrelevant inside each screen set.
    let rows = adapt(PHRASES, &transport(&PHRASE_HEADER, &[phrase_row(
        r#"["A","A","B"]"#, r#"["B","A"]"#,
    )])).unwrap();
    assert_eq!((&rows[0][9], &rows[0][10]), ("[]", "0"));
}

#[test]
fn explicit_empty_phrase_sets_are_not_missing_and_pairs_are_not_reordered() {
    for (previous, current, expected, count) in [
        ("[]", "[]", "[]", "0"), ("[]", r#"[""]"#, r#"[""]"#, "1"),
        (r#"[""]"#, "[]", r#"[""]"#, "1"),
    ] {
        let row = phrase_row(previous, current);
        let rows = adapt(PHRASES, &transport(&PHRASE_HEADER, &[row.clone(), row])).unwrap();
        assert_eq!(rows.len(), 2, "identical input rows remain independently represented");
        for row in rows { assert_eq!((&row[9], &row[10]), (expected, count)); }
    }
    let mut later = phrase_row(r#"["B"]"#, r#"["C"]"#);
    later[3] = "later".into(); later[4] = "latest".into();
    let earlier = phrase_row(r#"["A"]"#, r#"["B"]"#);
    let rows = adapt(PHRASES, &transport(&PHRASE_HEADER, &[later, earlier])).unwrap();
    assert_eq!(&rows[0][3], "later");
    assert_eq!(&rows[1][3], "first");
}

#[test]
fn phrases_refuse_missing_nonphrase_stages_and_conflicting_identities() {
    for bad in ["", "null", r#"["A",null]"#, "[1]", "{}"] {
        let row = phrase_row(bad, "[]");
        assert!(adapt(PHRASES, &transport(&PHRASE_HEADER, &[row])).unwrap_err().contains("JSON array"));
    }
    for (column, value, message) in [
        (0, "", "identities"), (2, "another participant", "one participant"),
        (4, "first", "distinct screen"), (7, "ocr_text", "Accessibility"),
        (8, "infer_from_file_order", "sequential screens"),
    ] {
        let mut row = phrase_row("[]", "[]"); row[column] = value.into();
        assert!(adapt(PHRASES, &transport(&PHRASE_HEADER, &[row])).unwrap_err().contains(message));
    }
    let first = phrase_row(r#"["A"]"#, r#"["B"]"#);
    let second = phrase_row(r#"["C"]"#, r#"["B"]"#);
    assert!(adapt(PHRASES, &transport(&PHRASE_HEADER, &[first, second])).unwrap_err().contains("conflicting"));
}

#[test]
fn direction_runs_preserve_order_nonconsecutive_repeats_and_all_lifts() {
    let rows = adapt(DIRECTIONS, &transport(&DIRECTION_HEADER, &[
        direction_row("shape1", r#"["Down","Down","Down"]"#),
        direction_row("shape2", r#"["Down","Down","Up","Up","Down"]"#),
        direction_row("shape3", r#"["Down","Down"]"#),
    ])).unwrap();
    // The first Down of both later lifted shapes remains; no cross-row state.
    assert_eq!((&rows[0][6], &rows[0][7], &rows[0][8], &rows[0][9]), (r#"["Down"]"#, "3", "1", "2"));
    assert_eq!((&rows[1][6], &rows[1][7], &rows[1][8], &rows[1][9]), (r#"["Down","Up","Down"]"#, "5", "3", "2"));
    assert_eq!((&rows[2][6], &rows[2][7], &rows[2][8], &rows[2][9]), (r#"["Down"]"#, "2", "1", "1"));
}

#[test]
fn direction_collapse_has_no_shape_validity_cap_or_row_deduplication() {
    for (directions, expected, count) in [
        ("[]", "[]", "0"), (r#"["Left"]"#, r#"["Left"]"#, "1"),
        (r#"["Right","Left","Right","Up"]"#, r#"["Right","Left","Right","Up"]"#, "4"),
    ] {
        let row = direction_row("shape", directions);
        let rows = adapt(DIRECTIONS, &transport(&DIRECTION_HEADER, &[row.clone(), row])).unwrap();
        assert_eq!(rows.len(), 2);
        for row in rows { assert_eq!((&row[6], &row[8], &row[9]), (expected, count, "0")); }
    }
    let mut another_participant = direction_row("shape", r#"["Right","Right"]"#);
    another_participant[1] = "other".into();
    let rows = adapt(DIRECTIONS, &transport(&DIRECTION_HEADER, &[
        direction_row("shape", r#"["Left","Left"]"#), another_participant,
    ])).unwrap();
    assert_eq!(&rows[0][6], r#"["Left"]"#);
    assert_eq!(&rows[1][6], r#"["Right"]"#);
}

#[test]
fn directions_refuse_missing_ungrounded_quantization_and_shape_conflicts() {
    for bad in ["", "null", r#"["Down",null]"#, "[1]", "{}"] {
        assert!(adapt(DIRECTIONS, &transport(&DIRECTION_HEADER, &[direction_row("shape", bad)])).unwrap_err().contains("JSON array"));
    }
    for bad in [r#"["down"]"#, r#"["Down "]"#, r#"["D"]"#, r#"["Diagonal"]"#] {
        assert!(adapt(DIRECTIONS, &transport(&DIRECTION_HEADER, &[direction_row("shape", bad)])).unwrap_err().contains("exact Up"));
    }
    for (column, value, message) in [
        (0, "", "identities"), (2, "", "identities"),
        (3, "still_down", "finger-lift"), (4, "raw_xy", "recognized direction"),
    ] {
        let mut row = direction_row("shape", r#"["Down"]"#); row[column] = value.into();
        assert!(adapt(DIRECTIONS, &transport(&DIRECTION_HEADER, &[row])).unwrap_err().contains(message));
    }
    assert!(adapt(DIRECTIONS, &transport(&DIRECTION_HEADER, &[
        direction_row("shape", r#"["Up"]"#), direction_row("shape", r#"["Down"]"#),
    ])).unwrap_err().contains("conflicting"));
}

#[test]
fn both_components_refuse_header_aliasing_precomputed_outputs_and_missing_fields() {
    for (component, header, row, derived) in [
        (PHRASES, PHRASE_HEADER.as_slice(), phrase_row("[]", "[]"), "phrase_difference_count"),
        (DIRECTIONS, DIRECTION_HEADER.as_slice(), direction_row("shape", "[]"), "collapsed_directions_json"),
    ] {
        let mut duplicate = header.to_vec(); duplicate.push(header[0]);
        let mut extra_row = row.clone(); extra_row.push("unused".into());
        assert!(adapt(component, &transport(&duplicate, &[extra_row.clone()])).unwrap_err().contains("duplicate"));
        let mut output_header = header.to_vec(); output_header.push(derived);
        assert!(adapt(component, &transport(&output_header, &[extra_row])).unwrap_err().contains("supplied"));
        assert!(adapt(component, &transport(&header[..header.len()-1], &[row[..row.len()-1].to_vec()])).is_err());
    }
}
