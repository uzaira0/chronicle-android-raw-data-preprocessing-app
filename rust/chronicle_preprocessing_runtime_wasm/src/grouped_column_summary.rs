//! Columnwise means and sample standard deviations within first-seen groups.
//!
//! Missing and NaN values are removed independently for each column. An
//! all-missing column has a NaN mean and a missing sample deviation. A missing
//! group key is retained in first-seen order as an all-missing summary group.

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct GroupedNumericRow {
    pub(crate) group: Option<String>,
    pub(crate) values: Vec<Option<f64>>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct GroupedColumnSummary {
    pub(crate) group: Option<String>,
    pub(crate) means: Vec<f64>,
    pub(crate) sample_standard_deviations: Vec<Option<f64>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GroupedColumnSummaryError {
    EmptyInput,
    EmptyValueColumns,
    InconsistentColumnCount,
    InvalidGroupOrder,
}

/// Column means without removing missing observations, in caller-supplied
/// factor-level order. Unlike the first-seen summary below, an NA group is a
/// real group and contributes its actual values. Unobserved factor levels are
/// retained by the caller's typed column but produce no summary rows.
///
/// Source boundary: Bjerre-Nielsen load_data.R:60-64. The caller must select
/// numeric columns by their actual type; this operation does not infer types,
/// create factor levels, or perform the later distinct-study join.
pub(crate) fn mean_columns_by_factor_group(
    rows: &[GroupedNumericRow],
    group_order: &[Option<String>],
    column_count: usize,
) -> Result<Vec<GroupedNumericRow>, GroupedColumnSummaryError> {
    if column_count == 0 {
        return Err(GroupedColumnSummaryError::EmptyValueColumns);
    }
    if rows.iter().any(|row| row.values.len() != column_count) {
        return Err(GroupedColumnSummaryError::InconsistentColumnCount);
    }
    if group_order
        .iter()
        .enumerate()
        .any(|(index, group)| group_order[..index].contains(group))
        || rows.iter().any(|row| !group_order.contains(&row.group))
    {
        return Err(GroupedColumnSummaryError::InvalidGroupOrder);
    }
    let mut summaries = Vec::new();
    for group in group_order {
        let selected = rows
            .iter()
            .filter(|row| &row.group == group)
            .collect::<Vec<_>>();
        if selected.is_empty() {
            continue;
        }
        let values = (0..column_count)
            .map(|column| {
                let values = selected
                    .iter()
                    .map(|row| row.values[column])
                    .collect::<Option<Vec<_>>>()?;
                let sum = values.iter().sum::<f64>();
                let finite_sum = sum.is_finite();
                let mut mean = if finite_sum {
                    sum / values.len() as f64
                } else {
                    values.iter().map(|value| value / values.len() as f64).sum()
                };
                // R mean.default corrects rounding error around the first mean.
                // Nonfinite results retain their source arithmetic semantics.
                if mean.is_finite() {
                    mean += if finite_sum {
                        values.iter().map(|value| value - mean).sum::<f64>() / values.len() as f64
                    } else {
                        values
                            .iter()
                            .map(|value| (value - mean) / values.len() as f64)
                            .sum::<f64>()
                    };
                }
                Some(mean)
            })
            .collect();
        summaries.push(GroupedNumericRow {
            group: group.clone(),
            values,
        });
    }
    Ok(summaries)
}

pub(crate) fn summarize_columns_by_first_seen_group(
    rows: &[GroupedNumericRow],
) -> Result<Vec<GroupedColumnSummary>, GroupedColumnSummaryError> {
    let Some(first) = rows.first() else {
        return Err(GroupedColumnSummaryError::EmptyInput);
    };
    let column_count = first.values.len();
    if column_count == 0 {
        return Err(GroupedColumnSummaryError::EmptyValueColumns);
    }
    if rows.iter().any(|row| row.values.len() != column_count) {
        return Err(GroupedColumnSummaryError::InconsistentColumnCount);
    }

    let mut groups = Vec::<Option<String>>::new();
    for row in rows {
        if !groups.contains(&row.group) {
            groups.push(row.group.clone());
        }
    }

    Ok(groups
        .into_iter()
        .map(|group| {
            if group.is_none() {
                return GroupedColumnSummary {
                    group,
                    means: vec![f64::NAN; column_count],
                    sample_standard_deviations: vec![None; column_count],
                };
            }

            let mut means = Vec::with_capacity(column_count);
            let mut sample_standard_deviations = Vec::with_capacity(column_count);
            for column in 0..column_count {
                let observed = rows
                    .iter()
                    .filter(|row| row.group == group)
                    .filter_map(|row| row.values[column])
                    .filter(|value| !value.is_nan())
                    .collect::<Vec<_>>();
                let mean = if observed.is_empty() {
                    f64::NAN
                } else {
                    observed.iter().sum::<f64>() / observed.len() as f64
                };
                let sample_standard_deviation = (observed.len() >= 2).then(|| {
                    let squared_deviations = observed
                        .iter()
                        .map(|value| {
                            let deviation = value - mean;
                            deviation * deviation
                        })
                        .sum::<f64>();
                    (squared_deviations / (observed.len() - 1) as f64).sqrt()
                });

                means.push(mean);
                sample_standard_deviations.push(sample_standard_deviation);
            }

            GroupedColumnSummary {
                group,
                means,
                sample_standard_deviations,
            }
        })
        .collect())
}
