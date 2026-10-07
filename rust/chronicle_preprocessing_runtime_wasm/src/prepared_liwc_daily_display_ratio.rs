//! Prepared daily LIWC display values only: e55999.txt205–207,553–554,570–571.
//! No OCR, dictionary/clinical score construction or calendar inference.
use crate::grouped_scalar_sum_projection::{
    grouped_scalar_sum_then_project_unique, GroupedScalarInput, RCompatibleScalar,
    SequentialDivisionConfiguration,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeSet;

pub const FIELDS: &[&str] = &[
    "participant_id",
    "component_id",
    "inventory_id",
    "input_unit",
    "membership_qualification",
    "inventory_complete",
    "expected_day_ids_json",
    "daily_values_json",
];
const OUTPUTS: &[&str] = &[
    "component_study_total",
    "daily_display_ratios_json",
    "computation_status",
    "computation_reason",
    "output_unit_relation",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DailyValue {
    day_id: String,
    input_unit: String,
    // A numeric lexical string avoids JSON-decoder silent exponent underflow.
    // Null/absent is explicitly unavailable, never a zero or an omitted day.
    value: Option<String>,
}

pub struct RatioCsv {
    pub csv_bytes: Vec<u8>,
    pub row_count: usize,
}

fn nonblank(value: &str, name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("prepared LIWC requires nonblank {name}"))
    } else {
        Ok(())
    }
}

fn scalar(text: Option<&str>) -> Result<(Option<f64>, &'static str), String> {
    let Some(text) = text else {
        return Ok((None, "missing_daily_value"));
    };
    let value = text
        .parse::<f64>()
        .map_err(|_| "prepared LIWC value requires numeric lexical scalar")?;
    let nonzero_significand = text
        .split(['e', 'E'])
        .next()
        .unwrap_or("")
        .bytes()
        .any(|b| matches!(b, b'1'..=b'9'));
    if !value.is_finite() {
        if nonzero_significand {
            return Ok((None, "input_numeric_loss"));
        }
        return Err("prepared LIWC refuses nonfinite daily value".into());
    }
    if value == 0.0 && nonzero_significand {
        return Ok((None, "input_numeric_loss"));
    }
    Ok((Some(value), ""))
}

fn sum_and_divide(values: &[f64], divisor: f64) -> Result<(Option<f64>, Option<f64>), String> {
    let rows = values
        .iter()
        .map(|value| GroupedScalarInput {
            entity: (),
            raw_partition: (),
            passthrough: (),
            value: RCompatibleScalar::Finite(*value),
        })
        .collect::<Vec<_>>();
    let result = grouped_scalar_sum_then_project_unique(
        &rows,
        SequentialDivisionConfiguration {
            first_divisor: divisor,
            second_divisor: 1.0,
        },
        |_| Some(()),
    )
    .map_err(|e| e.to_string())?;
    let finite = |value| match value {
        RCompatibleScalar::Finite(v) => Some(v),
        _ => None,
    };
    Ok((finite(result[0].sum), finite(result[0].first_scaled_value)))
}

// Check the shared ordered sum without replacing it or assigning an author
// precision policy. TwoSum retains each finite addition's rounding residual.
// Accept ordinary rounding only when reliably tracked residuals do not change
// the emitted binary64 total; otherwise no denominator is claimed.
pub(crate) fn study_total_has_numeric_loss(values: &[f64], total: f64) -> bool {
    let addition = |left: f64, right: f64| {
        let sum = left + right;
        let virtual_right = sum - left;
        let virtual_left = sum - virtual_right;
        let left_loss = left - virtual_left;
        let right_loss = right - virtual_right;
        let residual = left_loss + right_loss;
        [
            sum,
            virtual_right,
            virtual_left,
            left_loss,
            right_loss,
            residual,
        ]
        .iter()
        .all(|v| v.is_finite())
        .then_some((sum, residual))
    };
    let (mut sum, mut residual) = (0.0, 0.0);
    for value in values {
        let Some((next, loss)) = addition(sum, *value) else {
            return true;
        };
        let Some((next_residual, residual_loss)) = addition(residual, loss) else {
            return true;
        };
        if residual_loss != 0.0 {
            return true;
        }
        sum = next;
        residual = next_residual;
    }
    let Some((corrected, _)) = addition(sum, residual) else {
        return true;
    };
    sum != total || corrected != total || (corrected == 0.0 && sum != -residual)
}

