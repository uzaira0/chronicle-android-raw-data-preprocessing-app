//! RFC 8785 (JCS) bytes, identical to `serde_jcs::to_vec`, without its
//! per-member allocations.
//!
//! `serde_jcs` buffers every object member in its own `Vec`, re-parses every
//! key through `serde_json::Value` to sort it, and boxes a `dyn Write` for each
//! write. Here the members of every open object share one buffer: a member is a
//! pair of byte ranges, and closing an object sorts its ranges and rewrites
//! that tail of the buffer in canonical order. Formatting rules (numbers via
//! `ryu_js` as f64, string escapes, UTF-16 key order, last duplicate wins) are
//! copied from `serde_jcs` 0.2.0; the tests below and
//! `pipeline_v2::tests::fast_jcs_matches_serde_jcs_on_a_whole_pipeline_result`
//! hold the two byte-for-byte equal. One difference is out of reach of every
//! caller: a bare top-level NaN or infinity serializes as `null` here, where
//! `serde_jcs` errors (nested ones are `null` in both).

use serde::Serialize;
use serde_json::ser::{CharEscape, Formatter};
use std::cell::Cell;
use std::cmp::Ordering;
use std::io::{self, Write};
use std::ops::Range;

/// `serde_jcs::to_vec`, byte for byte.
pub fn to_vec<T: Serialize + ?Sized>(value: &T) -> serde_json::Result<Vec<u8>> {
    let mut out = Vec::with_capacity(128);
    to_writer(&mut out, value)?;
    Ok(out)
}

/// `to_vec`, plus where the value of `key` in the outermost object sits in
/// the returned bytes. JCS nests verbatim, so those bytes are the JCS of that
/// member's value on its own.
pub fn to_vec_capturing<T: Serialize + ?Sized>(
    value: &T,
    key: &str,
) -> serde_json::Result<(Vec<u8>, Option<Range<usize>>)> {
    let quoted = serde_json::to_vec(key)?;
    let captured = Cell::new(None);
    let mut out = Vec::with_capacity(128);
    value.serialize(&mut serde_json::Serializer::with_formatter(
        &mut out,
        JcsFormatter {
            capture: Some((&quoted, &captured)),
            ..JcsFormatter::default()
        },
    ))?;
    Ok((out, captured.take()))
}

/// `serde_jcs::to_writer`, byte for byte.
pub fn to_writer<W: Write, T: Serialize + ?Sized>(writer: W, value: &T) -> serde_json::Result<()> {
    value.serialize(&mut serde_json::Serializer::with_formatter(
        writer,
        JcsFormatter::default(),
    ))
}

type CapturedRange = Cell<Option<Range<usize>>>;

struct Member {
    key: Range<usize>,
    value: Range<usize>,
    /// ASCII without escapes: byte order is UTF-16 order.
    plain: bool,
}

#[derive(Default)]
struct JcsFormatter<'a> {
    /// Bytes of every open object, innermost last.
    buf: Vec<u8>,
    /// Members of every open object, innermost last.
    members: Vec<Member>,
    /// Per open object: where its bytes and its members start.
    frames: Vec<(usize, usize)>,
    key_start: usize,
    scratch: Vec<u8>,
    /// Serialized key to find in the outermost object, and where its value
    /// landed in the output (valid when the output starts with that object).
    capture: Option<(&'a [u8], &'a CapturedRange)>,
}

impl JcsFormatter<'_> {
    #[inline]
    fn put<W: ?Sized + Write>(&mut self, writer: &mut W, bytes: &[u8]) -> io::Result<()> {
        if self.frames.is_empty() {
            writer.write_all(bytes)
        } else {
            self.buf.extend_from_slice(bytes);
            Ok(())
        }
    }
}

fn cmp_members(buf: &[u8], left: &Member, right: &Member) -> Ordering {
    let (left_key, right_key) = (&buf[left.key.clone()], &buf[right.key.clone()]);
    if left.plain && right.plain {
        left_key[1..left_key.len() - 1].cmp(&right_key[1..right_key.len() - 1])
    } else {
        cmp_keys(left_key, right_key)
    }
}

