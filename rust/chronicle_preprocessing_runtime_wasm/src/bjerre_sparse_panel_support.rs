//! Exact bounded port of Bjerre et al.'s released sparse-panel support filter.
//!
//! Source: DOI 10.1177/0956797620956613, released `load_data.R:31-57`.
//! The released caller fixes `threshold = 2`; this module deliberately does
//! not expose a configurable threshold or implement the separate `<10 hours`
//! attendance exclusion.

use std::collections::BTreeMap;

pub(crate) const BJERRE_SPARSE_PANEL_SUPPORT_THRESHOLD: usize = 2;

/// The two grouping keys surround an untouched caller-owned row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BjerreSparsePanelRow<T> {
    pub(crate) user_idx: Option<String>,
    pub(crate) course_num_sem: Option<String>,
    pub(crate) row: T,
}

/// Apply the released course-first, participant-second filter to a fixed point.
///
/// Support is row count, not distinct opposite-side identifiers. `None` is a
/// group key, matching the demonstrated dplyr NA behavior. `Vec::retain`
/// preserves source order and leaves each payload unchanged.
pub(crate) fn filter_bjerre_sparse_panel_support<T>(
    mut rows: Vec<BjerreSparsePanelRow<T>>,
) -> Vec<BjerreSparsePanelRow<T>> {
    loop {
        let before = rows.len();

        let mut users_per_course = BTreeMap::<Option<String>, usize>::new();
        for row in &rows {
            *users_per_course
                .entry(row.course_num_sem.clone())
                .or_default() += 1;
        }
        rows.retain(|row| {
            users_per_course
                .get(&row.course_num_sem)
                .is_some_and(|count| *count >= BJERRE_SPARSE_PANEL_SUPPORT_THRESHOLD)
        });

        let mut courses_per_user = BTreeMap::<Option<String>, usize>::new();
        for row in &rows {
            *courses_per_user.entry(row.user_idx.clone()).or_default() += 1;
        }
        rows.retain(|row| {
            courses_per_user
                .get(&row.user_idx)
                .is_some_and(|count| *count >= BJERRE_SPARSE_PANEL_SUPPORT_THRESHOLD)
        });

        if rows.len() == before {
            return rows;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{filter_bjerre_sparse_panel_support, BjerreSparsePanelRow};

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct SourceRow {
        row_id: u8,
        study: &'static str,
        payload: &'static str,
    }

    fn row(
        row_id: u8,
        user_idx: Option<&str>,
        course_num_sem: Option<&str>,
        study: &'static str,
        payload: &'static str,
    ) -> BjerreSparsePanelRow<SourceRow> {
        BjerreSparsePanelRow {
            user_idx: user_idx.map(str::to_owned),
            course_num_sem: course_num_sem.map(str::to_owned),
            row: SourceRow {
                row_id,
                study,
                payload,
            },
        }
    }

    #[test]
    fn released_caller_preserves_fixed_point_row_support_semantics() {
        let input = vec![
            row(1, Some("U1"), Some("C1"), "A", "stable-1"),
            row(2, Some("U1"), Some("C3"), "A", "cascade-1"),
            row(3, Some("UD"), Some("CD"), "A", "duplicate-1"),
            row(4, None, Some("CN"), "A", "na-user-1"),
            row(5, Some("U2"), Some("C1"), "A", "stable-2"),
            row(6, Some("UN"), None, "A", "na-course-1"),
            row(7, Some("U3"), Some("C3"), "A", "cascade-2"),
            row(8, Some("SX"), Some("CX"), "S1", "cross-study-1"),
            row(9, Some("U1"), Some("C2"), "A", "stable-3"),
            row(10, Some("U3"), Some("C4"), "A", "cascade-3"),
            row(11, Some("UD"), Some("CD"), "A", "duplicate-2"),
            row(12, None, Some("CN"), "A", "na-user-2"),
            row(13, Some("U2"), Some("C2"), "A", "stable-4"),
            row(14, Some("U4"), Some("C4"), "A", "cascade-4"),
            row(15, Some("UN"), None, "A", "na-course-2"),
            row(16, Some("SX"), Some("CX"), "S2", "cross-study-2"),
        ];

        let retained = filter_bjerre_sparse_panel_support(input);
        let retained_ids = retained
            .iter()
            .map(|row| row.row.row_id)
            .collect::<Vec<_>>();

        // Rows 14, 10, 7, then 2 peel across successive passes. Duplicate
        // rows, NA-key groups, and equal keys across studies each count twice.
        assert_eq!(retained_ids, vec![1, 3, 4, 5, 6, 8, 9, 11, 12, 13, 15, 16]);
        assert_eq!(retained[1].row.payload, "duplicate-1");
        assert_eq!(retained[5].row.study, "S1");
        assert_eq!(retained[11].row.study, "S2");
    }
}
