use super::*;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct AggregateCsvOutput<B = Vec<u8>> {
    pub kind: String,
    pub bytes: B,
    pub row_count: u32,
}

#[derive(Clone)]
struct SummaryEntry {
    period: String,
    summary: PeriodSummary,
}

#[derive(Clone)]
struct PeriodSummary {
    study_id: String,
    participant_id: String,
    timezone: String,
    day: u8,
    weekday_mf: u8,
    weekday_mth: u8,
    weekday_su_th: u8,
    total_app_usage_minutes: f64,
    total_background_app_usage_minutes: f64,
    total_screen_usage_minutes: f64,
    app_session_count: usize,
    screen_session_count: usize,
    app_switches: usize,
    pickups: usize,
    mean_app_session_minutes: f64,
    longest_app_session_minutes: f64,
    active_window_minutes: f64,
    first_use_ns: Option<i64>,
    last_use_ns: Option<i64>,
}

const METRICS: &[&str] = &[
    "total_app_usage_minutes",
    "total_background_app_usage_minutes",
    "total_screen_usage_minutes",
    "app_session_count",
    "screen_session_count",
    "app_switches",
    "pickups",
    "mean_app_session_minutes",
    "longest_app_session_minutes",
    "active_window_minutes",
];

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn minutes(ns: i128) -> f64 {
    round4(ns as f64 / 60_000_000_000.0)
}

fn complete(row: &Row, kind: &str) -> bool {
    row.interaction_type == kind
        && row.app_package_name != NO_ACTIVITY_PLACEHOLDER_PACKAGE
        && row.start_timestamp_ns.is_some()
        && row.stop_timestamp_ns.is_some()
}

fn duration_ns(row: &Row) -> i128 {
    if row.duration_minutes.is_none() {
        return 0;
    }
    i128::from(row.stop_timestamp_ns.unwrap_or_default())
        - i128::from(row.start_timestamp_ns.unwrap_or_default())
}

fn summarize(app: Vec<&Row>, screen: Vec<&Row>, background: Vec<&Row>) -> PeriodSummary {
    let mut app = app;
    app.sort_by_key(|row| row.start_timestamp_ns);
    // A no-activity placeholder keeps its day in the summary but is no session.
    let placeholder_sample = app.first().copied();
    app.retain(|row| row.app_package_name != NO_ACTIVITY_PLACEHOLDER_PACKAGE);
    let total_app_ns: i128 = app.iter().map(|row| duration_ns(row)).sum();
    let total_background_ns: i128 = background.iter().map(|row| duration_ns(row)).sum();
    let total_screen_ns: i128 = screen.iter().map(|row| duration_ns(row)).sum();
    let with_duration = app
        .iter()
        .filter(|row| row.duration_minutes.is_some())
        .count();
    let longest = app
        .iter()
        .filter_map(|row| row.duration_minutes)
        .fold(0.0_f64, f64::max);
    let app_switches = app
        .windows(2)
        .filter(|pair| pair[0].app_package_name != pair[1].app_package_name)
        .count();
    let first_use_ns = app
        .iter()
        .chain(screen.iter())
        .filter_map(|row| row.start_timestamp_ns)
        .min();
    let last_use_ns = app
        .iter()
        .chain(screen.iter())
        .filter_map(|row| row.stop_timestamp_ns)
        .max();
    let sample = app
        .first()
        .copied()
        .or_else(|| screen.first().copied())
        .or(placeholder_sample)
        .or_else(|| background.first().copied())
        .expect("aggregate group has a sample");
    let total_app_usage_minutes = minutes(total_app_ns);
    PeriodSummary {
        study_id: sample.study_id.to_string(),
        participant_id: sample.participant_id.to_string(),
        timezone: sample.timezone.to_string(),
        day: sample.day,
        weekday_mf: sample.weekday_mf,
        weekday_mth: sample.weekday_mth,
        weekday_su_th: sample.weekday_su_th,
        total_app_usage_minutes,
        total_background_app_usage_minutes: minutes(total_background_ns),
        total_screen_usage_minutes: minutes(total_screen_ns),
        app_session_count: app.len(),
        screen_session_count: screen.len(),
        app_switches,
        pickups: screen.len(),
        mean_app_session_minutes: if with_duration == 0 {
            0.0
        } else {
            round4(total_app_usage_minutes / with_duration as f64)
        },
        longest_app_session_minutes: round4(longest),
        active_window_minutes: match (first_use_ns, last_use_ns) {
            (Some(first), Some(last)) if last > first => minutes(i128::from(last - first)),
            _ => 0.0,
        },
        first_use_ns,
        last_use_ns,
    }
}

fn compute_period_summaries<F>(
    app_rows: &[Row],
    screen_rows: &[Row],
    period_of: F,
) -> Vec<SummaryEntry>
where
    F: Fn(&str) -> String,
{
    type Key = (String, String, String);
    let key = |row: &Row| {
        (
            row.study_id.to_string(),
            row.participant_id.to_string(),
            period_of(&row.date),
        )
    };
    let mut app = BTreeMap::<Key, Vec<&Row>>::new();
    let mut background = BTreeMap::<Key, Vec<&Row>>::new();
    let mut screen = BTreeMap::<Key, Vec<&Row>>::new();
    for row in app_rows.iter().filter(|row| {
        complete(row, APP_USAGE) || row.app_package_name == NO_ACTIVITY_PLACEHOLDER_PACKAGE
    }) {
        if row.usage_layer.as_deref() == Some("secondary") {
            background.entry(key(row)).or_default().push(row);
        } else {
            app.entry(key(row)).or_default().push(row);
        }
    }
    for row in screen_rows.iter().filter(|row| complete(row, SCREEN_USAGE)) {
        screen.entry(key(row)).or_default().push(row);
    }
    let keys: BTreeSet<_> = app
        .keys()
        .chain(background.keys())
        .chain(screen.keys())
        .cloned()
        .collect();
    keys.into_iter()
        .map(|key| SummaryEntry {
            period: key.2.clone(),
            summary: summarize(
                app.remove(&key).unwrap_or_default(),
                screen.remove(&key).unwrap_or_default(),
                background.remove(&key).unwrap_or_default(),
            ),
        })
        .collect()
}

