//! Unique categorical modes for caller-defined groups.
//!
//! This operator counts observations only. It does not construct groups,
//! classify categories, synthesize absent groups, or choose among tied modes.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupedUniqueMode<Group, Category> {
    pub group: Group,
    pub category: Category,
    pub frequency: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GroupedUniqueModeError<Group> {
    NonUniqueMaximum {
        group: Group,
        maximum_frequency: usize,
        tied_category_count: usize,
    },
}

/// Return the uniquely most frequent category within each observed group.
///
/// A repeated observation increases its category's frequency. If two or more
/// categories share the maximum frequency, the entire operation fails closed
/// with the affected group instead of selecting an unstated tie rule.
pub fn unique_mode_by_group<Group, Category, Rows>(
    observations: Rows,
) -> Result<Vec<GroupedUniqueMode<Group, Category>>, GroupedUniqueModeError<Group>>
where
    Group: Clone + Ord,
    Category: Ord,
    Rows: IntoIterator<Item = (Group, Category)>,
{
    let mut frequencies_by_group = BTreeMap::<Group, BTreeMap<Category, usize>>::new();
    for (group, category) in observations {
        let frequency = frequencies_by_group
            .entry(group)
            .or_default()
            .entry(category)
            .or_default();
        *frequency += 1;
    }

    frequencies_by_group
        .into_iter()
        .map(|(group, frequencies)| {
            let maximum_frequency = frequencies.values().copied().max().unwrap_or(0);
            let mut modes = frequencies
                .into_iter()
                .filter(|(_, frequency)| *frequency == maximum_frequency);
            let (category, frequency) = modes
                .next()
                .expect("an observed group contains at least one category");
            let tied_category_count = 1 + modes.count();
            if tied_category_count > 1 {
                return Err(GroupedUniqueModeError::NonUniqueMaximum {
                    group,
                    maximum_frequency,
                    tied_category_count,
                });
            }
            Ok(GroupedUniqueMode {
                group,
                category,
                frequency,
            })
        })
        .collect()
}
