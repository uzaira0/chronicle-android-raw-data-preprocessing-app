//! Keyword-set construction from the linked PrefMiner artifact, not study-build parity.
//!
//! RuleMiner.java:211–215,226–253 at d62dab5cca6d668689275d0ad0d46c44932d7988,
//! SHA256 db48c96d621b08adcd985cb58394736b82340c75324377912f7dba9097b2c915.
//! The caller supplies already-filtered strings and complete group membership.
//! No text filtering, cluster/context construction or rule admission occurs here.

use super::required_header;
use crate::finite_scalar_pivot_classifier::FiniteScalarPivotClassifier;
use crate::grouped_category_count::count_categories_by_group;
use crate::grouped_distinct_count::count_distinct_members_by_group;
use std::collections::{BTreeMap, BTreeSet};

const FIELDS: [&str; 4] = ["source_row_id", "group_id", "record_type", "filtered_title"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct KeywordSet {
    pub group_id: String,
    pub unique_title_count: usize,
    pub keyword_threshold: i32,
    pub keywords: Vec<String>,
}

/// Java String.split(" ") uses limit zero: leading/interior empty strings survive,
/// trailing empty strings disappear; the no-match empty input remains [""].
/// Only the literal ASCII space is a delimiter. This is not split_whitespace.
pub(super) fn java_space_tokens(title: &str) -> Vec<&str> {
    let mut words = title.split(' ').collect::<Vec<_>>();
    if !title.is_empty() {
        while words.last() == Some(&"") {
            words.pop();
        }
    }
    words
}

/// The source frequency map stores Java Integer and increments int with freq+1.
/// Project the existing exact occurrence counter modulo 2^32, then reinterpret
/// as signed int32. No alternative saturation or positive-count policy is added.
pub(super) fn java_frequency(occurrence_count: usize) -> i32 {
    occurrence_count as u32 as i32
}

/// Java Set.size() supplies an int. Multiplication by exactly 0.5 and cast to int
/// is floor(n/2) for its nonnegative int32 domain; these integers are exact in f64.
pub(super) fn source_threshold(unique_title_count: usize) -> Result<i32, String> {
    let count = i32::try_from(unique_title_count)
        .map_err(|_| "unique title count exceeds Java Set.size int32 domain".to_owned())?;
    Ok(count / 2)
}

/// The exact-title set is needed for source iteration, not token/title-support
/// counting. Existing distinct and occurrence primitives own both counts.
pub(super) fn keyword_sets(
    groups: &BTreeMap<String, BTreeSet<String>>,
) -> Result<Vec<KeywordSet>, String> {
    let title_counts = count_distinct_members_by_group(
        groups
            .iter()
            .flat_map(|(group, titles)| titles.iter().map(move |title| (group, title))),
    )
    .into_iter()
    .map(|count| (count.group, count.distinct_member_count))
    .collect::<BTreeMap<_, _>>();
    let mut results = BTreeMap::new();
    let mut predicates = BTreeMap::new();
    for group in groups.keys() {
        // Only a supplied group inventory permits an explicitly empty set.
        let count = title_counts.get(group).copied().unwrap_or(0);
        let threshold = source_threshold(count)?;
        predicates.insert(
            group,
            FiniteScalarPivotClassifier::new(f64::from(threshold), false, true, true)
                .map_err(|error| error.to_string())?,
        );
        results.insert(
            group,
            KeywordSet {
                group_id: group.clone(),
                unique_title_count: count,
                keyword_threshold: threshold,
                keywords: Vec::new(),
            },
        );
    }
    let token_counts = count_categories_by_group(groups.iter().flat_map(|(group, titles)| {
        titles.iter().flat_map(move |title| {
            java_space_tokens(title)
                .into_iter()
                .map(move |token| (group, token))
        })
    }));
    for count in token_counts {
        let frequency = java_frequency(count.observation_count);
        if *predicates[count.group]
            .category_for(f64::from(frequency))
            .map_err(|error| error.to_string())?
        {
            results
                .get_mut(count.group)
                .expect("token group comes from supplied inventory")
                .keywords
                .push(count.category.to_owned());
        }
    }
    // Sorted CSV/JSON serialization is engineering transport, not HashSet order.
    Ok(results.into_values().collect())
}

fn identity(
    record: &csv::StringRecord,
    column: usize,
    name: &str,
    row: usize,
    adapter: &str,
) -> Result<String, String> {
    let value = record.get(column).unwrap_or("");
    if value.trim().is_empty() {
        return Err(format!("{adapter} row {row} requires {name}"));
    }
    Ok(value.to_owned())
}

pub(super) fn keyword_csv(
    raw_csv: &[u8],
    adapter: &str,
) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::Reader::from_reader(raw_csv);
    let headers = reader
        .headers()
        .map_err(|error| format!("{adapter} header: {error}"))?
        .clone();
    if headers.len() != 4 || headers.iter().collect::<BTreeSet<_>>().len() != 4 {
        return Err(format!(
            "{adapter} requires exactly four unique carrier columns"
        ));
    }
    let fields = FIELDS
        .iter()
        .map(|field| required_header(&headers, field, adapter))
        .collect::<Result<Vec<_>, _>>()?;
    let mut declared = BTreeSet::new();
    let mut groups = BTreeMap::<String, BTreeSet<String>>::new();
    let mut source_rows = 0;
    for (index, record) in reader.records().enumerate() {
        let row = index + 1;
        let record = record.map_err(|error| format!("{adapter} row {row}: {error}"))?;
        identity(&record, fields[0], FIELDS[0], row, adapter)?;
        let group = identity(&record, fields[1], FIELDS[1], row, adapter)?;
        // Empty title is a real String. Missing/null is a different record state,
        // never inferred from a blank CSV field or a textual NA/null token.
        let title = record
            .get(fields[3])
            .expect("CSV enforces declared row width");
        match record.get(fields[2]) {
            Some("inventory") => {
                if !title.is_empty() {
                    return Err(format!(
                        "{adapter} row {row} inventory must have empty filtered_title"
                    ));
                }
                if !declared.insert(group.clone()) {
                    return Err(format!("{adapter} row {row} duplicate group inventory"));
                }
                groups.entry(group).or_default();
            }
            Some("title") => {
                groups.entry(group).or_default().insert(title.to_owned());
            }
            _ => {
                return Err(format!(
                    "{adapter} row {row} record_type must be inventory or title"
                ))
            }
        }
        source_rows += 1;
    }
    for group in groups.keys() {
        if !declared.contains(group) {
            return Err(format!(
                "{adapter} group {group:?} has no supplied group inventory"
            ));
        }
    }
    let results = keyword_sets(&groups).map_err(|error| format!("{adapter}: {error}"))?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "group_id",
            "unique_title_count",
            "keyword_threshold",
            "keywords_json",
        ])
        .map_err(|error| format!("{adapter} output header: {error}"))?;
    for result in &results {
        let keywords = serde_json::to_string(&result.keywords)
            .map_err(|error| format!("{adapter} keyword set serialization: {error}"))?;
        writer
            .serialize((
                &result.group_id,
                result.unique_title_count,
                result.keyword_threshold,
                keywords,
            ))
            .map_err(|error| format!("{adapter} output row: {error}"))?;
    }
    Ok((
        writer
            .into_inner()
            .map_err(|error| format!("{adapter} output finish: {error}"))?,
        source_rows,
        results.len(),
    ))
}
