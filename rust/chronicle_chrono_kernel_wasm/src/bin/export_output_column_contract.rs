use std::collections::BTreeSet;

use chronicle_chrono_kernel_wasm::b05_foundational_semantics::ScreenSessionConstructionStrategyId;
use chronicle_chrono_kernel_wasm::pipeline_v2::{
    declared_app_output_columns, declared_screen_output_columns_for_strategy,
    insert_conditional_app_output_columns,
};
use serde_json::json;

fn main() {
    let mut app = BTreeSet::new();
    for include_codebook in [false, true] {
        for include_aliases in [false, true] {
            for usage_layer_active in [false, true] {
                for include_end_reason in [false, true] {
                    for include_session_id in [false, true] {
                        let base = declared_app_output_columns(
                            include_codebook,
                            include_aliases,
                            usage_layer_active,
                            30.0,
                            include_end_reason,
                            include_session_id,
                        );
                        // Every research-axis column a run can add: the codebook
                        // has to document the whole emitted set, not the default.
                        for axes in 0..16_u8 {
                            let mut columns = base.clone();
                            insert_conditional_app_output_columns(
                                &mut columns,
                                axes & 1 != 0,
                                axes & 2 != 0,
                                axes & 4 != 0,
                                axes & 8 != 0,
                            );
                            app.extend(columns);
                        }
                    }
                }
            }
        }
    }
    let mut screen: BTreeSet<String> = ScreenSessionConstructionStrategyId::ALL
        .into_iter()
        .flat_map(declared_screen_output_columns_for_strategy)
        .collect();
    screen.insert("screen_usage_session_classification".into());
    println!(
        "{}",
        serde_json::to_string(&json!({
            "protocolVersion": "chronicle-output-column-contract/v1",
            "app": app,
            "screen": screen,
        }))
        .expect("serialize output-column contract")
    );
}