fn js_number(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        normalize_float_string(value)
    }
}

fn metric(summary: &PeriodSummary, name: &str) -> String {
    match name {
        "total_app_usage_minutes" => js_number(summary.total_app_usage_minutes),
        "total_background_app_usage_minutes" => {
            js_number(summary.total_background_app_usage_minutes)
        }
        "total_screen_usage_minutes" => js_number(summary.total_screen_usage_minutes),
        "app_session_count" => summary.app_session_count.to_string(),
        "screen_session_count" => summary.screen_session_count.to_string(),
        "app_switches" => summary.app_switches.to_string(),
        "pickups" => summary.pickups.to_string(),
        "mean_app_session_minutes" => js_number(summary.mean_app_session_minutes),
        "longest_app_session_minutes" => js_number(summary.longest_app_session_minutes),
        "active_window_minutes" => js_number(summary.active_window_minutes),
        _ => String::new(),
    }
}


fn to_csv<W: std::io::Write>(
    make_writer: &impl Fn() -> W, headers: &[&str], rows: Vec<Vec<String>>) -> W {
    let mut output = make_writer();
    let mut record = Vec::new();
    record.extend_from_slice(headers.join(",").as_bytes());
    record.push(b'\n');
    output.write_all(&record).expect("infallible artifact writer");
    for row in rows {
        record.clear();
        for (index, cell) in row.iter().enumerate() {
            if index > 0 { record.push(b','); }
            write_csv_field(&mut record, cell.as_bytes());
        }
        record.push(b'\n');
        output.write_all(&record).expect("infallible artifact writer");
    }
    output
}

const TOP_APPS_HEADERS: &[&str] = &[
    "study_id",
    "study_name",
    "participant_id",
    "date",
    "rank",
    "app_package_name",
    "application_label",
    "foreground_minutes",
    "background_minutes",
    "total_minutes",
    "session_count",
];

const CATEGORY_HEADERS: &[&str] = &[
    "study_id",
    "study_name",
    "participant_id",
    "date",
    "broad_app_category",
    "foreground_minutes",
    "background_minutes",
    "total_minutes",
    "session_count",
];

const CO_USAGE_HEADERS: &[&str] = &[
    "study_id",
    "study_name",
    "participant_id",
    "app_a",
    "app_b",
    "co_usage_count",
    "total_overlap_minutes",
];

/// The exact `summary_csv` header row. `summary_csv` writes this and the
/// field-level workflow contract binds output cells against it, so the emitted
/// columns and the declared columns cannot drift apart.
fn summary_headers(period_column: &'static str, weekly: bool, shape: &str) -> Vec<&'static str> {
    if shape == "long" {
        return vec![
            "study_id",
            "study_name",
            "participant_id",
            period_column,
            "timezone",
            "metric",
            "value",
        ];
    }
    let mut headers = vec!["study_id", "study_name", "participant_id", period_column];
    if weekly {
        headers.push("week_start_date");
    } else {
        headers.extend_from_slice(&["day", "weekdayMF", "weekdayMTh", "weekdaySuTh"]);
    }
    headers.push("timezone");
    headers.extend_from_slice(METRICS);
    headers.extend_from_slice(&["first_use", "last_use"]);
    headers
}

/// Every column each aggregate CSV can carry, for the exact `aggregate_shape`.
/// `output_cell_bindings` in `workflow_contract.rs` is checked against this list.
pub fn declared_aggregate_output_columns(kind: &str, shape: &str) -> Vec<&'static str> {
    match kind {
        "aggregate-daily-summary-csv" => summary_headers("date", false, shape),
        "aggregate-weekly-summary-csv" => summary_headers("iso_year_week", true, shape),
        "aggregate-top-apps-csv" => TOP_APPS_HEADERS.to_vec(),
        "aggregate-category-time-budget-csv" => CATEGORY_HEADERS.to_vec(),
        "aggregate-app-co-usage-csv" => CO_USAGE_HEADERS.to_vec(),
        "aggregate-participant-amount-summary-csv" => PARTICIPANT_AMOUNT_HEADERS.to_vec(),
        _ => Vec::new(),
    }
}


fn summary_csv<W: std::io::Write>(
    make_writer: &impl Fn() -> W,
    summaries: &[SummaryEntry],
    study_name: &str,
    period_column: &'static str,
    weekly: bool,
    shape: &str,
) -> W {
    let headers = summary_headers(period_column, weekly, shape);
    if shape == "long" {
        let rows = summaries
            .iter()
            .flat_map(|entry| {
                METRICS.iter().map(move |metric_name| {
                    vec![
                        entry.summary.study_id.clone(),
                        study_name.into(),
                        entry.summary.participant_id.clone(),
                        entry.period.clone(),
                        entry.summary.timezone.clone(),
                        (*metric_name).into(),
                        metric(&entry.summary, metric_name),
                    ]
                })
            })
            .collect();
        return to_csv(make_writer, &headers, rows);
    }
    let rows = summaries
        .iter()
        .map(|entry| {
            let summary = &entry.summary;
            let mut row = vec![
                summary.study_id.clone(),
                study_name.into(),
                summary.participant_id.clone(),
                entry.period.clone(),
            ];
            if weekly {
                let date = NaiveDate::parse_from_str(
                    &format!("{}-1", entry.period.replace('W', "")),
                    "%G-%V-%u",
                )
                .map(|date| date.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
                row.push(date);
            } else {
                row.extend([
                    summary.day.to_string(),
                    summary.weekday_mf.to_string(),
                    summary.weekday_mth.to_string(),
                    summary.weekday_su_th.to_string(),
                ]);
            }
            row.push(summary.timezone.clone());
            row.extend(METRICS.iter().map(|name| metric(summary, name)));
            let timezone = summary.timezone.parse::<Tz>().unwrap_or(Tz::UTC);
            row.push(fmt_session_timestamp(summary.first_use_ns, timezone));
            row.push(fmt_session_timestamp(summary.last_use_ns, timezone));
            row
        })
        .collect();
    to_csv(make_writer, &headers, rows)
}

fn iso_period(date: &str) -> String {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|date| {
            let week = date.iso_week();
            format!("{}-W{:02}", week.year(), week.week())
        })
        .unwrap_or_default()
}

