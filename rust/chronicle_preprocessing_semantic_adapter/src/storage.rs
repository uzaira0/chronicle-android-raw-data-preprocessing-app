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

impl MemoryCas {
    /// Store bytes under a SHA-256 digest that the caller has already verified.
    /// This avoids hashing very large inputs again at a second in-process
    /// boundary while retaining the bytes needed by the workspace store.
    pub fn put_verified_sha256(
        &mut self,
        media_type: &str,
        digest: &str,
        bytes: Vec<u8>,
        derived_from: Vec<String>,
    ) -> Result<ArtifactRef, RuntimeError> {
        if digest.len() != 71
            || !digest.starts_with("sha256:")
            || !digest[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(RuntimeError::Storage(
                "verified object digest must be lowercase sha256".into(),
            ));
        }
        let size = bytes.len() as u64;
        self.objects.entry(digest.to_string()).or_insert(bytes);
        Ok(ArtifactRef {
            artifact_id: format!("urn:chronicle:artifact:{}", &digest[7..]),
            digest: digest.to_string(),
            media_type: media_type.to_string(),
            size,
            derived_from,
            qualifiers: BTreeMap::new(),
        })
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
        assert!(store.contains(&first.digest));
        assert!(!store.contains("sha256:missing"));
        assert!(store.get("sha256:missing").is_err());
    }

    #[test]
    fn verified_content_address_reuses_a_prechecked_digest() {
        let mut store = MemoryCas::default();
        let digest = format!(
            "sha256:{}",
            hex::encode(Sha256::digest(b"already verified"))
        );
        let artifact = store
            .put_verified_sha256("text/plain", &digest, b"already verified".to_vec(), vec![])
            .unwrap();
        assert_eq!(artifact.digest, digest);
        assert_eq!(store.get(&digest).unwrap(), b"already verified");
        assert!(store
            .put_verified_sha256("text/plain", "sha256:short", Vec::new(), vec![])
            .is_err());
        assert!(store
            .put_verified_sha256(
                "text/plain",
                &format!("sha257:{}", "a".repeat(64)),
                Vec::new(),
                vec![],
            )
            .is_err());
        assert!(store
            .put_verified_sha256(
                "text/plain",
                &format!("sha256:{}g", "a".repeat(63)),
                Vec::new(),
                vec![],
            )
            .is_err());
    }
}
