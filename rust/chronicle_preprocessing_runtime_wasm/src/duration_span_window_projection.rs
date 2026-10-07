//! Project duration-bearing spans onto a numeric analysis window.
//!
//! Positive intersections are retained with their clipped width. A span with
//! no positive intersection is still retained at width zero when its start is
//! inside the inclusive window. Inputs and outputs use one caller-owned numeric
//! coordinate system; this module performs no unit or timezone conversion.

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DurationSpan<T> {
    pub(crate) start: f64,
    pub(crate) duration: f64,
    pub(crate) payload: T,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WindowProjectedSpan<T> {
    pub(crate) start: f64,
    pub(crate) duration: f64,
    pub(crate) overlap: f64,
    pub(crate) payload: T,
}

pub(crate) fn project_duration_spans_to_window<T>(
    rows: Vec<DurationSpan<T>>,
    window_start: f64,
    window_end: f64,
) -> Vec<WindowProjectedSpan<T>> {
    rows.into_iter()
        .filter_map(|row| {
            let span_end = row.start + row.duration;
            let overlap = window_end.min(span_end) - window_start.max(row.start);
            let overlap = if overlap < 0.0 { 0.0 } else { overlap };

            let has_positive_intersection = overlap > 0.0;
            let starts_inside_inclusive_window =
                row.start >= window_start && row.start <= window_end;

            (has_positive_intersection || starts_inside_inclusive_window).then_some(
                WindowProjectedSpan {
                    start: row.start,
                    duration: row.duration,
                    overlap,
                    payload: row.payload,
                },
            )
        })
        .collect()
}
