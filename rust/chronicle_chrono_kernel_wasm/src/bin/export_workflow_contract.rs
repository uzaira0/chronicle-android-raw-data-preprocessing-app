fn main() {
    let contract = chronicle_chrono_kernel_wasm::workflow_contract::workflow_contract();
    println!(
        "{}",
        serde_json::to_string_pretty(&contract).expect("serialize workflow contract")
    );
}