#[cfg(test)]
fn top_apps_csv(app_rows: &[Row], study_name: &str, limit: u32) -> (Vec<u8>, u32) {
    top_apps_csv_with_writer::<Vec<u8>>(&Vec::new, app_rows, study_name, limit)
}

fn top_apps_csv_with_writer<W: std::io::Write>(
    make_writer: &impl Fn() -> W, app_rows: &[Row], study_name: &str, limit: u32) -> (W, u32) {
    type DayKey = (String, String, String);
    let mut days = BTreeMap::<DayKey, Vec<&Row>>::new();
    for row in app_rows.iter().filter(|row| complete(row, APP_USAGE)) {
        days.entry((
            row.study_id.to_string(),
            row.participant_id.to_string(),
            row.date.to_string(),
        ))
        .or_default()
        .push(row);
    }
    let mut records = Vec::new();
    for ((study_id, participant_id, date), rows) in days {
        let mut packages = BTreeMap::<String, Vec<&Row>>::new();
        for row in rows {
            packages
                .entry(row.app_package_name.to_string())
                .or_default()
                .push(row);
        }
        let mut ranked: Vec<_> = packages
            .into_iter()
            .map(|(package, rows)| {
                let foreground: i128 = rows
                    .iter()
                    .filter(|row| row.usage_layer.as_deref() != Some("secondary"))
                    .map(|row| duration_ns(row))
                    .sum();
                let background: i128 = rows
                    .iter()
                    .filter(|row| row.usage_layer.as_deref() == Some("secondary"))
                    .map(|row| duration_ns(row))
                    .sum();
                (
                    package,
                    rows[0].application_label.to_string(),
                    foreground,
                    background,
                    rows.len(),
                )
            })
            .collect();
        ranked.sort_by(|left, right| {
            minutes(right.2 + right.3)
                .total_cmp(&minutes(left.2 + left.3))
                .then_with(|| left.0.cmp(&right.0))
        });
        for (index, (package, label, foreground, background, count)) in ranked
            .into_iter()
            .take(if limit == 0 {
                usize::MAX
            } else {
                limit as usize
            })
            .enumerate()
        {
            records.push(vec![
                study_id.clone(),
                study_name.into(),
                participant_id.clone(),
                date.clone(),
                (index + 1).to_string(),
                package,
                label,
                js_number(minutes(foreground)),
                js_number(minutes(background)),
                js_number(minutes(foreground + background)),
                count.to_string(),
            ]);
        }
    }
    let count = records.len() as u32;
    (to_csv(make_writer, TOP_APPS_HEADERS, records), count)
}


fn category_csv_with_writer<W: std::io::Write>(
    make_writer: &impl Fn() -> W, app_rows: &[Row], study_name: &str) -> (W, u32) {
    type Key = (String, String, String, String);
    let mut groups = BTreeMap::<Key, Vec<&Row>>::new();
    for row in app_rows.iter().filter(|row| complete(row, APP_USAGE)) {
        let category = row
            .broad_app_category
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Unknown")
            .to_string();
        groups
            .entry((
                row.study_id.to_string(),
                row.participant_id.to_string(),
                row.date.to_string(),
                category,
            ))
            .or_default()
            .push(row);
    }
    let records: Vec<_> = groups
        .into_iter()
        .map(|((study, participant, date, category), rows)| {
            let foreground: i128 = rows
                .iter()
                .filter(|row| row.usage_layer.as_deref() != Some("secondary"))
                .map(|row| duration_ns(row))
                .sum();
            let background: i128 = rows
                .iter()
                .filter(|row| row.usage_layer.as_deref() == Some("secondary"))
                .map(|row| duration_ns(row))
                .sum();
            vec![
                study,
                study_name.into(),
                participant,
                date,
                category,
                js_number(minutes(foreground)),
                js_number(minutes(background)),
                js_number(minutes(foreground + background)),
                rows.len().to_string(),
            ]
        })
        .collect();
    let count = records.len() as u32;
    (to_csv(make_writer, CATEGORY_HEADERS, records), count)
}

#[cfg(test)]
fn co_usage_csv(app_rows: &[Row], study_name: &str) -> (Vec<u8>, u32) {
    co_usage_csv_with_writer::<Vec<u8>>(&Vec::new, app_rows, study_name)
}

