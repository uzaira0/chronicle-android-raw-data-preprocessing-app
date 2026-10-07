//! Exactness properties of the `PipelineV2OptionsJson` boundary.
//!
//! These assert facts about product code that hold regardless of any particular
//! axis of the delivery campaign:
//!
//! 1. presence-tracked options serialize differently when omitted than when
//!    explicitly supplied, so an omitted key and an explicit key equal to the
//!    default are distinguishable downstream;
//! 2. `i64` nanosecond options above the exactly-representable binary64 range
//!    alias under RFC 8785 canonical JSON, so canonical JSON is never a faithful
//!    identity for them;
//! 3. the struct carries `deny_unknown_fields`, so an unrecognized option key
//!    is refused at the deserialization boundary itself — and the serialize-back
//!    key comparison remains as a second line of defense for KNOWN keys that
//!    vanish through `skip_serializing_if` (this test pins both);
//! 4. an out-of-domain enum value is rejected at deserialization.
//!
//! This file is deliberately self-contained: no `#[path]` mounting of a module
//! shared with `examples/`, and no capture-ceremony file writer.

use chronicle_chrono_kernel_wasm::pipeline_v2::PipelineV2OptionsJson;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// A minimal, valid option vector. Values are arbitrary; only their presence
/// and their types matter to the properties under test.
fn base_options() -> Value {
    json!({
        "study_name": "Options Exactness",
        "timezone": "UTC",
        "usage_session_mode": "app_usage",
        "include_app_output": true,
        "include_screen_output": false,
        "use_filter_file": false,
        "use_apps_forcing_screen_open": false,
        "use_app_codebook": false,
        "correct_duplicate_event_timestamps": true,
        "allow_stop_event_reuse": false,
        "use_activity_stopped_as_fallback": true,
        "apply_threshold_to_fallback": true,
        "long_duration_threshold_ns": 43_200_000_000_000_i64,
        "custom_app_engagement_duration": 300.0,
        "long_data_time_gap_thresholds": [1.0, 2.0],
        "long_usage_duration_thresholds": [1.0, 2.0],
        "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
        "other_stop_types": ["Activity Resumed", "Device Shutdown"],
        "interaction_types_to_remove": [],
        "screen_auto_lock_timeout_seconds": 120.0,
        "screen_auto_lock_tolerance_seconds": 30.0,
        "screen_manual_lock_max_tail_seconds": 30.0,
        "screen_keyguard_near_stop_seconds": 2.0,
        "datetime_of_preprocessing": "2026-08-12 00:00:00 UTC",
        "minimum_usage_duration": 60.0
    })
}

fn object(value: &Value) -> &Map<String, Value> {
    value.as_object().expect("option vector is a JSON object")
}

/// Deserialize into the typed option struct, then serialize back. This is the
/// exact round trip the runtime performs on the worker boundary.
fn round_trip(value: &Value) -> Result<Value, String> {
    let typed: PipelineV2OptionsJson =
        serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
    serde_json::to_value(&typed).map_err(|error| error.to_string())
}

/// Keys the caller supplied that survive no round trip — i.e. keys the struct
/// silently discarded. `PipelineV2OptionsJson` carries `deny_unknown_fields`,
/// so an UNKNOWN key never reaches this comparison (the parser refuses it
/// first); what this catches is a KNOWN key whose value vanishes on the way
/// back out — an `Option` field supplied as explicit JSON `null` that
/// `skip_serializing_if = "Option::is_none"` then omits from the
/// serialization.
fn silently_dropped_keys(source: &Value, serialized: &Value) -> Vec<String> {
    let serialized = object(serialized);
    object(source)
        .keys()
        .filter(|key| !serialized.contains_key(*key))
        .cloned()
        .collect()
}

