//! Screenomics arithmetic on supplied lexical words and exact grayscale counts.
//!
//! DOI 10.1016/j.chb.2020.106570, pinned primary text096:174-184:
//! count word occurrences; unique CURRENT words absent from the prior five-second
//! capture; Shannon entropy across 256 gray levels (range 0..8); absolute change
//! from the temporally prior capture. No OCR, pixel conversion or pair constructor.

use crate::grouped_category_count::count_categories_by_group;
use crate::grouped_distinct_count::count_distinct_members_by_group;
use std::collections::BTreeSet;

pub const ADAPTER: &str = "chronicle.screenomics-text-image-statistics";
pub const RESULT_KIND: &str = "literature-screenomics-text-image-statistics-csv";
pub const FIVE_SECOND_PRIOR: &str = "immediately_prior_five_second_capture";
pub const TEMPORAL_PRIOR: &str = "immediately_prior_capture";
pub const NO_PRIOR: &str = "no_prior_capture_supplied";
pub const REQUIRED_FIELDS: [&str; 18] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_stream_id",
    "capture_id",
    "clock_id",
    "time_unit",
    "time_precision",
    "capture_timestamp",
    "prior_participant_id",
    "prior_device_id",
    "prior_source_stream_id",
    "prior_capture_id",
    "prior_clock_id",
    "prior_time_unit",
    "prior_time_precision",
    "prior_capture_timestamp",
    "prior_relation",
];
pub const OUTPUT_FIELDS: [&str; 9] = [
    "word_count",
    "word_count_status",
    "new_unique_word_count",
    "new_unique_word_count_status",
    "image_entropy_bits",
    "image_entropy_status",
    "absolute_entropy_delta_bits",
    "absolute_entropy_delta_status",
    "statistics_claim_scope",
];

pub struct PreparedScreenomicsStatistics {
    pub csv_bytes: Vec<u8>,
    pub row_count: usize,
}

fn supplied_words(value: &str) -> Result<Option<Vec<String>>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    let words: Vec<String> = serde_json::from_str(value)
        .map_err(|_| "Screenomics words require a JSON array of strings".to_owned())?;
    if words
        .iter()
        .any(|word| word.is_empty() || word.contains(' '))
    {
        return Err("Screenomics requires nonempty, already space-separated lexical tokens; raw tokenization is not inferred".into());
    }
    Ok(Some(words))
}

fn supplied_histogram(value: &str) -> Result<Option<Vec<u64>>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    let histogram: Vec<u64> = serde_json::from_str(value).map_err(|_| {
        "Screenomics histogram requires a JSON array of nonnegative u64 integers".to_owned()
    })?;
    if histogram.len() != 256 {
        return Err(
            "Screenomics requires exactly 256 grayscale histogram bins in gray-level order".into(),
        );
    }
    Ok(Some(histogram))
}

/// Exact supplied occurrence count, including repeated lexical words. An
/// explicit empty array is a known empty ensemble, unlike a missing payload.
pub fn word_count(words: &[String]) -> usize {
    count_categories_by_group(words.iter().map(|_| ((), ())))
        .first()
        .map_or(0, |count| count.observation_count)
}

/// Direction is CURRENT minus PREVIOUS. The shared distinct counter collapses
/// repeated new words only; strings are never case-folded or Unicode-normalized.
pub fn new_unique_word_count(current: &[String], prior: &[String]) -> usize {
    let previous = prior.iter().collect::<BTreeSet<_>>();
    count_distinct_members_by_group(
        current
            .iter()
            .filter(|word| !previous.contains(word))
            .map(|word| ((), word)),
    )
    .first()
    .map_or(0, |count| count.distinct_member_count)
}

/// Base 2 follows from the source's 256-state maximum of 8. Counts and their
/// total remain integer (u128 sum); probabilities/logarithms use f64. Empty bins
/// contribute the Shannon limit 0. An empty image has no source-pinned result.
pub fn grayscale_entropy_bits(histogram: &[u64]) -> Result<f64, &'static str> {
    if histogram.len() != 256 {
        return Err("not_256_bins");
    }
    let total = histogram
        .iter()
        .map(|&count| u128::from(count))
        .sum::<u128>();
    if total == 0 {
        return Err("zero_total_histogram_source_behavior_undisclosed");
    }
    let entropy = histogram
        .iter()
        .filter(|&&count| count != 0)
        .map(|&count| {
            let probability = count as f64 / total as f64;
            -probability * probability.log2()
        })
        .sum::<f64>();
    Ok(if entropy == 0.0 { 0.0 } else { entropy })
}

fn integer_result(value: Option<usize>, missing: &str) -> [String; 2] {
    value.map_or_else(
        || [String::new(), format!("unavailable:{missing}")],
        |value| [value.to_string(), "computed_supplied_statistics".into()],
    )
}

fn float_result(value: Result<f64, &str>) -> [String; 2] {
    match value {
        Ok(value) => [value.to_string(), "computed_supplied_statistics".into()],
        Err(reason) => [String::new(), format!("unavailable:{reason}")],
    }
}