pub fn execute_csv(raw: &[u8]) -> Result<RatioCsv, String> {
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len()
        || OUTPUTS
            .iter()
            .any(|name| headers.iter().any(|h| h == *name))
    {
        return Err("prepared LIWC refuses duplicate/reserved columns".into());
    }
    for field in FIELDS {
        if !headers.iter().any(|h| h == *field) {
            return Err(format!("prepared LIWC requires {field}"));
        }
    }
    let rows = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Err("prepared LIWC requires an explicit study inventory row".into());
    }
    let row_count = rows.len();
    let mut writer = csv::Writer::from_writer(Vec::new());
    let mut output_headers = headers.clone();
    for name in OUTPUTS {
        output_headers.push_field(name);
    }
    writer
        .write_record(&output_headers)
        .map_err(|e| e.to_string())?;
    let mut owners = BTreeSet::new();
    for row in rows {
        let get = |name| {
            &row[headers
                .iter()
                .position(|h| h == name)
                .expect("required field checked")]
        };
        for name in [
            "participant_id",
            "component_id",
            "inventory_id",
            "input_unit",
        ] {
            nonblank(get(name), name)?;
        }
        if get("membership_qualification") != "source_qualified_complete_liwc_study_days"
            || get("inventory_complete") != "true"
        {
            return Err(
                "prepared LIWC requires caller-qualified complete study-day membership".into(),
            );
        }
        if !owners.insert((
            get("participant_id").to_owned(),
            get("component_id").to_owned(),
        )) {
            return Err(
                "prepared LIWC refuses duplicate participant/component study inventory".into(),
            );
        }
        let expected: Vec<String> = serde_json::from_str(get("expected_day_ids_json"))
            .map_err(|e| format!("expected_day_ids_json: {e}"))?;
        let mut expected_ids = BTreeSet::new();
        for id in &expected {
            nonblank(id, "expected day_id")?;
            if !expected_ids.insert(id.as_str()) {
                return Err("duplicate expected day_id".into());
            }
        }
        let daily: Vec<DailyValue> = serde_json::from_str(get("daily_values_json"))
            .map_err(|e| format!("daily_values_json: {e}"))?;
        let mut ids = BTreeSet::new();
        let mut values = Vec::new();
        for item in &daily {
            nonblank(&item.day_id, "day_id")?;
            if !ids.insert(item.day_id.as_str()) {
                return Err("duplicate daily day_id".into());
            }
            if item.input_unit != get("input_unit") {
                return Err(
                    "prepared LIWC requires identical supplied units for all daily values".into(),
                );
            }
            values.push(scalar(item.value.as_deref())?);
        }
        if ids != expected_ids {
            return Err("daily values must exactly cover supplied expected day inventory; no days are inferred".into());
        }
        let unavailable_input = values
            .iter()
            .find(|(v, _)| v.is_none())
            .map(|(_, reason)| *reason);
        let total = if !values.is_empty() && unavailable_input.is_none() {
            sum_and_divide(
                &values
                    .iter()
                    .map(|(v, _)| v.expect("all values checked"))
                    .collect::<Vec<_>>(),
                1.0,
            )?
            .0
        } else {
            None
        };
        let study_total_numeric_loss = total.is_some_and(|total| {
            study_total_has_numeric_loss(
                &values
                    .iter()
                    .map(|(v, _)| v.expect("all values checked"))
                    .collect::<Vec<_>>(),
                total,
            )
        });
        let total = if study_total_numeric_loss {
            None
        } else {
            total
        };
        let inventory_reason = if daily.is_empty() {
            "empty_day_inventory"
        } else if let Some(reason) = unavailable_input {
            reason
        } else if study_total_numeric_loss {
            "study_total_numeric_loss"
        } else if total.is_none() {
            "nonfinite_study_total"
        } else if total == Some(0.0) {
            "zero_study_total"
        } else {
            ""
        };
        let mut results = Vec::new();
        let mut all_computed = !daily.is_empty();
        for (item, (value, _)) in daily.iter().zip(&values) {
            let ratio = if inventory_reason.is_empty() {
                sum_and_divide(
                    &[value.expect("known value")],
                    total.expect("known nonzero total"),
                )?
                .1
                .filter(|r| !(*r == 0.0 && value.is_some_and(|v| v != 0.0)))
            } else {
                None
            };
            let reason = if !inventory_reason.is_empty() {
                inventory_reason
            } else if ratio.is_none() {
                "nonfinite_or_underflow_ratio"
            } else {
                ""
            };
            let status = if ratio.is_some() {
                "computed"
            } else if matches!(reason, "zero_study_total" | "empty_day_inventory") {
                "source_undefined"
            } else if reason == "missing_daily_value" {
                "input_unavailable"
            } else {
                "arithmetic_unavailable"
            };
            all_computed &= ratio.is_some();
            results
                .push(json!({"day_id":item.day_id,"value":ratio,"status":status,"reason":reason}));
        }
        let status = if all_computed {
            "computed"
        } else if matches!(inventory_reason, "zero_study_total" | "empty_day_inventory") {
            "source_undefined"
        } else if inventory_reason == "missing_daily_value" {
            "input_unavailable"
        } else if inventory_reason == "study_total_numeric_loss" {
            "arithmetic_unavailable"
        } else {
            "contains_unavailable_ratios"
        };
        let mut output = row.clone();
        for value in [
            total.map(|v| v.to_string()).unwrap_or_default(),
            serde_json::to_string(&results).map_err(|e| e.to_string())?,
            status.into(),
            if all_computed {
                String::new()
            } else if inventory_reason.is_empty() {
                "see_per_day_status".into()
            } else {
                inventory_reason.into()
            },
            "dimensionless_fraction".into(),
        ] {
            output.push_field(&value);
        }
        writer.write_record(&output).map_err(|e| e.to_string())?;
    }
    Ok(RatioCsv {
        csv_bytes: writer.into_inner().map_err(|e| e.to_string())?,
        row_count,
    })
}
