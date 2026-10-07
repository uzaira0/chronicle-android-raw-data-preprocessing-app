//! Shared bounded lossless decoder, included by both existing browser crates.
use flate2::bufread::GzDecoder;
use std::io::Read;

pub(crate) const MAX_DECODED_JSON_BYTES: usize = 16 * 1024 * 1024;

pub(crate) fn decode_gzip_bytes(packed: &[u8], expected_bytes: usize) -> Result<Vec<u8>, String> {
    if expected_bytes == 0 || expected_bytes > MAX_DECODED_JSON_BYTES {
        return Err("packed JSON decoded size is outside its supported bound".into());
    }
    let mut decoder = GzDecoder::new(packed).take(expected_bytes as u64 + 1);
    let mut bytes = Vec::with_capacity(expected_bytes);
    decoder
        .read_to_end(&mut bytes)
        .map_err(|error| format!("invalid packed JSON gzip: {error}"))?;
    if bytes.len() != expected_bytes {
        return Err("packed JSON decoded size mismatch".into());
    }
    if !decoder.into_inner().into_inner().is_empty() {
        return Err("packed JSON gzip has trailing bytes".into());
    }
    Ok(bytes)
}