fn co_usage_csv_with_writer<W: std::io::Write>(
    make_writer: &impl Fn() -> W, app_rows: &[Row], study_name: &str) -> (W, u32) {
    type Participant = (String, String);
    let mut participants = BTreeMap::<Participant, Vec<&Row>>::new();
    for row in app_rows.iter().filter(|row| complete(row, APP_USAGE)) {
        participants
            .entry((row.study_id.to_string(), row.participant_id.to_string()))
            .or_default()
            .push(row);
    }
    let mut records = Vec::new();
    for ((study, participant), mut sessions) in participants {
        sessions.sort_by_key(|row| row.start_timestamp_ns);
        let mut pairs = BTreeMap::<(String, String), (usize, i128)>::new();
        let mut active: Vec<&Row> = Vec::new();
        for session in sessions {
            let start = session.start_timestamp_ns.unwrap_or_default();
            active.retain(|other| other.stop_timestamp_ns.unwrap_or_default() > start);
            for other in &active {
                if other.app_package_name == session.app_package_name {
                    continue;
                }
                let end = other
                    .stop_timestamp_ns
                    .unwrap_or_default()
                    .min(session.stop_timestamp_ns.unwrap_or_default());
                let overlap = i128::from(end - start);
                if overlap <= 0 {
                    continue;
                }
                let mut names = [
                    other.app_package_name.to_string(),
                    session.app_package_name.to_string(),
                ];
                names.sort();
                let entry = pairs
                    .entry((names[0].clone(), names[1].clone()))
                    .or_default();
                entry.0 += 1;
                entry.1 += overlap;
            }
            active.push(session);
        }
        for ((app_a, app_b), (count, overlap)) in pairs {
            records.push(vec![
                study.clone(),
                study_name.into(),
                participant.clone(),
                app_a,
                app_b,
                count.to_string(),
                js_number(minutes(overlap)),
            ]);
        }
    }
    let count = records.len() as u32;
    (to_csv(make_writer, CO_USAGE_HEADERS, records), count)
}

const PARTICIPANT_AMOUNT_HEADERS: &[&str] = &[
    "participant_id",
    "days_tracked",
    "total_app_usage_minutes",
    "daily_average_minutes",
    "daily_average_minutes_winsorized",
    "huber_m_daily_minutes",
    "sample_p1_minutes",
    "sample_p99_minutes",
];

/// Nearest-rank percentile over an already-sorted ascending sample: the value
/// at 1-based rank `ceil(p/100 × n)`. Wenz, Keusch & Bach (2024) state the
/// percentile RANKS (1st/99th) and not an interpolation rule — their 10 and
/// 1200 min are the realized cut values of their sample — so the choice of
/// nearest rank is this repository's, stated in the ontology. A tiny sample
/// degenerates to min/max, which makes the clamp a no-op rather than a
/// refusal.
fn nearest_rank_percentile(sorted: &[f64], percentile: f64) -> f64 {
    let rank = ((percentile / 100.0) * sorted.len() as f64).ceil() as usize;
    sorted[rank.clamp(1, sorted.len()) - 1]
}

fn median_of_sorted(sorted: &[f64]) -> f64 {
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 1 {
        sorted[middle]
    } else {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    }
}

/// Huber M location estimate over one participant's per-day minutes.
///
/// Stachl et al. (2020) state only "we used robust estimators (e.g., Huber M
/// Estimator; ref. 61) for most variables" and their exact code is
/// unpublished (their own availability statement), so the constants here are
/// the standard ones: k = 1.345, MAD scale with the 1.4826 normal-consistency
/// factor, iterated to a fixed tolerance. A zero MAD (at least half the days
/// identical) leaves no scale to weight against and the estimate is the
/// median itself. The day series arrives date-sorted, so the summation order
/// — and therefore the f64 result — is a function of the data alone.
fn huber_m_location(days: &[f64]) -> f64 {
    const K: f64 = 1.345;
    const MAD_NORMAL_CONSISTENCY: f64 = 1.4826;
    const TOLERANCE: f64 = 1e-9;
    const MAX_ITERATIONS: usize = 100;
    let mut sorted = days.to_vec();
    sorted.sort_by(f64::total_cmp);
    let median = median_of_sorted(&sorted);
    let mut deviations: Vec<f64> = days.iter().map(|value| (value - median).abs()).collect();
    deviations.sort_by(f64::total_cmp);
    let scale = MAD_NORMAL_CONSISTENCY * median_of_sorted(&deviations);
    if scale == 0.0 {
        return median;
    }
    let mut location = median;
    for _ in 0..MAX_ITERATIONS {
        let mut weighted_sum = 0.0;
        let mut weight_total = 0.0;
        for &value in days {
            let deviation = (value - location).abs();
            let weight = if deviation <= K * scale {
                1.0
            } else {
                K * scale / deviation
            };
            weighted_sum += weight * value;
            weight_total += weight;
        }
        let next = weighted_sum / weight_total;
        let step = (next - location).abs();
        location = next;
        if step < TOLERANCE {
            break;
        }
    }
    location
}

/// One row per participant: Wenz, Keusch & Bach (2024)'s amount-of-use
/// measure — total tracked time over days tracked, with the sample-percentile
/// winsorized variant from their footnote — and Stachl et al. (2020)'s robust
/// aggregation as a side-by-side Huber M column. Estimators ride as columns,
/// not as options, so selecting between them is an analysis decision made on
/// the export rather than a preprocessing fork.
///
/// `days_tracked` counts the participant's usage days plus raw-data days with
/// no usage (the coverage spine's `usage` + `no_activity` statuses) — the
/// closest analog of Wenz's "days for which the participants' devices were
/// tracked". Tracked days without usage enter the per-day series as 0, which
/// keeps the average, the winsorized average, and the Huber M estimate all
/// over the same denominator. The winsorize sample is the participants of
/// THIS export, and the realized cut values are published per row
/// (`sample_p1_minutes`/`sample_p99_minutes`) so the export is
/// self-describing the way Wenz's 10/1200 min footnote is.
pub(super) fn participant_amount_summary_output(
    app_rows: &[Row],
    raw_dates: &BTreeMap<String, BTreeSet<String>>,
    options: &PipelineV2Options,
) -> Option<AggregateCsvOutput> {
    participant_amount_summary_output_with_writer::<Vec<u8>>(app_rows, raw_dates, options)
}

