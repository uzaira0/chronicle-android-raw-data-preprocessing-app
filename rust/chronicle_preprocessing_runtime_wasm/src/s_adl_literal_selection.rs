//! sequence-v9.py:14–18,31–43(field choice),49–104, commit
//! 9203534419c39862351c694f05daf11a7734df94, SHA256
//! 7617852f43cf258628845de399ab11aa8db1b1a5f3c5482f438f02d19bf5212d.
//! Source line 28 is executed for supplied common typed timestamp keys with
//! no ties. Clock values and resolved datetime bounds are separately supplied
//! Python-str-rendered values. No pandas parser, inferred typing, sort-tie rule
//! or Excel serializer is recreated. Literal requirements are CSV metadata.

use super::{
    parse_python_float, record_value, required_header, S_ADL_LITERAL_SELECTION_ADAPTER as ADAPTER,
};
use serde_json::value::RawValue;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

const QUALIFICATION: &str = "source_python_str_values_and_bounds";
const KEPT_KEYS: [&str; 7] = [
    "packageName",
    "type",
    "isPosted",
    "messageBox",
    "currentKey",
    "prevKey",
    "timeTaken",
];

#[derive(PartialEq, Eq)]
struct Invocation {
    requirements: Vec<String>,
    lower: String,
    upper: String,
    sort_type: String,
}

enum SortKey {
    Missing,
    Int64(i64),
    Uint64(u64),
    Float64(f64),
    Text(String),
}

impl SortKey {
    fn compare(&self, other: &Self) -> Ordering {
        match (self, other) {
            (Self::Missing, Self::Missing) => Ordering::Equal,
            (Self::Missing, _) => Ordering::Greater,
            (_, Self::Missing) => Ordering::Less,
            (Self::Int64(left), Self::Int64(right)) => left.cmp(right),
            (Self::Uint64(left), Self::Uint64(right)) => left.cmp(right),
            (Self::Float64(left), Self::Float64(right)) => {
                left.partial_cmp(right).expect("NaN keys refused")
            }
            (Self::Text(left), Self::Text(right)) => left.cmp(right),
            _ => unreachable!("invocation has one common timestamp key type"),
        }
    }
}

fn sort_key(kind: &str, value: &str, missing: &str) -> Result<SortKey, String> {
    match missing {
        "true" if value.is_empty() => return Ok(SortKey::Missing),
        "false" => (),
        _ => {
            return Err(format!(
                "{ADAPTER} timestamp_sort_key_missing must be true with an empty key, or false"
            ))
        }
    }
    let invalid = || format!("{ADAPTER} timestamp_sort_key is not supplied {kind}");
    match kind {
        "int64" => value.parse().map(SortKey::Int64).map_err(|_| invalid()),
        "uint64" => value.parse().map(SortKey::Uint64).map_err(|_| invalid()),
        "float64" => {
            let key = parse_python_float(value, "timestamp_sort_key", 0)?;
            if key.is_nan() {
                return Err(format!(
                    "{ADAPTER} NaN timestamp key requires explicit missing=true and empty key"
                ));
            }
            Ok(SortKey::Float64(key))
        }
        "string" => Ok(SortKey::Text(value.to_owned())),
        _ => Err(format!(
            "{ADAPTER} timestamp_sort_type must be int64, uint64, float64 or string"
        )),
    }
}

struct Row {
    source_row_id: String,
    datum_type: String,
    offset_timestamp: String,
    timestamp: String,
    value: String,
    posted_source_str: String,
    sort_key: SortKey,
}

struct SelectedRow {
    row: Row,
    requirement_id: String,
    value: String,
}

fn python_rstrip(line: &str) -> &str {
    line.trim_end_matches(|c| {
        matches!(c,
        '\u{0009}'..='\u{000d}' | '\u{001c}'..='\u{0020}' | '\u{0085}' | '\u{00a0}' |
        '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' |
        '\u{202f}' | '\u{205f}' | '\u{3000}')
    })
}

fn string_field_matches(value: &RawValue, token: &str, key: &str) -> Result<bool, String> {
    let text: String = serde_json::from_str(value.get())
        .map_err(|_| format!("{ADAPTER} source .lower() requires string {key}"))?;
    ascii_lower_matches(&text, token)
}

