fn main() {
    let contract = chronicle_chrono_kernel_wasm::step_contract::pipeline_step_contract();
    println!(
        "{}",
        serde_json::to_string_pretty(&contract).expect("serialize pipeline step contract")
    );
}
