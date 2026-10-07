//! Structure-aware input for the `closure_evidence_journal` fuzz target.
//!
//! Importing a workspace archive (`importPersistedRustWorkspace`,
//! web/src/lib/rustPipelineRuntime.ts) parses the archive framing and object
//! table in TypeScript (`openRuntimeClosure`, web/src/lib/opfsArtifactStore.ts)
//! and rehashes every object against its digest. The one place archive bytes
//! then reach a Rust parser is `verifyRootClosure`, which hands each commit's
//! evidence journal object to the runtime's `verify_evidence_journal_cbor`,
//! i.e. `EvidenceJournal::from_cbor`: CBOR decoding plus the hash-chain
//! check. A digest only proves the bytes are the ones the archive declares, not
//! that they were produced by this runtime, so this decoder sees attacker bytes.
//!
//! Raw bytes almost never decode into journal events, so half the inputs build
//! a valid hash-chained journal with `EvidenceJournal::append`, encode it the
//! way the runtime persists it, and then corrupt the encoding; the decoder is
//! exercised on near-valid input as well as on arbitrary bytes.

use arbitrary::Arbitrary;
use chronicle_preprocessing_semantic_adapter::journal::{EvidenceJournal, Transition};
use chronicle_preprocessing_semantic_adapter::MaterializationState;

/// Upper bound on events per generated journal: chain verification is linear,
/// and a longer chain only repeats the same per-event work.
pub const MAX_EVENTS: usize = 16;

const STATES: [MaterializationState; 6] = [
    MaterializationState::Open,
    MaterializationState::Ready,
    MaterializationState::Satisfied,
    MaterializationState::Blocked,
    MaterializationState::Invalid,
    MaterializationState::NotApplicable,
];

#[derive(Debug, Clone, Arbitrary)]
pub struct FuzzTransition {
    pub event_kind: String,
    pub subject_id: String,
    pub from_state: Option<u8>,
    pub to_state: u8,
    pub reason_id: String,
    pub source_id: String,
    pub revision: u64,
}

/// One byte edit applied to an encoded journal; the offset wraps modulo the
/// encoding's length so every edit lands inside it.
#[derive(Debug, Clone, Arbitrary)]
pub struct ByteEdit {
    pub offset: u16,
    pub value: u8,
}

#[derive(Debug, Clone, Arbitrary)]
pub enum JournalInput {
    /// Arbitrary bytes straight into the decoder.
    Raw(Vec<u8>),
    /// A valid journal, encoded, then edited and/or truncated.
    Corrupted {
        transitions: Vec<FuzzTransition>,
        edits: Vec<ByteEdit>,
        truncate_to: Option<u16>,
    },
}

fn state(index: u8) -> MaterializationState {
    STATES[usize::from(index) % STATES.len()]
}

/// A valid hash-chained journal built the way the runtime builds one.
pub fn build_journal(transitions: &[FuzzTransition]) -> EvidenceJournal {
    let mut journal = EvidenceJournal::default();
    for transition in transitions.iter().take(MAX_EVENTS) {
        let appended = journal.append(Transition {
            event_kind: &transition.event_kind,
            subject_id: &transition.subject_id,
            from_state: transition.from_state.map(state),
            to_state: state(transition.to_state),
            reason_id: &transition.reason_id,
            source_id: &transition.source_id,
            revision: transition.revision,
        });
        // A transition the canonical-JSON digest cannot serialize is refused
        // by `append` itself; the journal so far is still a valid chain.
        if appended.is_err() {
            break;
        }
    }
    journal
}

/// The bytes this input hands to the decoder. For `Corrupted`, also returns
/// the journal they were derived from and whether any byte actually changed.
pub fn journal_bytes(input: &JournalInput) -> (Vec<u8>, Option<(EvidenceJournal, bool)>) {
    match input {
        JournalInput::Raw(bytes) => (bytes.clone(), None),
        JournalInput::Corrupted {
            transitions,
            edits,
            truncate_to,
        } => {
            let journal = build_journal(transitions);
            let original = journal.to_cbor().expect("an in-memory journal encodes");
            let mut bytes = original.clone();
            for edit in edits {
                if !bytes.is_empty() {
                    let at = usize::from(edit.offset) % bytes.len();
                    bytes[at] = edit.value;
                }
            }
            if let Some(length) = truncate_to {
                bytes.truncate(usize::from(*length));
            }
            let changed = bytes != original;
            (bytes, Some((journal, changed)))
        }
    }
}

/// The properties the target asserts for one input. Panics on a violation.
pub fn check_journal_input(input: &JournalInput) {
    let (bytes, built) = journal_bytes(input);
    let decoded = EvidenceJournal::from_cbor(&bytes);
    if let Some((journal, changed)) = &built {
        if !changed {
            // An unmodified encoding must decode back to the same journal.
            assert_eq!(
                decoded.as_ref().ok(),
                Some(journal),
                "valid journal did not round-trip"
            );
        }
    }
    if let Ok(journal) = decoded {
        // Anything accepted is a verified chain, and re-encoding it is stable.
        journal
            .verify()
            .expect("from_cbor accepted a journal that does not verify");
        let encoded = journal.to_cbor().expect("an accepted journal re-encodes");
        assert_eq!(
            EvidenceJournal::from_cbor(&encoded).expect("re-encoded journal decodes"),
            journal,
            "re-encoding an accepted journal changed it",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transitions(count: usize) -> Vec<FuzzTransition> {
        (0..count)
            .map(|index| FuzzTransition {
                event_kind: "node-ready".into(),
                subject_id: format!("query-{index}"),
                from_state: Some(0),
                to_state: 1,
                reason_id: "reason".into(),
                source_id: "plan".into(),
                revision: index as u64,
            })
            .collect()
    }

    #[test]
    fn an_unmodified_journal_round_trips() {
        let input = JournalInput::Corrupted {
            transitions: transitions(3),
            edits: vec![],
            truncate_to: None,
        };
        let (bytes, built) = journal_bytes(&input);
        let (journal, changed) = built.unwrap();
        assert!(!changed);
        assert_eq!(EvidenceJournal::from_cbor(&bytes).unwrap(), journal);
        check_journal_input(&input);
    }

    /// The corrupted mode reaches the hash-chain check, not only the CBOR
    /// decoder: renaming one subject keeps the CBOR well-formed and breaks the
    /// recorded digest, so decoding must fail closed.
    #[test]
    fn a_tampered_subject_fails_the_chain_check() {
        let journal = build_journal(&transitions(2));
        let mut bytes = journal.to_cbor().unwrap();
        let at = bytes.windows(7).position(|w| w == b"query-1").unwrap();
        bytes[at + 6] = b'9';
        assert!(EvidenceJournal::from_cbor(&bytes).is_err());
    }

    #[test]
    fn truncation_and_raw_bytes_fail_closed_without_panicking() {
        check_journal_input(&JournalInput::Corrupted {
            transitions: transitions(4),
            edits: vec![ByteEdit {
                offset: 5,
                value: 0xff,
            }],
            truncate_to: Some(17),
        });
        check_journal_input(&JournalInput::Raw(vec![0x9f, 0xbf, 0xff]));
        check_journal_input(&JournalInput::Raw(Vec::new()));
    }
}