/// UTF-16 code-unit order of two serialized keys (quoted JSON strings).
fn cmp_keys(left: &[u8], right: &[u8]) -> Ordering {
    fn text(key: &[u8]) -> std::borrow::Cow<'_, str> {
        let inner = &key[1..key.len() - 1];
        if !inner.contains(&b'\\') {
            if let Ok(text) = std::str::from_utf8(inner) {
                return text.into();
            }
        }
        serde_json::from_slice::<String>(key)
            .unwrap_or_default()
            .into()
    }
    text(left).encode_utf16().cmp(text(right).encode_utf16())
}

impl Formatter for JcsFormatter<'_> {
    fn write_null<W: ?Sized + Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.put(writer, b"null")
    }

    fn write_bool<W: ?Sized + Write>(&mut self, writer: &mut W, value: bool) -> io::Result<()> {
        self.put(writer, if value { b"true" } else { b"false" })
    }

    fn write_char_escape<W: ?Sized + Write>(
        &mut self,
        writer: &mut W,
        escape: CharEscape,
    ) -> io::Result<()> {
        static HEX: [u8; 16] = *b"0123456789abcdef";
        let control;
        let bytes: &[u8] = match escape {
            CharEscape::Quote => b"\\\"",
            CharEscape::ReverseSolidus => b"\\\\",
            CharEscape::Solidus => b"/",
            CharEscape::Backspace => b"\\b",
            CharEscape::FormFeed => b"\\f",
            CharEscape::LineFeed => b"\\n",
            CharEscape::CarriageReturn => b"\\r",
            CharEscape::Tab => b"\\t",
            CharEscape::AsciiControl(byte) => {
                control = [
                    b'\\',
                    b'u',
                    b'0',
                    b'0',
                    HEX[(byte >> 4) as usize],
                    HEX[(byte & 0xF) as usize],
                ];
                &control
            }
        };
        self.put(writer, bytes)
    }

    fn write_number_str<W: ?Sized + Write>(&mut self, writer: &mut W, value: &str) -> io::Result<()> {
        self.write_f64(writer, value.parse().map_err(io::Error::other)?)
    }

    fn write_string_fragment<W: ?Sized + Write>(
        &mut self,
        writer: &mut W,
        fragment: &str,
    ) -> io::Result<()> {
        self.put(writer, fragment.as_bytes())
    }

    fn write_raw_fragment<W: ?Sized + Write>(
        &mut self,
        writer: &mut W,
        fragment: &str,
    ) -> io::Result<()> {
        let value: serde_json::Value = serde_json::from_str(fragment)?;
        let bytes = to_vec(&value)?;
        self.put(writer, &bytes)
    }

    fn write_i8<W: ?Sized + Write>(&mut self, writer: &mut W, value: i8) -> io::Result<()> {
        self.write_f64(writer, f64::from(value))
    }

    fn write_i16<W: ?Sized + Write>(&mut self, writer: &mut W, value: i16) -> io::Result<()> {
        self.write_f64(writer, f64::from(value))
    }

    fn write_i32<W: ?Sized + Write>(&mut self, writer: &mut W, value: i32) -> io::Result<()> {
        self.write_f64(writer, f64::from(value))
    }

    #[allow(clippy::cast_precision_loss)]
    fn write_i64<W: ?Sized + Write>(&mut self, writer: &mut W, value: i64) -> io::Result<()> {
        self.write_f64(writer, value as f64)
    }

    #[allow(clippy::cast_precision_loss)]
    fn write_i128<W: ?Sized + Write>(&mut self, writer: &mut W, value: i128) -> io::Result<()> {
        self.write_f64(writer, value as f64)
    }

    fn write_u8<W: ?Sized + Write>(&mut self, writer: &mut W, value: u8) -> io::Result<()> {
        self.write_f64(writer, f64::from(value))
    }

    fn write_u16<W: ?Sized + Write>(&mut self, writer: &mut W, value: u16) -> io::Result<()> {
        self.write_f64(writer, f64::from(value))
    }

    fn write_u32<W: ?Sized + Write>(&mut self, writer: &mut W, value: u32) -> io::Result<()> {
        self.write_f64(writer, f64::from(value))
    }

    #[allow(clippy::cast_precision_loss)]
    fn write_u64<W: ?Sized + Write>(&mut self, writer: &mut W, value: u64) -> io::Result<()> {
        self.write_f64(writer, value as f64)
    }

    #[allow(clippy::cast_precision_loss)]
    fn write_u128<W: ?Sized + Write>(&mut self, writer: &mut W, value: u128) -> io::Result<()> {
        self.write_f64(writer, value as f64)
    }

    fn write_f32<W: ?Sized + Write>(&mut self, writer: &mut W, value: f32) -> io::Result<()> {
        self.write_f64(writer, f64::from(value))
    }

    fn write_f64<W: ?Sized + Write>(&mut self, writer: &mut W, value: f64) -> io::Result<()> {
        if !value.is_finite() {
            return Err(io::Error::other("invalid float value"));
        }
        let mut buffer = ryu_js::Buffer::new();
        let text = buffer.format_finite(value);
        self.put(writer, text.as_bytes())
    }

    fn begin_string<W: ?Sized + Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.put(writer, b"\"")
    }

    fn end_string<W: ?Sized + Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.put(writer, b"\"")
    }

    fn begin_array<W: ?Sized + Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.put(writer, b"[")
    }

    fn end_array<W: ?Sized + Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.put(writer, b"]")
    }

    fn begin_array_value<W: ?Sized + Write>(&mut self, writer: &mut W, first: bool) -> io::Result<()> {
        if first {
            Ok(())
        } else {
            self.put(writer, b",")
        }
    }

    fn end_array_value<W: ?Sized + Write>(&mut self, _writer: &mut W) -> io::Result<()> {
        Ok(())
    }

    fn begin_object<W: ?Sized + Write>(&mut self, _writer: &mut W) -> io::Result<()> {
        self.frames.push((self.buf.len(), self.members.len()));
        Ok(())
    }

    fn end_object<W: ?Sized + Write>(&mut self, writer: &mut W) -> io::Result<()> {
        let (start, first_member) = self
            .frames
            .pop()
            .ok_or_else(|| io::Error::other("end_object called before begin_object"))?;
        let buf = &self.buf;
        let members = &mut self.members[first_member..];
        // Stable, so among equal keys the last one written stays last.
        members.sort_by(|left, right| cmp_members(buf, left, right));
        let mut out = std::mem::take(&mut self.scratch);
        out.clear();
        out.push(b'{');
        let mut index = 0;
        while index < members.len() {
            // A BTreeMap insert keeps the first key and the last value.
            let key = members[index].key.clone();
            let mut last = index;
            while last + 1 < members.len()
                && cmp_members(buf, &members[index], &members[last + 1]) == Ordering::Equal
            {
                last += 1;
            }
            if index != 0 {
                out.push(b',');
            }
            out.extend_from_slice(&buf[key.clone()]);
            out.push(b':');
            let value = &buf[members[last].value.clone()];
            if let Some((wanted, captured)) = self.capture {
                if self.frames.is_empty() && buf[key] == *wanted {
                    captured.set(Some(out.len()..out.len() + value.len()));
                }
            }
            out.extend_from_slice(value);
            index = last + 1;
        }
        out.push(b'}');
        self.members.truncate(first_member);
        self.buf.truncate(start);
        let result = self.put(writer, &out);
        self.scratch = out;
        result
    }

    fn begin_object_key<W: ?Sized + Write>(&mut self, _writer: &mut W, _first: bool) -> io::Result<()> {
        self.key_start = self.buf.len();
        Ok(())
    }

    fn end_object_key<W: ?Sized + Write>(&mut self, _writer: &mut W) -> io::Result<()> {
        Ok(())
    }

    fn begin_object_value<W: ?Sized + Write>(&mut self, _writer: &mut W) -> io::Result<()> {
        // Pushed before the value so a nested object's members stack above it.
        let key_end = self.buf.len();
        let key = &self.buf[self.key_start..key_end];
        let plain = key.is_ascii() && !key.contains(&b'\\');
        self.members.push(Member {
            key: self.key_start..key_end,
            value: key_end..key_end,
            plain,
        });
        Ok(())
    }

    fn end_object_value<W: ?Sized + Write>(&mut self, _writer: &mut W) -> io::Result<()> {
        let end = self.buf.len();
        let member = self
            .members
            .last_mut()
            .ok_or_else(|| io::Error::other("end_object_value called before begin_object"))?;
        member.value.end = end;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::to_vec;
    use proptest::prelude::*;
    use serde::ser::{SerializeMap, Serializer};
    use serde_json::{json, Map, Value};

    fn assert_same<T: serde::Serialize + ?Sized>(value: &T) {
        assert_eq!(
            String::from_utf8(to_vec(value).unwrap()).unwrap(),
            serde_jcs::to_string(value).unwrap()
        );
    }

    #[test]
    fn matches_serde_jcs_on_key_order_escapes_and_numbers() {
        let mut keys = Map::new();
        for key in [
            "a", "a ", "a!", "a\"", "", "b", "B", "\u{7f}", "\u{e9}", "\u{e000}", "\u{ffff}",
            "\u{10000}", "\u{1f600}", "\\", "/", "\n", "\u{1}", "\u{1f}", "10", "9",
        ] {
            keys.insert(key.to_owned(), json!(key));
        }
        let numbers = json!([
            0, -0.0, 1, -1, 0.1, 1e21, 1e-7, 1.5e300, 5e-324, f64::MAX, f64::MIN_POSITIVE,
            9_007_199_254_740_993_u64, u64::MAX, i64::MIN, 123_456_789.123_456_79, 1e20, 1e-6
        ]);
        let value = json!({
            "keys": keys,
            "numbers": numbers,
            "nested": [{"z": {"y": [{"b": 1, "a": {}}, []]}, "a": null}, {}, [[{"c": true, "b": false}]]],
            "text": "tab\tquote\"back\\slash/\u{0}\u{1f}\u{7f}\u{2028}\u{1f600}",
        });
        assert_same(&value);
        assert_same(&json!([{"b": 1, "a": 2}, {"d": {"f": 1, "e": 2}}]));
        assert_same(&json!({}));
        assert_same(&json!("top"));
        assert_same(&json!(12.5));
        assert_same(&Some(std::collections::BTreeMap::from([(3_u32, "x"), (20, "y")])));
    }

    #[test]
    fn matches_serde_jcs_on_duplicate_keys() {
        struct Duplicates;
        impl serde::Serialize for Duplicates {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                let mut map = serializer.serialize_map(None)?;
                map.serialize_entry("b", &1)?;
                map.serialize_entry("a", &json!({"y": 1, "x": 2}))?;
                map.serialize_entry("b", &2)?;
                map.serialize_entry("a", &3)?;
                map.serialize_entry("b", &json!([3]))?;
                map.end()
            }
        }
        assert_same(&Duplicates);
        assert_same(&std::collections::BTreeMap::from([("outer", [Duplicates, Duplicates])]));
    }

    #[test]
    fn a_captured_member_is_the_jcs_of_that_value_alone() {
        let inner = json!({"z": [1, {"b": 2, "a": 3}], "y": "t"});
        let value = json!({"b": {"inner": 1}, "inner": inner, "a": [{"inner": 0}]});
        let (bytes, range) = super::to_vec_capturing(&value, "inner").unwrap();
        assert_eq!(bytes, to_vec(&value).unwrap());
        assert_eq!(bytes[range.unwrap()], to_vec(&inner).unwrap()[..]);
        let (_, missing) = super::to_vec_capturing(&value, "absent").unwrap();
        assert_eq!(missing, None);
    }

    fn arbitrary_json() -> impl Strategy<Value = Value> {
        let key = prop_oneof![
            "[a-c ]{0,3}",
            any::<String>(),
            prop::sample::select(vec!["\u{e000}".to_owned(), "\u{10000}".to_owned(), "\u{ffff}".to_owned()]),
        ];
        let leaf = prop_oneof![
            Just(Value::Null),
            any::<bool>().prop_map(Value::from),
            any::<i64>().prop_map(Value::from),
            any::<u64>().prop_map(Value::from),
            any::<f64>()
                .prop_filter("finite", |value| value.is_finite())
                .prop_map(Value::from),
            any::<String>().prop_map(Value::from),
        ];
        leaf.prop_recursive(4, 64, 8, move |inner| {
            prop_oneof![
                prop::collection::vec(inner.clone(), 0..6).prop_map(Value::Array),
                prop::collection::vec((key.clone(), inner), 0..6)
                    .prop_map(|members| Value::Object(members.into_iter().collect())),
            ]
        })
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(2_000))]
        #[test]
        fn matches_serde_jcs_on_arbitrary_json(value in arbitrary_json()) {
            prop_assert_eq!(to_vec(&value).unwrap(), serde_jcs::to_vec(&value).unwrap());
        }
    }
}
