//! UbiqLog 5ba1c1a (2014-02-02), JsonEncodeDecode.java:12–56.
//! Date formatter outputs are supplied tokens, not inferred Date/locale/zone values.
use super::required_header;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const ADAPTER: &str = "chronicle.ubiqlog-released-literal-encoder";
pub(super) const KIND: &str = "literature-ubiqlog-released-literal-encoder-csv";
pub(super) const FIELDS: [&str; 18] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_platform",
    "input_stage",
    "kind",
    "friendly_name",
    "process_name",
    "start_text",
    "end_text",
    "phone_number",
    "duration",
    "time_text",
    "type",
    "body",
    "with_annotation",
    "annotation_name",
    "annotation_name_is_null",
];

fn boolean(value: &str) -> Result<bool, String> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(format!("{ADAPTER} requires an explicit nonnull boolean")),
    }
}
fn integer(value: &str) -> Result<String, String> {
    value
        .parse::<i32>()
        .map(|v| v.to_string())
        .map_err(|_| format!("{ADAPTER} requires a Java signed32 integer value"))
}

/// Concatenate the literal Java source strings. CSV quotes only the transport;
/// the source text is never parsed, repaired, escaped as JSON or evaluated.
pub(super) fn csv(raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader
        .headers()
        .map_err(|e| format!("{ADAPTER} header: {e}"))?
        .clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len()
        || headers.iter().any(|h| h == "encoded_source_text")
    {
        return Err(format!(
            "{ADAPTER} refuses duplicate or derived column identities"
        ));
    }
    let columns = FIELDS
        .iter()
        .map(|name| required_header(&headers, name, ADAPTER).map(|i| (*name, i)))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let mut output = csv::Writer::from_writer(Vec::new());
    output
        .write_record(headers.iter().chain(["encoded_source_text"]))
        .map_err(|e| format!("{ADAPTER} output: {e}"))?;
    let mut ids = BTreeSet::new();
    let mut count = 0;
    for row in reader.records() {
        let row = row.map_err(|e| format!("{ADAPTER} row: {e}"))?;
        let v = |name: &str| &row[columns[name]];
        for name in ["source_row_id", "participant_id", "device_id"] {
            if v(name).trim().is_empty() {
                return Err(format!("{ADAPTER} requires {name}"));
            }
        }
        if !ids.insert((
            v("participant_id").to_owned(),
            v("device_id").to_owned(),
            v("source_row_id").to_owned(),
        )) {
            return Err(format!("{ADAPTER} refuses ambiguous source row identity"));
        }
        if v("source_platform") != "Android"
            || v("input_stage") != "caller-supplied-v2014-source-formatted-date-tokens"
        {
            return Err(format!(
                "{ADAPTER} requires Android and supplied source formatter tokens"
            ));
        }
        let friendly = v("friendly_name");
        let encoded = match v("kind") {
            "APP" => format!(
                "{{\"{friendly}\":{{\"ProcessName\":\"{}\",\"Start\":\"{}\",\"End\":\"{}\"}}}}",
                v("process_name"),
                v("start_text"),
                v("end_text")
            ),
            "CALL" | "SMS" => {
                let annotate = boolean(v("with_annotation"))?;
                let null_name = boolean(v("annotation_name_is_null"))?;
                if null_name && !v("annotation_name").is_empty() {
                    return Err(format!(
                        "{ADAPTER} null annotation must have no competing string value"
                    ));
                }
                let name = if null_name {
                    "null"
                } else {
                    v("annotation_name")
                };
                let annotation = if annotate && (v("kind") == "CALL" || !null_name) {
                    format!(", \"metadata\": {{\"name\": \"{name}\"}}")
                } else {
                    String::new()
                };
                let kind = integer(v("type"))?;
                if v("kind") == "CALL" {
                    let duration = integer(v("duration"))?;
                    format!("{{\"{friendly}\":{{\"Number\":\"{}\",\"Duration\":\"{duration}\",\"Time\":\"{}\",\"Type\":\"{kind}\"{annotation}}}}}", v("phone_number"), v("time_text"))
                } else {
                    format!("{{\"{friendly}\":{{\"Address\":\"{}\",\"type\":\"{kind}\",\"date\":\"{}\",\"body\":\"{}\",\"Type\":\"{kind}\"{annotation}}}}}", v("phone_number"), v("time_text"), v("body"))
                }
            }
            _ => return Err(format!("{ADAPTER} requires APP, CALL or SMS")),
        };
        output
            .write_record(row.iter().chain([encoded.as_str()]))
            .map_err(|e| format!("{ADAPTER} output: {e}"))?;
        count += 1;
    }
    let bytes = output
        .into_inner()
        .map_err(|e| format!("{ADAPTER} output: {e}"))?;
    Ok((bytes, count, count))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(
        kind: &str,
        annotate: &str,
        null: &str,
        name: &str,
        body: &str,
        duration: &str,
    ) -> Vec<u8> {
        let mut w = csv::Writer::from_writer(Vec::new());
        w.write_record(FIELDS).unwrap();
        w.write_record([
            "r",
            "P",
            "D",
            "Android",
            "caller-supplied-v2014-source-formatted-date-tokens",
            kind,
            if kind == "APP" {
                "Application"
            } else if kind == "CALL" {
                "Call"
            } else {
                "SMS"
            },
            "org.app",
            "3-4-2014 01:02:03",
            "3-4-2014 01:02:10",
            "0123",
            duration,
            "3-4-2014 01:02:03",
            "1",
            body,
            annotate,
            name,
            null,
        ])
        .unwrap();
        w.into_inner().unwrap()
    }
    fn encoded(raw: &[u8]) -> String {
        let (out, _, _) = csv(raw).unwrap();
        csv::Reader::from_reader(out.as_slice())
            .records()
            .next()
            .unwrap()
            .unwrap()[18]
            .to_owned()
    }
    #[test]
    fn final_prepared_ubiqlog_literal_source_fields_null_annotation_and_no_escape() {
        assert_eq!(
            encoded(&input("APP", "", "", "", "", "")),
            r#"{"Application":{"ProcessName":"org.app","Start":"3-4-2014 01:02:03","End":"3-4-2014 01:02:10"}}"#
        );
        assert_eq!(
            encoded(&input("CALL", "true", "true", "", "", "-2")),
            r#"{"Call":{"Number":"0123","Duration":"-2","Time":"3-4-2014 01:02:03","Type":"1", "metadata": {"name": "null"}}}"#
        );
        let text = encoded(&input("SMS", "true", "true", "", "He said \"go\"", ""));
        assert!(text.contains("\"body\":\"He said \"go\"\",\"Type\":\"1\""));
        assert!(!text.contains("metadata"));
        assert!(serde_json::from_str::<serde_json::Value>(&text).is_err());
        assert!(encoded(&input("SMS", "true", "false", "", "", "")).contains("\"name\": \"\""));
        assert!(!encoded(&input(
            "CALL",
            "false",
            "false",
            "unused",
            "",
            "-2147483648"
        ))
        .contains("metadata"));
        assert!(csv(&input("CALL", "true", "true", "competing", "", "0")).is_err());
        assert!(csv(&input("CALL", "null", "true", "", "", "0")).is_err());
        assert!(csv(&input("CALL", "true", "true", "", "", "2147483648")).is_err());
    }
}
