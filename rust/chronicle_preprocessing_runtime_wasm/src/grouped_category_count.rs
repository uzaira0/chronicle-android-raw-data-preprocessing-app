//! Observation counts for caller-defined groups and categories.
//!
//! Every supplied observation contributes one count. This operator does not
//! construct groups, classify categories, collapse duplicates, or synthesize
//! absent group/category combinations.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupedCategoryCount<Group, Category> {
    pub group: Group,
    pub category: Category,
    pub observation_count: usize,
}

/// Count all supplied observations independently by `(group, category)`.
///
/// Results are sorted by group and then category. Repeated observations count
/// repeatedly; callers that require distinct-member counts must deduplicate by
/// the appropriate identity before this boundary.
pub fn count_categories_by_group<Group, Category, Rows>(
    observations: Rows,
) -> Vec<GroupedCategoryCount<Group, Category>>
where
    Group: Ord,
    Category: Ord,
    Rows: IntoIterator<Item = (Group, Category)>,
{
    let mut counts = BTreeMap::<(Group, Category), usize>::new();
    for observation in observations {
        *counts.entry(observation).or_default() += 1;
    }
    counts
        .into_iter()
        .map(
            |((group, category), observation_count)| GroupedCategoryCount {
                group,
                category,
                observation_count,
            },
        )
        .collect()
}
