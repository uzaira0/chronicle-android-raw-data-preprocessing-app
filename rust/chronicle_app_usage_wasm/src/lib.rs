use _rust_app_usage_matcher::{match_app_usage_update_indices_core, MatchOptions};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchUpdateIndicesResponse {
    start_indices: Vec<usize>,
    stop_start_indices: Vec<usize>,
    stop_event_indices: Vec<usize>,
    missing_indices: Vec<usize>,
}

#[wasm_bindgen(js_name = matcherVersion)]
pub fn matcher_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn bytes_to_bools(values: Vec<u8>) -> Vec<bool> {
    values.into_iter().map(|value| value != 0).collect()
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = matchAppUsageUpdateIndices)]
pub fn match_app_usage_update_indices(
    app_codes: Vec<i32>,
    timestamp_ns: Vec<i64>,
    resumed: Vec<u8>,
    same_stop: Vec<u8>,
    other_stop: Vec<u8>,
    stopped: Vec<u8>,
    allow_stop_event_reuse: bool,
    use_activity_stopped_as_fallback: bool,
    apply_threshold_to_fallback: bool,
    long_duration_threshold_ns: i64,
) -> Result<JsValue, JsValue> {
    let resumed = bytes_to_bools(resumed);
    let same_stop = bytes_to_bools(same_stop);
    let other_stop = bytes_to_bools(other_stop);
    let stopped = bytes_to_bools(stopped);
    let response = match_app_usage_update_indices_core(
        &app_codes,
        &timestamp_ns,
        &resumed,
        &same_stop,
        &other_stop,
        &stopped,
        MatchOptions {
            allow_stop_event_reuse,
            use_activity_stopped_as_fallback,
            apply_threshold_to_fallback,
            long_duration_threshold_ns,
        },
    )
    .map(|output| MatchUpdateIndicesResponse {
        start_indices: output.start_indices,
        stop_start_indices: output.stop_start_indices,
        stop_event_indices: output.stop_event_indices,
        missing_indices: output.missing_indices,
    })
    .map_err(|error| JsValue::from_str(&error.to_string()))?;

    serde_wasm_bindgen::to_value(&response)
        .map_err(|error| JsValue::from_str(&format!("failed to serialize matcher output: {error}")))
}
