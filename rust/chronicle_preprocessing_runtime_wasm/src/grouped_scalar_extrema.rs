//! Finite scalar extrema for caller-defined groups.
//!
//! This operator does not construct groups, interpret scalar coordinates, or
//! synthesize groups that are absent from the supplied observations.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct GroupedScalarExtrema<Group> {
    pub group: Group,
    pub minimum: f64,
    pub maximum: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GroupedScalarExtremaError<Group> {
    NonFiniteValue { group: Group, value: f64 },
}

/// Return the minimum and maximum finite scalar supplied for each group.
///
/// Results are sorted by group. Equal or repeated values do not change an
/// extremum. The entire operation fails closed when any value is non-finite.
pub fn finite_scalar_extrema_by_group<Group, Rows>(
    observations: Rows,
) -> Result<Vec<GroupedScalarExtrema<Group>>, GroupedScalarExtremaError<Group>>
where
    Group: Ord,
    Rows: IntoIterator<Item = (Group, f64)>,
{
    let mut extrema = BTreeMap::<Group, (f64, f64)>::new();
    for (group, value) in observations {
        if !value.is_finite() {
            return Err(GroupedScalarExtremaError::NonFiniteValue { group, value });
        }

        extrema
            .entry(group)
            .and_modify(|(minimum, maximum)| {
                *minimum = minimum.min(value);
                *maximum = maximum.max(value);
            })
            .or_insert((value, value));
    }

    Ok(extrema
        .into_iter()
        .map(|(group, (minimum, maximum))| GroupedScalarExtrema {
            group,
            minimum,
            maximum,
        })
        .collect())
}