fn digest(value: &Value) -> String {
    let bytes = serde_json::to_vec(value).expect("serialize option vector");
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

const PRESENCE_TRACKED_KEYS: [&str; 5] = [
    "interval_expansion_method",
    "micro_use_classification_policy",
    "minimum_usage_duration",
    "minimum_duration_comparator",
    "minimum_duration_disposition",
];

#[test]
fn omitted_and_explicit_presence_tracked_options_serialize_differently() {
    let mut omitted_source = base_options();
    {
        let fields = omitted_source
            .as_object_mut()
            .expect("option vector is a JSON object");
        for key in PRESENCE_TRACKED_KEYS {
            fields.remove(key);
        }
    }
    let omitted = round_trip(&omitted_source).expect("omitted vector deserializes");
    for key in PRESENCE_TRACKED_KEYS {
        assert!(
            !object(&omitted).contains_key(key),
            "{key} must stay absent when it was omitted"
        );
    }

    let mut explicit_source = base_options();
    {
        let fields = explicit_source
            .as_object_mut()
            .expect("option vector is a JSON object");
        // Every value here is the struct's own default, so only *presence*
        // separates this vector from the omitted one.
        fields.insert("interval_expansion_method".into(), json!("none"));
        fields.insert("micro_use_classification_policy".into(), json!("none"));
        fields.insert("minimum_usage_duration".into(), json!(60.0));
        fields.insert("minimum_duration_comparator".into(), json!("strict_lt"));
        fields.insert(
            "minimum_duration_disposition".into(),
            json!("chronicle_blank_keep_row"),
        );
    }
    let explicit = round_trip(&explicit_source).expect("explicit vector deserializes");
    for key in PRESENCE_TRACKED_KEYS {
        assert!(
            object(&explicit).contains_key(key),
            "{key} must be retained when it was supplied explicitly"
        );
    }

    assert_ne!(omitted, explicit);
    assert_ne!(digest(&omitted), digest(&explicit));
}

#[test]
fn nanosecond_options_above_the_binary64_exact_range_alias_under_canonical_json() {
    // 2^53 is the largest integer with an exact binary64 neighbour-free
    // representation; 2^53 + 1 is not representable at all.
    const EXACT: i64 = 9_007_199_254_740_992;
    const ALIASING: i64 = 9_007_199_254_740_993;

    let mut source = base_options();
    source
        .as_object_mut()
        .expect("option vector is a JSON object")
        .insert("long_duration_threshold_ns".into(), json!(ALIASING));
    let serialized = round_trip(&source).expect("aliasing vector deserializes");

    // serde_json itself is lossless for i64.
    assert_eq!(
        object(&serialized)
            .get("long_duration_threshold_ns")
            .and_then(Value::as_i64),
        Some(ALIASING),
        "serde_json must preserve the i64 exactly"
    );

    // RFC 8785 canonical JSON (which the runtime uses for provenance digests)
    // is not: it renders every number as binary64.
    let canonical = serde_jcs::to_string(&serialized).expect("canonicalize option vector");
    assert!(
        !canonical.contains(&ALIASING.to_string()),
        "canonical JSON unexpectedly preserved {ALIASING}: {canonical}"
    );
    assert!(
        canonical.contains(&EXACT.to_string()),
        "canonical JSON should have aliased {ALIASING} down to {EXACT}: {canonical}"
    );

    // The aliasing collapses two distinct option vectors onto one canonical
    // form, which is precisely why canonical JSON must not be the identity for
    // nanosecond options.
    let mut exact_source = base_options();
    exact_source
        .as_object_mut()
        .expect("option vector is a JSON object")
        .insert("long_duration_threshold_ns".into(), json!(EXACT));
    let exact_serialized = round_trip(&exact_source).expect("exact vector deserializes");
    assert_ne!(exact_serialized, serialized);
    assert_eq!(
        serde_jcs::to_string(&exact_serialized).expect("canonicalize option vector"),
        canonical,
        "the two vectors must be shown to collide canonically"
    );
}

#[test]
fn unknown_option_keys_are_rejected_at_deserialization() {
    // `PipelineV2OptionsJson` carries `deny_unknown_fields`, so an invented
    // key fails closed at the deserialization boundary itself — it can no
    // longer be silently dropped and left for the serialize-back comparison
    // to catch. The round-trip comparison remains as a second line of
    // defense (control below), but the primary gate is the parser.
    let mut source = base_options();
    source
        .as_object_mut()
        .expect("option vector is a JSON object")
        .insert("candidate_invented_field".into(), Value::Bool(true));

    let error = round_trip(&source).expect_err("an unknown option key must fail deserialization");
    assert!(
        error.contains("unknown field `candidate_invented_field`"),
        "the rejection must name the offending key: {error}"
    );

    // Control: the unmodified vector deserializes and drops nothing.
    let clean = base_options();
    let clean_serialized = round_trip(&clean).expect("base vector deserializes");
    assert!(silently_dropped_keys(&clean, &clean_serialized).is_empty());

    // Positive control: the comparison must have discriminating power. A KNOWN
    // `Option` field supplied as explicit JSON `null` deserializes to `None`
    // and is then omitted by `skip_serializing_if = "Option::is_none"` — the
    // one remaining shape the serialize-back comparison exists to report.
    let mut nulled = base_options();
    nulled
        .as_object_mut()
        .expect("option vector is a JSON object")
        .insert("maximum_duration_policy".into(), Value::Null);
    let nulled_serialized = round_trip(&nulled).expect("an explicit null Option deserializes");
    assert_eq!(
        silently_dropped_keys(&nulled, &nulled_serialized),
        vec!["maximum_duration_policy".to_string()],
        "a known key whose null value vanishes on serialize-back must be reported"
    );
}

#[test]
fn an_out_of_domain_screen_session_construction_strategy_is_rejected() {
    let mut source = base_options();
    source.as_object_mut().unwrap().insert(
        "screen_session_construction_strategy".into(),
        Value::String("invented_screen_strategy".into()),
    );
    let error = round_trip(&source).expect_err("an invented strategy id must be rejected");
    assert!(
        error.contains("unknown_screen_session_construction_strategy"),
        "unexpected rejection message: {error}"
    );

    // A value inside the domain still deserializes.
    let mut native = base_options();
    native
        .as_object_mut()
        .unwrap()
        .insert("screen_session_construction_strategy".into(), Value::Null);
    round_trip(&native).expect("an absent strategy selection remains valid");
}

// ---------------------------------------------------------------------------
// `delivery:B06` maximum-duration wire rows (proof-matrix Tier 1:
// b06_presence_default, b06_threshold_wire_exactness,
// b06_malformed_runtime_rejection, b06_legacy_exact_canonicalization).
// ---------------------------------------------------------------------------

use chronicle_chrono_kernel_wasm::pipeline_v2::validate_pipeline_v2_options;

const B06_WIRE_KEYS: [&str; 7] = [
    "maximum_duration_policy",
    "maximum_duration_disposition",
    "maximum_duration_threshold_source",
    "maximum_duration_threshold_ns",
    "long_duration_threshold_explicit",
    "b06_legacy_threshold_hours_canonical",
    "b06_legacy_threshold_ns_canonical",
];

fn with_b06(fields: &[(&str, Value)]) -> Value {
    let mut source = base_options();
    let object = source
        .as_object_mut()
        .expect("option vector is a JSON object");
    for (key, value) in fields {
        object.insert((*key).to_string(), value.clone());
    }
    source
}

fn validate(source: &Value) -> Result<(), String> {
    let typed: PipelineV2OptionsJson =
        serde_json::from_value(source.clone()).map_err(|error| error.to_string())?;
    validate_pipeline_v2_options(&typed.into_pipeline_options()).map_err(|error| error.to_string())
}

fn explicit_native() -> Vec<(&'static str, Value)> {
    vec![
        ("maximum_duration_policy", json!("strategy_native")),
        ("maximum_duration_disposition", json!("not_applicable")),
        (
            "maximum_duration_threshold_source",
            json!("strategy_native"),
        ),
        ("b06_legacy_threshold_hours_canonical", json!("12")),
        ("b06_legacy_threshold_ns_canonical", json!("43200000000000")),
    ]
}

fn generic_fixed(threshold: &str) -> Vec<(&'static str, Value)> {
    vec![
        (
            "maximum_duration_policy",
            json!("post_reconstruction_strict_max_v1"),
        ),
        ("maximum_duration_disposition", json!("flag_and_retain")),
        (
            "maximum_duration_threshold_source",
            json!("fixed_parameter"),
        ),
        ("maximum_duration_threshold_ns", json!(threshold)),
        ("b06_legacy_threshold_hours_canonical", json!("12")),
        ("b06_legacy_threshold_ns_canonical", json!("43200000000000")),
    ]
}

/// b06_presence_default: with every B06 key absent the vector re-serializes
/// without them (the digest the browser computes is the digest the runtime
/// re-derives), and it validates as the legacy baseline; explicit
/// `strategy_native` and the marker-only vector are each distinguishable from
/// omission by presence alone.
#[test]
fn b06_omission_and_explicit_native_are_distinct_on_the_wire_and_both_valid() {
    let omitted = round_trip(&base_options()).expect("omitted vector deserializes");
    for key in B06_WIRE_KEYS {
        assert!(
            !object(&omitted).contains_key(key),
            "{key} must not appear when omitted"
        );
    }
    validate(&base_options()).expect("omission is the legacy baseline");

    let explicit_source = with_b06(&explicit_native());
    let explicit = round_trip(&explicit_source).expect("explicit native deserializes");
    for key in [
        "maximum_duration_policy",
        "maximum_duration_disposition",
        "maximum_duration_threshold_source",
        "b06_legacy_threshold_hours_canonical",
        "b06_legacy_threshold_ns_canonical",
    ] {
        assert!(
            object(&explicit).contains_key(key),
            "{key} must survive the round trip"
        );
    }
    assert!(!object(&explicit).contains_key("maximum_duration_threshold_ns"));
    assert!(silently_dropped_keys(&explicit_source, &explicit).is_empty());
    validate(&explicit_source).expect("explicit strategy_native is baseline-equivalent");
    assert_ne!(digest(&omitted), digest(&explicit));

    let marker_only_source = with_b06(&[("long_duration_threshold_explicit", json!(true))]);
    let marker_only = round_trip(&marker_only_source).expect("marker-only deserializes");
    assert_eq!(
        object(&marker_only).get("long_duration_threshold_explicit"),
        Some(&json!(true))
    );
    validate(&marker_only_source).expect("the marker alone is still the omitted shape");
    assert_ne!(digest(&omitted), digest(&marker_only));
}

/// b06_threshold_wire_exactness: the threshold is a decimal string on the
/// wire and survives the round trip byte-for-byte across the whole i64
/// range — including values a binary64 could not carry.
#[test]
fn b06_threshold_strings_round_trip_exactly_across_the_i64_range() {
    for threshold in [
        "1",
        "9007199254740991",
        "9007199254740992",
        "9007199254740993",
        "9223372036854775807",
    ] {
        let source = with_b06(&generic_fixed(threshold));
        let serialized = round_trip(&source).expect("canonical threshold deserializes");
        assert_eq!(
            object(&serialized).get("maximum_duration_threshold_ns"),
            Some(&json!(threshold)),
            "{threshold} must round-trip as the same string"
        );
        validate(&source).unwrap_or_else(|error| panic!("{threshold}: {error}"));
    }
    // A JSON number is a type error, never a rounded acceptance.
    let numeric = with_b06(&[
        (
            "maximum_duration_policy",
            json!("post_reconstruction_strict_max_v1"),
        ),
        ("maximum_duration_disposition", json!("flag_and_retain")),
        (
            "maximum_duration_threshold_source",
            json!("fixed_parameter"),
        ),
        (
            "maximum_duration_threshold_ns",
            json!(9_007_199_254_740_993_i64),
        ),
    ]);
    round_trip(&numeric).expect_err("a numeric threshold must be rejected at deserialization");
}

/// b06_malformed_runtime_rejection: every non-canonical threshold spelling and
/// every partial or mis-paired selection vector is refused by option
/// validation with the typed token, before any decode or reconstruction.
#[test]
fn b06_malformed_thresholds_and_illegal_shapes_are_refused_before_execution() {
    for malformed in [
        "0",
        "-1",
        "+1",
        " 1",
        "1 ",
        "01",
        "1.0",
        "1e3",
        "9223372036854775808",
        "18446744073709551616",
    ] {
        let error = validate(&with_b06(&generic_fixed(malformed)))
            .expect_err(&format!("{malformed:?} must be refused"));
        assert!(
            error.contains("b06=maximum_duration_threshold_malformed"),
            "{malformed:?}: {error}"
        );
    }
    // Partial vector: policy without its siblings.
    let error = validate(&with_b06(&[(
        "maximum_duration_policy",
        json!("strategy_native"),
    )]))
    .expect_err("a partial vector is not a shape");
    assert!(
        error.contains("b06=maximum_duration_request_shape_invalid"),
        "{error}"
    );
    // Mis-paired: generic policy with the legacy source.
    let mut mispaired = generic_fixed("3600000000000");
    mispaired[2] = (
        "maximum_duration_threshold_source",
        json!("chronicle_legacy_config"),
    );
    let error = validate(&with_b06(&mispaired)).expect_err("mis-paired vector");
    assert!(
        error.contains("b06=maximum_duration_request_shape_invalid"),
        "{error}"
    );
    // Out-of-vocabulary value.
    let mut bogus = explicit_native();
    bogus[0] = ("maximum_duration_policy", json!("invented_policy"));
    let error = validate(&with_b06(&bogus)).expect_err("out-of-vocabulary policy");
    assert!(
        error.contains("b06=maximum_duration_request_shape_invalid"),
        "{error}"
    );
    // Chronicle arm outside the fused matcher.
    let mut chronicle = explicit_native();
    chronicle[0] = (
        "maximum_duration_policy",
        json!("chronicle_observed_close_rejection_v1"),
    );
    chronicle[2] = (
        "maximum_duration_threshold_source",
        json!("chronicle_legacy_config"),
    );
    let mut source = with_b06(&chronicle);
    source.as_object_mut().unwrap().insert(
        "episode_reconstruction_strategy".into(),
        json!("gesis_start_stop_repair"),
    );
    let error = validate(&source).expect_err("chronicle arm needs the fused matcher");
    assert!(
        error.contains("b06=maximum_duration_policy_incompatible_with_reconstruction_strategy"),
        "{error}"
    );
    // Adaptive source has no provider in v1.
    let mut adaptive = generic_fixed("1");
    adaptive[2] = (
        "maximum_duration_threshold_source",
        json!("b12_adaptive_participant"),
    );
    adaptive.remove(3);
    let error = validate(&with_b06(&adaptive)).expect_err("adaptive refuses in v1");
    assert!(
        error.contains("b06=adaptive_maximum_threshold_provider_unavailable"),
        "{error}"
    );
}

/// b06_legacy_exact_canonicalization: for every explicit selection the legacy
/// hours companions must be the exact canonical spelling of the wire
/// `long_duration_threshold_ns`; each drift is a distinct typed refusal, in
/// the frozen order (nonpositive → spelling → integrality/overflow → binary64
/// mapping → companion agreement).
#[test]
fn b06_legacy_companions_map_exactly_or_refuse_in_the_frozen_order() {
    let request = |hours: &str, ns_text: &str, wire_ns: i64| {
        let mut fields = explicit_native();
        fields[3] = ("b06_legacy_threshold_hours_canonical", json!(hours));
        fields[4] = ("b06_legacy_threshold_ns_canonical", json!(ns_text));
        let mut source = with_b06(&fields);
        source
            .as_object_mut()
            .unwrap()
            .insert("long_duration_threshold_ns".into(), json!(wire_ns));
        source
    };
    // Accepted: 12 h, 1.25 h, 0.5 h.
    for (hours, ns_text, wire_ns) in [
        ("12", "43200000000000", 43_200_000_000_000_i64),
        ("1.25", "4500000000000", 4_500_000_000_000),
        ("0.5", "1800000000000", 1_800_000_000_000),
    ] {
        validate(&request(hours, ns_text, wire_ns))
            .unwrap_or_else(|error| panic!("{hours} h: {error}"));
    }
    let refused = |hours: &str, ns_text: &str, wire_ns: i64, token: &str| {
        let error = match validate(&request(hours, ns_text, wire_ns)) {
            Err(error) => error,
            Ok(()) => panic!("{hours} h must be refused with {token}"),
        };
        assert!(
            error.contains(&format!("b06={token}")),
            "{hours} h: {error}"
        );
    };
    refused("0", "0", 0, "maximum_duration_legacy_threshold_nonpositive");
    refused(
        "-1",
        "-3600000000000",
        -3_600_000_000_000,
        "maximum_duration_legacy_threshold_nonpositive",
    );
    refused(
        "1.2500000000000001",
        "4500000000000",
        4_500_000_000_000,
        "maximum_duration_legacy_threshold_canonicalization_mismatch",
    );
    refused(
        "0.0000000000001",
        "0",
        0,
        "maximum_duration_legacy_threshold_not_integer_ns",
    );
    refused(
        "1e300",
        "0",
        0,
        "maximum_duration_legacy_threshold_canonicalization_mismatch",
    );
    refused(
        "1.1",
        "3960000000000",
        3_960_000_000_000,
        "maximum_duration_legacy_threshold_binary64_mapping_mismatch",
    );
    refused(
        "12",
        "43200000000001",
        43_200_000_000_000,
        "maximum_duration_legacy_threshold_canonicalization_mismatch",
    );
    refused(
        "12",
        "43200000000000",
        43_200_000_000_001,
        "maximum_duration_legacy_threshold_canonicalization_mismatch",
    );
    // Missing companions on an explicit selection.
    let mut fields = explicit_native();
    fields.truncate(3);
    let error = validate(&with_b06(&fields)).expect_err("companions are required when explicit");
    assert!(
        error.contains("b06=maximum_duration_legacy_threshold_canonicalization_mismatch"),
        "{error}"
    );
}