fn ascii_lower_matches(left: &str, right: &str) -> Result<bool, String> {
    if !left.is_ascii() || !right.is_ascii() {
        return Err(format!("{ADAPTER} compared .lower() values require the declared ASCII domain; Unicode case-table parity is not claimed"));
    }
    Ok(left.eq_ignore_ascii_case(right))
}

fn posted_matches(value: &RawValue, token: &str, supplied: &str) -> Result<bool, String> {
    let raw = value.get();
    let rendered = match raw {
        "true" => "True".to_owned(),
        "false" => "False".to_owned(),
        "null" => "None".to_owned(),
        "-0" => "0".to_owned(),
        text if text.starts_with('"') => serde_json::from_str::<String>(text)
            .map_err(|error| format!("{ADAPTER} isPosted string: {error}"))?,
        text if !text.starts_with(['[', '{']) && !text.contains(['.', 'e', 'E']) => text.to_owned(),
        _ if !supplied.is_empty() => supplied.to_owned(),
        _ => {
            return Err(format!(
                "{ADAPTER} float/composite isPosted requires qualified isPosted_source_str"
            ))
        }
    };
    ascii_lower_matches(&rendered, token)
}

fn any_field_matches(
    object: &BTreeMap<String, Box<RawValue>>,
    keys: &[&str],
    token: &str,
    posted_source_str: &str,
) -> Result<bool, String> {
    // The order and short circuit are the source OR expressions, not a set
    // membership operation: a nonstring earlier field can raise before a
    // later matching field is considered.
    for key in keys {
        if let Some(value) = object.get(*key) {
            let matched = if *key == "isPosted" {
                posted_matches(value, token, posted_source_str)?
            } else {
                string_field_matches(value, token, key)?
            };
            if matched {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn retained_json(object: &BTreeMap<String, Box<RawValue>>) -> Result<String, String> {
    let mut fields = Vec::new();
    for key in KEPT_KEYS {
        if let Some(value) = object.get(key) {
            let key = serde_json::to_string(key).map_err(|error| error.to_string())?;
            fields.push(format!("{key}:{}", parsed_json_carrier(value)?));
        }
    }
    Ok(format!("{{{}}}", fields.join(",")))
}

fn parsed_json_carrier(value: &RawValue) -> Result<String, String> {
    // json.loads keeps arbitrary-sized integers but converts decimal/exponent
    // numbers to binary64. RawValue avoids first losing large integers through
    // serde_json::Value. This is a JSON value carrier, not Python dict repr or
    // the released pandas/Excel serializer; nested object key order is not a
    // serializer claim either.
    let raw = value.get();
    if raw.starts_with('[') {
        let elements: Vec<Box<RawValue>> =
            serde_json::from_str(raw).map_err(|error| error.to_string())?;
        let elements = elements
            .iter()
            .map(|value| parsed_json_carrier(value))
            .collect::<Result<Vec<_>, _>>()?;
        return Ok(format!("[{}]", elements.join(",")));
    }
    if raw.starts_with('{') {
        let fields: BTreeMap<String, Box<RawValue>> =
            serde_json::from_str(raw).map_err(|error| error.to_string())?;
        let fields = fields
            .iter()
            .map(|(key, value)| {
                Ok(format!(
                    "{}:{}",
                    serde_json::to_string(key).map_err(|error| error.to_string())?,
                    parsed_json_carrier(value)?
                ))
            })
            .collect::<Result<Vec<_>, String>>()?;
        return Ok(format!("{{{}}}", fields.join(",")));
    }
    if raw.starts_with('"') || matches!(raw, "true" | "false" | "null") {
        return Ok(raw.to_owned());
    }
    if raw.contains(['.', 'e', 'E']) {
        let value = parse_python_float(raw, "retained JSON float", 0)?;
        if !value.is_finite() {
            return Err(format!(
                "{ADAPTER} retained nonfinite JSON float has no strict JSON carrier representation"
            ));
        }
        return serde_json::to_string(&value).map_err(|error| error.to_string());
    }
    Ok(if raw == "-0" { "0" } else { raw }.to_owned())
}

fn select(rows: Vec<Row>, invocation: &Invocation) -> Result<Vec<SelectedRow>, String> {
    let lower_offset = invocation.requirements[0].ends_with('Z');
    let upper_offset = invocation.requirements[1].ends_with('Z');
    let mut entered = false;
    let mut selected = Vec::new();
    for row in rows {
        let upper_value = if upper_offset {
            &row.offset_timestamp
        } else {
            &row.timestamp
        };
        if upper_value > &invocation.upper {
            break;
        }
        if !entered {
            let lower_value = if lower_offset {
                &row.offset_timestamp
            } else {
                &row.timestamp
            };
            if lower_value >= &invocation.lower {
                entered = true;
            } else {
                continue;
            }
        }
        for requirement in invocation.requirements.iter().skip(3) {
            let parts = requirement.split('-').collect::<Vec<_>>();
            // This happens before datumType comparison in source line 65.
            let raw: Box<RawValue> = serde_json::from_str(&row.value).map_err(|error| {
                format!(
                    "{ADAPTER} activated row {} JSON: {error}",
                    row.source_row_id
                )
            })?;
            if !ascii_lower_matches(&row.datum_type, parts[0])? {
                continue;
            }
            let object: BTreeMap<String, Box<RawValue>> =
                serde_json::from_str(raw.get()).map_err(|_| {
                    format!(
                        "{ADAPTER} matching row {} source value.keys() requires an object",
                        row.source_row_id
                    )
                })?;
            let matched = if parts.len() == 1 {
                true
            } else {
                any_field_matches(
                    &object,
                    &["type", "packageName", "isPosted", "messageBox"],
                    parts[1],
                    &row.posted_source_str,
                )? && (parts.len() == 2
                    || any_field_matches(
                        &object,
                        &["type", "isPosted"],
                        parts[2],
                        &row.posted_source_str,
                    )?)
            };
            if matched {
                let value = retained_json(&object)?;
                selected.push(SelectedRow {
                    row,
                    requirement_id: parts.join("_"),
                    value,
                });
                break;
            }
        }
    }
    Ok(selected)
}

pub(super) fn prepare_literal_selection_csv(
    raw_csv: &[u8],
) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::Reader::from_reader(raw_csv);
    let headers = reader
        .headers()
        .map_err(|error| format!("{ADAPTER} header: {error}"))?
        .clone();
    if headers.len() != 13 || headers.iter().collect::<BTreeSet<_>>().len() != 13 {
        return Err(format!(
            "{ADAPTER} requires thirteen unique qualified carrier columns"
        ));
    }
    let column = |name| required_header(&headers, name, ADAPTER);
    let id = column("source_row_id")?;
    let requirements = column("requirements_json")?;
    let qualification = column("source_values_qualification")?;
    let lower = column("lower_bound_rendered")?;
    let upper = column("upper_bound_rendered")?;
    let datum = column("datumType")?;
    let offset = column("offsetTimestamp")?;
    let timestamp = column("timestamp")?;
    let value = column("value")?;
    let posted = column("isPosted_source_str")?;
    let sort_type = column("timestamp_sort_type")?;
    let key = column("timestamp_sort_key")?;
    let key_missing = column("timestamp_sort_key_missing")?;
    let mut invocation = None;
    let mut rows = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|error| format!("{ADAPTER} row {}: {error}", index + 1))?;
        let field = |column| record_value(&record, Some(column));
        if field(id).is_empty() || field(qualification) != QUALIFICATION {
            return Err(format!("{ADAPTER} row {} requires source_row_id and explicit source-rendering qualification", index + 1));
        }
        let reqs: Vec<String> = serde_json::from_str(field(requirements))
            .map_err(|error| format!("{ADAPTER} literal requirements_json: {error}"))?;
        let reqs = reqs
            .iter()
            .map(|line| python_rstrip(line).to_owned())
            .collect::<Vec<_>>();
        if reqs.len() < 3 || reqs[0].is_empty() || reqs[1].is_empty() {
            return Err(format!(
                "{ADAPTER} requires three requirement header lines and nonempty bounds"
            ));
        }
        let supplied = Invocation {
            requirements: reqs,
            lower: field(lower).to_owned(),
            upper: field(upper).to_owned(),
            sort_type: field(sort_type).to_owned(),
        };
        if !["int64", "uint64", "float64", "string"].contains(&supplied.sort_type.as_str()) {
            return Err(format!(
                "{ADAPTER} timestamp_sort_type must be int64, uint64, float64 or string"
            ));
        }
        for (line, rendered) in [
            (&supplied.requirements[0], &supplied.lower),
            (&supplied.requirements[1], &supplied.upper),
        ] {
            if !line.ends_with('Z') && line != rendered {
                return Err(format!(
                    "{ADAPTER} non-Z bounds must retain the literal source timestamp string"
                ));
            }
        }
        if invocation.as_ref().is_some_and(|first| first != &supplied) {
            return Err(format!(
                "{ADAPTER} row {} has inconsistent invocation metadata",
                index + 1
            ));
        }
        invocation.get_or_insert(supplied);
        rows.push(Row {
            source_row_id: field(id).to_owned(),
            datum_type: field(datum).to_owned(),
            offset_timestamp: field(offset).to_owned(),
            timestamp: field(timestamp).to_owned(),
            value: field(value).to_owned(),
            posted_source_str: field(posted).to_owned(),
            sort_key: sort_key(field(sort_type), field(key), field(key_missing))?,
        });
    }
    let invocation =
        invocation.ok_or_else(|| format!("{ADAPTER} requires a metadata-bearing source row"))?;
    let source_rows = rows.len();
    // With distinct comparable keys the ascending result is independent of
    // pandas' unspecified default tie algorithm. Missing keys sort last.
    rows.sort_unstable_by(|left, right| left.sort_key.compare(&right.sort_key));
    if rows
        .windows(2)
        .any(|pair| pair[0].sort_key.compare(&pair[1].sort_key) == Ordering::Equal)
    {
        return Err(format!("{ADAPTER} tied timestamp keys (including multiple missing keys) require unavailable source sort-tie behavior"));
    }
    let selected = select(rows, &invocation)?;
    let mut totals = BTreeMap::new();
    for row in &selected {
        *totals.entry(row.requirement_id.as_str()).or_insert(0usize) += 1;
    }
    let mut ordinals = BTreeMap::new();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "source_row_id",
            "requirement_id",
            "datumType",
            "offsetTimestamp",
            "timestamp",
            "value",
            "count",
        ])
        .map_err(|error| format!("{ADAPTER} output header: {error}"))?;
    for selected_row in &selected {
        let ordinal = ordinals
            .entry(selected_row.requirement_id.as_str())
            .or_insert(0usize);
        *ordinal += 1;
        let count = format!(
            "{ordinal} / {}",
            totals[selected_row.requirement_id.as_str()]
        );
        let offset = format!(
            "{}T{}.000Z",
            selected_row
                .row
                .offset_timestamp
                .chars()
                .take(10)
                .collect::<String>(),
            selected_row
                .row
                .offset_timestamp
                .chars()
                .skip(11)
                .collect::<String>()
        );
        writer
            .write_record([
                &selected_row.row.source_row_id,
                &selected_row.requirement_id,
                &selected_row.row.datum_type,
                &offset,
                &selected_row.row.timestamp,
                &selected_row.value,
                &count,
            ])
            .map_err(|error| format!("{ADAPTER} output row: {error}"))?;
    }
    let output = writer
        .into_inner()
        .map_err(|error| format!("{ADAPTER} output: {error}"))?;
    Ok((output, source_rows, selected.len()))
}

