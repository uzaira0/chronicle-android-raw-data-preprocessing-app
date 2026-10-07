#![no_main]

use chronicle_runtime_fuzz::{execute_structured_workspace, StructuredWorkspaceInput};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|input: StructuredWorkspaceInput| {
    // Any `Err` is a fail-closed rejection and acceptable; the target exists
    // to find panics, aborts, and sanitizer reports past request admission.
    let _ = execute_structured_workspace(&input);
});
