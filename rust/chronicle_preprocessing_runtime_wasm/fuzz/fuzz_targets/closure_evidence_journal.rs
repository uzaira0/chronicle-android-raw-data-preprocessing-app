#![no_main]

use chronicle_runtime_fuzz::journal::{check_journal_input, JournalInput};
use libfuzzer_sys::fuzz_target;

// The Rust decoder an imported workspace archive reaches: each commit's
// evidence journal object, through `verify_evidence_journal_cbor` ->
// `EvidenceJournal::from_cbor`. src/journal.rs explains the path and the input.
fuzz_target!(|input: JournalInput| {
    check_journal_input(&input);
});