pub(super) fn participant_amount_summary_output_with_writer<W: std::io::Write + Default>(
    app_rows: &[Row],
    raw_dates: &BTreeMap<String, BTreeSet<String>>,
    options: &PipelineV2Options,
) -> Option<AggregateCsvOutput<W>> {
    participant_amount_summary_output_with_writer_factory(&W::default, app_rows, raw_dates, options)
}

pub(super) fn participant_amount_summary_output_with_writer_factory<W: std::io::Write>(
    make_writer: &impl Fn() -> W,
    app_rows: &[Row],
    raw_dates: &BTreeMap<String, BTreeSet<String>>,
    options: &PipelineV2Options,
) -> Option<AggregateCsvOutput<W>> {
    if !options.enable_participant_amount_summary {
        return None;
    }
    let mut day_minutes = BTreeMap::<String, BTreeMap<String, i128>>::new();
    for row in app_rows.iter().filter(|row| complete(row, APP_USAGE)) {
        if row.usage_layer.as_deref() == Some("secondary") {
            continue;
        }
        *day_minutes
            .entry(row.participant_id.to_string())
            .or_default()
            .entry(row.date.to_string())
            .or_default() += duration_ns(row);
    }
    let participants: BTreeSet<String> = day_minutes
        .keys()
        .chain(raw_dates.keys())
        .cloned()
        .collect();
    struct ParticipantAmount {
        participant_id: String,
        days_tracked: usize,
        total_minutes: f64,
        daily_average: f64,
        huber_m: f64,
    }
    let mut amounts = Vec::new();
    for participant_id in participants {
        let usage = day_minutes.remove(&participant_id).unwrap_or_default();
        let mut tracked_days: BTreeSet<String> = usage.keys().cloned().collect();
        if let Some(raw) = raw_dates.get(&participant_id) {
            tracked_days.extend(raw.iter().cloned());
        }
        if tracked_days.is_empty() {
            continue;
        }
        // Per-day values are the same `minutes()` roundings the daily
        // summary publishes, so this table can be recomputed from that one.
        let days: Vec<f64> = tracked_days
            .iter()
            .map(|date| usage.get(date).copied().map_or(0.0, minutes))
            .collect();
        let total: f64 = round4(days.iter().sum());
        amounts.push(ParticipantAmount {
            participant_id,
            days_tracked: days.len(),
            total_minutes: total,
            daily_average: round4(total / days.len() as f64),
            huber_m: round4(huber_m_location(&days)),
        });
    }
    let mut sample: Vec<f64> = amounts.iter().map(|amount| amount.daily_average).collect();
    sample.sort_by(f64::total_cmp);
    let (p1, p99) = if sample.is_empty() {
        (0.0, 0.0)
    } else {
        (
            nearest_rank_percentile(&sample, 1.0),
            nearest_rank_percentile(&sample, 99.0),
        )
    };
    let records = amounts
        .iter()
        .map(|amount| {
            vec![
                amount.participant_id.clone(),
                amount.days_tracked.to_string(),
                js_number(amount.total_minutes),
                js_number(amount.daily_average),
                js_number(amount.daily_average.clamp(p1, p99)),
                js_number(amount.huber_m),
                js_number(p1),
                js_number(p99),
            ]
        })
        .collect::<Vec<_>>();
    let row_count = records.len() as u32;
    Some(AggregateCsvOutput {
        kind: "aggregate-participant-amount-summary-csv".to_string(),
        bytes: to_csv(make_writer, PARTICIPANT_AMOUNT_HEADERS, records),
        row_count,
    })
}

pub(super) fn build_aggregate_outputs(
    app_rows: &[Row],
    screen_rows: &[Row],
    options: &PipelineV2Options,
) -> Vec<AggregateCsvOutput> {
    build_aggregate_outputs_with_writer::<Vec<u8>>(app_rows, screen_rows, options)
}

pub(super) fn build_aggregate_outputs_with_writer<W: std::io::Write + Default>(
    app_rows: &[Row],
    screen_rows: &[Row],
    options: &PipelineV2Options,
) -> Vec<AggregateCsvOutput<W>> {
    build_aggregate_outputs_with_writer_factory(&W::default, app_rows, screen_rows, options)
}

