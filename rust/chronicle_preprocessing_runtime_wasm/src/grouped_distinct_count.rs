//! Distinct-member counts for caller-defined groups.
//!
//! Group and member identities remain caller-owned typed values. This operator
//! does not construct groups, classify members, or emit groups absent from the
//! observations.

use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupedDistinctCount<Group> {
    pub group: Group,
    pub distinct_member_count: usize,
}

/// Count unique members independently within each observed group.
///
/// Repeated `(group, member)` observations collapse to one member. The same
/// member in different groups contributes once to each group. Results are
/// ordered by `Group`; no unobserved group is synthesized or zero-filled.
pub fn count_distinct_members_by_group<Group, Member, Rows>(
    observations: Rows,
) -> Vec<GroupedDistinctCount<Group>>
where
    Group: Clone + Ord,
    Member: Ord,
    Rows: IntoIterator<Item = (Group, Member)>,
{
    distinct_members_by_group(observations)
        .into_iter()
        .map(|(group, members)| GroupedDistinctCount {
            group,
            distinct_member_count: members.len(),
        })
        .collect()
}

/// The same existing set accumulation, retaining members instead of projecting
/// only cardinality. Ordered set transport does not imply source event order.
pub fn distinct_members_by_group<Group, Member, Rows>(
    observations: Rows,
) -> Vec<(Group, BTreeSet<Member>)>
where
    Group: Clone + Ord,
    Member: Ord,
    Rows: IntoIterator<Item = (Group, Member)>,
{
    let mut members_by_group = BTreeMap::<Group, BTreeSet<Member>>::new();
    for (group, member) in observations {
        members_by_group.entry(group).or_default().insert(member);
    }
    members_by_group
        .into_iter()
        .collect()
}
