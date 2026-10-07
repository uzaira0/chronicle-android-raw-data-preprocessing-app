//! Dataset-level and row-level numeric derivations for a screen-time/academic
//! analysis table.
//!
//! This boundary is intentionally narrow. It accepts the source's already
//! integer-coerced grade column and explicitly names the two columns divided by
//! their own R-style sample standard deviations. It does not center values,
//! select arbitrary measures. The typed-table composition below reuses this
//! core and the existing support filter for the released preparation stage.

use crate::bjerre_sparse_panel_support::{
    filter_bjerre_sparse_panel_support, BjerreSparsePanelRow,
};
use crate::grouped_column_summary::{mean_columns_by_factor_group, GroupedNumericRow};
use arrow_array::{
    types::Int32Type, Array, ArrayRef, BooleanArray, DictionaryArray, Float64Array, Int32Array,
    RecordBatch, StringArray,
};
use arrow_schema::DataType;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq)]
pub struct ScreenAcademicInputRow<T> {
    /// Grade after the upstream source operation `as.integer(grade)`.
    pub integer_grade: Option<i32>,
    pub screen_time: Option<f64>,
    pub attendance_percent: Option<f64>,
    pub parent_income_mean: Option<f64>,
    pub smoke_frequency: Option<f64>,
    pub course_semester_id: Option<String>,
    pub payload: T,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScreenAcademicDerivedRow<T> {
    pub skipping_percent: Option<f64>,
    pub parent_income_ten_thousands: Option<f64>,
    pub screen_time_scale_only: Option<f64>,
    pub grade_scale_only: Option<f64>,
    pub smoker_indicator: Option<i32>,
    pub course_id: Option<String>,
    pub payload: T,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScreenAcademicDerivation<T> {
    pub grade_sample_sd: Option<f64>,
    pub screen_time_sample_sd: Option<f64>,
    pub rows: Vec<ScreenAcademicDerivedRow<T>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScreenAcademicBackgroundRow<T> {
    pub high_school_gpa: Option<f64>,
    pub parent_education_max: Option<f64>,
    pub parent_income_mean: Option<f64>,
    pub payload: T,
}

/// R's disclosed `sd(column)` boundary for a numeric vector with its default
/// `na.rm = FALSE` behavior.
///
/// `None` represents R `NA`. A missing value anywhere in the vector, or fewer
/// than two observations, therefore yields `None`. Zero variance remains
/// `Some(0.0)` so the subsequent division naturally produces R-compatible
/// infinities or NaNs rather than silently replacing them.
fn r_sample_sd(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let values = values.collect::<Option<Vec<_>>>()?;
    if values.len() < 2 {
        return None;
    }

    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let squared_deviations = values
        .iter()
        .map(|value| {
            let deviation = value - mean;
            deviation * deviation
        })
        .sum::<f64>();
    Some((squared_deviations / (values.len() - 1) as f64).sqrt())
}

fn r_divide(value: Option<f64>, denominator: Option<f64>) -> Option<f64> {
    Some(value? / denominator?)
}

/// Exact scalar result of R's `as.integer(smoke_freq != 4)` for an already
/// numeric source column. R comparisons against `NA` or `NaN` produce logical
/// `NA`, which remains absent after integer coercion. Infinite numeric values
/// are valid and compare unequal to four.
fn r_smoker_indicator(smoke_frequency: Option<f64>) -> Option<i32> {
    smoke_frequency.and_then(|value| {
        if value.is_nan() {
            None
        } else {
            Some(i32::from(value != 4.0))
        }
    })
}

/// Exact fixed-pattern behavior of stringr `str_remove(value, "_.*")`.
///
/// The first ASCII underscore starts the sole replacement. Like the source
/// regex, `.` does not cross a newline, so a newline and everything following
/// it remain. This is intentionally not a configurable regex facility.
fn remove_first_semester_suffix(value: Option<String>) -> Option<String> {
    value.map(|value| {
        let Some(underscore_index) = value.find('_') else {
            return value;
        };
        let matched_suffix = &value[underscore_index..];
        match matched_suffix.find('\n') {
            Some(newline_offset) => {
                let mut course_id = value[..underscore_index].to_owned();
                course_id.push_str(&matched_suffix[newline_offset..]);
                course_id
            }
            None => value[..underscore_index].to_owned(),
        }
    })
}

/// Apply the six operations disclosed together at the source table boundary:
///
/// - `smoker = as.integer(smoke_freq != 4)`;
/// - `skipping = 100 - attendance`;
/// - `parent_inc_mean = parent_inc_mean / 10000`;
/// - `screentime_std = screentime / sd(screentime)`;
/// - `grade_std = grade / sd(grade)`.
/// - `course_num = str_remove(course_num_sem, '_.*')`.
///
/// Input order and the opaque payload are preserved. The two scale-only
/// transformations deliberately use different, explicitly selected columns.
pub fn derive_screen_academic_rows<T>(
    rows: Vec<ScreenAcademicInputRow<T>>,
) -> ScreenAcademicDerivation<T> {
    let grade_sample_sd = r_sample_sd(
        rows.iter()
            .map(|row| row.integer_grade.map(|grade| grade as f64)),
    );
    let screen_time_sample_sd = r_sample_sd(rows.iter().map(|row| row.screen_time));

    let rows = rows
        .into_iter()
        .map(|row| ScreenAcademicDerivedRow {
            skipping_percent: row.attendance_percent.map(|value| 100.0 - value),
            parent_income_ten_thousands: row.parent_income_mean.map(|value| value / 10_000.0),
            screen_time_scale_only: r_divide(row.screen_time, screen_time_sample_sd),
            grade_scale_only: r_divide(
                row.integer_grade.map(|grade| grade as f64),
                grade_sample_sd,
            ),
            smoker_indicator: r_smoker_indicator(row.smoke_frequency),
            course_id: remove_first_semester_suffix(row.course_semester_id),
            payload: row.payload,
        })
        .collect();

    ScreenAcademicDerivation {
        grade_sample_sd,
        screen_time_sample_sd,
        rows,
    }
}

fn r_numeric_is_nonmissing(value: Option<f64>) -> bool {
    value.is_some_and(|value| !value.is_nan())
}

/// Execute the source-enabled background-covariate complete-case filter.
///
/// A row is retained only when `hs_gpa`, `parent_edu_max`, and
/// `parent_inc_mean` are all nonmissing. R's `is.na()` classifies both numeric
/// `NA` and `NaN` as missing while retaining positive and negative infinity.
/// Input order, all three source values, and the opaque payload are preserved.
pub fn retain_complete_screen_academic_background<T>(
    rows: Vec<ScreenAcademicBackgroundRow<T>>,
) -> Vec<ScreenAcademicBackgroundRow<T>> {
    rows.into_iter()
        .filter(|row| {
            r_numeric_is_nonmissing(row.high_school_gpa)
                && r_numeric_is_nonmissing(row.parent_education_max)
                && r_numeric_is_nonmissing(row.parent_income_mean)
        })
        .collect()
}

fn numeric_cell(array: &dyn Array, row: usize) -> Result<Option<f64>, String> {
    if array.is_null(row) {
        return Ok(None);
    }
    match array.data_type() {
        DataType::Float64 => Ok(Some(
            array
                .as_any()
                .downcast_ref::<Float64Array>()
                .unwrap()
                .value(row),
        )),
        DataType::Int32 => Ok(Some(
            array
                .as_any()
                .downcast_ref::<Int32Array>()
                .unwrap()
                .value(row) as f64,
        )),
        DataType::Boolean => Ok(Some(u8::from(
            array
                .as_any()
                .downcast_ref::<BooleanArray>()
                .unwrap()
                .value(row),
        ) as f64)),
        other => Err(format!(
            "numeric source operation does not accept {other:?}"
        )),
    }
}

// R's scalar numeric-to-character boundary uses 15 significant digits to
// select a decimal precision, then the shorter fixed/scientific width (fixed
// wins a tie). Format the original value at that precision, not a rounded
// intermediate: fixed notation can retain more than 15 integer digits.
fn r_factor_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value == f64::INFINITY {
        return "Inf".to_owned();
    }
    if value == f64::NEG_INFINITY {
        return "-Inf".to_owned();
    }
    let scientific = format!("{value:.14e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let exponent: i32 = exponent.parse().unwrap();
    let mantissa = mantissa.trim_end_matches('0').trim_end_matches('.');
    let digits = mantissa.bytes().filter(u8::is_ascii_digit).count() as i32;
    let rounding_widens = exponent > 0
        && exponent <= 27
        && value.abs() < 10_f64.powi(exponent) - 0.5 / 10_f64.powi((15 - exponent).clamp(0, 27));
    let decimals = (digits - exponent - 1 + i32::from(rounding_widens)).max(0) as usize;
    let fixed = format!("{value:.decimals$}");
    let scientific = format!("{mantissa}e{exponent:+03}");
    if fixed.len() <= scientific.len() {
        if fixed.contains('.') {
            fixed.trim_end_matches('0').trim_end_matches('.').to_owned()
        } else {
            fixed
        }
    } else {
        scientific
    }
}

fn text_cell(array: &dyn Array, row: usize) -> Result<Option<String>, String> {
    if array.is_null(row) {
        return Ok(None);
    }
    match array.data_type() {
        DataType::Utf8 => Ok(Some(
            array
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap()
                .value(row)
                .to_owned(),
        )),
        DataType::Dictionary(_, _) => {
            let factor = checked_factor(array)?;
            let levels = factor
                .values()
                .as_any()
                .downcast_ref::<StringArray>()
                .ok_or("factor levels must be strings")?;
            Ok(Some(
                levels.value(factor.keys().value(row) as usize).to_owned(),
            ))
        }
        DataType::Boolean => Ok(Some(
            if array
                .as_any()
                .downcast_ref::<BooleanArray>()
                .unwrap()
                .value(row)
            {
                "TRUE"
            } else {
                "FALSE"
            }
            .to_owned(),
        )),
        _ => Ok(numeric_cell(array, row)?.map(r_factor_number)),
    }
}

fn checked_factor(array: &dyn Array) -> Result<&DictionaryArray<Int32Type>, String> {
    let factor = array
        .as_any()
        .downcast_ref::<DictionaryArray<Int32Type>>()
        .ok_or("factor keys must be Int32")?;
    let levels = factor
        .values()
        .as_any()
        .downcast_ref::<StringArray>()
        .ok_or("factor levels must be strings")?;
    let mut seen = std::collections::HashSet::new();
    if levels
        .iter()
        .any(|level| level.is_none() || !seen.insert(level.unwrap()))
    {
        return Err("factor levels must be unique and nonmissing".to_owned());
    }
    Ok(factor)
}

fn source_is_missing(array: &dyn Array, row: usize) -> bool {
    array.is_null(row)
        || array
            .as_any()
            .downcast_ref::<Float64Array>()
            .is_some_and(|values| values.value(row).is_nan())
}

fn same_source_cell(array: &dyn Array, left: usize, right: usize) -> Result<bool, String> {
    if array.is_null(left) || array.is_null(right) {
        return Ok(array.is_null(left) == array.is_null(right));
    }
    if let Some(values) = array.as_any().downcast_ref::<Float64Array>() {
        let (left, right) = (values.value(left), values.value(right));
        return Ok(left == right || left.is_nan() && right.is_nan());
    }
    Ok(text_cell(array, left)? == text_cell(array, right)?)
}

fn source_group_key(array: &dyn Array, row: usize) -> Result<Option<String>, String> {
    if array.data_type() == &DataType::Float64 {
        return Ok(numeric_cell(array, row)?.map(|value| {
            if value == 0.0 {
                "0".to_owned()
            } else if value.is_nan() {
                "NaN".to_owned()
            } else {
                format!("{:016x}", value.to_bits())
            }
        }));
    }
    text_cell(array, row)
}

fn select_rows(array: &ArrayRef, rows: &[usize]) -> Result<ArrayRef, String> {
    Ok(match array.data_type() {
        DataType::Float64 => Arc::new(Float64Array::from(
            rows.iter()
                .map(|&row| numeric_cell(array.as_ref(), row))
                .collect::<Result<Vec<_>, _>>()?,
        )),
        DataType::Int32 => {
            let values = array.as_any().downcast_ref::<Int32Array>().unwrap();
            Arc::new(Int32Array::from(
                rows.iter()
                    .map(|&row| (!values.is_null(row)).then(|| values.value(row)))
                    .collect::<Vec<_>>(),
            ))
        }
        DataType::Boolean => {
            let values = array.as_any().downcast_ref::<BooleanArray>().unwrap();
            Arc::new(BooleanArray::from(
                rows.iter()
                    .map(|&row| (!values.is_null(row)).then(|| values.value(row)))
                    .collect::<Vec<_>>(),
            ))
        }
        DataType::Utf8 => Arc::new(StringArray::from(
            rows.iter()
                .map(|&row| text_cell(array.as_ref(), row))
                .collect::<Result<Vec<_>, _>>()?,
        )),
        DataType::Dictionary(_, _) => {
            let values = array
                .as_any()
                .downcast_ref::<DictionaryArray<Int32Type>>()
                .ok_or("factor keys must be Int32")?;
            let keys = Int32Array::from(
                rows.iter()
                    .map(|&row| (!values.is_null(row)).then(|| values.keys().value(row)))
                    .collect::<Vec<_>>(),
            );
            Arc::new(
                DictionaryArray::<Int32Type>::try_new(keys, Arc::clone(values.values()))
                    .map_err(|error| error.to_string())?,
            )
        }
        other => return Err(format!("unsupported source column type {other:?}")),
    })
}

fn factor_column(array: &ArrayRef) -> Result<ArrayRef, String> {
    if matches!(array.data_type(), DataType::Dictionary(_, _)) {
        checked_factor(array.as_ref())?;
        return Ok(Arc::clone(array));
    }
    let values = (0..array.len())
        .map(|row| text_cell(array.as_ref(), row))
        .collect::<Result<Vec<_>, _>>()?;
    let mut levels = values.iter().flatten().cloned().collect::<Vec<_>>();
    if matches!(array.data_type(), DataType::Float64 | DataType::Int32) {
        let mut numbers = (0..array.len())
            .map(|row| numeric_cell(array.as_ref(), row))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        numbers.sort_by(|a, b| {
            a.partial_cmp(b)
                .unwrap_or_else(|| a.is_nan().cmp(&b.is_nan()))
        });
        levels = numbers.into_iter().map(r_factor_number).collect();
    } else {
        // ASCII homogeneous-case identifiers have the same tested ordering in
        // the pinned R locale. Do not invent a Unicode/locale collation port.
        let upper = levels
            .iter()
            .any(|value| value.bytes().any(|byte| byte.is_ascii_uppercase()));
        let lower = levels
            .iter()
            .any(|value| value.bytes().any(|byte| byte.is_ascii_lowercase()));
        if upper && lower
            || levels
                .iter()
                .any(|value| !value.bytes().all(|byte| byte.is_ascii_alphanumeric()))
        {
            return Err(
                "source factor collation requires explicit locale-compatible levels".to_owned(),
            );
        }
        levels.sort();
    }
    levels.dedup();
    let keys = Int32Array::from(
        values
            .iter()
            .map(|value| {
                value
                    .as_ref()
                    .map(|value| levels.iter().position(|level| level == value).unwrap() as i32)
            })
            .collect::<Vec<_>>(),
    );
    Ok(Arc::new(
        DictionaryArray::<Int32Type>::try_new(keys, Arc::new(StringArray::from(levels)))
            .map_err(|error| error.to_string())?,
    ))
}

fn table_column<'a>(table: &'a RecordBatch, name: &str) -> Result<&'a ArrayRef, String> {
    table
        .column_by_name(name)
        .ok_or_else(|| format!("source table lacks {name}"))
}

/// Released preparation from explicitly typed readr-equivalent columns. The
/// Arrow boundary preserves null/NaN, numeric-vs-logical types and full factor
/// dictionaries; it does not claim to implement readr's CSV type inference.
pub(crate) fn prepare_screen_academic_tables(
    input: &RecordBatch,
) -> Result<(RecordBatch, RecordBatch), String> {
    let mut names = std::collections::HashSet::new();
    for field in input.schema().fields() {
        if !names.insert(field.name().clone()) {
            return Err(format!("duplicate source column {}", field.name()));
        }
        if !matches!(
            field.data_type(),
            DataType::Float64 | DataType::Int32 | DataType::Boolean | DataType::Utf8
        ) {
            return Err(format!(
                "unsupported readr-equivalent input type for {}: {:?}",
                field.name(),
                field.data_type()
            ));
        }
    }
    let input_number = |name, row| numeric_cell(table_column(input, name)?.as_ref(), row);
    let grade_source = table_column(input, "grade")?;
    let grades = (0..input.num_rows())
        .map(|row| {
            let number = if grade_source.data_type() == &DataType::Utf8 {
                let text = text_cell(grade_source.as_ref(), row)?;
                if text.as_deref().is_some_and(|value| {
                    let value = value.trim().trim_start_matches(['+', '-']);
                    value.starts_with("0x") || value.starts_with("0X")
                }) {
                    return Err("hexadecimal grade coercion is not implemented".to_owned());
                }
                text.and_then(|text| text.trim().parse::<f64>().ok())
            } else {
                numeric_cell(grade_source.as_ref(), row)?
            };
            Ok(number.and_then(|value| {
                (value.is_finite()
                    && value.trunc() > i32::MIN as f64
                    && value.trunc() <= i32::MAX as f64)
                    .then(|| value.trunc() as i32)
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let users = factor_column(table_column(input, "user_idx")?)?;
    let rows = (0..input.num_rows())
        .map(|row| {
            Ok(ScreenAcademicInputRow {
                integer_grade: grades[row],
                screen_time: input_number("screentime", row)?,
                attendance_percent: input_number("attendance", row)?,
                parent_income_mean: input_number("parent_inc_mean", row)?,
                smoke_frequency: input_number("smoke_freq", row)?,
                course_semester_id: text_cell(
                    table_column(input, "course_num_sem")?.as_ref(),
                    row,
                )?,
                payload: row,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let derived = derive_screen_academic_rows(rows);
    let mut columns = input
        .schema()
        .fields()
        .iter()
        .zip(input.columns())
        .map(|(field, values)| (field.name().clone(), Arc::clone(values)))
        .collect::<Vec<_>>();
    let mut replace = |name: &str, values: ArrayRef| {
        if let Some(entry) = columns.iter_mut().find(|(key, _)| key == name) {
            entry.1 = values;
        } else {
            columns.push((name.to_owned(), values));
        }
    };
    replace("grade", Arc::new(Int32Array::from(grades)));
    replace("user_idx", users);
    replace(
        "smoker",
        Arc::new(Int32Array::from(
            derived
                .rows
                .iter()
                .map(|row| row.smoker_indicator)
                .collect::<Vec<_>>(),
        )),
    );
    replace(
        "skipping",
        Arc::new(Float64Array::from(
            derived
                .rows
                .iter()
                .map(|row| row.skipping_percent)
                .collect::<Vec<_>>(),
        )),
    );
    replace(
        "parent_inc_mean",
        Arc::new(Float64Array::from(
            derived
                .rows
                .iter()
                .map(|row| row.parent_income_ten_thousands)
                .collect::<Vec<_>>(),
        )),
    );
    replace(
        "screentime_std",
        Arc::new(Float64Array::from(
            derived
                .rows
                .iter()
                .map(|row| row.screen_time_scale_only)
                .collect::<Vec<_>>(),
        )),
    );
    replace(
        "grade_std",
        Arc::new(Float64Array::from(
            derived
                .rows
                .iter()
                .map(|row| row.grade_scale_only)
                .collect::<Vec<_>>(),
        )),
    );
    replace(
        "course_num",
        Arc::new(StringArray::from(
            derived
                .rows
                .iter()
                .map(|row| row.course_id.clone())
                .collect::<Vec<_>>(),
        )),
    );
    let names = [
        "user_idx",
        "course_num_sem",
        "course_num",
        "grade",
        "grade_std",
        "screentime",
        "screentime_std",
        "screentime_sms",
        "screentime_outofclass",
        "screentime_nopause_v1",
        "screentime_nopause_v2",
        "skipping",
        "male",
        "age",
        "hs_gpa",
        "parent_inc_mean",
        "parent_edu_max",
        "conscientiousness",
        "agreeableness",
        "neuroticism",
        "openness",
        "extraversion",
        "locus_of_control",
        "bmi",
        "smoker",
        "study",
        "semester",
    ];
    let complete = RecordBatch::try_from_iter(
        names
            .iter()
            .map(|name| {
                columns
                    .iter()
                    .find(|(key, _)| key == name)
                    .cloned()
                    .ok_or_else(|| format!("source table lacks {name}"))
            })
            .collect::<Result<Vec<_>, _>>()?,
    )
    .map_err(|error| error.to_string())?;
    let background_columns = ["hs_gpa", "parent_edu_max", "parent_inc_mean"]
        .map(|name| table_column(&complete, name))
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    let sparse = (0..complete.num_rows())
        .filter(|&row| {
            background_columns
                .iter()
                .all(|array| !source_is_missing(array.as_ref(), row))
        })
        .map(|row| {
            Ok(BjerreSparsePanelRow {
                user_idx: text_cell(table_column(&complete, "user_idx")?.as_ref(), row)?,
                course_num_sem: source_group_key(
                    table_column(&complete, "course_num_sem")?.as_ref(),
                    row,
                )?,
                row,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let retained = filter_bjerre_sparse_panel_support(sparse)
        .into_iter()
        .map(|row| row.row)
        .collect::<Vec<_>>();
    let course = RecordBatch::try_from_iter(
        complete
            .schema()
            .fields()
            .iter()
            .zip(complete.columns())
            .map(|(field, array)| Ok((field.name().clone(), select_rows(array, &retained)?)))
            .collect::<Result<Vec<_>, String>>()?,
    )
    .map_err(|error| error.to_string())?;
    let user_column = table_column(&course, "user_idx")?;
    let user_factor = user_column
        .as_any()
        .downcast_ref::<DictionaryArray<Int32Type>>()
        .unwrap();
    let user_levels = user_factor
        .values()
        .as_any()
        .downcast_ref::<StringArray>()
        .unwrap();
    let mut order = user_levels
        .iter()
        .map(|value| value.map(str::to_owned))
        .collect::<Vec<_>>();
    if user_factor.null_count() > 0 {
        order.push(None);
    }
    let numeric_columns = course
        .schema()
        .fields()
        .iter()
        .enumerate()
        .filter(|(_, field)| matches!(field.data_type(), DataType::Float64 | DataType::Int32))
        .map(|(index, field)| (index, field.name().clone()))
        .collect::<Vec<_>>();
    let numeric_rows = (0..course.num_rows())
        .map(|row| {
            Ok(GroupedNumericRow {
                group: text_cell(user_column.as_ref(), row)?,
                values: numeric_columns
                    .iter()
                    .map(|(column, _)| numeric_cell(course.column(*column).as_ref(), row))
                    .collect::<Result<Vec<_>, _>>()?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let means = mean_columns_by_factor_group(&numeric_rows, &order, numeric_columns.len())
        .map_err(|error| format!("numeric group summary: {error:?}"))?;
    let study = table_column(&course, "study")?;
    let mut mean_rows = Vec::new();
    let mut study_rows = Vec::new();
    for (mean_index, mean) in means.iter().enumerate() {
        let mut seen = Vec::new();
        for row in 0..course.num_rows() {
            if text_cell(user_column.as_ref(), row)? != mean.group {
                continue;
            }
            if seen.iter().try_fold(false, |found, &previous| {
                Ok::<_, String>(found || same_source_cell(study.as_ref(), previous, row)?)
            })? {
                continue;
            }
            seen.push(row);
            mean_rows.push(mean_index);
            study_rows.push(row);
        }
    }
    let user_keys = Int32Array::from(
        mean_rows
            .iter()
            .map(|&row| {
                means[row].group.as_ref().map(|value| {
                    user_levels
                        .iter()
                        .position(|level| level == Some(value.as_str()))
                        .unwrap() as i32
                })
            })
            .collect::<Vec<_>>(),
    );
    let mut participant_columns: Vec<(String, ArrayRef)> = vec![(
        "user_idx".to_owned(),
        Arc::new(
            DictionaryArray::<Int32Type>::try_new(user_keys, Arc::clone(user_factor.values()))
                .map_err(|error| error.to_string())?,
        ),
    )];
    let numeric_study = numeric_columns.iter().any(|(_, name)| name == "study");
    for (column, (_, name)) in numeric_columns.iter().enumerate() {
        let name = match name.as_str() {
            "grade" => "gpa",
            "study" => "study.x",
            value => value,
        };
        participant_columns.push((
            name.to_owned(),
            Arc::new(Float64Array::from(
                mean_rows
                    .iter()
                    .map(|&row| means[row].values[column])
                    .collect::<Vec<_>>(),
            )),
        ));
    }
    participant_columns.push((
        if numeric_study { "study.y" } else { "study" }.to_owned(),
        select_rows(study, &study_rows)?,
    ));
    for name in ["male", "smoker"] {
        let entry = participant_columns
            .iter_mut()
            .find(|(key, _)| key == name)
            .ok_or_else(|| format!("numeric summary lacks {name}"))?;
        entry.1 = factor_column(&entry.1)?;
    }
    for (source, target) in [("screentime", "screentime_std"), ("gpa", "gpa_std")] {
        let source_column = participant_columns
            .iter()
            .find(|(key, _)| key == source)
            .unwrap()
            .1
            .clone();
        let values = (0..source_column.len())
            .map(|row| numeric_cell(source_column.as_ref(), row))
            .collect::<Result<Vec<_>, _>>()?;
        let sd = r_sample_sd(values.iter().copied());
        let scaled: ArrayRef = Arc::new(Float64Array::from(
            values
                .into_iter()
                .map(|value| r_divide(value, sd))
                .collect::<Vec<_>>(),
        ));
        if let Some(entry) = participant_columns
            .iter_mut()
            .find(|(key, _)| key == target)
        {
            entry.1 = scaled;
        } else {
            participant_columns.push((target.to_owned(), scaled));
        }
    }
    let course = RecordBatch::try_from_iter(
        course
            .schema()
            .fields()
            .iter()
            .zip(course.columns())
            .map(|(field, array)| {
                Ok((
                    field.name().clone(),
                    if matches!(field.name().as_str(), "male" | "smoker") {
                        factor_column(array)?
                    } else {
                        Arc::clone(array)
                    },
                ))
            })
            .collect::<Result<Vec<_>, String>>()?,
    )
    .map_err(|error| error.to_string())?;
    Ok((
        course,
        RecordBatch::try_from_iter(participant_columns).map_err(|error| error.to_string())?,
    ))
}

#[cfg(test)]
mod typed_preparation_tests {
    use super::*;
    use serde_json::Value;

    fn input_table(table: &Value) -> RecordBatch {
        let rows = table["rows"].as_array().unwrap();
        RecordBatch::try_from_iter(table["columns"].as_array().unwrap().iter().enumerate().map(
            |(column, name)| {
                let name = name.as_str().unwrap();
                let values = rows
                    .iter()
                    .map(|row| row[column].as_str())
                    .collect::<Vec<_>>();
                let array: ArrayRef = match table["classes"][name][0].as_str().unwrap() {
                    "numeric" => Arc::new(Float64Array::from(
                        values
                            .iter()
                            .map(|value| value.map(|value| value.parse::<f64>().unwrap()))
                            .collect::<Vec<_>>(),
                    )),
                    "integer" => Arc::new(Int32Array::from(
                        values
                            .iter()
                            .map(|value| value.map(|value| value.parse::<i32>().unwrap()))
                            .collect::<Vec<_>>(),
                    )),
                    "logical" => Arc::new(BooleanArray::from(
                        values
                            .iter()
                            .map(|value| {
                                value.map(|value| match value {
                                    "TRUE" => true,
                                    "FALSE" => false,
                                    _ => panic!("invalid logical fixture"),
                                })
                            })
                            .collect::<Vec<_>>(),
                    )),
                    "character" => Arc::new(StringArray::from(values)),
                    class => panic!("unimplemented fixture type {class}"),
                };
                (name, array)
            },
        ))
        .unwrap()
    }

    fn compare(case: &str, actual: &RecordBatch, expected: &Value) {
        let columns = expected["columns"].as_array().unwrap();
        assert_eq!(actual.num_columns(), columns.len(), "{case} column count");
        assert_eq!(
            actual.num_rows(),
            expected["rows"].as_array().unwrap().len(),
            "{case} row count"
        );
        for (column, name) in columns.iter().enumerate() {
            let name = name.as_str().unwrap();
            assert_eq!(
                actual.schema().field(column).name(),
                name,
                "{case} column order"
            );
            let array = actual.column(column);
            let class = match array.data_type() {
                DataType::Float64 => "numeric",
                DataType::Int32 => "integer",
                DataType::Utf8 => "character",
                DataType::Boolean => "logical",
                DataType::Dictionary(_, _) => "factor",
                other => panic!("unexpected {other:?}"),
            };
            assert_eq!(expected["classes"][name][0], class, "{case} {name} class");
            if class == "factor" {
                let factor = array
                    .as_any()
                    .downcast_ref::<DictionaryArray<Int32Type>>()
                    .unwrap();
                let levels = factor
                    .values()
                    .as_any()
                    .downcast_ref::<StringArray>()
                    .unwrap();
                assert_eq!(
                    levels.iter().map(Option::unwrap).collect::<Vec<_>>(),
                    expected["levels"][name]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|value| value.as_str().unwrap())
                        .collect::<Vec<_>>(),
                    "{case} {name} levels"
                );
            }
            for row in 0..actual.num_rows() {
                let expected = &expected["rows"][row][column];
                if matches!(class, "numeric" | "integer") {
                    let actual = numeric_cell(array.as_ref(), row).unwrap();
                    let expected = expected.as_str().map(|value| value.parse::<f64>().unwrap());
                    match (actual, expected) {
                        (None, None) => {}
                        (Some(actual), Some(expected)) if actual.is_nan() && expected.is_nan() => {}
                        (Some(actual), Some(expected)) => assert!(
                            actual == expected
                                || (actual - expected).abs() <= 1e-12 * expected.abs().max(1.0),
                            "{case} {name} row{row}"
                        ),
                        _ => panic!("{case} {name} row{row}: NA/NaN distinction"),
                    }
                } else {
                    assert_eq!(
                        text_cell(array.as_ref(), row).unwrap().as_deref(),
                        expected.as_str(),
                        "{case} {name} row{row}"
                    );
                }
            }
        }
    }

    #[test]
    fn numeric_factors_match_original_r_labels_order_and_collisions() {
        let oracle: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/r_numeric_factor_oracle.json"
        ))
        .unwrap();
        let array: ArrayRef = Arc::new(Float64Array::from(
            oracle["input"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().map(|value| value.parse::<f64>().unwrap()))
                .collect::<Vec<_>>(),
        ));
        let factor = factor_column(&array).unwrap();
        let factor = checked_factor(factor.as_ref()).unwrap();
        let levels = factor
            .values()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        for row in 0..array.len() {
            assert_eq!(
                text_cell(factor, row).unwrap().as_deref(),
                oracle["labels"][row].as_str(),
                "row{row}: {:?}",
                oracle["input"][row]
            );
        }
        assert_eq!(levels.len(), oracle["levels"].as_array().unwrap().len());
        for (index, level) in levels.iter().enumerate() {
            assert_eq!(
                level,
                oracle["levels"][index].as_str(),
                "factor level{index}"
            );
        }
    }

    #[test]
    fn malformed_factors_and_unsupported_grade_syntax_are_not_source_errors() {
        let keys = Int32Array::from(vec![0, 1]);
        for levels in [vec![Some("a"), None], vec![Some("a"), Some("a")]] {
            let array: ArrayRef = Arc::new(
                DictionaryArray::<Int32Type>::try_new(
                    keys.clone(),
                    Arc::new(StringArray::from(levels)),
                )
                .unwrap(),
            );
            assert_eq!(
                factor_column(&array).unwrap_err(),
                "factor levels must be unique and nonmissing"
            );
        }
        let oracle: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bjerre_preparation_oracle.json"
        ))
        .unwrap();
        for grade in ["0x10", "+0X10", "-0x10"] {
            let mut input = oracle["cases"][0]["input"].clone();
            input["classes"]["grade"] = serde_json::json!(["character"]);
            let column = input["columns"]
                .as_array()
                .unwrap()
                .iter()
                .position(|name| name == "grade")
                .unwrap();
            input["rows"][0][column] = serde_json::json!(grade);
            assert_eq!(
                prepare_screen_academic_tables(&input_table(&input)).unwrap_err(),
                "hexadecimal grade coercion is not implemented"
            );
        }
    }

    #[test]
    fn full_typed_preparation_matches_original_r_tables_and_source_errors() {
        let oracle: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/bjerre_preparation_oracle.json"
        ))
        .unwrap();
        assert_eq!(
            oracle["sourceSha256"],
            "b2c12ecb356742dd05c23abb9c7ca78013125a87f24bf279c0b38f778e16302c"
        );
        let mut successes = 0;
        let mut refusals = 0;
        for case in oracle["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let input = input_table(&case["input"]);
            let encoded = crate::binary_exports::single_table_arrow(&input).unwrap();
            let decoded = crate::binary_exports::read_single_table_arrow(&encoded).unwrap();
            let actual = prepare_screen_academic_tables(&decoded);
            if case["status"] == "error" {
                assert_eq!(
                    actual.unwrap_err(),
                    "numeric summary lacks male",
                    "{name} source error"
                );
                refusals += 1;
            } else {
                let (course, participant) =
                    actual.unwrap_or_else(|error| panic!("{name}: {error}"));
                if name == "baseline"
                    && std::env::var_os("CHRONICLE_RECORD_TYPED_PREPARATION_FIXTURE").is_some()
                {
                    let course_bytes = crate::binary_exports::single_table_arrow(&course).unwrap();
                    let participant_bytes =
                        crate::binary_exports::single_table_arrow(&participant).unwrap();
                    println!(
                        "TYPED_PREPARATION_FIXTURE {}",
                        serde_json::json!({
                            "rawBinaryBytes": encoded,
                            "outputSha256": crate::sha256(&course_bytes),
                            "derivedOutputSha256": crate::sha256(&participant_bytes),
                            "sourceRowCount": decoded.num_rows(),
                            "emittedRowCount": course.num_rows(),
                            "derivedRowCount": participant.num_rows(),
                        })
                    );
                }
                for (table_name, table) in [("course", course), ("participant", participant)] {
                    let encoded = crate::binary_exports::single_table_arrow(&table).unwrap();
                    let decoded = crate::binary_exports::read_single_table_arrow(&encoded).unwrap();
                    compare(&format!("{name}:{table_name}"), &decoded, &case[table_name]);
                }
                successes += 1;
            }
        }
        assert_eq!((successes, refusals), (25, 3));
    }
}
