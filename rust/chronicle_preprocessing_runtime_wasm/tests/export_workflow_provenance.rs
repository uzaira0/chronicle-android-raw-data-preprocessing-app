use std::process::Command;

#[test]
fn exporter_writes_nonempty_valid_jsonld() {
    let output = Command::new(env!("CARGO_BIN_EXE_export_workflow_provenance"))
        .output()
        .expect("run workflow provenance exporter");

    assert!(output.status.success(), "exporter failed: {output:?}");
    assert!(output.stderr.is_empty(), "unexpected stderr: {output:?}");
    let document: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("parse exported workflow provenance");
    assert!(document
        .get("@graph")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|graph| !graph.is_empty()));
}
