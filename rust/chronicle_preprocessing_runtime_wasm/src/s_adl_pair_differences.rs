//! Supplied common-array boundary for features.ipynb cell 4:2,4–17,31,
//! source commit 9203534419c39862351c694f05daf11a7734df94, notebook SHA256
//! dcf368c036ba576ac1c6d41d52579cd7cbb98b3d3dffa0c67323f936766617a2.
//! This does not run feature_df's pandas coercion/inference, the CSV selector,
//! task labels, Excel writing, or any model. Metadata is Chronicle transport.

use super::{
    format_python_float, parse_python_float, record_value, required_header,
    S_ADL_PAIR_DIFFERENCES_ADAPTER as ADAPTER,
};
use std::collections::BTreeSet;

const TRIAL_COLUMNS: [&str; 9] = [
    "Trial 1", "Trial 2", "Trial 3", "Trial 4", "Trial 5", "Trial 6", "Trial 7", "Trial 8",
    "Trial 9",
];

enum CommonArrayRow {
    Int64([i64; 9]),
    Uint64([u64; 9]),
    Float64([f64; 9]),
}

impl CommonArrayRow {
    fn subtract_then_append_float64(&self, earlier: &Self) -> Result<[f64; 9], String> {
        // NumPy subtract runs in the supplied common-array dtype. np.append
        // then promotes into np.empty((0, 9))'s float64 output, before /1000.
        match (self, earlier) {
            (Self::Int64(later), Self::Int64(earlier)) => Ok(std::array::from_fn(|k| {
                later[k].wrapping_sub(earlier[k]) as f64
            })),
            (Self::Uint64(later), Self::Uint64(earlier)) => Ok(std::array::from_fn(|k| {
                later[k].wrapping_sub(earlier[k]) as f64
            })),
            (Self::Float64(later), Self::Float64(earlier)) => {
                Ok(std::array::from_fn(|k| later[k] - earlier[k]))
            }
            _ => Err(format!("{ADAPTER} requires one common-array dtype")),
        }
    }
}

fn calculate(
    rows: &[CommonArrayRow],
    row_count: i64,
    block_size: i64,
) -> Result<Vec<[f64; 9]>, String> {
    let limit = i128::from(row_count) * i128::from(block_size);
    if limit <= 0 || block_size == 1 {
        return Ok(Vec::new());
    }
    if block_size < 0 {
        return Err(format!(
            "{ADAPTER} negative row_count and block_size would not terminate in source"
        ));
    }
    let limit = usize::try_from(limit)
        .map_err(|_| format!("{ADAPTER} indexed row limit exceeds this runtime"))?;
    let block_size = usize::try_from(block_size)
        .map_err(|_| format!("{ADAPTER} block_size exceeds this runtime"))?;
    let mut output = Vec::new();
    for index in (0..limit).step_by(block_size) {
        let end = index + block_size;
        for i in index..end {
            for j in (i + 1)..end {
                // Preserve num_df[j], num_df[i] access order. In particular n=1
                // never indexes the array, so no artificial shortage guard.
                let later = rows.get(j).ok_or_else(|| {
                    format!("{ADAPTER} insufficient indexed rows at array index {j}")
                })?;
                let earlier = rows.get(i).ok_or_else(|| {
                    format!("{ADAPTER} insufficient indexed rows at array index {i}")
                })?;
                let appended = later.subtract_then_append_float64(earlier)?;
                output.push(appended.map(|value| value / 1000.0));
            }
        }
    }
    Ok(output)
}

