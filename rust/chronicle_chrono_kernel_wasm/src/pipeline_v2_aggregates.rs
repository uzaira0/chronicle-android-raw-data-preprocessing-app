use super::*;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct AggregateCsvOutput {
    pub kind: String,
    pub bytes: Vec<u8>,
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
    for row in app_rows.iter().filter(|row| complete(row, APP_USAGE)) {
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

fn to_csv(headers: &[&str], rows: Vec<Vec<String>>) -> Vec<u8> {
    let mut output = Vec::new();
    output.extend_from_slice(headers.join(",").as_bytes());
    output.push(b'\n');
    for row in rows {
        for (index, cell) in row.iter().enumerate() {
            if index > 0 {
                output.push(b',');
            }
            write_csv_field(&mut output, cell.as_bytes());
        }
        output.push(b'\n');
    }
    output
}

fn summary_csv(
    summaries: &[SummaryEntry],
    study_name: &str,
    period_column: &str,
    weekly: bool,
    shape: &str,
) -> Vec<u8> {
    if shape == "long" {
        let headers = [
            "study_id",
            "study_name",
            "participant_id",
            period_column,
            "timezone",
            "metric",
            "value",
        ];
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
        return to_csv(&headers, rows);
    }
    let extra_headers: &[&str] = if weekly {
        &["week_start_date"]
    } else {
        &["day", "weekdayMF", "weekdayMTh", "weekdaySuTh"]
    };
    let mut headers = vec!["study_id", "study_name", "participant_id", period_column];
    headers.extend_from_slice(extra_headers);
    headers.push("timezone");
    headers.extend_from_slice(METRICS);
    headers.extend_from_slice(&["first_use", "last_use"]);
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
    to_csv(&headers, rows)
}

fn iso_period(date: &str) -> String {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|date| {
            let week = date.iso_week();
            format!("{}-W{:02}", week.year(), week.week())
        })
        .unwrap_or_default()
}

fn top_apps_csv(app_rows: &[Row], study_name: &str) -> (Vec<u8>, u32) {
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
        for (index, (package, label, foreground, background, count)) in
            ranked.into_iter().enumerate()
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
    (
        to_csv(
            &[
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
            ],
            records,
        ),
        count,
    )
}

fn category_csv(app_rows: &[Row], study_name: &str) -> (Vec<u8>, u32) {
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
    (
        to_csv(
            &[
                "study_id",
                "study_name",
                "participant_id",
                "date",
                "broad_app_category",
                "foreground_minutes",
                "background_minutes",
                "total_minutes",
                "session_count",
            ],
            records,
        ),
        count,
    )
}

fn co_usage_csv(app_rows: &[Row], study_name: &str) -> (Vec<u8>, u32) {
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
    (
        to_csv(
            &[
                "study_id",
                "study_name",
                "participant_id",
                "app_a",
                "app_b",
                "co_usage_count",
                "total_overlap_minutes",
            ],
            records,
        ),
        count,
    )
}

pub(super) fn build_aggregate_outputs(
    app_rows: &[Row],
    screen_rows: &[Row],
    options: &PipelineV2Options,
) -> Vec<AggregateCsvOutput> {
    if !options.enable_aggregates {
        return Vec::new();
    }
    let daily = compute_period_summaries(app_rows, screen_rows, str::to_string);
    let weekly = compute_period_summaries(app_rows, screen_rows, iso_period);
    let long = options.aggregate_shape == "long";
    let mut outputs = vec![
        AggregateCsvOutput {
            kind: "aggregate-daily-summary-csv".to_string(),
            bytes: summary_csv(
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
            bytes: summary_csv(
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
    let (bytes, row_count) = top_apps_csv(app_rows, &options.study_name);
    outputs.push(AggregateCsvOutput {
        kind: "aggregate-top-apps-csv".to_string(),
        bytes,
        row_count,
    });
    if options.use_app_codebook {
        let (bytes, row_count) = category_csv(app_rows, &options.study_name);
        outputs.push(AggregateCsvOutput {
            kind: "aggregate-category-time-budget-csv".to_string(),
            bytes,
            row_count,
        });
    }
    if options.model_concurrent_usage || options.use_background_apps_file {
        let (bytes, row_count) = co_usage_csv(app_rows, &options.study_name);
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
        let (bytes, count) = top_apps_csv(&rows, "Study");
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
        let (bytes, count) = top_apps_csv(&rows, "Study");
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
