use std::collections::BTreeSet;

use chronicle_chrono_kernel_wasm::pipeline_v2::{
    declared_app_output_columns, declared_screen_output_columns,
};
use serde_json::json;

fn main() {
    let mut app = BTreeSet::new();
    for include_codebook in [false, true] {
        for include_aliases in [false, true] {
            for usage_layer_active in [false, true] {
                app.extend(declared_app_output_columns(
                    include_codebook,
                    include_aliases,
                    usage_layer_active,
                    30.0,
                ));
            }
        }
    }
    println!(
        "{}",
        serde_json::to_string(&json!({
            "protocolVersion": "chronicle-output-column-contract/v1",
            "app": app,
            "screen": declared_screen_output_columns(),
        }))
        .expect("serialize output-column contract")
    );
}
