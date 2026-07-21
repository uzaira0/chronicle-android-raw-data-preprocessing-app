use crate::model::{ArtifactRef, RuntimeError};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub trait ArtifactStore {
    fn put(
        &mut self,
        media_type: &str,
        bytes: Vec<u8>,
        derived_from: Vec<String>,
    ) -> Result<ArtifactRef, RuntimeError>;
    fn get(&self, digest: &str) -> Result<&[u8], RuntimeError>;
    fn contains(&self, digest: &str) -> bool;
}

#[derive(Debug, Default, Clone)]
pub struct MemoryCas {
    objects: BTreeMap<String, Vec<u8>>,
}

impl ArtifactStore for MemoryCas {
    fn put(
        &mut self,
        media_type: &str,
        bytes: Vec<u8>,
        derived_from: Vec<String>,
    ) -> Result<ArtifactRef, RuntimeError> {
        let digest = format!("sha256:{}", hex::encode(Sha256::digest(&bytes)));
        let size = bytes.len() as u64;
        self.objects.entry(digest.clone()).or_insert(bytes);
        Ok(ArtifactRef {
            artifact_id: format!("urn:chronicle:artifact:{}", &digest[7..]),
            digest,
            media_type: media_type.to_string(),
            size,
            derived_from,
            qualifiers: BTreeMap::new(),
        })
    }

    fn get(&self, digest: &str) -> Result<&[u8], RuntimeError> {
        self.objects
            .get(digest)
            .map(Vec::as_slice)
            .ok_or_else(|| RuntimeError::Storage(format!("missing object {digest}")))
    }

    fn contains(&self, digest: &str) -> bool {
        self.objects.contains_key(digest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_address_is_stable_and_deduplicated() {
        let mut store = MemoryCas::default();
        let first = store.put("text/plain", b"same".to_vec(), vec![]).unwrap();
        let second = store.put("text/plain", b"same".to_vec(), vec![]).unwrap();
        assert_eq!(first.digest, second.digest);
        assert_eq!(store.get(&first.digest).unwrap(), b"same");
    }
}
