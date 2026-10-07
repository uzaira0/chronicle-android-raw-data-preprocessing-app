//! Prepared post-SDK ODIM gesture arithmetic, not Android acquisition or study parity.
//!
//! CoreAccessibilityService.kt:382–412 and Gesture.kt:3–20 at
//! 5237a464bbefd17dac1f200ff77e561b26a16f32 (later 2025-11-14 artifact).
//! Core ORIGINAL bytes SHA256 f4415db28ca2b6e705c7bb4442c267e53d3a55a3c541275def1ce9e25d1222e5.
//! API-returned centers/extents and SystemUI/scroll qualification are supplied.
//! Rect center construction, viewport acquisition and event pairing are upstream.

use super::required_header;
use std::collections::BTreeSet;

const FIELDS: [&str; 17] = [
    "source_row_id", "participant_id", "device_id", "stream_id", "viewport_id",
    "argument_domain", "viewport_width_i32", "viewport_height_i32",
    "node_bounds_state", "node_center_x_i32", "node_center_y_i32",
    "is_system_ui_button_pressed", "class_name_json", "view_id_json",
    "scroll_state", "scroll_delta_x_i32", "scroll_delta_y_i32",
];
const OUTPUT: [&str; 11] = [
    "gesture_center_x_f32_bits", "gesture_center_x_ieee_class",
    "gesture_center_y_f32_bits", "gesture_center_y_ieee_class",
    "gesture_scroll_dx_f32_bits", "gesture_scroll_dx_ieee_class",
    "gesture_scroll_dy_f32_bits", "gesture_scroll_dy_ieee_class",
    "gesture_class_name_json", "gesture_view_id_json", "gesture_verified",
];

#[derive(Debug)]
pub(super) struct Gesture {
    pub values: [f32; 4],
    pub class_name: Option<String>,
    pub view_id: Option<String>,
}

/// The retained Kotlin function first casts both API extents to Float. Keep
/// each binary32 operation and early constructor branch; do not fold width/2/width,
/// use a floating bounding-box center, clip, or impose a zero-division policy.
pub(super) fn supplied_gesture(
    viewport: (i32, i32),
    centers: Option<(i32, i32)>,
    is_system_ui: bool,
    class_name: &str,
    view_id: Option<&str>,
    scroll: Option<(i32, i32)>,
) -> Gesture {
    let width = viewport.0 as f32;
    let height = viewport.1 as f32;
    let (center_x, center_y) = match centers {
        None if !is_system_ui => {
            return Gesture {
                values: [-1.0_f32; 4],
                class_name: Some(class_name.to_owned()),
                view_id: None,
            };
        }
        None => ((width / 2.0_f32) / width, (height - 30.0_f32) / height),
        Some((x, y)) => ((x as f32) / width, (y as f32) / height),
    };
    let (scroll_dx, scroll_dy) = match scroll {
        Some((x, y)) => ((x as f32) / width, (y as f32) / height),
        None => (0.0_f32, 0.0_f32),
    };
    Gesture {
        values: [center_x, center_y, scroll_dx, scroll_dy],
        class_name: None,
        view_id: view_id.map(str::to_owned),
    }
}

/// Deterministic engineering transport, not Kotlin Float.toString or NaN-payload
/// equivalence. Finite values (including signed zero) have exactly eight hex bits.
/// Exceptional values have a class and no claimed payload bits/numeric JSON.
pub(super) fn float_transport(value: f32) -> (String, &'static str) {
    if value.is_nan() {
        (String::new(), "nan")
    } else if value == f32::INFINITY {
        (String::new(), "positive_infinity")
    } else if value == f32::NEG_INFINITY {
        (String::new(), "negative_infinity")
    } else {
        (format!("{:08x}", value.to_bits()), "finite")
    }
}

fn int32(cell: &str, field: &str, row: usize, adapter: &str) -> Result<i32, String> {
    // A typed decimal int32 carrier, not raw Android coercion or CSV-byte parity.
    cell.trim().parse::<i32>()
        .map_err(|_| format!("{adapter} row {row} requires signed32 {field}"))
}
fn string_json(
    cell: &str, nullable: bool, field: &str, row: usize, adapter: &str,
) -> Result<Option<String>, String> {
    let parsed: serde_json::Value = serde_json::from_str(cell)
        .map_err(|_| format!("{adapter} row {row} requires JSON string{} {field}",
            if nullable { " or null" } else { "" }))?;
    match parsed {
        serde_json::Value::String(value) => Ok(Some(value)),
        serde_json::Value::Null if nullable => Ok(None),
        _ => Err(format!("{adapter} row {row} requires JSON string{} {field}",
            if nullable { " or null" } else { "" })),
    }
}

