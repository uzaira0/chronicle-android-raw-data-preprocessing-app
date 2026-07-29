use crate::model::{MaterializationState, RuntimeError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalEvent {
    pub sequence: u64,
    pub previous_digest: Option<String>,
    pub event_digest: String,
    pub event_kind: String,
    pub subject_id: String,
    pub from_state: Option<MaterializationState>,
    pub to_state: MaterializationState,
    pub reason_id: String,
    pub source_id: String,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct UnsignedJournalEvent<'a> {
    sequence: u64,
    previous_digest: &'a Option<String>,
    event_kind: &'a str,
    subject_id: &'a str,
    from_state: Option<MaterializationState>,
    to_state: MaterializationState,
    reason_id: &'a str,
    source_id: &'a str,
    revision: u64,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceJournal {
    events: Vec<JournalEvent>,
}

pub struct Transition<'a> {
    pub event_kind: &'a str,
    pub subject_id: &'a str,
    pub from_state: Option<MaterializationState>,
    pub to_state: MaterializationState,
    pub reason_id: &'a str,
    pub source_id: &'a str,
    pub revision: u64,
}

impl EvidenceJournal {
    pub fn append(&mut self, transition: Transition<'_>) -> Result<&JournalEvent, RuntimeError> {
        let sequence = self.events.len() as u64;
        let previous_digest = self.events.last().map(|event| event.event_digest.clone());
        let unsigned = UnsignedJournalEvent {
            sequence,
            previous_digest: &previous_digest,
            event_kind: transition.event_kind,
            subject_id: transition.subject_id,
            from_state: transition.from_state,
            to_state: transition.to_state,
            reason_id: transition.reason_id,
            source_id: transition.source_id,
            revision: transition.revision,
        };
        let bytes = serde_jcs::to_vec(&unsigned)
            .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
        let event_digest = format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
        self.events.push(JournalEvent {
            sequence,
            previous_digest,
            event_digest,
            event_kind: transition.event_kind.to_string(),
            subject_id: transition.subject_id.to_string(),
            from_state: transition.from_state,
            to_state: transition.to_state,
            reason_id: transition.reason_id.to_string(),
            source_id: transition.source_id.to_string(),
            revision: transition.revision,
        });
        Ok(self.events.last().expect("event appended"))
    }

    pub fn events(&self) -> &[JournalEvent] {
        &self.events
    }

    pub fn verify(&self) -> Result<(), RuntimeError> {
        let mut previous = None;
        for event in &self.events {
            if event.previous_digest != previous {
                return Err(RuntimeError::Storage(format!(
                    "journal chain broken at sequence {}",
                    event.sequence
                )));
            }
            let unsigned = UnsignedJournalEvent {
                sequence: event.sequence,
                previous_digest: &event.previous_digest,
                event_kind: &event.event_kind,
                subject_id: &event.subject_id,
                from_state: event.from_state,
                to_state: event.to_state,
                reason_id: &event.reason_id,
                source_id: &event.source_id,
                revision: event.revision,
            };
            let bytes = serde_jcs::to_vec(&unsigned)
                .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
            let actual = format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
            if actual != event.event_digest {
                return Err(RuntimeError::Storage(format!(
                    "journal digest mismatch at sequence {}",
                    event.sequence
                )));
            }
            previous = Some(event.event_digest.clone());
        }
        Ok(())
    }

    pub fn to_cbor(&self) -> Result<Vec<u8>, RuntimeError> {
        let mut bytes = Vec::new();
        ciborium::into_writer(&self.events, &mut bytes)
            .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
        Ok(bytes)
    }

    pub fn from_cbor(bytes: &[u8]) -> Result<Self, RuntimeError> {
        let events = ciborium::from_reader(bytes)
            .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
        let journal = Self { events };
        journal.verify()?;
        Ok(journal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_is_hash_chained_and_cbor_exportable() {
        let mut journal = EvidenceJournal::default();
        journal
            .append(Transition {
                event_kind: "role-assigned",
                subject_id: "raw_chronicle_csv",
                from_state: Some(MaterializationState::Open),
                to_state: MaterializationState::Satisfied,
                reason_id: "reason:1",
                source_id: "artifact:1",
                revision: 1,
            })
            .unwrap();
        journal
            .append(Transition {
                event_kind: "node-ready",
                subject_id: "parse_events",
                from_state: Some(MaterializationState::Open),
                to_state: MaterializationState::Ready,
                reason_id: "reason:2",
                source_id: "plan:1",
                revision: 1,
            })
            .unwrap();
        journal.verify().unwrap();
        let bytes = journal.to_cbor().unwrap();
        assert!(!bytes.is_empty());
        assert_eq!(EvidenceJournal::from_cbor(&bytes).unwrap(), journal);
    }

    #[test]
    fn tamper_is_detected() {
        let mut journal = EvidenceJournal::default();
        journal
            .append(Transition {
                event_kind: "state",
                subject_id: "node",
                from_state: None,
                to_state: MaterializationState::Ready,
                reason_id: "reason",
                source_id: "source",
                revision: 1,
            })
            .unwrap();
        journal.events[0].subject_id = "tampered".into();
        assert!(journal.verify().is_err());
    }

    #[test]
    fn broken_chain_and_malformed_cbor_fail_closed() {
        let mut journal = EvidenceJournal::default();
        for revision in 1..=2 {
            journal
                .append(Transition {
                    event_kind: "state",
                    subject_id: "node",
                    from_state: None,
                    to_state: MaterializationState::Ready,
                    reason_id: "reason",
                    source_id: "source",
                    revision,
                })
                .unwrap();
        }
        assert_eq!(journal.events().len(), 2);
        journal.events[1].previous_digest = None;
        assert!(journal
            .verify()
            .unwrap_err()
            .to_string()
            .contains("chain broken"));
        assert!(EvidenceJournal::from_cbor(b"not-cbor").is_err());
    }
}