/// Each row is one caller-supplied current capture, optionally with a qualified
/// prior capture from the same lexical participant/device/stream. Rows, extra
/// columns, repeated IDs and duplicate occurrences survive in supplied order.
/// The relation is an explicit caller attestation, never derived by sorting,
/// parsing timestamps, a clock tolerance, a five-second session rule or rounding.
pub fn execute_screenomics_statistics_csv(
    raw: &[u8],
) -> Result<PreparedScreenomicsStatistics, String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::None)
        .from_reader(raw);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err("Screenomics requires unique CSV column names".into());
    }
    if OUTPUT_FIELDS
        .iter()
        .any(|field| headers.iter().any(|h| h == *field))
    {
        return Err("Screenomics refuses supplied computed output columns".into());
    }
    let columns = REQUIRED_FIELDS
        .map(|name| {
            headers
                .iter()
                .position(|h| h == name)
                .ok_or_else(|| format!("Screenomics requires {name}"))
        })
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    let optional = |name: &str| headers.iter().position(|h| h == name);
    let current_words = optional("words_json");
    let prior_words = optional("prior_words_json");
    let current_histogram = optional("grayscale_histogram_json");
    let prior_histogram = optional("prior_grayscale_histogram_json");
    if current_words.is_none() && current_histogram.is_none() {
        return Err(
            "Screenomics requires supplied words_json and/or grayscale_histogram_json".into(),
        );
    }
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    let mut output_headers = headers.clone();
    output_headers.extend(OUTPUT_FIELDS);
    writer
        .write_record(&output_headers)
        .map_err(|e| e.to_string())?;
    let mut row_count = 0;
    for record in reader.records() {
        let record = record.map_err(|e| e.to_string())?;
        let field = |position: usize| &record[columns[position]];
        let payload = |column: Option<usize>| column.and_then(|i| record.get(i)).unwrap_or("");
        if (0..5).any(|position| field(position).trim().is_empty()) {
            return Err(
                "Screenomics requires nonempty lexical source/current capture ownership".into(),
            );
        }
        let relation = field(17);
        if !matches!(relation, FIVE_SECOND_PRIOR | TEMPORAL_PRIOR | NO_PRIOR) {
            return Err("Screenomics requires an exact supplied prior_relation".into());
        }
        if relation == NO_PRIOR {
            if (9..17).any(|position| !field(position).is_empty())
                || !payload(prior_words).is_empty()
                || !payload(prior_histogram).is_empty()
            {
                return Err(
                    "Screenomics no-prior declaration contradicts supplied prior capture data"
                        .into(),
                );
            }
        } else {
            if (9..13).any(|position| field(position).trim().is_empty()) {
                return Err(
                    "Screenomics supplied prior requires explicit lexical capture ownership".into(),
                );
            }
            if (1..4).any(|position| field(position) != field(position + 8)) {
                return Err(
                    "Screenomics prior capture belongs to another participant/device/source stream"
                        .into(),
                );
            }
            if field(4) == field(12) {
                return Err(
                    "Screenomics prior and current must identify distinct supplied captures".into(),
                );
            }
        }
        let words = supplied_words(payload(current_words))?;
        let previous_words = supplied_words(payload(prior_words))?;
        let histogram = supplied_histogram(payload(current_histogram))?;
        let previous_histogram = supplied_histogram(payload(prior_histogram))?;
        let clock_conflict = field(5) != field(13) || field(6) != field(14);
        let pair_limit = if relation == NO_PRIOR {
            Some("prior_capture_not_supplied_source_behavior_undisclosed")
        } else if clock_conflict {
            Some("incompatible_supplied_clock_or_unit_metadata")
        } else {
            None
        };
        let count = integer_result(
            words.as_deref().map(word_count),
            "current_word_ensemble_not_supplied",
        );
        let word_delta = if let Some(reason) = pair_limit {
            integer_result(None, reason)
        } else if relation != FIVE_SECOND_PRIOR {
            integer_result(None, "prior_five_second_relation_not_supplied")
        } else {
            integer_result(
                words
                    .as_deref()
                    .zip(previous_words.as_deref())
                    .map(|(current, prior)| new_unique_word_count(current, prior)),
                "current_or_prior_word_ensemble_not_supplied",
            )
        };
        let entropy = histogram
            .as_deref()
            .ok_or("current_histogram_not_supplied")
            .and_then(grayscale_entropy_bits);
        let entropy_delta = if let Some(reason) = pair_limit {
            Err(reason)
        } else {
            entropy.and_then(|current| {
                previous_histogram
                    .as_deref()
                    .ok_or("prior_histogram_not_supplied")
                    .and_then(grayscale_entropy_bits)
                    .map(|prior| (current - prior).abs())
            })
        };
        let mut output = record.clone();
        for result in [
            count,
            word_delta,
            float_result(entropy),
            float_result(entropy_delta),
        ] {
            output.extend(result.iter().map(String::as_str));
        }
        output.push_field("supplied_statistics_only_not_ocr_pair_constructor_caps_or_models");
        writer.write_record(&output).map_err(|e| e.to_string())?;
        row_count += 1;
    }
    Ok(PreparedScreenomicsStatistics {
        csv_bytes: writer.into_inner().map_err(|e| e.to_string())?,
        row_count,
    })
}
