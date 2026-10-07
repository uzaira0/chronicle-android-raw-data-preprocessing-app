//! Lossless byte packaging of existing generated JSON, not a new data authority.
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
pub(crate) use crate::bundled_gzip::decode_gzip_bytes;
#[cfg(test)]
use crate::bundled_gzip::MAX_DECODED_JSON_BYTES;

pub(crate) struct PackedJson {
    name: &'static str,
    gzip: &'static [u8],
    expected_bytes: usize,
    raw_sha256: &'static str,
    text: OnceLock<Result<String, String>>,
}

impl PackedJson {
    pub(crate) fn text(&self) -> Result<&str, String> {
        self.text
            .get_or_init(|| {
                let bytes = decode_gzip_bytes(self.gzip, self.expected_bytes)?;
                if hex::encode(Sha256::digest(&bytes)) != self.raw_sha256 {
                    return Err(format!("packed {} decoded byte digest mismatch", self.name));
                }
                String::from_utf8(bytes)
                    .map_err(|error| format!("packed {} is not UTF-8: {error}", self.name))
            })
            .as_ref()
            .map(String::as_str)
            .map_err(Clone::clone)
    }

    /// Exact original-byte identity; the decoder verifies it before use.
    pub(crate) fn digest(&self) -> String {
        format!("sha256:{}", self.raw_sha256)
    }
}

include!(concat!(env!("OUT_DIR"), "/packed_json_assets.rs"));

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn packed(bytes: &[u8]) -> Vec<u8> {
        let mut compressor = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        compressor.write_all(bytes).unwrap();
        compressor.finish().unwrap()
    }

    #[test]
    fn deployed_assets_decode_to_every_original_byte_and_digest() {
        for (asset, original) in [
            (
                &ANDROID_REGISTRY,
                include_bytes!(
                    "../../../web/src/generated/android-method-profile-runtime-registry.json"
                )
                .as_slice(),
            ),
            (
                &SLEEP_DIARY_BRIDGE,
                include_bytes!("../../../web/schema/sleep-diary-catalog.bridge.json").as_slice(),
            ),
            (
                &ADAPTER_CONTRACT,
                include_bytes!("../../../web/schema/literature-input-adapter-contract.json")
                    .as_slice(),
            ),
            (
                &ADAPTER_CONFORMANCE,
                include_bytes!("../tests/fixtures/literature_input_adapter_conformance.json")
                    .as_slice(),
            ),
        ] {
            assert_eq!(asset.text().unwrap().as_bytes(), original);
            assert_eq!(asset.digest(), crate::sha256(original));
            assert!(asset.gzip.len() < original.len());
            assert!(std::ptr::eq(asset.text().unwrap(), asset.text().unwrap()));
        }
    }

    #[test]
    fn gzip_decode_refuses_corruption_truncation_trailing_members_and_size_changes() {
        let raw = b"{\"exact\":\"retained whitespace and text\"}\n";
        let gzip = packed(raw);
        assert_eq!(decode_gzip_bytes(&gzip, raw.len()).unwrap(), raw);
        for size in [0, raw.len() - 1, raw.len() + 1, MAX_DECODED_JSON_BYTES + 1] {
            assert!(decode_gzip_bytes(&gzip, size).is_err());
        }
        assert!(decode_gzip_bytes(&gzip[..gzip.len() - 1], raw.len()).is_err());
        assert!(decode_gzip_bytes(b"not gzip", raw.len()).is_err());
        let mut corrupt = gzip.clone();
        let last = corrupt.len() - 1;
        corrupt[last] ^= 1;
        assert!(decode_gzip_bytes(&corrupt, raw.len()).is_err());
        let mut trailing = gzip.clone();
        trailing.extend_from_slice(&gzip);
        assert!(decode_gzip_bytes(&trailing, raw.len()).is_err());
    }

    #[test]
    fn embedded_decode_refuses_digest_and_utf8_drift() {
        let wrong_digest = PackedJson {
            name: "test",
            gzip: b"invalid",
            expected_bytes: 1,
            raw_sha256: "wrong",
            text: OnceLock::new(),
        };
        assert!(wrong_digest.text().is_err());
        let raw = b"valid text";
        let gzip = Box::leak(packed(raw).into_boxed_slice());
        let wrong_digest = PackedJson {
            name: "test",
            gzip,
            expected_bytes: raw.len(),
            raw_sha256: "wrong",
            text: OnceLock::new(),
        };
        assert!(wrong_digest
            .text()
            .unwrap_err()
            .contains("byte digest mismatch"));
        let raw = b"\xff";
        let gzip = Box::leak(packed(raw).into_boxed_slice());
        let digest = Box::leak(hex::encode(Sha256::digest(raw)).into_boxed_str());
        let not_utf8 = PackedJson {
            name: "test",
            gzip,
            expected_bytes: raw.len(),
            raw_sha256: digest,
            text: OnceLock::new(),
        };
        assert!(not_utf8.text().unwrap_err().contains("not UTF-8"));
    }
}
