#![no_main]

use chronicle_preprocessing_runtime_wasm::inspect_raw_file_v1;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|bytes: &[u8]| {
    if bytes.len() > 1024 * 1024 {
        return;
    }
    let inspection = inspect_raw_file_v1(bytes, "synthetic.csv", bytes.len() as f64);
    assert!(serde_json::from_str::<serde_json::Value>(&inspection).is_ok());
});