pub(super) fn gesture_csv(
    raw_csv: &[u8], adapter: &str,
) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::Reader::from_reader(raw_csv);
    let headers = reader.headers()
        .map_err(|error| format!("{adapter} header: {error}"))?.clone();
    if headers.len() != FIELDS.len()
        || headers.iter().collect::<BTreeSet<_>>().len() != FIELDS.len()
    {
        return Err(format!("{adapter} requires exactly 17 unique carrier columns"));
    }
    let columns = FIELDS.iter().map(|name| required_header(&headers, name, adapter))
        .collect::<Result<Vec<_>, _>>()?;
    let mut output_header = headers.clone();
    for name in OUTPUT { output_header.push_field(name); }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(&output_header)
        .map_err(|error| format!("{adapter} output header: {error}"))?;
    let mut source_rows = 0;
    for (index, record) in reader.records().enumerate() {
        let row = index + 1;
        let record = record.map_err(|error| format!("{adapter} row {row}: {error}"))?;
        let cell = |field: usize| record.get(columns[field]).expect("CSV enforces row width");
        for (field, name) in FIELDS.iter().enumerate().take(5) {
            if cell(field).trim().is_empty() {
                return Err(format!("{adapter} row {row} requires {name}"));
            }
        }
        if cell(5) != "odim_post_sdk_i32_pixels" {
            return Err(format!("{adapter} row {row} requires argument_domain odim_post_sdk_i32_pixels"));
        }
        // The source consumes viewport extents before either constructor branch.
        let viewport = (
            int32(cell(6), FIELDS[6], row, adapter)?,
            int32(cell(7), FIELDS[7], row, adapter)?,
        );
        let centers = match cell(8) {
            "null" => None,
            "present" => Some((
                int32(cell(9), FIELDS[9], row, adapter)?,
                int32(cell(10), FIELDS[10], row, adapter)?,
            )),
            _ => return Err(format!("{adapter} row {row} node_bounds_state must be present or null")),
        };
        // Kotlin short-circuits this flag for non-null bounds.
        let is_system_ui = if centers.is_none() {
            match cell(11) {
                "true" => true,
                "false" => false,
                _ => return Err(format!("{adapter} row {row} requires Boolean is_system_ui_button_pressed")),
            }
        } else { false };
        let early = centers.is_none() && !is_system_ui;
        // Consume only arguments read by the actual branch. Ignored raw carrier
        // cells remain exported, but their interpretation is not claimed.
        let class_name = if early {
            string_json(cell(12), false, FIELDS[12], row, adapter)?.unwrap()
        } else { String::new() };
        let view_id = if early { None } else {
            string_json(cell(13), true, FIELDS[13], row, adapter)?
        };
        let scroll = if early { None } else {
            match cell(14) {
                "null" => None,
                "present" => Some((
                    int32(cell(15), FIELDS[15], row, adapter)?,
                    int32(cell(16), FIELDS[16], row, adapter)?,
                )),
                _ => return Err(format!("{adapter} row {row} scroll_state must be present or null")),
            }
        };
        let result = supplied_gesture(
            viewport, centers, is_system_ui, &class_name, view_id.as_deref(), scroll,
        );
        let mut out = record.clone();
        for value in result.values {
            let (bits, class) = float_transport(value);
            out.push_field(&bits);
            out.push_field(class);
        }
        let class_json = serde_json::to_string(&result.class_name)
            .map_err(|error| format!("{adapter} class serialization: {error}"))?;
        let view_json = serde_json::to_string(&result.view_id)
            .map_err(|error| format!("{adapter} view serialization: {error}"))?;
        out.push_field(&class_json);
        out.push_field(&view_json);
        out.push_field("false"); // Both source constructors initialize verified=false.
        writer.write_record(&out)
            .map_err(|error| format!("{adapter} output row: {error}"))?;
        source_rows += 1;
    }
    Ok((writer.into_inner()
        .map_err(|error| format!("{adapter} output finish: {error}"))?,
        source_rows, source_rows))
}