pub(super) fn prepare_pair_differences_csv(
    raw_csv: &[u8],
) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::Reader::from_reader(raw_csv);
    let headers = reader
        .headers()
        .map_err(|error| format!("{ADAPTER} header: {error}"))?
        .clone();
    if headers.len() != 13 || headers.iter().collect::<BTreeSet<_>>().len() != 13 {
        return Err(format!(
            "{ADAPTER} requires thirteen unique carrier columns: metadata and nine trials"
        ));
    }
    let source_row = required_header(&headers, "source_row_id", ADAPTER)?;
    let row_count_column = required_header(&headers, "row_count", ADAPTER)?;
    let block_size_column = required_header(&headers, "block_size", ADAPTER)?;
    let dtype_column = required_header(&headers, "common_array_dtype", ADAPTER)?;
    let trial_columns = TRIAL_COLUMNS.map(|name| required_header(&headers, name, ADAPTER));
    let trial_columns = trial_columns.into_iter().collect::<Result<Vec<_>, _>>()?;
    let mut invocation = None;
    let mut rows = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|error| format!("{ADAPTER} row {}: {error}", index + 1))?;
        if record_value(&record, Some(source_row)).is_empty() {
            return Err(format!(
                "{ADAPTER} row {} requires source_row_id",
                index + 1
            ));
        }
        let integer_metadata = |column| {
            record_value(&record, Some(column))
                .trim()
                .parse::<i64>()
                .map_err(|_| {
                    format!(
                        "{ADAPTER} row {} requires int64 {} metadata",
                        index + 1,
                        &headers[column]
                    )
                })
        };
        let row_count = integer_metadata(row_count_column)?;
        let block_size = integer_metadata(block_size_column)?;
        let dtype = record_value(&record, Some(dtype_column));
        if !matches!(dtype, "int64" | "uint64" | "float64") {
            return Err(format!(
                "{ADAPTER} row {} requires common_array_dtype int64, uint64 or float64",
                index + 1
            ));
        }
        let supplied = (row_count, block_size, dtype.to_owned());
        if invocation.as_ref().is_some_and(|first| first != &supplied) {
            return Err(format!(
                "{ADAPTER} row {} has inconsistent invocation metadata",
                index + 1
            ));
        }
        invocation.get_or_insert(supplied);
        let mut ints = [0; 9];
        let mut uints = [0; 9];
        let mut floats = [0.0; 9];
        for (trial, column) in trial_columns.iter().enumerate() {
            let raw = record_value(&record, Some(*column)).trim();
            let integer_error = || {
                format!(
                    "{ADAPTER} row {} requires {dtype} {}",
                    index + 1,
                    &headers[*column]
                )
            };
            match dtype {
                "int64" => ints[trial] = raw.parse::<i64>().map_err(|_| integer_error())?,
                "uint64" => uints[trial] = raw.parse::<u64>().map_err(|_| integer_error())?,
                "float64" => {
                    floats[trial] = if raw.is_empty() {
                        f64::NAN
                    } else {
                        parse_python_float(raw, &headers[*column], index + 1)?
                    }
                }
                _ => unreachable!("validated common-array dtype"),
            }
        }
        rows.push(match dtype {
            "int64" => CommonArrayRow::Int64(ints),
            "uint64" => CommonArrayRow::Uint64(uints),
            "float64" => CommonArrayRow::Float64(floats),
            _ => unreachable!("validated common-array dtype"),
        });
    }
    let (row_count, block_size, _) = invocation
        .ok_or_else(|| format!("{ADAPTER} requires a metadata-bearing typed input row"))?;
    let result = calculate(&rows, row_count, block_size)?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(TRIAL_COLUMNS)
        .map_err(|error| format!("{ADAPTER} output header: {error}"))?;
    for result_row in &result {
        writer
            .write_record(result_row.map(format_python_float))
            .map_err(|error| format!("{ADAPTER} output: {error}"))?;
    }
    let output = writer
        .into_inner()
        .map_err(|error| format!("{ADAPTER} output: {error}"))?;
    Ok((output, rows.len(), result.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integer_wrap_and_float_cast_match_independent_math_bits() {
        let signed = calculate(
            &[
                CommonArrayRow::Int64([
                    i64::MIN,
                    i64::MAX,
                    9_007_199_254_740_992,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                ]),
                CommonArrayRow::Int64([
                    i64::MAX,
                    i64::MIN,
                    9_007_199_254_740_993,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                ]),
            ],
            1,
            2,
        )
        .unwrap();
        assert_eq!(
            signed[0].map(f64::to_bits),
            [-0.001_f64, 0.001, 0.001, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0].map(f64::to_bits)
        );

        // 0-1 modulo 2^64 is 2^64-1. Conversion rounds to 2^64;
        // division by 1000 rounds to the exactly representable integer below.
        let unsigned = calculate(
            &[
                CommonArrayRow::Uint64([1; 9]),
                CommonArrayRow::Uint64([0; 9]),
            ],
            1,
            2,
        )
        .unwrap();
        assert_eq!(
            unsigned[0].map(f64::to_bits),
            [18_446_744_073_709_552.0_f64.to_bits(); 9]
        );

        // Supplied float64 2^53+1 already rounds to 2^53; contrast with the
        // supplied int64 increment above, which is subtracted before casting.
        let floats = calculate(
            &[
                CommonArrayRow::Float64([9_007_199_254_740_992.0; 9]),
                CommonArrayRow::Float64([9_007_199_254_740_993.0; 9]),
            ],
            1,
            2,
        )
        .unwrap();
        assert_eq!(floats[0].map(f64::to_bits), [0.0_f64.to_bits(); 9]);
    }

    #[test]
    fn supplied_array_hand_fixtures_preserve_math_wrap_and_order() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/s_adl_pair_differences.json"
        ))
        .unwrap();
        for case in fixtures["cases"].as_array().unwrap() {
            let result =
                prepare_pair_differences_csv(case["input_csv"].as_str().unwrap().as_bytes());
            if let Some(expected) = case["expected_csv"].as_str() {
                let (output, source_rows, emitted_rows) =
                    result.unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
                assert_eq!(
                    String::from_utf8(output).unwrap(),
                    expected,
                    "{}",
                    case["id"]
                );
                assert_eq!(
                    source_rows,
                    case["source_rows"].as_u64().unwrap() as usize,
                    "{}",
                    case["id"]
                );
                assert_eq!(
                    emitted_rows,
                    case["emitted_rows"].as_u64().unwrap() as usize,
                    "{}",
                    case["id"]
                );
            } else {
                let error = result.unwrap_err();
                assert!(
                    error.contains(case["expected_error_contains"].as_str().unwrap()),
                    "{}: {error}",
                    case["id"]
                );
            }
        }
    }
}