#[cfg(test)]
pub(super) fn fixture_csv(case: &serde_json::Value, defaults: &serde_json::Value) -> Vec<u8> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "source_row_id",
            "requirements_json",
            "source_values_qualification",
            "lower_bound_rendered",
            "upper_bound_rendered",
            "datumType",
            "offsetTimestamp",
            "timestamp",
            "value",
            "isPosted_source_str",
            "timestamp_sort_type",
            "timestamp_sort_key",
            "timestamp_sort_key_missing",
        ])
        .unwrap();
    let requirements = case
        .get("requirements")
        .unwrap_or(&defaults["requirements"]);
    let requirements = serde_json::to_string(requirements).unwrap();
    let default = |name: &str| case.get(name).unwrap_or(&defaults[name]).as_str().unwrap();
    for row in case["rows"].as_array().unwrap() {
        let field = |name: &str, fallback: &str| {
            row.get(name)
                .and_then(|value| value.as_str())
                .unwrap_or(fallback)
                .to_owned()
        };
        let key = field("key", "1");
        writer
            .write_record([
                field("id", "row"),
                row.get("requirements_override")
                    .map(|value| serde_json::to_string(value).unwrap())
                    .unwrap_or_else(|| requirements.clone()),
                QUALIFICATION.to_owned(),
                field("lower_override", default("lower")),
                field("upper_override", default("upper")),
                field("datum", "EVENT"),
                field("offset", "NaT"),
                field("timestamp", &key),
                field("value", "{}"),
                field("posted", ""),
                default("sort_type").to_owned(),
                key,
                row.get("missing")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
                    .to_string(),
            ])
            .unwrap();
    }
    writer.into_inner().unwrap()
}

