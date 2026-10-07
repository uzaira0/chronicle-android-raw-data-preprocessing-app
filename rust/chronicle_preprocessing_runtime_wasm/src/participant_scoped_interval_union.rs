#[derive(Debug, Clone)]
pub(crate) struct ParticipantInterval {
    pub participant_id: String,
    pub application_name: Option<String>,
    pub application_category: Option<String>,
    pub start_unix_seconds: f64,
    pub end_unix_seconds: f64,
    pub derived_duration_seconds: f64,
}

#[derive(Debug, Clone)]
pub(crate) enum ScopeSelector {
    All,
    ApplicationNameIn(Vec<String>),
    ApplicationCategoryEquals(String),
}

#[derive(Debug, Clone)]
pub(crate) struct IntervalUnionScope {
    pub scope_id: String,
    pub selector: ScopeSelector,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DurationUnit {
    Seconds,
    Minutes,
    Hours,
    Days,
}

impl DurationUnit {
    pub(crate) fn source_label(self) -> &'static str {
        match self {
            Self::Seconds => "secs",
            Self::Minutes => "mins",
            Self::Hours => "hours",
            Self::Days => "days",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct UnionInterval {
    pub participant_id: String,
    pub start_unix_seconds: i64,
    pub end_unix_seconds: i64,
    pub duration: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ScopeIntervals {
    pub scope_id: String,
    pub intervals: Vec<UnionInterval>,
    pub duration_unit: DurationUnit,
}

#[derive(Debug, Clone, Copy)]
struct Int32Interval<'a> {
    source: &'a ParticipantInterval,
    start: i32,
    end: i32,
}

fn int32_coordinate(value: f64, row_index: usize) -> Result<i32, String> {
    let truncated = value.trunc();
    if !value.is_finite() || truncated < i32::MIN as f64 || truncated > i32::MAX as f64 {
        return Err(format!(
            "participant-scoped interval row {row_index} has a coordinate outside signed int32"
        ));
    }
    Ok(truncated as i32)
}

fn duration_unit(intervals: &[UnionInterval]) -> DurationUnit {
    match intervals
        .iter()
        .map(|interval| (interval.end_unix_seconds - interval.start_unix_seconds).unsigned_abs())
        .min()
    {
        Some(seconds) if seconds >= 86_400 => DurationUnit::Days,
        Some(seconds) if seconds >= 3_600 => DurationUnit::Hours,
        Some(seconds) if seconds >= 60 => DurationUnit::Minutes,
        _ => DurationUnit::Seconds,
    }
}

fn selected(row: &ParticipantInterval, selector: &ScopeSelector) -> bool {
    match selector {
        ScopeSelector::All => true,
        ScopeSelector::ApplicationNameIn(names) => row
            .application_name
            .as_deref()
            .is_some_and(|name| names.iter().any(|candidate| candidate == name)),
        ScopeSelector::ApplicationCategoryEquals(category) => {
            row.application_category.as_deref() == Some(category.as_str())
        }
    }
}

fn union_scope<'a>(
    scope: &IntervalUnionScope,
    rows: impl Iterator<Item = Int32Interval<'a>>,
) -> ScopeIntervals {
    let mut rows = rows.collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        left.source
            .participant_id
            .cmp(&right.source.participant_id)
            .then(left.start.cmp(&right.start))
            .then(left.end.cmp(&right.end))
    });

    let mut intervals = Vec::<UnionInterval>::new();
    for row in rows {
        if let Some(current) = intervals.last_mut() {
            if current.participant_id == row.source.participant_id
                && i64::from(row.start) <= current.end_unix_seconds
            {
                current.end_unix_seconds = current.end_unix_seconds.max(i64::from(row.end));
                continue;
            }
        }
        intervals.push(UnionInterval {
            participant_id: row.source.participant_id.clone(),
            start_unix_seconds: i64::from(row.start),
            end_unix_seconds: i64::from(row.end),
            duration: 0.0,
        });
    }

    let duration_unit = duration_unit(&intervals);
    let divisor = match duration_unit {
        DurationUnit::Seconds => 1.0,
        DurationUnit::Minutes => 60.0,
        DurationUnit::Hours => 3_600.0,
        DurationUnit::Days => 86_400.0,
    };
    for interval in &mut intervals {
        interval.duration =
            (interval.end_unix_seconds - interval.start_unix_seconds) as f64 / divisor;
    }
    ScopeIntervals {
        scope_id: scope.scope_id.clone(),
        intervals,
        duration_unit,
    }
}

/// Union touching or overlapping intervals independently for each participant
/// and each caller-supplied scope. Coordinates follow the evidenced valr path:
/// finite POSIXct doubles truncate toward zero into signed 32-bit integers.
pub(crate) fn participant_scoped_interval_unions(
    rows: &[ParticipantInterval],
    scopes: &[IntervalUnionScope],
) -> Result<Vec<ScopeIntervals>, String> {
    let mut int32_rows = Vec::with_capacity(rows.len());
    for (row_index, row) in rows.iter().enumerate() {
        if row.participant_id.is_empty() {
            return Err(format!(
                "participant-scoped interval row {row_index} has no participant_id"
            ));
        }
        if !row.derived_duration_seconds.is_finite() || row.derived_duration_seconds <= 0.0 {
            return Err(format!(
                "participant-scoped interval row {row_index} has non-positive or missing derived duration"
            ));
        }
        if !row.start_unix_seconds.is_finite() || !row.end_unix_seconds.is_finite() {
            return Err(format!(
                "participant-scoped interval row {row_index} has a non-finite interval"
            ));
        }
        if row.start_unix_seconds >= row.end_unix_seconds {
            return Err(format!(
                "participant-scoped interval row {row_index} is not increasing"
            ));
        }
        int32_rows.push(Int32Interval {
            source: row,
            start: int32_coordinate(row.start_unix_seconds, row_index)?,
            end: int32_coordinate(row.end_unix_seconds, row_index)?,
        });
    }

    Ok(scopes
        .iter()
        .map(|scope| {
            union_scope(
                scope,
                int32_rows
                    .iter()
                    .copied()
                    .filter(|row| selected(row.source, &scope.selector)),
            )
        })
        .collect())
}