pub(super) fn build_aggregate_outputs_with_writer_factory<W: std::io::Write>(
    make_writer: &impl Fn() -> W,
    app_rows: &[Row],
    screen_rows: &[Row],
    options: &PipelineV2Options,
) -> Vec<AggregateCsvOutput<W>> {
    if !options.enable_aggregates {
        return Vec::new();
    }
    let daily = compute_period_summaries(app_rows, screen_rows, str::to_string);
    let weekly = compute_period_summaries(app_rows, screen_rows, iso_period);
    let long = options.aggregate_shape == "long";
    let mut outputs = vec![
        AggregateCsvOutput {
            kind: "aggregate-daily-summary-csv".to_string(),
            bytes: summary_csv(make_writer,
                &daily,
                &options.study_name,
                "date",
                false,
                &options.aggregate_shape,
            ),
            row_count: if long {
                (daily.len() * METRICS.len()) as u32
            } else {
                daily.len() as u32
            },
        },
        AggregateCsvOutput {
            kind: "aggregate-weekly-summary-csv".to_string(),
            bytes: summary_csv(make_writer,
                &weekly,
                &options.study_name,
                "iso_year_week",
                true,
                &options.aggregate_shape,
            ),
            row_count: if long {
                (weekly.len() * METRICS.len()) as u32
            } else {
                weekly.len() as u32
            },
        },
    ];
    let (bytes, row_count) = top_apps_csv_with_writer(
        make_writer,
        app_rows,
        &options.study_name,
        options.aggregate_top_apps_limit,
    );
    outputs.push(AggregateCsvOutput {
        kind: "aggregate-top-apps-csv".to_string(),
        bytes,
        row_count,
    });
    if options.use_app_codebook {
        let (bytes, row_count) = category_csv_with_writer(make_writer, app_rows, &options.study_name);
        outputs.push(AggregateCsvOutput {
            kind: "aggregate-category-time-budget-csv".to_string(),
            bytes,
            row_count,
        });
    }
    if options.model_concurrent_usage || options.use_background_apps_file {
        let (bytes, row_count) = co_usage_csv_with_writer(make_writer, app_rows, &options.study_name);
        outputs.push(AggregateCsvOutput {
            kind: "aggregate-app-co-usage-csv".to_string(),
            bytes,
            row_count,
        });
    }
    outputs
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: i64 = 60_000_000_000;

    /// (package, usage layer, start minute, stop minute, interaction type)
    type Session<'a> = (&'a str, Option<&'a str>, i64, Option<i64>, &'a str);

    fn sessions(rows: &[Session<'_>]) -> Vec<Row> {
        let stamps = rows
            .iter()
            .enumerate()
            .map(|(index, _)| format!("2026-03-07 10:{index:02}:00"))
            .collect::<Vec<_>>();
        let events: Vec<(&str, &str, &str)> = stamps
            .iter()
            .map(|stamp| (stamp.as_str(), "Activity Resumed", "com.example.chat"))
            .collect();
        let mut built = crate::pipeline_v2::tests::rows_from_events(&events);
        for (row, (package, layer, start, stop, kind)) in built.iter_mut().zip(rows) {
            let data = row.edit_all();
            data.study_id = "Study".into();
            data.participant_id = "P01".into();
            data.date = "2026-03-07".into();
            data.interaction_type = (*kind).into();
            data.app_package_name = (*package).into();
            data.application_label = (*package).into();
            data.usage_layer = layer.map(SharedString::from);
            data.start_timestamp_ns = Some(*start * MINUTE);
            data.stop_timestamp_ns = stop.map(|stop| stop * MINUTE);
            data.duration_minutes = stop.map(|stop| (stop - *start) as f64);
        }
        built
    }

    fn csv_rows(bytes: &[u8]) -> Vec<Vec<String>> {
        String::from_utf8(bytes.to_vec())
            .expect("aggregate CSV is UTF-8")
            .lines()
            .map(|line| line.split(',').map(str::to_owned).collect())
            .collect()
    }

    fn amount_options(enabled: bool) -> PipelineV2Options {
        let mut options = crate::pipeline_v2::tests::test_options();
        options.enable_participant_amount_summary = enabled;
        options
    }

    fn amount_rows(per_participant: &[(&str, &[(&str, f64)])]) -> Vec<Row> {
        let template = sessions(&[("com.example.chat", None, 0, Some(1), APP_USAGE)])
            .pop()
            .expect("one template row");
        let mut rows = Vec::new();
        for (participant, days) in per_participant {
            for (date, minutes) in days.iter() {
                let mut row = template.clone();
                let data = row.edit_all();
                data.participant_id = (*participant).into();
                data.date = (*date).into();
                data.start_timestamp_ns = Some(0);
                data.stop_timestamp_ns = Some((*minutes * MINUTE as f64) as i64);
                data.duration_minutes = Some(*minutes);
                rows.push(row);
            }
        }
        rows
    }

    fn amount_csv(
        rows: &[Row],
        raw_dates: &BTreeMap<String, BTreeSet<String>>,
    ) -> Vec<Vec<String>> {
        let output = participant_amount_summary_output(rows, raw_dates, &amount_options(true))
            .expect("the selected summary materializes");
        assert_eq!(output.kind, "aggregate-participant-amount-summary-csv");
        assert_eq!(output.row_count as usize, csv_rows(&output.bytes).len() - 1);
        csv_rows(&output.bytes)
    }

    /// A no-activity placeholder keeps its day in the period summaries — a
    /// zero-usage day still counts as a day — but it is not an app session.
    #[test]
    fn a_no_activity_placeholder_keeps_its_day_but_is_no_session() {
        let rows = sessions(&[(NO_ACTIVITY_PLACEHOLDER_PACKAGE, None, 0, Some(0), APP_USAGE)]);
        let summaries = compute_period_summaries(&rows, &[], str::to_string);
        assert_eq!(summaries.len(), 1, "the zero-usage day is still summarized");
        assert_eq!(summaries[0].summary.app_session_count, 0);
        assert_eq!(summaries[0].summary.total_app_usage_minutes, 0.0);
    }

    /// Off by default: no artifact, so every existing output stays
    /// byte-identical. The option is the only gate.
    #[test]
    fn the_participant_amount_summary_is_absent_unless_selected() {
        let rows = amount_rows(&[("P01", &[("2026-03-07", 60.0)])]);
        assert!(
            participant_amount_summary_output(&rows, &BTreeMap::new(), &amount_options(false))
                .is_none()
        );
    }

    /// Wenz, Keusch & Bach: amount = total tracked time over days TRACKED,
    /// not days used. Two raw-data days with no usage enter the denominator
    /// and the per-day series as zeros, so the average is 20, not 60 — and
    /// the Huber M estimate is the robust center of [60, 0, 0], which is 0.
    #[test]
    fn daily_amount_counts_tracked_days_including_zero_usage_days() {
        let rows = amount_rows(&[("P01", &[("2026-03-07", 60.0)])]);
        let raw_dates = BTreeMap::from([(
            "P01".to_string(),
            BTreeSet::from([
                "2026-03-07".to_string(),
                "2026-03-08".to_string(),
                "2026-03-09".to_string(),
            ]),
        )]);
        let lines = amount_csv(&rows, &raw_dates);
        assert_eq!(
            lines,
            vec![
                PARTICIPANT_AMOUNT_HEADERS
                    .iter()
                    .map(|header| header.to_string())
                    .collect::<Vec<_>>(),
                vec![
                    "P01".to_string(),
                    "3".to_string(),
                    "60".to_string(),
                    "20".to_string(),
                    "20".to_string(),
                    "0".to_string(),
                    "20".to_string(),
                    "20".to_string(),
                ],
            ],
        );
    }

    /// Stachl: the robust estimator rides beside the mean, not instead of it.
    /// P01's clipped weights cancel exactly at the bulk (the fixed point is
    /// 10 while the mean is 67.6); P02's second outlier breaks the symmetry
    /// and the pinned value comes from the standard constants (k = 1.345,
    /// 1.4826 x MAD). With two participants the nearest-rank 1st/99th cuts
    /// degenerate to min/max, so winsorizing is a documented no-op here.
    #[test]
    fn huber_m_downweights_outlier_days_where_the_mean_cannot() {
        let p01_days: &[(&str, f64)] = &[
            ("2026-03-07", 8.0),
            ("2026-03-08", 9.0),
            ("2026-03-09", 10.0),
            ("2026-03-10", 11.0),
            ("2026-03-11", 300.0),
        ];
        let p02_days: &[(&str, f64)] = &[
            ("2026-03-07", 8.0),
            ("2026-03-08", 9.0),
            ("2026-03-09", 10.0),
            ("2026-03-10", 11.0),
            ("2026-03-11", 300.0),
            ("2026-03-12", 301.0),
        ];
        let rows = amount_rows(&[("P01", p01_days), ("P02", p02_days)]);
        let lines = amount_csv(&rows, &BTreeMap::new());
        assert_eq!(
            lines[1],
            vec!["P01", "5", "338", "67.6", "67.6", "10", "67.6", "106.5"],
        );
        assert_eq!(
            lines[2],
            vec!["P02", "6", "639", "106.5", "106.5", "11.4941", "67.6", "106.5"],
        );
    }

    /// The 1st/99th cuts are nearest-rank over the export's participants, so
    /// they only bite once the sample is large enough for those ranks to
    /// leave the extremes: at n = 101 the cuts are the 2nd and 100th values
    /// and both tail participants are clamped, publishing the realized cut
    /// values on every row the way Wenz's 10/1200 min footnote does.
    #[test]
    fn nearest_rank_cuts_clamp_only_the_sample_tails() {
        assert_eq!(nearest_rank_percentile(&[5.0], 1.0), 5.0);
        assert_eq!(nearest_rank_percentile(&[5.0], 99.0), 5.0);
        let two_hundred: Vec<f64> = (1..=200).map(f64::from).collect();
        assert_eq!(nearest_rank_percentile(&two_hundred, 1.0), 2.0);
        assert_eq!(nearest_rank_percentile(&two_hundred, 99.0), 198.0);

        let participants: Vec<(String, f64)> = (1..=101)
            .map(|index| (format!("P{index:03}"), f64::from(index)))
            .collect();
        let spec: Vec<(&str, Vec<(&str, f64)>)> = participants
            .iter()
            .map(|(name, minutes)| (name.as_str(), vec![("2026-03-07", *minutes)]))
            .collect();
        let spec_refs: Vec<(&str, &[(&str, f64)])> = spec
            .iter()
            .map(|(name, days)| (*name, days.as_slice()))
            .collect();
        let rows = amount_rows(&spec_refs);
        let lines = amount_csv(&rows, &BTreeMap::new());
        assert_eq!(
            lines[1],
            vec!["P001", "1", "1", "1", "2", "1", "2", "100"],
            "the low tail is clamped up to the realized 1st-percentile cut",
        );
        assert_eq!(
            lines[101],
            vec!["P101", "1", "101", "101", "100", "101", "2", "100"],
            "the high tail is clamped down to the realized 99th-percentile cut",
        );
        assert_eq!(
            lines[50],
            vec!["P050", "1", "50", "50", "50", "50", "2", "100"],
            "an interior participant is untouched",
        );
    }

    /// The aggregates describe app usage, so they count only completed app
    /// sessions: a screen session sitting in the same row list is a different
    /// kind, and an app session that never got a stop is not a session yet.
    #[test]
    fn aggregates_count_only_completed_sessions_of_their_own_kind() {
        let rows = sessions(&[
            ("com.example.counted", None, 0, Some(10), APP_USAGE),
            ("com.example.screen", None, 0, Some(10), SCREEN_USAGE),
            ("com.example.unfinished", None, 0, None, APP_USAGE),
        ]);
        let (bytes, count) = top_apps_csv(&rows, "Study", 0);
        assert_eq!(count, 1, "only the completed app session may be ranked");
        let lines = csv_rows(&bytes);
        assert_eq!(lines.len(), 2, "one header and one ranked app");
        assert!(
            lines[1].contains(&"com.example.counted".to_string()),
            "{:?}",
            lines[1],
        );
    }

    /// Co-usage means two apps were open at the same instant. Sessions that
    /// merely abut — one stopping exactly when the next starts — share no
    /// time, so they must not be reported as a co-usage pair however the
    /// active-session scan decides to retire the earlier one.
    #[test]
    fn sessions_that_only_abut_are_not_co_usage() {
        let rows = sessions(&[
            ("com.example.first", None, 0, Some(10), APP_USAGE),
            ("com.example.second", None, 10, Some(20), APP_USAGE),
        ]);
        let (bytes, count) = co_usage_csv(&rows, "Study");
        assert_eq!(count, 0, "abutting sessions were reported as co-usage");
        assert_eq!(csv_rows(&bytes).len(), 1, "only the header may be written");

        let overlapping = sessions(&[
            ("com.example.first", None, 0, Some(10), APP_USAGE),
            ("com.example.second", None, 9, Some(20), APP_USAGE),
        ]);
        let (bytes, count) = co_usage_csv(&overlapping, "Study");
        assert_eq!(count, 1, "a one-minute overlap is co-usage");
        let lines = csv_rows(&bytes);
        assert!(
            lines[1].contains(&"1".to_string()),
            "expected one overlapping minute in {:?}",
            lines[1]
        );
    }

    /// The active window spans the first start to the last stop. A day whose
    /// only session is instantaneous spans nothing, so it reports zero
    /// minutes rather than a window.
    #[test]
    fn an_instantaneous_day_has_no_active_window() {
        let rows = sessions(&[("com.example.blink", None, 5, Some(5), APP_USAGE)]);
        let borrowed: Vec<&Row> = rows.iter().collect();
        let summary = summarize(borrowed, Vec::new(), Vec::new());
        assert_eq!(
            summary.active_window_minutes, 0.0,
            "a zero-length day reported an active window"
        );
        assert_eq!(summary.first_use_ns, summary.last_use_ns);

        let spanned = sessions(&[("com.example.real", None, 5, Some(11), APP_USAGE)]);
        let borrowed: Vec<&Row> = spanned.iter().collect();
        assert_eq!(
            summarize(borrowed, Vec::new(), Vec::new()).active_window_minutes,
            6.0
        );
    }

    /// The top-apps table ranks by the whole day an app was used: foreground
    /// and background minutes added together, not one weighed against the
    /// other. An app with less foreground time can still outrank one with more.
    #[test]
    fn top_apps_rank_by_foreground_and_background_minutes_together() {
        let rows = sessions(&[
            ("com.example.foreground", None, 0, Some(10), APP_USAGE),
            ("com.example.both", None, 20, Some(26), APP_USAGE),
            (
                "com.example.both",
                Some("secondary"),
                30,
                Some(38),
                APP_USAGE,
            ),
        ]);
        let (bytes, count) = top_apps_csv(&rows, "Study", 0);
        assert_eq!(count, 2);
        let lines = csv_rows(&bytes);
        let column = |name: &str| {
            lines[0]
                .iter()
                .position(|header| header == name)
                .unwrap_or_else(|| panic!("{name} is not a top-apps column"))
        };
        let package = column("app_package_name");
        let total = column("total_minutes");
        assert_eq!(
            (lines[1][package].as_str(), lines[1][total].as_str()),
            ("com.example.both", "14"),
            "6 foreground plus 8 background minutes outranks 10 foreground",
        );
        assert_eq!(
            (lines[2][package].as_str(), lines[2][total].as_str()),
            ("com.example.foreground", "10"),
        );
    }

    #[test]
    fn top_apps_limit_keeps_exactly_the_highest_ranked_rows() {
        let rows = sessions(&[
            ("com.example.a", None, 0, Some(60), APP_USAGE),
            ("com.example.b", None, 0, Some(50), APP_USAGE),
            ("com.example.c", None, 0, Some(40), APP_USAGE),
            ("com.example.d", None, 0, Some(30), APP_USAGE),
            ("com.example.e", None, 0, Some(20), APP_USAGE),
            ("com.example.f", None, 0, Some(10), APP_USAGE),
        ]);
        let (bytes, count) = top_apps_csv(&rows, "Study", 5);
        let lines = csv_rows(&bytes);
        let package = lines[0]
            .iter()
            .position(|header| header == "app_package_name")
            .expect("top-apps package column");
        assert_eq!(count, 5);
        assert_eq!(lines.len(), 6);
        assert_eq!(lines[5][package], "com.example.e");
        assert!(lines
            .iter()
            .all(|line| !line.contains(&"com.example.f".into())));
    }

    /// A period summary describes completed sessions of one kind. A row of the
    /// other kind sitting in the same list, and a session that never got a
    /// stop, are both excluded — from the counts and from the minutes — and the
    /// active window spans the first start to the last stop across both kinds.
    #[test]
    fn period_summaries_count_only_completed_sessions_of_the_matching_kind() {
        let app = sessions(&[
            ("com.example.chat", None, 0, Some(10), APP_USAGE),
            ("com.example.mail", None, 12, None, APP_USAGE),
            ("com.example.screen", None, 0, Some(30), SCREEN_USAGE),
            (
                "com.example.player",
                Some("secondary"),
                0,
                Some(4),
                APP_USAGE,
            ),
        ]);
        let screen = sessions(&[
            ("com.example.screen", None, 0, Some(14), SCREEN_USAGE),
            ("com.example.screen", None, 20, None, SCREEN_USAGE),
        ]);

        let summaries = compute_period_summaries(&app, &screen, str::to_owned);
        assert_eq!(summaries.len(), 1);
        let summary = &summaries[0].summary;
        assert_eq!(summaries[0].period, "2026-03-07");
        assert_eq!(
            (summary.app_session_count, summary.screen_session_count),
            (1, 1),
            "the unfinished session and the other kind's row are not sessions here",
        );
        assert_eq!(summary.total_app_usage_minutes, 10.0);
        assert_eq!(summary.total_background_app_usage_minutes, 4.0);
        assert_eq!(summary.total_screen_usage_minutes, 14.0);
        assert_eq!(summary.mean_app_session_minutes, 10.0);
        assert_eq!(summary.longest_app_session_minutes, 10.0);
        assert_eq!(
            summary.active_window_minutes, 14.0,
            "the window runs from the first start to the last stop of either kind",
        );
    }
}