#[cfg(test)]
pub(super) fn assert_fixture_output(case: &serde_json::Value, output: &[u8]) {
    let mut reader = csv::Reader::from_reader(output);
    assert_eq!(
        reader.headers().unwrap().iter().collect::<Vec<_>>(),
        [
            "source_row_id",
            "requirement_id",
            "datumType",
            "offsetTimestamp",
            "timestamp",
            "value",
            "count"
        ]
    );
    let actual: Vec<Vec<String>> = reader
        .records()
        .map(|row| row.unwrap().iter().map(str::to_owned).collect())
        .collect();
    let expected: Vec<Vec<String>> = serde_json::from_value(case["expected"].clone()).unwrap();
    assert_eq!(actual, expected, "{}", case["id"]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn s_adl_literal_selection_source_read_hand_cases() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/s_adl_literal_selection.json"
        ))
        .unwrap();
        for case in fixtures["cases"].as_array().unwrap() {
            let input = fixture_csv(case, &fixtures["defaults"]);
            let result = prepare_literal_selection_csv(&input);
            if let Some(error) = case["error"].as_str() {
                assert!(
                    result.expect_err("hand case must fail").contains(error),
                    "{}",
                    case["id"]
                );
            } else {
                let (output, sources, emitted) =
                    result.unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
                assert_eq!(sources, case["rows"].as_array().unwrap().len());
                assert_eq!(emitted, case["expected"].as_array().unwrap().len());
                assert_fixture_output(case, &output);
            }
        }
    }

    #[test]
    fn s_adl_literal_selection_typed_sort_uses_integer_and_ieee_comparisons() {
        // Independent explicit expectations; no author code or float casts for integers.
        assert_eq!(
            sort_key("int64", "9007199254740993", "false")
                .unwrap()
                .compare(&sort_key("int64", "9007199254740992", "false").unwrap()),
            Ordering::Greater
        );
        assert_eq!(
            sort_key("uint64", "18446744073709551615", "false")
                .unwrap()
                .compare(&sort_key("uint64", "0", "false").unwrap()),
            Ordering::Greater
        );
        assert_eq!(
            sort_key("float64", "-0", "false")
                .unwrap()
                .compare(&sort_key("float64", "0", "false").unwrap()),
            Ordering::Equal
        );
        assert_eq!(
            sort_key("float64", "-inf", "false")
                .unwrap()
                .compare(&sort_key("float64", "inf", "false").unwrap()),
            Ordering::Less
        );
        assert_eq!(
            sort_key("string", "10", "false")
                .unwrap()
                .compare(&sort_key("string", "2", "false").unwrap()),
            Ordering::Less
        );
        assert_eq!(
            SortKey::Missing.compare(&sort_key("int64", "9223372036854775807", "false").unwrap()),
            Ordering::Greater
        );
    }
}
